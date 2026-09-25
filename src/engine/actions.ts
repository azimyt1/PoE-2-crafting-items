// Currency actions: exact outcome distributions (for the planner) and random
// sampling (for Monte Carlo). Both share the same rules.

import { BONE_LEVELS, MIN_MOD_LEVEL } from './currency';
import { addPool, cloneItem, modOf, openSlots, type AddFilter } from './item';
import type { Action, Ctx, Item, ItemMod, ModDef, OmenName, PoolEntry, Side } from './types';

export type Rng = () => number;

export interface Outcome {
  p: number;
  item: Item;
}

/** Groups modifiers into planner-relevant classes; mods with the same key are merged. */
export type Classifier = (m: ModDef) => string;

const has = (a: Action, o: OmenName) => !!a.omens?.includes(o);

function sideOmen(a: Action, left: OmenName, right: OmenName): Side | undefined {
  if (has(a, left)) return 'p';
  if (has(a, right)) return 's';
  return undefined;
}

// ------------------------------------------------------------ add filters

function addFilterFor(_item: Item, a: Action): AddFilter | null {
  const tier = a.tier ?? 0;
  switch (a.kind) {
    case 'transmute':
      return { minLevel: MIN_MOD_LEVEL.transmute[tier], asRarity: 'magic' };
    case 'augment':
      return { minLevel: MIN_MOD_LEVEL.augment[tier] };
    case 'regal':
      return {
        minLevel: MIN_MOD_LEVEL.regal[tier],
        asRarity: 'rare',
        side: sideOmen(a, 'Omen of Sinistral Coronation', 'Omen of Dextral Coronation'),
      };
    case 'exalt':
      return { minLevel: MIN_MOD_LEVEL.exalt[tier], side: sideOmen(a, 'Omen of Sinistral Exaltation', 'Omen of Dextral Exaltation') };
    case 'chaos':
      return { minLevel: MIN_MOD_LEVEL.chaos[tier] };
    default:
      return null;
  }
}

/** Room for the guaranteed modifier of a Perfect Essence after removing mod `skip`. */
function essenceFits(item: Item, ctx: Ctx, mod: ModDef, skip: number): boolean {
  const rest: Item = { rarity: 'rare', mods: item.mods.filter((_, k) => k !== skip) };
  if (openSlots(rest, ctx)[mod.s] <= 0) return false;
  const blocked = new Set(rest.mods.flatMap((im) => modOf(ctx, im).g));
  return !mod.g.some((g) => blocked.has(g));
}

/** Mods that the removal part of an action may remove (uniformly). */
export function removable(item: Item, ctx: Ctx, a: Action): number[] {
  let idx = item.mods.map((_, i) => i).filter((i) => !item.mods[i].fr);
  if (a.kind === 'essence' && a.essence?.perfect) {
    const side = sideOmen(a, 'Omen of Sinistral Crystallisation', 'Omen of Dextral Crystallisation');
    if (side) idx = idx.filter((i) => modOf(ctx, item.mods[i]).s === side);
    // Assumption: the game only removes a modifier that makes room for the new one.
    const m = ctx.byId.get(a.essence.modId);
    idx = m ? idx.filter((i) => essenceFits(item, ctx, m, i)) : [];
  } else if (a.kind === 'annul') {
    if (has(a, 'Omen of Light')) idx = idx.filter((i) => item.mods[i].de);
    const side = sideOmen(a, 'Omen of Sinistral Annulment', 'Omen of Dextral Annulment');
    if (side) idx = idx.filter((i) => modOf(ctx, item.mods[i]).s === side);
  } else if (a.kind === 'chaos') {
    const side = sideOmen(a, 'Omen of Sinistral Erasure', 'Omen of Dextral Erasure');
    if (side) idx = idx.filter((i) => modOf(ctx, item.mods[i]).s === side);
    if (has(a, 'Omen of Whittling') && idx.length) {
      const minL = Math.min(...idx.map((i) => modOf(ctx, item.mods[i]).l));
      idx = idx.filter((i) => modOf(ctx, item.mods[i]).l === minL);
    }
  }
  return idx;
}

