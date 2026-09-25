import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildCtx } from './item';
import { outcomes, sample } from './actions';
import { Planner } from './planner';
import { explainPlan, makeRng, simulate } from './simulate';
import { STRATEGIES } from './strategies';
import { DEFAULT_PRICES } from './currency';
import { DEFAULT_ESSENCE_PRICES } from './essences';
import type { BaseDef, ModDef, Target } from './types';

const mods: ModDef[] = JSON.parse(fs.readFileSync('public/data/mods.json', 'utf8'));
const bases: BaseDef[] = JSON.parse(fs.readFileSync('public/data/bases.json', 'utf8'));
const prices = { ...DEFAULT_PRICES, ...DEFAULT_ESSENCE_PRICES };

function ctxFor(name: string, ilvl = 82) {
  const base = bases.find((b) => b.name === name)!;
  return buildCtx({ base, ilvl, mods, prices, baseCost: 1 });
}
const fam = (id: string) => mods.find((m) => m.id === id)!;
function req(id: string) {
  const m = fam(id);
  return { fam: m.f, minLevel: m.l, side: m.s, label: m.x };
}

describe('pool', () => {
  it('ring pool has life, resistances and no body-armour mods', () => {
    const ctx = ctxFor('Gold Ring');
    const ids = ctx.regular.map((e) => e.mod.id);
    expect(ids).toContain('IncreasedLife8');
    expect(ids).toContain('FireResist7');
    expect(ids.some((i) => i.startsWith('LocalIncreasedPhysicalDamageReductionRating'))).toBe(false);
  });
  it('Dusk Ring allows 4 prefixes and 2 suffixes', () => {
    const ctx = ctxFor('Dusk Ring');
    expect(ctx.rareCap).toEqual({ p: 4, s: 2 });
  });
});

describe('actions', () => {
  it('transmute exact distribution sums to 1 and matches sampling', () => {
    const ctx = ctxFor('Gold Ring');
    const outs = outcomes({ rarity: 'normal', mods: [] }, ctx, { kind: 'transmute' });
    const total = outs.reduce((s, o) => s + o.p, 0);
    expect(total).toBeCloseTo(1, 6);
    const lifeP = outs.filter((o) => o.item.mods[0].id.startsWith('IncreasedLife')).reduce((s, o) => s + o.p, 0);
    const rng = makeRng(3);
    let hits = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (sample({ rarity: 'normal', mods: [] }, ctx, { kind: 'transmute' }, rng).mods[0].id.startsWith('IncreasedLife')) hits++;
    expect(Math.abs(hits / N - lifeP)).toBeLessThan(0.01);
  });
  it('perfect exalt only adds modifiers of level 50+', () => {
    const ctx = ctxFor('Gold Ring');
    const outs = outcomes({ rarity: 'rare', mods: [] }, ctx, { kind: 'exalt', tier: 2 });
    for (const o of outs) expect(ctx.byId.get(o.item.mods[0].id)!.l).toBeGreaterThanOrEqual(50);
  });
  it('sinistral exaltation only adds prefixes', () => {
    const ctx = ctxFor('Gold Ring');
    const outs = outcomes({ rarity: 'rare', mods: [] }, ctx, { kind: 'exalt', omens: ['Omen of Sinistral Exaltation'] });
    for (const o of outs) expect(ctx.byId.get(o.item.mods[0].id)!.s).toBe('p');
  });
  it('fractured mods are never removed', () => {
    const ctx = ctxFor('Gold Ring');
    const item = { rarity: 'rare' as const, mods: [{ id: 'IncreasedLife9', fr: true }, { id: 'FireResist7' }] };
    const outs = outcomes(item, ctx, { kind: 'annul' });
    expect(outs).toHaveLength(1);
    expect(outs[0].item.mods.map((m) => m.id)).toEqual(['IncreasedLife9']);
  });
});

describe('planner + simulation', () => {
  const target: Target = { reqs: [req('IncreasedLife6'), req('FireResist5'), req('ColdResist5')], need: 3 };

  for (const s of STRATEGIES) {
    it(`strategy ${s.id} finishes a 3-mod ring`, () => {
      const ctx = ctxFor('Gold Ring');
      const planner = new Planner(ctx, target, s);
      const res = simulate(planner, { rarity: 'normal', mods: [] }, { trials: 300, maxSteps: 6000, buyFirstBase: true });
      expect(res.successRate).toBeGreaterThan(0.9);
      // the model estimate and the simulated policy must agree (within noise)
      if (res.successRate > 0.99) expect(Math.abs(res.meanCost - planner.restartCost) / planner.restartCost).toBeLessThan(0.35);
    });
  }

  it('explains a plan with fallbacks', () => {
    const ctx = ctxFor('Gold Ring');
    const planner = new Planner(ctx, target, STRATEGIES[1]);
    const plan = explainPlan(planner, { rarity: 'normal', mods: [] });
    expect(plan.length).toBeGreaterThan(2);
  });
});
