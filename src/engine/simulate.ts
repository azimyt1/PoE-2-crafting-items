// Monte Carlo evaluation of a planner policy, plus a readable step-by-step plan.

import { sample, type Rng } from './actions';
import { actionCost, actionItems, actionTitleRu } from './currency';
import { analyze, itemSignature } from './item';
import type { Planner } from './planner';
import type { Action, Item } from './types';

export function makeRng(seed = 1): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  trials: number;
  maxSteps: number;
  /** count the price of the first base too */
  buyFirstBase: boolean;
  seed?: number;
}

export interface SimResult {
  trials: number;
  successRate: number;
  meanCost: number;
  medianCost: number;
  p90Cost: number;
  meanSteps: number;
  meanRestarts: number;
  /** average number of each item used per trial */
  usage: Record<string, number>;
  /** chance that the very first base succeeds without starting over */
  firstBaseSuccess: number;
}

export function simulate(planner: Planner, start: Item, opts: SimOptions): SimResult {
  const rng = makeRng(opts.seed ?? 7);
  const { ctx } = planner;
  const costs: number[] = [];
  const usage: Record<string, number> = {};
  let successes = 0;
  let steps = 0;
  let restarts = 0;
  let firstOk = 0;
  for (let t = 0; t < opts.trials; t++) {
    let item = start;
    let cost = opts.buyFirstBase && start.rarity === 'normal' && start.mods.length === 0 ? ctx.baseCost : 0;
    let ok = false;
    let r = 0;
    for (let k = 0; k < opts.maxSteps; k++) {
      const d = planner.decide(item);
      if (d.done) {
        ok = true;
        break;
      }
      if (!d.action) break;
      const a = d.action;
      cost += actionCost(a, ctx.base, ctx.prices, ctx.baseCost);
      if (a.kind === 'restart') {
        r++;
        usage['Новая база'] = (usage['Новая база'] ?? 0) + 1;
      } else for (const n of actionItems(a, ctx.base)) usage[n] = (usage[n] ?? 0) + 1;
      item = sample(item, ctx, a, rng, planner.preferFor(item));
      steps++;
    }
    if (!ok && analyze(item, ctx, planner.target).goal) ok = true;
    if (ok) {
      successes++;
      if (r === 0) firstOk++;
    }
    restarts += r;
    costs.push(cost);
  }
  costs.sort((a, b) => a - b);
  const n = opts.trials;
  for (const k of Object.keys(usage)) usage[k] /= n;
  return {
    trials: n,
    successRate: successes / n,
    meanCost: costs.reduce((s, c) => s + c, 0) / n,
    medianCost: costs[Math.floor(n / 2)] ?? 0,
    p90Cost: costs[Math.floor(n * 0.9)] ?? 0,
    meanSteps: steps / n,
    meanRestarts: restarts / n,
    usage,
    firstBaseSuccess: firstOk / n,
  };
}

// ------------------------------------------------------------ readable plan

export interface PlanStep {
  title: string;
  action: Action;
  cost: number;
  /** probability that this step moves the craft forward */
  pGood: number;
  /** what to do if it does not */
  fallback?: string;
  pFallback?: number;
  /** expected remaining cost after this step */
  remaining: number;
  itemAfter: Item;
}

/**
 * Follows the most likely successful branch of the policy and, for each step,
 * reports the chance of progress and the planned reaction to a failure.
 */
export function explainPlan(planner: Planner, start: Item, maxSteps = 14): PlanStep[] {
  const steps: PlanStep[] = [];
  const { ctx } = planner;
  let item = start;
  const seen = new Set<string>();
  for (let k = 0; k < maxSteps; k++) {
    const d = planner.decide(item);
    if (d.done || !d.action) break;
    const a = d.action;
    const cost = actionCost(a, ctx.base, ctx.prices, ctx.baseCost);
    const hNow = planner.H(item);
    if (a.kind === 'restart') {
      steps.push({ title: actionTitleRu(a, ctx.base), action: a, cost, pGood: 1, remaining: planner.h0, itemAfter: { rarity: 'normal', mods: [] } });
      break;
    }
    const outs = planner.outcomesOf(item, a).map((o) => ({ ...o, h: planner.H(o.item) }));
    const good = outs.filter((o) => o.h < hNow - 1e-9 || analyze(o.item, ctx, planner.target).goal);
    const bad = outs.filter((o) => !good.includes(o));
    const pGood = good.reduce((s, o) => s + o.p, 0);
    let fallback: string | undefined;
    let pFallback: number | undefined;
    if (bad.length) {
      const worst = bad.sort((x, y) => y.p - x.p)[0];
      const fd = planner.decide(worst.item);
      fallback = fd.done ? 'Цель достигнута' : fd.action ? actionTitleRu(fd.action, ctx.base) : 'Нет хорошего продолжения';
      pFallback = bad.reduce((s, o) => s + o.p, 0);
    }
    const next = (good.length ? good : outs).sort((x, y) => x.h - y.h || y.p - x.p)[0];
    steps.push({
      title: actionTitleRu(a, ctx.base),
      action: a,
      cost,
      pGood,
      fallback,
      pFallback,
      remaining: next?.h ?? 0,
      itemAfter: next?.item ?? item,
    });
    if (!next) break;
    item = next.item;
    const sig = itemSignature(item);
    if (seen.has(sig)) break;
    seen.add(sig);
  }
  return steps;
}