function desecrationSides(item: Item, ctx: Ctx, a: Action): Side[] {
  const forced = sideOmen(a, 'Omen of Sinistral Necromancy', 'Omen of Dextral Necromancy');
  const open = openSlots(item, ctx);
  const sides: Side[] = forced ? [forced] : (['p', 's'] as Side[]);
  return sides.filter((s) => open[s] > 0);
}

function desecrationPool(item: Item, ctx: Ctx, a: Action, side: Side): PoolEntry[] {
  const lv = BONE_LEVELS[a.bone ?? 'Preserved'];
  return addPool(item, ctx, { side, desecration: true, minLevel: lv.min, maxLevel: Math.min(lv.max, ctx.ilvl) });
}

// ------------------------------------------------------------ validity

export function isValid(item: Item, ctx: Ctx, a: Action): boolean {
  switch (a.kind) {
    case 'restart':
      return true;
    case 'transmute':
    case 'alchemy':
      return item.rarity === 'normal';
    case 'augment':
      return item.rarity === 'magic' && item.mods.length < 2 && addPool(item, ctx, addFilterFor(item, a)!).length > 0;
    case 'regal':
      return item.rarity === 'magic' && addPool(item, ctx, addFilterFor(item, a)!).length > 0;
    case 'exalt': {
      if (item.rarity !== 'rare') return false;
      const f = addFilterFor(item, a)!;
      if (!addPool(item, ctx, f).length) return false;
      if (!has(a, 'Omen of Greater Exaltation')) return true;
      // two modifiers need two free slots on the allowed side(s)
      const open = openSlots(item, ctx);
      return (f.side ? open[f.side] : open.p + open.s) >= 2;
    }
    case 'fracture':
      return item.rarity === 'rare' && item.mods.length >= 4 && !item.mods.some((m) => m.fr);
    case 'chaos':
      return item.rarity === 'rare' && removable(item, ctx, a).length > 0;
    case 'annul':
      return item.rarity !== 'normal' && removable(item, ctx, a).length > 0;
    case 'essence': {
      if (!a.essence) return false;
      if (a.essence.perfect) return item.rarity === 'rare' && removable(item, ctx, a).length > 0;
      if (item.rarity !== 'magic') return false;
      const m = ctx.byId.get(a.essence.modId);
      if (!m) return false;
      const blocked = new Set(item.mods.flatMap((im) => modOf(ctx, im).g));
      return !m.g.some((g) => blocked.has(g));
    }
    case 'desecrate': {
      if (item.rarity !== 'rare') return false;
      if (item.mods.some((m) => m.de)) return false; // one desecrated modifier per item
      return desecrationSides(item, ctx, a).some((s) => desecrationPool(item, ctx, a, s).length > 0);
    }
  }
}

// ------------------------------------------------------------ exact outcomes

function aggregate(pool: PoolEntry[], classify?: Classifier): { mod: ModDef; p: number }[] {
  const total = pool.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return [];
  if (!classify) return pool.map((e) => ({ mod: e.mod, p: e.w / total }));
  const byKey = new Map<string, { mod: ModDef; p: number }>();
  for (const e of pool) {
    const k = classify(e.mod);
    const cur = byKey.get(k);
    if (cur) cur.p += e.w / total;
    else byKey.set(k, { mod: e.mod, p: e.w / total });
  }
  return [...byKey.values()];
}

function withMod(item: Item, mod: ModDef, rarity: Item['rarity'], extra: Partial<ItemMod> = {}): Item {
  return { rarity, mods: [...item.mods.map((m) => ({ ...m })), { id: mod.id, ...extra }] };
}

function withoutIdx(item: Item, i: number): Item {
  return { rarity: item.rarity, mods: item.mods.filter((_, k) => k !== i).map((m) => ({ ...m })) };
}

function addOutcomes(item: Item, ctx: Ctx, f: AddFilter, rarity: Item['rarity'], classify?: Classifier): Outcome[] {
  const pool = addPool(item, ctx, f);
  return aggregate(pool, classify).map(({ mod, p }) => ({ p, item: withMod(item, mod, rarity) }));
}

/**
 * Exact outcome distribution of an action. With a classifier, equivalent
 * modifiers are merged (keeps it fast for the planner).
 * Desecration uses the "best of 3 options" rule with the given preference.
 */
