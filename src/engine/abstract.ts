// Abstract Markov model of a craft, solved exactly with value iteration.
//
// A real item is projected onto a small state:
//   rarity, which wanted mods are present (bitmask), which wanted mods are
//   blocked by a lower tier of the same family (bitmask), how many unwanted
//   mods sit on each side, and whether a desecrated modifier is present.
// Transition probabilities come from the modifier weights of the base.
// Value iteration then gives the expected remaining cost V(state) under the
// best policy. V is used by the planner as a consistent cost-to-go estimate.

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

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
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
    private essenceReqs: { name: string; req: number }[],
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
    add({ r: 0, met: 0, blk: 0, jp: 0, js: 0, de: 0 });
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
    return ((((s.r * 256 + s.met) * 256 + s.blk) * 8 + s.jp) * 8 + s.js) * 4 + s.de;
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
    return popcount(s.met & m) + popcount(s.blk & m) + (side === 'p' ? s.jp : s.js) + this.fixed.fracJ[side];
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
      if (a.essence) for (const e of this.essenceReqs) out.push({ kind: 'essence', essence: { name: e.name, modId: String(e.req) } });
      if (a.annul) out.push({ kind: 'annul' });
    } else {
      if (a.exalt) for (const t of tiers) for (const o of omenSets('Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation')) out.push({ kind: 'exalt', tier: t, omens: o });
      if (a.chaos)
        for (const t of tiers) {
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
      if (a.desecrate) for (const b of BONES) for (const o of omenSets('Omen of Sinistral Necromancy', 'Omen of Dextral Necromancy')) out.push({ kind: 'desecrate', bone: b, omens: o });
    }
    if (a.restart && s.r !== 0) out.push({ kind: 'restart' });
    return out.filter((x) => (x.kind === 'essence' ? Number.isFinite(this.ctx.prices[x.essence!.name]) : hasPrice(x, this.ctx.base, this.ctx.prices)));
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
  private removeDist(s: S, filter: { side?: Side; light?: boolean; whittling?: boolean }): { p: number; s: S }[] {
    type C = { w: number; f: (x: S) => S; junk: boolean };
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
      if (s.met & bit && !(this.fixed.fracMet & bit)) cands.push({ w: 1, junk: false, f: (x) => ({ ...x, met: x.met & ~bit, de: x.de === 3 ? 0 : x.de }) });
      if (s.blk & bit && !(this.fixed.fracBlk & bit)) cands.push({ w: 1, junk: true, f: (x) => ({ ...x, blk: x.blk & ~bit }) });
    }
    for (const sd of ['p', 's'] as Side[]) {
      if (filter.side && sd !== filter.side) continue;
      const j = sd === 'p' ? s.jp : s.js;
      if (j <= 0) continue;
      const deHere = (sd === 'p' && s.de === 1) || (sd === 's' && s.de === 2);
      cands.push({
        w: j,
        junk: true,
        f: (x) => (sd === 'p' ? { ...x, jp: x.jp - 1 } : { ...x, js: x.js - 1 }),
      });
      if (deHere) {
        // the removed unwanted mod is the desecrated one with probability 1/j
        const last = cands.pop()!;
        cands.push({ w: j - 1, junk: true, f: last.f });
        cands.push({ w: 1, junk: true, f: (x) => ({ ...last.f(x), de: 0 }) });
      }
    }
    let use = cands.filter((c) => c.w > 0);
    if (filter.whittling) {
      // lowest-level modifier: assume unwanted mods are lower than wanted ones
      const junk = use.filter((c) => c.junk);
      if (junk.length) use = junk;
    }
    const tot = use.reduce((q, c) => q + c.w, 0);
    if (tot <= 0) return [];
    return use.map((c) => ({ p: c.w / tot, s: c.f(s) }));
  }

  private transitions(s: S, a: Action): { p: number; s: S }[] {
    const tier = a.tier ?? 0;
    const om = (o: OmenName) => !!a.omens?.includes(o);
    const side = (l: OmenName, r: OmenName): Side | undefined => (om(l) ? 'p' : om(r) ? 's' : undefined);
    switch (a.kind) {
      case 'restart':
        return [{ p: 1, s: { r: 0, met: 0, blk: 0, jp: 0, js: 0, de: 0 } }];
      case 'transmute': {
        const base: S = { r: 1, met: 0, blk: 0, jp: 0, js: 0, de: 0 };
        return this.addDist(base, this.cap(1), this.classes(MIN_MOD_LEVEL.transmute[tier], Infinity, false));
      }
      case 'augment':
        if (popcount(s.met | s.blk) + s.jp + s.js >= 2) return [];
        return this.addDist(s, this.cap(1), this.classes(MIN_MOD_LEVEL.augment[tier], Infinity, false));
      case 'regal':
        return this.addDist({ ...s, r: 2 }, this.cap(2), this.classes(MIN_MOD_LEVEL.regal[tier], Infinity, false), side('Omen of Sinistral Coronation', 'Omen of Dextral Coronation'));
      case 'exalt':
        return this.addDist(s, this.cap(2), this.classes(MIN_MOD_LEVEL.exalt[tier], Infinity, false), side('Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation'));
      case 'essence': {
        const i = +a.essence!.modId;
        const bit = 1 << i;
        if ((s.met | s.blk) & bit) return [];
        const next: S = { ...s, r: 2, met: s.met | bit };
        const sd = this.target.reqs[i].side;
        if (this.used(next, sd) > this.cap(2)[sd]) return [];
        return [{ p: 1, s: next }];
      }
      case 'alchemy': {
        const cw = this.classes(0, Infinity, false);
        const forced = side('Omen of Sinistral Alchemy', 'Omen of Dextral Alchemy');
        let dist: { p: number; s: S }[] = [{ p: 1, s: { r: 2, met: 0, blk: 0, jp: 0, js: 0, de: 0 } }];
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
        const rem = this.removeDist(s, { side: side('Omen of Sinistral Erasure', 'Omen of Dextral Erasure'), whittling: om('Omen of Whittling') });
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
      for (let i = 0; i < n; i++) {
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
      if (maxRel < 1e-6) break;
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
