// Abstract Markov model of a craft, solved exactly with value iteration.
//
// A real item is projected onto a small state:
//   rarity, which wanted mods are present (bitmask), which wanted mods are
//   blocked by a lower tier of the same family (bitmask), how many unwanted
//   mods sit on each side, whether a desecrated modifier is present, and
//   which modifier was fractured.
// Transition probabilities come from the modifier weights of the base.
// Value iteration then gives the expected remaining cost V(state) under the
// best policy. V is used by the planner as a consistent cost-to-go estimate.
// Omen of Whittling is left out on purpose: it depends on the exact levels of
// the unwanted modifiers, which this state does not know, and modelling it on
// average makes the estimate far too optimistic. The planner still considers
// Whittling on the real item, where the levels are known.

import { BONE_LEVELS, MIN_MOD_LEVEL, actionCost, hasPrice } from './currency';
import type { Classifier } from './actions';
import type { Action, BoneTier, Ctx, OmenName, OrbTier, Side, Strategy, Target } from './types';

/** Desecrated modifier: 0 none, 1 unwanted prefix, 2 unwanted suffix, 3 other (wanted/blocker) */
type De = 0 | 1 | 2 | 3;

interface S {
  r: 0 | 1 | 2; // normal, magic, rare
  met: number;
  blk: number;
  jp: number;
  js: number;
  de: De;
  /** modifier fractured inside the model (Fracturing Orb): 0 none, 1+i wanted req i, 9 unwanted prefix, 10 unwanted suffix, 11+i blocker of req i */
  fx: number;
}

interface Tr {
  cost: number;
  action: Action;
  to: Int32Array;
  p: Float64Array;
}

interface ClassW {
  hit: number[];
  blk: number[];
  junk: { p: number; s: number };
}

const TIERS: OrbTier[] = [0, 1, 2];
const BONES: BoneTier[] = ['Gnawed', 'Preserved', 'Ancient'];
const FX_JP = 9;
const FX_JS = 10;
const FX_BLK = 11;
const FRESH = { met: 0, blk: 0, jp: 0, js: 0, de: 0 as De, fx: 0 };

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** An essence as the abstract model sees it: the planner class ('h'/'b'/'x' + index or side) of each alternative. */
export interface AbsEssence {
  name: string;
  /** used on rare items, removes a random modifier first */
  rare: boolean;
  /** Omens of Crystallisation apply */
  crystal: boolean;
  outs: string[];
}

export interface Fixed {
  /** wanted mods that are fractured (cannot be removed) */
  fracMet: number;
  /** blockers that are fractured (the wanted mod is then impossible) */
  fracBlk: number;
  /** fractured unwanted mods per side */
  fracJ: { p: number; s: number };
}

export class AbstractModel {
  readonly states: S[] = [];
  readonly index = new Map<number, number>();
  readonly V: Float64Array;
  readonly best: Int32Array;
  private trans: Tr[][] = [];
  private R: number;
  private sideMask = { p: 0, s: 0 };
  private classCache = new Map<string, ClassW>();

  constructor(
    private ctx: Ctx,
    private target: Target,
    private strategy: Strategy,
    private classify: Classifier,
    private essences: AbsEssence[],
    readonly fixed: Fixed,
    starts: S[],
  ) {
    this.R = target.reqs.length;
    target.reqs.forEach((r, i) => (this.sideMask[r.side] |= 1 << i));
    // BFS over reachable states
    const queue: number[] = [];
    const add = (s: S): number => {
      const k = this.key(s);
      let i = this.index.get(k);
      if (i === undefined) {
        i = this.states.length;
        this.index.set(k, i);
        this.states.push(s);
        queue.push(i);
      }
      return i;
    };
    add({ r: 0, ...FRESH });
    for (const s of starts) add(s);
    while (queue.length) {
      const i = queue.shift()!;
      const s = this.states[i];
      const list: Tr[] = [];
      if (!this.isGoal(s)) {
        for (const a of this.actions(s)) {
          const outs = this.transitions(s, a);
          if (!outs.length) continue;
          const merged = new Map<number, number>();
          for (const o of outs) {
            const j = add(o.s);
            merged.set(j, (merged.get(j) ?? 0) + o.p);
          }
          const to = new Int32Array(merged.size);
          const p = new Float64Array(merged.size);
          let k = 0;
          for (const [j, q] of merged) {
            to[k] = j;
            p[k] = q;
            k++;
          }
          list.push({ cost: actionCost(a, ctx.base, ctx.prices, ctx.baseCost), action: a, to, p });
        }
      }
      this.trans[i] = list;
    }
    this.V = new Float64Array(this.states.length);
    this.best = new Int32Array(this.states.length).fill(-1);
    this.solve();
  }