export function outcomes(
  item: Item,
  ctx: Ctx,
  a: Action,
  classify?: Classifier,
  prefer?: (m: ModDef) => number,
): Outcome[] {
  switch (a.kind) {
    case 'restart':
      return [{ p: 1, item: { rarity: 'normal', mods: [] } }];
    case 'transmute':
      return addOutcomes({ rarity: 'magic', mods: [] }, ctx, addFilterFor(item, a)!, 'magic', classify);
    case 'augment':
      return addOutcomes(item, ctx, addFilterFor(item, a)!, 'magic', classify);
    case 'regal': {
      const f = addFilterFor(item, a)!;
      return addOutcomes({ ...item, rarity: 'rare' }, ctx, { ...f, asRarity: undefined }, 'rare', classify);
    }
    case 'exalt': {
      const f = addFilterFor(item, a)!;
      const first = addOutcomes(item, ctx, f, 'rare', classify);
      if (!has(a, 'Omen of Greater Exaltation')) return first;
      const out: Outcome[] = [];
      for (const o of first) {
        const second = addOutcomes(o.item, ctx, f, 'rare', classify);
        if (!second.length) out.push(o);
        for (const x of second) out.push({ p: o.p * x.p, item: x.item });
      }
      return out;
    }
    case 'essence': {
      const m = ctx.byId.get(a.essence!.modId)!;
      if (!a.essence!.perfect) return [{ p: 1, item: withMod(item, m, 'rare') }];
      const idx = removable(item, ctx, a);
      return idx.map((i) => ({ p: 1 / idx.length, item: withMod(withoutIdx(item, i), m, 'rare') }));
    }
    case 'fracture':
      return item.mods.map((_, i) => ({
        p: 1 / item.mods.length,
        item: { rarity: item.rarity, mods: item.mods.map((m, k) => (k === i ? { ...m, fr: true } : { ...m })) },
      }));
    case 'annul': {
      const idx = removable(item, ctx, a);
      return idx.map((i) => ({ p: 1 / idx.length, item: withoutIdx(item, i) }));
    }
    case 'chaos': {
      const idx = removable(item, ctx, a);
      const f = addFilterFor(item, a)!;
      const out: Outcome[] = [];
      for (const i of idx) {
        const after = withoutIdx(item, i);
        const adds = addOutcomes(after, ctx, f, 'rare', classify);
        if (!adds.length) out.push({ p: 1 / idx.length, item: after });
        for (const o of adds) out.push({ p: o.p / idx.length, item: o.item });
      }
      return out;
    }
    case 'desecrate': {
      const sides = desecrationSides(item, ctx, a).filter((s) => desecrationPool(item, ctx, a, s).length > 0);
      const out: Outcome[] = [];
      for (const side of sides) {
        const pool = desecrationPool(item, ctx, a, side);
        const total = pool.reduce((s, e) => s + e.w, 0);
        // Best-of-3 approximated with replacement: P(best = option k) by rank.
        const score = (m: ModDef) => (prefer ? prefer(m) : 0);
        const ranked = aggregate(pool, classify).sort((x, y) => score(y.mod) - score(x.mod));
        let better = 0; // probability mass of strictly better options
        for (const r of ranked) {
          const pBestIsThis = Math.pow(1 - better, 3) - Math.pow(1 - better - r.p, 3);
          better += r.p;
          if (pBestIsThis > 0) out.push({ p: pBestIsThis / sides.length, item: withMod(item, r.mod, 'rare', { de: true }) });
        }
        void total;
      }
      return out;
    }
    case 'alchemy':
      return sampledOutcomes(item, ctx, a, 400);
  }
}

/** Fallback: estimate the distribution by sampling (used for Orb of Alchemy). */
function sampledOutcomes(item: Item, ctx: Ctx, a: Action, n: number): Outcome[] {
  let seed = 12345;
  const rng: Rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const counts = new Map<string, { item: Item; c: number }>();
  for (let k = 0; k < n; k++) {
    const it = sample(item, ctx, a, rng);
    const key = it.mods.map((m) => m.id).sort().join(',');
    const cur = counts.get(key);
    if (cur) cur.c++;
    else counts.set(key, { item: it, c: 1 });
  }
  return [...counts.values()].map((v) => ({ p: v.c / n, item: v.item }));
}

