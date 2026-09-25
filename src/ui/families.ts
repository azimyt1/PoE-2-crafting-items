// Groups the modifier pool of a base into families (tiers of one modifier).

import type { Ctx, ModDef, Side } from '../engine/types';

export interface Family {
  fam: string;
  side: Side;
  name: string;
  /** tiers sorted best (highest level) first */
  tiers: ModDef[];
  desecrated: boolean;
}

export function genericText(text: string): string {
  return text
    .replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, '#')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\n/g, ' / ');
}

export function familiesOf(ctx: Ctx): Family[] {
  const map = new Map<string, Family>();
  for (const e of [...ctx.regular, ...ctx.lords]) {
    const m = e.mod;
    let f = map.get(m.f);
    if (!f) map.set(m.f, (f = { fam: m.f, side: m.s, name: '', tiers: [], desecrated: !!m.d }));
    f.tiers.push(m);
  }
  for (const f of map.values()) {
    f.tiers.sort((a, b) => b.l - a.l);
    f.name = genericText(f.tiers[0].x);
  }
  return [...map.values()].sort((a, b) => a.side.localeCompare(b.side) || Number(a.desecrated) - Number(b.desecrated) || a.name.localeCompare(b.name));
}

export function tierLabel(f: Family, m: ModDef): string {
  const n = f.tiers.indexOf(m) + 1;
  return `T${n} · ур.${m.l} · ${m.x.replace(/\n/g, ' / ')}`;
}