  key(s: S): number {
    return (((((s.r * 256 + s.met) * 256 + s.blk) * 8 + s.jp) * 8 + s.js) * 4 + s.de) * 32 + s.fx;
  }

  isGoal(s: S): boolean {
    return popcount(s.met) >= this.target.need;
  }

  cap(r: number): { p: number; s: number } {
    if (r === 1) return { p: 1, s: 1 };
    if (r === 2) return this.ctx.rareCap;
    return { p: 0, s: 0 };
  }

  used(s: S, side: Side): number {
    const m = this.sideMask[side];
    const fxJunk = side === 'p' ? +(s.fx === FX_JP) : +(s.fx === FX_JS);
    return popcount(s.met & m) + popcount(s.blk & m) + (side === 'p' ? s.jp : s.js) + this.fixed.fracJ[side] + fxJunk;
  }

  /** the item already carries a fractured modifier (Fracturing Orb cannot be used again) */
  private fractured(s: S): boolean {
    const f = this.fixed;
    return s.fx !== 0 || f.fracMet !== 0 || f.fracBlk !== 0 || f.fracJ.p + f.fracJ.s > 0;
  }

  private modCount(s: S): number {
    const f = this.fixed;
    return popcount(s.met | s.blk) + s.jp + s.js + f.fracJ.p + f.fracJ.s + +(s.fx === FX_JP || s.fx === FX_JS);
  }

  // -------------------------------------------------------------- weights

  private classes(minL: number, maxL: number, desecration: boolean): ClassW {
    const k = `${minL}|${maxL}|${desecration ? 1 : 0}`;
    let c = this.classCache.get(k);
    if (c) return c;
    c = { hit: Array(this.R).fill(0), blk: Array(this.R).fill(0), junk: { p: 0, s: 0 } };
    const src = desecration ? [...this.ctx.regular, ...this.ctx.lords] : this.ctx.regular;
    for (const e of src) {
      if (e.mod.l < minL || e.mod.l > maxL) continue;
      const cls = this.classify(e.mod);
      const i = +cls.slice(1);
      if (cls[0] === 'h') c.hit[i] += e.w;
      else if (cls[0] === 'b') c.blk[i] += e.w;
      else c.junk[e.mod.s] += e.w;
    }
    this.classCache.set(k, c);
    return c;
  }

  // -------------------------------------------------------------- actions