// ------------------------------------------------------------ sampling

function pick(pool: PoolEntry[], rng: Rng): ModDef | null {
  const total = pool.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const e of pool) {
    r -= e.w;
    if (r < 0) return e.mod;
  }
  return pool[pool.length - 1].mod;
}

function addRandom(item: Item, ctx: Ctx, f: AddFilter, rng: Rng, extra: Partial<ItemMod> = {}): boolean {
  const m = pick(addPool(item, ctx, f), rng);
  if (!m) return false;
  item.mods.push({ id: m.id, ...extra });
  return true;
}

/** Apply an action randomly. `prefer` scores desecration options (higher = better). */
export function sample(item: Item, ctx: Ctx, a: Action, rng: Rng, prefer?: (m: ModDef) => number): Item {
  const it = cloneItem(item);
  switch (a.kind) {
    case 'restart':
      return { rarity: 'normal', mods: [] };
    case 'transmute':
      it.rarity = 'magic';
      it.mods = [];
      addRandom(it, ctx, addFilterFor(item, a)!, rng);
      return it;
    case 'augment':
      addRandom(it, ctx, addFilterFor(item, a)!, rng);
      return it;
    case 'regal': {
      it.rarity = 'rare';
      const f = addFilterFor(item, a)!;
      addRandom(it, ctx, { ...f, asRarity: undefined }, rng);
      return it;
    }
    case 'exalt':
      addRandom(it, ctx, addFilterFor(item, a)!, rng);
      if (has(a, 'Omen of Greater Exaltation')) addRandom(it, ctx, addFilterFor(item, a)!, rng);
      return it;
    case 'essence':
      if (a.essence!.perfect) {
        const idx = removable(item, ctx, a);
        if (!idx.length) return it;
        it.mods.splice(idx[Math.floor(rng() * idx.length)], 1);
      }
      it.rarity = 'rare';
      it.mods.push({ id: a.essence!.modId });
      return it;
    case 'fracture': {
      if (!it.mods.length) return it;
      it.mods[Math.floor(rng() * it.mods.length)].fr = true;
      return it;
    }
    case 'annul': {
      const idx = removable(item, ctx, a);
      if (!idx.length) return it;
      const i = idx[Math.floor(rng() * idx.length)];
      it.mods.splice(i, 1);
      return it;
    }
    case 'chaos': {
      const idx = removable(item, ctx, a);
      if (!idx.length) return it;
      const i = idx[Math.floor(rng() * idx.length)];
      it.mods.splice(i, 1);
      addRandom(it, ctx, addFilterFor(item, a)!, rng);
      return it;
    }
    case 'alchemy': {
      it.rarity = 'rare';
      it.mods = [];
      const side = sideOmen(a, 'Omen of Sinistral Alchemy', 'Omen of Dextral Alchemy');
      if (side) {
        const other: Side = side === 'p' ? 's' : 'p';
        const n = ctx.rareCap[side];
        for (let k = 0; k < n; k++) addRandom(it, ctx, { side }, rng);
        for (let k = it.mods.length; k < 4; k++) addRandom(it, ctx, { side: other }, rng);
      } else {
        for (let k = 0; k < 4; k++) addRandom(it, ctx, {}, rng);
      }
      return it;
    }
    case 'desecrate': {
      const sides = desecrationSides(item, ctx, a).filter((s) => desecrationPool(item, ctx, a, s).length > 0);
      if (!sides.length) return it;
      const side = sides[Math.floor(rng() * sides.length)];
      const pool = [...desecrationPool(item, ctx, a, side)];
      const options: ModDef[] = [];
      for (let k = 0; k < 3 && pool.length; k++) {
        const m = pick(pool, rng)!;
        options.push(m);
        pool.splice(
          pool.findIndex((e) => e.mod === m),
          1,
        );
      }
      options.sort((x, y) => (prefer ? prefer(y) - prefer(x) : 0));
      it.mods.push({ id: options[0].id, de: true });
      return it;
    }
  }
}
