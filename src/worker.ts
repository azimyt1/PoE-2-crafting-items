/// <reference lib="webworker" />
// Calculation worker: runs planners and simulations off the UI thread.

import type { Advice, OutcomeView, PlanStepView, Setup, StrategyResult, WorkerRequest, WorkerResponse } from './api';
import { sample } from './engine/actions';
import { actionTitleRu } from './engine/currency';
import { analyze, buildCtx, modOf } from './engine/item';
import { Planner } from './engine/planner';
import { explainPlan, makeRng, simulate, type PlanStep } from './engine/simulate';
import { STRATEGIES } from './engine/strategies';
import type { BaseDef, Ctx, Item, ModDef } from './engine/types';

let mods: ModDef[] = [];
let bases = new Map<string, BaseDef>();
const planners = new Map<string, Planner>();

function post(msg: WorkerResponse) {
  (self as unknown as Worker).postMessage(msg);
}

function ctxFor(setup: Setup): Ctx {
  const base = bases.get(setup.baseId);
  if (!base) throw new Error('База не найдена');
  return buildCtx({ base, ilvl: setup.ilvl, mods, prices: setup.prices, baseCost: setup.baseCost, weightOverrides: setup.weights, essences: setup.essences });
}

function plannerFor(setup: Setup, strategyId: string): Planner {
  const key = JSON.stringify(setup) + '|' + strategyId;
  let p = planners.get(key);
  if (!p) {
    const strategy = STRATEGIES.find((s) => s.id === strategyId);
    if (!strategy) throw new Error('Неизвестная стратегия');
    if (planners.size > 30) planners.clear();
    p = new Planner(ctxFor(setup), setup.target, strategy);
    planners.set(key, p);
  }
  return p;
}

function modsText(ctx: Ctx, item: Item): string[] {
  return item.mods.map((m) => {
    const d = modOf(ctx, m);
    return `${d.s === 'p' ? 'П' : 'С'}: ${d.x.replace(/\n/g, ' / ')} (ур. ${d.l})${m.fr ? ' [расколот]' : ''}${m.de ? ' [очернён]' : ''}`;
  });
}

function planView(ctx: Ctx, steps: PlanStep[]): PlanStepView[] {
  return steps.map((s) => ({
    title: s.title,
    cost: s.cost,
    pGood: s.pGood,
    fallback: s.fallback,
    pFallback: s.pFallback,
    remaining: s.remaining,
    itemAfter: modsText(ctx, s.itemAfter),
  }));
}

function evaluate(id: number, setup: Setup, trials: number, strategyIds?: string[]) {
  for (const s of STRATEGIES) {
    if (strategyIds && !strategyIds.includes(s.id)) continue;
    const planner = plannerFor(setup, s.id);
    const start: Item = { rarity: 'normal', mods: [] };
    const impossible = planner.impossible(start);
    const sim = impossible
      ? null
      : simulate(planner, start, { trials, maxSteps: 4000, buyFirstBase: true, seed: 11 });
    const result: StrategyResult = {
      strategyId: s.id,
      name: s.name,
      description: s.description,
      estimate: impossible ? Infinity : planner.restartCost,
      successRate: sim?.successRate ?? 0,
      meanCost: sim?.meanCost ?? Infinity,
      medianCost: sim?.medianCost ?? Infinity,
      p90Cost: sim?.p90Cost ?? Infinity,
      meanSteps: sim?.meanSteps ?? 0,
      meanRestarts: sim?.meanRestarts ?? 0,
      firstBaseSuccess: sim?.firstBaseSuccess ?? 0,
      usage: sim ? Object.entries(sim.usage).sort((a, b) => b[1] - a[1]) : [],
      plan: impossible ? [] : planView(planner.ctx, explainPlan(planner, start)),
      impossible,
    };
    post({ type: 'strategy', id, result });
  }
  post({ type: 'evaluated', id });
}

function describeOutcome(planner: Planner, before: Item, after: Item): OutcomeView['label'] {
  const ctx = planner.ctx;
  const beforeIds = before.mods.map((m) => m.id);
  const afterIds = after.mods.map((m) => m.id);
  const parts: string[] = [];
  const removed = [...beforeIds];
  for (const id of afterIds) {
    const k = removed.indexOf(id);
    if (k >= 0) removed.splice(k, 1);
    else {
      const m = ctx.byId.get(id)!;
      const cls = planner.classify(m);
      if (cls[0] === 'h') parts.push(`+ нужный: ${planner.target.reqs[+cls.slice(1)].label}`);
      else if (cls[0] === 'b') parts.push(`+ низкий тир нужного мода (блокирует): ${planner.target.reqs[+cls.slice(1)].label}`);
      else parts.push(`+ ненужный ${m.s === 'p' ? 'префикс' : 'суффикс'}`);
    }
  }
  for (const id of removed) {
    const m = ctx.byId.get(id)!;
    parts.push(`− убран: ${m.x.replace(/\n/g, ' / ')}`);
  }
  if (after.rarity === 'normal' && before.rarity !== 'normal') return 'Новая обычная база';
  return parts.join('; ') || 'Без изменений';
}

function advise(id: number, setup: Setup, strategyId: string, item: Item, trials: number) {
  const planner = plannerFor(setup, strategyId);
  const ctx = planner.ctx;
  const done = analyze(item, ctx, setup.target).goal;
  const remaining = planner.H(item);
  const impossible = remaining >= 1e11;
  const advice: Advice = { done, impossible, remaining, alternatives: [], outcomes: [], plan: [] };
  if (!done && !impossible) {
    const d = planner.decide(item);
    if (d.action) {
      advice.action = d.action;
      advice.title = actionTitleRu(d.action, ctx.base);
      advice.cost = d.alternatives[0]?.cost;
      advice.alternatives = d.alternatives.map((a) => ({ title: actionTitleRu(a.action, ctx.base), value: a.value, cost: a.cost, action: a.action }));
      if (d.action.kind !== 'restart') {
        const hNow = remaining;
        const agg = new Map<string, OutcomeView>();
        for (const o of planner.outcomesOf(item, d.action)) {
          const label = describeOutcome(planner, item, o.item);
          const good = analyze(o.item, ctx, setup.target).goal || planner.H(o.item) < hNow - 1e-9;
          const cur = agg.get(label);
          if (cur) cur.p += o.p;
          else agg.set(label, { p: o.p, label, good });
        }
        advice.outcomes = [...agg.values()].sort((a, b) => b.p - a.p).slice(0, 12);
      }
    }
    const sim = simulate(planner, item, { trials, maxSteps: 4000, buyFirstBase: false, seed: 5 });
    advice.sim = { successRate: sim.successRate, meanCost: sim.meanCost, p90Cost: sim.p90Cost };
    advice.plan = planView(ctx, explainPlan(planner, item));
  }
  post({ type: 'advice', id, advice });
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
        mods = msg.mods;
        bases = new Map(msg.bases.map((b) => [b.id, b]));
        planners.clear();
        post({ type: 'ready' });
        break;
      case 'evaluate':
        evaluate(msg.id, msg.setup, msg.trials, msg.strategyIds);
        break;
      case 'advise':
        advise(msg.id, msg.setup, msg.strategyId, msg.item, msg.trials);
        break;
      case 'roll': {
        const planner = plannerFor(msg.setup, msg.strategyId);
        const item = sample(msg.item, planner.ctx, msg.action, makeRng(msg.seed), planner.preferFor(msg.item));
        post({ type: 'rolled', id: msg.id, item });
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', id: 'id' in msg ? msg.id : -1, message: e instanceof Error ? e.message : String(e) });
  }
};
