import { describe, expect, it } from 'vitest';
import { fetchNinjaPrices, parseOverview, toExalts } from './ninja';

// Shape of poe.ninja PoE2 exchange overview: values in the primary currency (divine).
const CURRENCY = {
  core: { primary: 'divine', rates: { exalted: 250, chaos: 40 }, items: [{ id: 'divine', name: 'Divine Orb' }] },
  items: [
    { id: 'exalted', name: 'Exalted Orb' },
    { id: 'chaos', name: 'Chaos Orb' },
    { id: 'annul', name: 'Orb of Annulment' },
  ],
  lines: [
    { id: 'divine', primaryValue: 1 },
    { id: 'exalted', primaryValue: 0.004 },
    { id: 'chaos', primaryValue: 0.025 },
    { id: 'annul', primaryValue: 0.02 },
  ],
};

describe('poe.ninja parser', () => {
  it('converts divine-denominated values to exalts via the Exalted Orb line', () => {
    const o = parseOverview(CURRENCY);
    const ex = toExalts(o.values, o.primary, o.rates)!;
    expect(ex['Exalted Orb']).toBe(1);
    expect(ex['Divine Orb']).toBeCloseTo(250, 6);
    expect(ex['Chaos Orb']).toBeCloseTo(6.25, 6);
    expect(ex['Orb of Annulment']).toBeCloseTo(5, 6);
  });

  it('falls back to core rates when the exalt line is missing', () => {
    const o = parseOverview({ ...CURRENCY, lines: CURRENCY.lines.filter((l) => l.id !== 'exalted') });
    expect(toExalts(o.values, o.primary, o.rates)!['Divine Orb']).toBeCloseTo(250, 6);
  });

  it('collects categories and skips failing ones', async () => {
    const omens = { items: [{ id: 'w', name: 'Omen of Whittling' }], lines: [{ id: 'w', primaryValue: 0.1 }] };
    const prices = await fetchNinjaPrices('League', async (url) => {
      if (url.includes('type=Currency')) return CURRENCY;
      if (url.includes('type=Omens')) return omens;
      throw new Error('404');
    });
    expect(prices!['Omen of Whittling']).toBeCloseTo(25, 6);
  });
});
