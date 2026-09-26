// Planner: chooses the next crafting action for a real item.
//
// The expected remaining cost of any item state comes from an abstract Markov
// model solved exactly (see abstract.ts). For the real item, every allowed
// action is scored as   cost(action) + Σ p(outcome) · V(outcome)
// using the exact outcome distribution on the real modifier pool, and the
// cheapest action is chosen. "Start over with a new base" is always an option,
// which gives the fallback plan when a craft goes wrong.

import { actionCost, hasPrice } from './currency';
import { essencesForBase, type EssenceOption } from './essences';
import { outcomes, isValid, type Classifier, type Outcome } from './actions';
import { AbstractModel, type AbsEssence, type AbsState, type Fixed } from './abstract';
import { analyze, modMatchesReq, modOf } from './item';
import type { Action, BoneTier, Ctx, FluxKind, Item, ModDef, OmenName, OrbTier, Strategy, Target } from './types';

export interface Scored {
  action: Action;
  value: number;
  cost: number;
}

export interface Decision {
  done: boolean;
  action?: Action;
  value: number;
  alternatives: Scored[];
}

const TIERS_ALL: OrbTier[] = [0, 1, 2];

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
const BONES: BoneTier[] = ['Gnawed', 'Preserved', 'Ancient'];

export class Planner {
  readonly ctx: Ctx;
  readonly target: Target;
  readonly strategy: Strategy;
  readonly essences: EssenceOption[];
  readonly classify: Classifier;
  private dCache = new Map<string, Decision>();
  private tiers: OrbTier[];
  private models = new Map<string, { model: AbstractModel; starts: AbsState[] }>();
  private absEssences: AbsEssence[];

  constructor(ctx: Ctx, target: Target, strategy: Strategy) {
    if (target.reqs.length > 8) throw new Error('Не больше 8 желаемых модов');
    this.ctx = ctx;
    this.target = target;
    this.strategy = strategy;
    this.essences = strategy.allow.essence ? essencesForBase(ctx) : [];
    this.tiers = strategy.allow.higherTiers ? TIERS_ALL : [0];
    const reqs = target.reqs;
    this.classify = (m: ModDef) => {
      for (let i = 0; i < reqs.length; i++) if (modMatchesReq(m, reqs[i])) return 'h' + i;
      for (let i = 0; i < reqs.length; i++) {
        const fg = ctx.famGroups.get(reqs[i].fam);
        if (fg && m.g.some((g) => fg.has(g))) return 'b' + i;
      }
      return 'x' + m.s;
    };
    // Essences that can add a wanted modifier, with the class of each alternative.
    this.absEssences = [];
    for (const e of this.essences) {
      const outs = e.mods.map((m) => this.classify(m));
      if (!outs.some((c) => c[0] === 'h')) continue;
      this.absEssences.push({ name: e.name, rare: e.rare, crystal: e.crystal, outs });
    }
  }

  // ---------------------------------------------------------- abstraction

  project(item: Item): { s: AbsState; fixed: Fixed } {
    const an = analyze(item, this.ctx, this.target);
    const fixed: Fixed = { fracMet: 0, fracBlk: 0, fracJ: { p: 0, s: 0 } };
    const s: AbsState = { r: item.rarity === 'normal' ? 0 : item.rarity === 'magic' ? 1 : 2, met: 0, blk: 0, jp: 0, js: 0, de: 0, fx: 0 };
    item.mods.forEach((im, k) => {
      const m = modOf(this.ctx, im);
      if (an.modReq[k] >= 0) {
        const bit = 1 << an.modReq[k];
        s.met |= bit;
        if (im.fr) fixed.fracMet |= bit;
        if (im.de) s.de = 3;
        return;
      }
      if (an.modBlocks[k] >= 0 && !(s.blk & (1 << an.modBlocks[k]))) {
        const bit = 1 << an.modBlocks[k];
        s.blk |= bit;
        if (im.fr) fixed.fracBlk |= bit;
        if (im.de) s.de = 3;
        return;
      }
      if (im.fr) fixed.fracJ[m.s]++;
      else if (m.s === 'p') s.jp++;
      else s.js++;
      // a fractured desecrated modifier cannot be annulled any more
      if (im.de) s.de = im.fr ? 3 : m.s === 'p' ? 1 : 2;
    });
    // A single fractured modifier (the usual Fracturing Orb case) is part of the
    // state itself, so it shares the main model instead of building a new one.
    const nFrac = popcount(fixed.fracMet) + popcount(fixed.fracBlk) + fixed.fracJ.p + fixed.fracJ.s;
    if (nFrac === 1) {
      if (fixed.fracMet) s.fx = 1 + Math.log2(fixed.fracMet);
      else if (fixed.fracBlk) s.fx = 11 + Math.log2(fixed.fracBlk);
      else s.fx = fixed.fracJ.p ? 9 : 10;
      return { s, fixed: { fracMet: 0, fracBlk: 0, fracJ: { p: 0, s: 0 } } };
    }
    return { s, fixed };
  }

