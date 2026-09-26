// Promise-style wrapper around the calculation worker.

import type { Advice, Setup, StrategyResult, WorkerRequest, WorkerResponse } from '../api';
import type { Action, BaseDef, Item, ModDef } from '../engine/types';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onStrategy?: (r: StrategyResult) => void;
};

export class WorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.readyPromise = new Promise((r) => (this.readyResolve = r));
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
  }

  init(mods: ModDef[], bases: BaseDef[], ru?: Record<string, string>): Promise<void> {
    this.send({ type: 'init', mods, bases, ...(ru ? { ru } : {}) });
    return this.readyPromise;
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === 'ready') {
      this.readyResolve();
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'strategy':
        p.onStrategy?.(msg.result);
        return;
      case 'evaluated':
        this.pending.delete(msg.id);
        p.resolve(undefined);
        return;
      case 'advice':
        this.pending.delete(msg.id);
        p.resolve(msg.advice);
        return;
      case 'rolled':
        this.pending.delete(msg.id);
        p.resolve(msg.item);
        return;
      case 'error':
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
        return;
    }
  }

  private request<T>(build: (id: number) => WorkerRequest, onStrategy?: (r: StrategyResult) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onStrategy });
      this.send(build(id));
    });
  }

  evaluate(setup: Setup, trials: number, start: Item | null, onStrategy: (r: StrategyResult) => void): Promise<void> {
    return this.request<void>((id) => ({ type: 'evaluate', id, setup, trials, ...(start ? { start } : {}) }), onStrategy);
  }

  advise(setup: Setup, strategyId: string, item: Item, trials: number): Promise<Advice> {
    return this.request<Advice>((id) => ({ type: 'advise', id, setup, strategyId, item, trials }));
  }

  roll(setup: Setup, strategyId: string, item: Item, action: Action): Promise<Item> {
    return this.request<Item>((id) => ({ type: 'roll', id, setup, strategyId, item, action, seed: Math.floor(Math.random() * 1e9) }));
  }
}
