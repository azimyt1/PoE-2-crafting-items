// Item model: context construction, affix capacity, modifier pools, analysis.

import type { BaseDef, Ctx, Item, ItemMod, ModDef, PoolEntry, Prices, Side, Target } from './types';

export const DEFAULT_WEIGHT = 1000;

export function spawnWeight(mod: ModDef, tags: Set<string>): number {
  for (const [tag, w] of mod.w) if (tags.has(tag)) return w;
  return 0;
}

/** "+1 Prefix Modifier allowed / -1 Suffix Modifier allowed" (Dusk Ring etc.) */
export function rareCapacity(base: BaseDef): { p: number; s: number } {
  const cap = { p: 3, s: 3 };
  for (const line of base.imp) {
    for (const part of line.split('\n')) {
      const m = part.match(/([+-]\d+) (Prefix|Suffix) Modifiers? allowed/i);
      if (m) {
        const d = parseInt(m[1], 10);
        if (m[2].toLowerCase() === 'prefix') cap.p += d;
        else cap.s += d;
      }
    }
  }
  cap.p = Math.max(0, cap.p);
  cap.s = Math.max(0, cap.s);
  return cap;
}

export function buildCtx(opts: {
  base: BaseDef;
  ilvl: number;
  mods: ModDef[];
  prices: Prices;
  baseCost: number;
  weightOverrides?: Record<string, number>;
}): Ctx {
  const { base, ilvl, mods, prices, baseCost } = opts;
  const tags = new Set(base.tags);
  const ov = opts.weightOverrides ?? {};
  const regular: PoolEntry[] = [];
  const lords: PoolEntry[] = [];
  const byId = new Map<string, ModDef>();
  const famGroups = new Map<string, Set<string>>();
  for (const m of mods) {
    byId.set(m.id, m);
    const sw = spawnWeight(m, tags);
    if (sw <= 0) continue;
    let g = famGroups.get(m.f);
    if (!g) famGroups.set(m.f, (g = new Set()));
    for (const x of m.g) g.add(x);
    if (m.l > ilvl) continue;
    // The game client only says "can spawn" (weight 1). Real weights are
    // server-side; community estimates can be supplied as overrides.
    const w = ov[m.id] ?? (sw > 1 ? sw : DEFAULT_WEIGHT);
    if (w <= 0) continue;
    (m.d ? lords : regular).push({ mod: m, w });
  }
  return { base, ilvl, regular, lords, byId, rareCap: rareCapacity(base), prices, baseCost, famGroups };
}

export function capacity(item: Item, ctx: Ctx): { p: number; s: number } {
  if (item.rarity === 'magic') return { p: 1, s: 1 };
  if (item.rarity === 'rare') return ctx.rareCap;
  return { p: 0, s: 0 };
}

export function modOf(ctx: Ctx, im: ItemMod): ModDef {
  const m = ctx.byId.get(im.id);
  if (!m) throw new Error(`Unknown modifier ${im.id}`);
  return m;
}

export function sideCounts(item: Item, ctx: Ctx): { p: number; s: number } {
  const c = { p: 0, s: 0 };
  for (const im of item.mods) c[modOf(ctx, im).s]++;
  return c;
}

export function openSlots(item: Item, ctx: Ctx): { p: number; s: number } {
  const cap = capacity(item, ctx);
  const c = sideCounts(item, ctx);
  return { p: Math.max(0, cap.p - c.p), s: Math.max(0, cap.s - c.s) };
}

export function blockedGroups(item: Item, ctx: Ctx): Set<string> {
  const g = new Set<string>();
  for (const im of item.mods) for (const x of modOf(ctx, im).g) g.add(x);
  return g;
}

export interface AddFilter {
  minLevel?: number;
  maxLevel?: number;
  /** restrict to one side (omens) */
  side?: Side;
  /** use the desecration pool (regular + Abyss lord modifiers) */
  desecration?: boolean;
  /** treat item as having this rarity's capacity (e.g. regal: magic -> rare) */
  asRarity?: Item['rarity'];
}

/** Modifiers that can be added to the item right now, with weights. */
export function addPool(item: Item, ctx: Ctx, f: AddFilter = {}): PoolEntry[] {
  const it = f.asRarity ? { ...item, rarity: f.asRarity } : item;
  const open = openSlots(it, ctx);
  const blocked = blockedGroups(item, ctx);
  const minL = f.minLevel ?? 0;
  const maxL = f.maxLevel ?? Infinity;
  const src = f.desecration ? [...ctx.regular, ...ctx.lords] : ctx.regular;
  const out: PoolEntry[] = [];
  for (const e of src) {
    const m = e.mod;
    if (f.side && m.s !== f.side) continue;
    if (open[m.s] <= 0) continue;
    if (m.l < minL || m.l > maxL) continue;
    if (m.g.some((g) => blocked.has(g))) continue;
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------- analysis

export interface Analysis {
  /** indices of reqs satisfied */
  met: Set<number>;
  goal: boolean;
  /** per item mod: index of req it satisfies, or -1 */
  modReq: number[];
  /** per item mod: index of req it blocks (same group, too low tier), or -1 */
  modBlocks: number[];
}

export function modMatchesReq(m: ModDef, req: { fam: string; minLevel: number }): boolean {
  return m.f === req.fam && m.l >= req.minLevel;
}

export function analyze(item: Item, ctx: Ctx, target: Target): Analysis {
  const met = new Set<number>();
  const modReq: number[] = [];
  const modBlocks: number[] = [];
  for (const im of item.mods) {
    const m = modOf(ctx, im);
    let r = -1;
    let b = -1;
    for (let i = 0; i < target.reqs.length; i++) {
      const req = target.reqs[i];
      if (!met.has(i) && modMatchesReq(m, req)) {
        r = i;
        break;
      }
    }
    if (r >= 0) met.add(r);
    else {
      for (let i = 0; i < target.reqs.length; i++) {
        const fg = ctx.famGroups.get(target.reqs[i].fam);
        if (fg && m.g.some((g) => fg.has(g))) {
          b = i;
          break;
        }
      }
    }
    modReq.push(r);
    modBlocks.push(b);
  }
  // A blocker is only relevant if its req is still missing.
  for (let k = 0; k < modBlocks.length; k++) if (modBlocks[k] >= 0 && met.has(modBlocks[k])) modBlocks[k] = -1;
  return { met, goal: met.size >= target.need, modReq, modBlocks };
}

export function itemSignature(item: Item): string {
  const parts = item.mods.map((m) => m.id + (m.fr ? '!' : '') + (m.de ? '~' : '')).sort();
  return item.rarity[0] + ':' + parts.join(',');
}

export function cloneItem(item: Item): Item {
  return { rarity: item.rarity, mods: item.mods.map((m) => ({ ...m })) };
}

export const NORMAL_ITEM: Item = { rarity: 'normal', mods: [] };