  private modelFor(fixed: Fixed, start?: AbsState): AbstractModel {
    const key = `${fixed.fracMet}|${fixed.fracBlk}|${fixed.fracJ.p}|${fixed.fracJ.s}`;
    let entry = this.models.get(key);
    const needs = (m: AbstractModel) => !start || m.valueOf(start) !== undefined;
    if (!entry || !needs(entry.model)) {
      const starts = [...(entry?.starts ?? []), ...(start ? [start] : [])];
      const model = new AbstractModel(this.ctx, this.target, this.strategy, this.classify, this.absEssences, fixed, starts);
      entry = { model, starts };
      this.models.set(key, entry);
    }
    return entry.model;
  }

  /** Identity of the item's abstract state (model + state). */
  absKey(item: Item): string {
    const { s, fixed } = this.project(item);
    return `${fixed.fracMet}|${fixed.fracBlk}|${fixed.fracJ.p}|${fixed.fracJ.s}|${s.r}|${s.met}|${s.blk}|${s.jp}|${s.js}|${s.de}|${s.fx}`;
  }

  /** Expected remaining cost from this item under the best policy. */
  H(item: Item): number {
    const { s, fixed } = this.project(item);
    return this.modelFor(fixed, s).valueOf(s) ?? Infinity;
  }

  /** Expected cost from a fresh normal base (excluding buying it). */
  get h0(): number {
    return this.H({ rarity: 'normal', mods: [] });
  }

  get restartCost(): number {
    return this.ctx.baseCost + this.h0;
  }

  /** Wanted mods can never all be reached from this state. */
  impossible(item: Item): boolean {
    return this.H(item) >= 1e11;
  }

  /**
   * Canonical state key for caching decisions: wanted mods by id, other
   * mods by side / blocker / flags / whether below the lowest wanted mod level.
   */
  canon(item: Item): string {
    const an = analyze(item, this.ctx, this.target);
    let minGood = Infinity;
    for (let k = 0; k < item.mods.length; k++) if (an.modReq[k] >= 0) minGood = Math.min(minGood, modOf(this.ctx, item.mods[k]).l);
    const parts = item.mods.map((im, k) => {
      const m = modOf(this.ctx, im);
      const flags = (im.fr ? '!' : '') + (im.de ? '~' : '');
      if (an.modReq[k] >= 0) return im.id + flags;
      const low = m.l < minGood ? 'L' : 'H';
      if (an.modBlocks[k] >= 0) return 'b' + an.modBlocks[k] + m.s + low + flags;
      return 'x' + m.s + low + flags;
    });
    return item.rarity[0] + ':' + parts.sort().join(',');
  }

  // ---------------------------------------------------------- candidates