  private actions(s: S): Action[] {
    const a = this.strategy.allow;
    const tiers = a.higherTiers ? TIERS : ([0] as OrbTier[]);
    const omenSets = (l: OmenName, r: OmenName): OmenName[][] => (a.omens ? [[], [l], [r]] : [[]]);
    const out: Action[] = [];
    if (s.r === 0) {
      if (this.strategy.start === 'transmute') for (const t of tiers) out.push({ kind: 'transmute', tier: t });
      else for (const o of omenSets('Omen of Sinistral Alchemy', 'Omen of Dextral Alchemy')) out.push({ kind: 'alchemy', omens: o });
    } else if (s.r === 1) {
      if (a.augment) for (const t of tiers) out.push({ kind: 'augment', tier: t });
      if (a.regal) for (const t of tiers) for (const o of omenSets('Omen of Sinistral Coronation', 'Omen of Dextral Coronation')) out.push({ kind: 'regal', tier: t, omens: o });
      if (a.essence) this.essences.forEach((e, k) => !e.rare && out.push({ kind: 'essence', essence: { name: e.name, modIds: [], ref: k } }));
      if (a.annul) out.push({ kind: 'annul' });
    } else {
      if (a.exalt)
        for (const t of tiers)
          for (const o of omenSets('Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation')) {
            out.push({ kind: 'exalt', tier: t, omens: o });
            if (a.omens) out.push({ kind: 'exalt', tier: t, omens: ['Omen of Greater Exaltation', ...o] });
          }
      if (a.essence)
        this.essences.forEach((e, k) => {
          if (!e.rare) return;
          const sets = e.crystal ? omenSets('Omen of Sinistral Crystallisation', 'Omen of Dextral Crystallisation') : [[]];
          for (const o of sets) out.push({ kind: 'essence', essence: { name: e.name, modIds: [], rare: true, ref: k }, omens: o });
        });
      if (a.fracture && !this.fractured(s) && this.modCount(s) >= 4) out.push({ kind: 'fracture' });
      if (a.chaos)
        for (const t of tiers) {
          out.push({ kind: 'chaos', tier: t });
          if (a.omens) {
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
      if (a.desecrate) for (const b of BONES) for (const o of omenSets('Omen of Sinistral Necromancy', 'Omen of Dextral Necromancy')) out.push({ kind: 'desecrate', bone: b, omens: o });
    }
    if (a.restart && s.r !== 0) out.push({ kind: 'restart' });
    return out.filter((x) =>
      x.kind === 'essence'
        ? Number.isFinite(this.ctx.prices[x.essence!.name]) && (x.omens ?? []).every((o) => Number.isFinite(this.ctx.prices[o]))
        : hasPrice(x, this.ctx.base, this.ctx.prices),
    );
  }

  // -------------------------------------------------------------- transitions

  private addDist(s: S, cap: { p: number; s: number }, cw: ClassW, side?: Side): { p: number; s: S }[] {
    const opts: { w: number; f: (x: S) => S }[] = [];
    for (const sd of ['p', 's'] as Side[]) {
      if (side && sd !== side) continue;
      if (cap[sd] - this.used(s, sd) <= 0) continue;
      if (cw.junk[sd] > 0) opts.push({ w: cw.junk[sd], f: (x) => (sd === 'p' ? { ...x, jp: x.jp + 1 } : { ...x, js: x.js + 1 }) });
      for (let i = 0; i < this.R; i++) {
        if (this.target.reqs[i].side !== sd) continue;
        const bit = 1 << i;
        if ((s.met | s.blk) & bit) continue;
        if (cw.hit[i] > 0) opts.push({ w: cw.hit[i], f: (x) => ({ ...x, met: x.met | bit }) });
        if (cw.blk[i] > 0) opts.push({ w: cw.blk[i], f: (x) => ({ ...x, blk: x.blk | bit }) });
      }
    }
    const tot = opts.reduce((q, o) => q + o.w, 0);
    if (tot <= 0) return [];
    return opts.map((o) => ({ p: o.w / tot, s: o.f(s) }));
  }

  /** uniform removal of one modifier among candidates */
  private removeDist(s: S, filter: { side?: Side; light?: boolean }): { p: number; s: S }[] {
    type C = { w: number; f: (x: S) => S };
    const cands: C[] = [];
    if (filter.light) {
      if (s.de === 1) return [{ p: 1, s: { ...s, jp: s.jp - 1, de: 0 } }];
      if (s.de === 2) return [{ p: 1, s: { ...s, js: s.js - 1, de: 0 } }];
      return [];
    }
    for (let i = 0; i < this.R; i++) {
      const bit = 1 << i;
      const sd = this.target.reqs[i].side;
      if (filter.side && sd !== filter.side) continue;
      if (s.met & bit && !(this.fixed.fracMet & bit) && s.fx !== 1 + i) cands.push({ w: 1, f: (x) => ({ ...x, met: x.met & ~bit, de: x.de === 3 ? 0 : x.de }) });
      if (s.blk & bit && !(this.fixed.fracBlk & bit) && s.fx !== FX_BLK + i) cands.push({ w: 1, f: (x) => ({ ...x, blk: x.blk & ~bit }) });
    }
    for (const sd of ['p', 's'] as Side[]) {
      if (filter.side && sd !== filter.side) continue;
      const j = sd === 'p' ? s.jp : s.js;
      if (j <= 0) continue;
      const deHere = (sd === 'p' && s.de === 1) || (sd === 's' && s.de === 2);
      cands.push({
        w: j,
        f: (x) => (sd === 'p' ? { ...x, jp: x.jp - 1 } : { ...x, js: x.js - 1 }),
      });
      if (deHere) {
        // the removed unwanted mod is the desecrated one with probability 1/j
        const last = cands.pop()!;
        cands.push({ w: j - 1, f: last.f });
        cands.push({ w: 1, f: (x) => ({ ...last.f(x), de: 0 }) });
      }
    }
    const use = cands.filter((c) => c.w > 0);
    const tot = use.reduce((q, c) => q + c.w, 0);
    if (tot <= 0) return [];
    return use.map((c) => ({ p: c.w / tot, s: c.f(s) }));
  }

  /** states after an essence adds one of its alternatives (those that fit, uniformly) */
  private essenceAdds(s: S, outs: string[]): S[] {
    const cap = this.cap(2);
    const res: S[] = [];
    for (const c of outs) {
      if (c[0] === 'x') {
        const sd = c[1] as Side;
        if (this.used(s, sd) >= cap[sd]) continue;
        res.push(sd === 'p' ? { ...s, jp: s.jp + 1 } : { ...s, js: s.js + 1 });
        continue;
      }
      const i = +c.slice(1);
      const bit = 1 << i;
      const sd = this.target.reqs[i].side;
      if ((s.met | s.blk) & bit || this.used(s, sd) >= cap[sd]) continue;
      res.push(c[0] === 'h' ? { ...s, met: s.met | bit } : { ...s, blk: s.blk | bit });
    }
    return res;
  }

  private transitions(s: S, a: Action): { p: number; s: S }[] {
    const tier = a.tier ?? 0;
    const om = (o: OmenName) => !!a.omens?.includes(o);
    const side = (l: OmenName, r: OmenName): Side | undefined => (om(l) ? 'p' : om(r) ? 's' : undefined);
    switch (a.kind) {
      case 'restart':
        return [{ p: 1, s: { r: 0, ...FRESH } }];
      case 'transmute': {
        const base: S = { r: 1, ...FRESH };
        return this.addDist(base, this.cap(1), this.classes(MIN_MOD_LEVEL.transmute[tier], Infinity, false));
      }
      case 'augment':
        if (popcount(s.met | s.blk) + s.jp + s.js >= 2) return [];
        return this.addDist(s, this.cap(1), this.classes(MIN_MOD_LEVEL.augment[tier], Infinity, false));
      case 'regal':
        return this.addDist({ ...s, r: 2 }, this.cap(2), this.classes(MIN_MOD_LEVEL.regal[tier], Infinity, false), side('Omen of Sinistral Coronation', 'Omen of Dextral Coronation'));
      case 'exalt': {
        const sd = side('Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation');
        const cw = this.classes(MIN_MOD_LEVEL.exalt[tier], Infinity, false);
        const cap = this.cap(2);
        const first = this.addDist(s, cap, cw, sd);
        if (!om('Omen of Greater Exaltation')) return first;
        const free = (x: S) => (sd ? cap[sd] - this.used(x, sd) : cap.p - this.used(x, 'p') + cap.s - this.used(x, 's'));
        if (free(s) < 2) return [];
        const out: { p: number; s: S }[] = [];
        for (const f of first) {
          const second = this.addDist(f.s, cap, cw, sd);
          if (!second.length) out.push(f);
          for (const x of second) out.push({ p: f.p * x.p, s: x.s });
        }
        return out;
      }
      case 'essence': {
        const e = this.essences[a.essence!.ref!];
        // essences used on rare items remove a random modifier first (only ones that make room)
        const rem = e.rare
          ? this.removeDist(s, { side: side('Omen of Sinistral Crystallisation', 'Omen of Dextral Crystallisation') })
          : [{ p: 1, s: { ...s, r: 2 as const } }];
        const out: { p: number; s: S }[] = [];
        let tot = 0;
        for (const r of rem) {
          const adds = this.essenceAdds(r.s, e.outs);
          if (!adds.length) continue;
          tot += r.p;
          for (const x of adds) out.push({ p: r.p / adds.length, s: x });
        }
        if (tot <= 0) return [];
        return out.map((o) => ({ p: o.p / tot, s: o.s }));
      }
      case 'fracture': {
        const n = this.modCount(s);
        if (this.fractured(s) || n < 4) return [];
        const out: { p: number; s: S }[] = [];
        for (let i = 0; i < this.R; i++) {
          const bit = 1 << i;
          if (s.met & bit) out.push({ p: 1 / n, s: { ...s, fx: 1 + i } });
          if (s.blk & bit) out.push({ p: 1 / n, s: { ...s, fx: FX_BLK + i } });
        }
        for (const sd of ['p', 's'] as Side[]) {
          const j = sd === 'p' ? s.jp : s.js;
          if (j <= 0) continue;
          const moved: S = sd === 'p' ? { ...s, jp: j - 1, fx: FX_JP } : { ...s, js: j - 1, fx: FX_JS };
          const deHere = (sd === 'p' && s.de === 1) || (sd === 's' && s.de === 2);
          if (!deHere) out.push({ p: j / n, s: moved });
          else {
            // the fractured one is the desecrated modifier with probability 1/j: it can no longer be annulled
            if (j > 1) out.push({ p: (j - 1) / n, s: moved });
            out.push({ p: 1 / n, s: { ...moved, de: 3 } });
          }
        }
        return out;
      }
      case 'alchemy': {
        const cw = this.classes(0, Infinity, false);
        const forced = side('Omen of Sinistral Alchemy', 'Omen of Dextral Alchemy');
        let dist: { p: number; s: S }[] = [{ p: 1, s: { r: 2, ...FRESH } }];
        const cap = this.cap(2);
        const plan: (Side | undefined)[] = forced
          ? [...Array(cap[forced]).fill(forced), ...Array(Math.max(0, 4 - cap[forced])).fill(forced === 'p' ? 's' : 'p')]
          : [undefined, undefined, undefined, undefined];
        for (const sd of plan.slice(0, 4)) {
          const next = new Map<number, { p: number; s: S }>();
          for (const d of dist) {
            const outs = this.addDist(d.s, cap, cw, sd);
            if (!outs.length) {
              const k = this.key(d.s);
              const cur = next.get(k);
              if (cur) cur.p += d.p;
              else next.set(k, { p: d.p, s: d.s });
            }
            for (const o of outs) {
              const k = this.key(o.s);
              const cur = next.get(k);
              if (cur) cur.p += d.p * o.p;
              else next.set(k, { p: d.p * o.p, s: o.s });
            }
          }
          dist = [...next.values()];
        }
        return dist;
      }
      case 'annul': {
        if (om('Omen of Light')) return this.removeDist(s, { light: true });
        return this.removeDist(s, { side: side('Omen of Sinistral Annulment', 'Omen of Dextral Annulment') });
      }
      case 'chaos': {
        const rem = this.removeDist(s, { side: side('Omen of Sinistral Erasure', 'Omen of Dextral Erasure') });
        const cw = this.classes(MIN_MOD_LEVEL.chaos[tier], Infinity, false);
        const out: { p: number; s: S }[] = [];
        for (const r of rem) {
          const adds = this.addDist(r.s, this.cap(2), cw);
          if (!adds.length) out.push(r);
          for (const x of adds) out.push({ p: r.p * x.p, s: x.s });
        }
        return out;
      }
      case 'desecrate': {
        if (s.de !== 0) return [];
        const lv = BONE_LEVELS[a.bone ?? 'Preserved'];
        const cw = this.classes(lv.min, Math.min(lv.max, this.ctx.ilvl), true);
        const forced = side('Omen of Sinistral Necromancy', 'Omen of Dextral Necromancy');
        const cap = this.cap(2);
        const sides = (forced ? [forced] : (['p', 's'] as Side[])).filter((sd) => cap[sd] - this.used(s, sd) > 0);
        const out: { p: number; s: S }[] = [];
        for (const sd of sides) {
          // classes on this side, ranked: wanted > unwanted > blocker
          const ranked: { w: number; s: S }[] = [];
          const hits: { w: number; s: S }[] = [];
          const blks: { w: number; s: S }[] = [];
          for (let i = 0; i < this.R; i++) {
            if (this.target.reqs[i].side !== sd) continue;
            const bit = 1 << i;
            if ((s.met | s.blk) & bit) continue;
            if (cw.hit[i] > 0) hits.push({ w: cw.hit[i], s: { ...s, met: s.met | bit, de: 3 } });
            if (cw.blk[i] > 0) blks.push({ w: cw.blk[i], s: { ...s, blk: s.blk | bit, de: 3 } });
          }
          ranked.push(...hits);
          if (cw.junk[sd] > 0) ranked.push({ w: cw.junk[sd], s: sd === 'p' ? { ...s, jp: s.jp + 1, de: 1 } : { ...s, js: s.js + 1, de: 2 } });
          ranked.push(...blks);
          const tot = ranked.reduce((q, x) => q + x.w, 0);
          if (tot <= 0) continue;
          let better = 0;
          for (const x of ranked) {
            const q = x.w / tot;
            const pBest = Math.pow(1 - better, 3) - Math.pow(Math.max(0, 1 - better - q), 3);
            better += q;
            if (pBest > 0) out.push({ p: pBest / sides.length, s: x.s });
          }
        }
        return out;
      }
    }
  }

  // -------------------------------------------------------------- solve

  private solve(): void {
    const n = this.states.length;
    const V = this.V;
    const goal = this.states.map((s) => this.isGoal(s));
    V.fill(0);
    for (let iter = 0; iter < 5000; iter++) {
      let maxRel = 0;
      // Gauss-Seidel sweep from the deepest states (closest to the goal) back to the start
      for (let i = n - 1; i >= 0; i--) {
        if (goal[i]) continue;
        let bestV = Infinity;
        let bestA = -1;
        const list = this.trans[i];
        for (let a = 0; a < list.length; a++) {
          const t = list[a];
          let self = 0;
          let acc = t.cost;
          for (let k = 0; k < t.to.length; k++) {
            if (t.to[k] === i) self += t.p[k];
            else acc += t.p[k] * V[t.to[k]];
          }
          if (self >= 1 - 1e-12) continue;
          const v = acc / (1 - self);
          if (v < bestV) {
            bestV = v;
            bestA = a;
          }
        }
        if (bestA < 0) bestV = 1e12;
        const old = V[i];
        V[i] = bestV;
        this.best[i] = bestA;
        const rel = Math.abs(bestV - old) / Math.max(1, bestV);
        if (rel > maxRel) maxRel = rel;
      }
      if (maxRel < 1e-5) break;
    }
  }

  valueOf(s: S): number | undefined {
    const i = this.index.get(this.key(s));
    return i === undefined ? undefined : this.V[i];
  }

  bestAction(s: S): Action | undefined {
    const i = this.index.get(this.key(s));
    if (i === undefined || this.best[i] < 0) return undefined;
    return this.trans[i][this.best[i]].action;
  }
}

export type AbsState = S;
