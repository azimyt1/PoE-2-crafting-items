import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildCtx } from './item';
import { isValid, outcomes, sample } from './actions';
import { Planner } from './planner';
import { explainPlan, makeRng, simulate } from './simulate';
import { STRATEGIES } from './strategies';
import { DEFAULT_PRICES } from './currency';
import { DEFAULT_ESSENCE_PRICES, essencesForBase } from './essences';
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

describe('new crafting currencies', () => {
  const lifeRes = { rarity: 'rare' as const, mods: [{ id: 'IncreasedLife8' }, { id: 'IncreasedMana5' }, { id: 'FireResist7' }, { id: 'ColdResist5' }] };

  it('fracturing orb locks exactly one modifier, only once', () => {
    const ctx = ctxFor('Gold Ring');
    const outs = outcomes(lifeRes, ctx, { kind: 'fracture' });
    expect(outs).toHaveLength(4);
    for (const o of outs) expect(o.item.mods.filter((m) => m.fr)).toHaveLength(1);
    expect(isValid(outs[0].item, ctx, { kind: 'fracture' })).toBe(false);
    expect(isValid({ rarity: 'rare', mods: lifeRes.mods.slice(0, 3) }, ctx, { kind: 'fracture' })).toBe(false);
  });

  it('perfect essence swaps a random modifier for the guaranteed one', () => {
    const ctx = ctxFor('Gold Ring');
    const ess = essencesForBase(ctx).find((e) => e.name === 'Perfect Essence of Grounding')!;
    const a = { kind: 'essence' as const, essence: { name: ess.name, modId: ess.mod.id, perfect: true } };
    const outs = outcomes(lifeRes, ctx, a);
    expect(outs.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 9);
    for (const o of outs) {
      expect(o.item.mods).toHaveLength(4);
      expect(o.item.mods.map((m) => m.id)).toContain(ess.mod.id);
    }
    // Dextral Crystallisation: only suffixes are removed, the life prefix always stays
    const dex = outcomes(lifeRes, ctx, { ...a, omens: ['Omen of Dextral Crystallisation'] });
    for (const o of dex) expect(o.item.mods.map((m) => m.id)).toContain('IncreasedLife8');
    // not usable on magic items
    expect(isValid({ rarity: 'magic', mods: [] }, ctx, a)).toBe(false);
  });

  it('greater exaltation adds two modifiers', () => {
    const ctx = ctxFor('Gold Ring');
    const outs = outcomes({ rarity: 'rare', mods: [] }, ctx, { kind: 'exalt', omens: ['Omen of Greater Exaltation', 'Omen of Sinistral Exaltation'] });
    expect(outs.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 9);
    for (const o of outs) {
      expect(o.item.mods).toHaveLength(2);
      for (const m of o.item.mods) expect(ctx.byId.get(m.id)!.s).toBe('p');
    }
  });

  it('abstract model and sampled policy agree with fracturing and perfect essences', () => {
    const ctx = ctxFor('Gold Ring');
    const target: Target = { reqs: [req('IncreasedLife7'), req('FireResist6'), req('ColdResist6'), req('LightningResist6')], need: 4 };
    const planner = new Planner(ctx, target, STRATEGIES.find((s) => s.id === 'full')!);
    const res = simulate(planner, { rarity: 'normal', mods: [] }, { trials: 300, maxSteps: 6000, buyFirstBase: true });
    expect(res.successRate).toBeGreaterThan(0.9);
    if (res.successRate > 0.99) expect(Math.abs(res.meanCost - planner.restartCost) / planner.restartCost).toBeLessThan(0.35);
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

describe('community weights (Craft of Exile)', () => {
  const file = JSON.parse(fs.readFileSync('public/data/weights.json', 'utf8'));
  it('maps bases to groups and tiers to game modifiers', () => {
    expect(file.bases['Gold Ring']).toBe('Ring');
    const ring = file.groups.Ring;
    expect(ring.IncreasedLife8).toBeGreaterThan(1);
    // chaos resistance is rarer than fire resistance on rings
    expect(ring.ChaosResist1).toBeLessThan(ring.FireResist1);
    for (const id of Object.keys(ring)) expect(mods.some((m) => m.id === id)).toBe(true);
  });
  it('planner works with imported weights', () => {
    const base = bases.find((b) => b.name === 'Gold Ring')!;
    const ctx = buildCtx({ base, ilvl: 82, mods, prices, baseCost: 1, weightOverrides: file.groups.Ring });
    const target: Target = { reqs: [req('IncreasedLife6'), req('FireResist5'), req('ChaosResist3')], need: 3 };
    const planner = new Planner(ctx, target, STRATEGIES.find((s) => s.id === 'omens')!);
    const res = simulate(planner, { rarity: 'normal', mods: [] }, { trials: 200, maxSteps: 6000, buyFirstBase: true });
    expect(res.successRate).toBeGreaterThan(0.9);
  });
});