  candidates(item: Item): Action[] {
    const { strategy } = this;
    const a = strategy.allow;
    const out: Action[] = [];
    const omenSets = (l: OmenName, r: OmenName): OmenName[][] => (a.omens ? [[], [l], [r]] : [[]]);
    if (item.rarity === 'normal') {
      if (strategy.start === 'transmute') for (const t of this.tiers) out.push({ kind: 'transmute', tier: t });
      else for (const o of omenSets('Omen of Sinistral Alchemy', 'Omen of Dextral Alchemy')) out.push({ kind: 'alchemy', omens: o });
    } else if (item.rarity === 'magic') {
      if (a.augment) for (const t of this.tiers) out.push({ kind: 'augment', tier: t });
      if (a.regal)
        for (const t of this.tiers)
          for (const o of omenSets('Omen of Sinistral Coronation', 'Omen of Dextral Coronation')) out.push({ kind: 'regal', tier: t, omens: o });
      if (a.essence) {
        const an = analyze(item, this.ctx, this.target);
        for (const e of this.essences) {
          if (e.rare || !this.useful(e, an.met)) continue;
          out.push({ kind: 'essence', essence: { name: e.name, modIds: e.mods.map((m) => m.id) } });
        }
      }
      if (a.annul) out.push({ kind: 'annul' });
    } else {
      if (a.exalt)
        for (const t of this.tiers)
          for (const o of omenSets('Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation')) {
            out.push({ kind: 'exalt', tier: t, omens: o });
            if (a.omens) out.push({ kind: 'exalt', tier: t, omens: ['Omen of Greater Exaltation', ...o] });
          }
      if (a.essence) {
        const an = analyze(item, this.ctx, this.target);
        for (const e of this.essences) {
          if (!e.rare || !this.useful(e, an.met)) continue;
          const sets = e.crystal ? omenSets('Omen of Sinistral Crystallisation', 'Omen of Dextral Crystallisation') : [[]];
          for (const o of sets) out.push({ kind: 'essence', essence: { name: e.name, modIds: e.mods.map((m) => m.id), rare: true }, omens: o });
        }
      }
      if (a.fracture) out.push({ kind: 'fracture' });
      if (a.chaos)
        for (const t of this.tiers) {
          out.push({ kind: 'chaos', tier: t });
          if (a.omens) {
            out.push({ kind: 'chaos', tier: t, omens: ['Omen of Whittling'] });
            out.push({ kind: 'chaos', tier: t, omens: ['Omen of Sinistral Erasure'] });
            out.push({ kind: 'chaos', tier: t, omens: ['Omen of Dextral Erasure'] });
          }
        }
      if (a.annul) {
        out.push({ kind: 'annul' });
        if (a.omens) {
          out.push({ kind: 'annul', omens: ['Omen of Sinistral Annulment'] });
          out.push({ kind: 'annul', omens: ['Omen of Dextral Annulment'] });
          out.push({ kind: 'annul', omens: ['Omen of Light'] });
        }
      }
      if (a.desecrate)
        for (const b of BONES)
          for (const o of omenSets('Omen of Sinistral Necromancy', 'Omen of Dextral Necromancy')) out.push({ kind: 'desecrate', bone: b, omens: o });
    }
    // Fluxes are only weighed on the real item (the abstract model does not know
    // which unwanted modifiers are resistances), so they are used when they help.
    if (a.flux && item.rarity !== 'normal')
      for (const f of ['Blazing', 'Chilling', 'Crackling', 'Void'] as FluxKind[]) out.push({ kind: 'flux', flux: f });
    if (a.restart && item.rarity !== 'normal') out.push({ kind: 'restart' });
    return out.filter((x) => hasPrice(x, this.ctx.base, this.ctx.prices) && isValid(item, this.ctx, x));
  }

  /** The essence can add a wanted modifier that is still missing. */
  private useful(e: EssenceOption, met: Set<number>): boolean {
    return e.mods.some((m) => this.target.reqs.some((r, i) => !met.has(i) && modMatchesReq(m, r)));
  }

  /** Preference among desecration options for this item (higher = better). */
  preferFor(item: Item): (m: ModDef) => number {
    const an = analyze(item, this.ctx, this.target);
    return (m: ModDef) => {
      const k = this.classify(m);
      if (k[0] === 'h') return an.met.has(+k.slice(1)) ? 1 : 2;
      if (k[0] === 'b') return 0;
      return 1;
    };
  }

  outcomesOf(item: Item, action: Action): Outcome[] {
    return outcomes(item, this.ctx, action, this.classify, this.preferFor(item));
  }

  score(item: Item, action: Action): Scored {
    const cost = actionCost(action, this.ctx.base, this.ctx.prices, this.ctx.baseCost);
    if (action.kind === 'restart') return { action, cost, value: cost + this.h0 };
    const sig = this.canon(item);
    const abs = this.absKey(item);
    let v = cost;
    let self = 0;
    for (const o of this.outcomesOf(item, action)) {
      // Same abstract state = no progress, even if an unwanted modifier was swapped
      // for another one (otherwise such swaps look like progress and loop forever).
      if (this.canon(o.item) === sig || this.absKey(o.item) === abs) self += o.p;
      else v += o.p * this.H(o.item);
    }
    // outcomes that leave the state unchanged repeat the action (geometric)
    if (self >= 1 - 1e-12) return { action, cost, value: Infinity };
    return { action, cost, value: v / (1 - self) };
  }

  decide(item: Item): Decision {
    const sig = this.canon(item);
    const cached = this.dCache.get(sig);
    if (cached && (cached.done || !cached.action || isValid(item, this.ctx, cached.action))) return cached;
    let d: Decision;
    if (analyze(item, this.ctx, this.target).goal) d = { done: true, value: 0, alternatives: [] };
    else {
      const scored = this.candidates(item)
        .map((a) => this.score(item, a))
        .filter((s) => Number.isFinite(s.value) && s.value < 1e11)
        .sort((x, y) => x.value - y.value);
      d = { done: false, action: scored[0]?.action, value: scored[0]?.value ?? Infinity, alternatives: scored.slice(0, 8) };
    }
    this.dCache.set(sig, d);
    return d;
  }
}
