import type { Prices } from '../engine/types';

export type DisplayCurrency = 'ex' | 'div' | 'chaos';

export const CURRENCY_LABEL: Record<DisplayCurrency, string> = {
  ex: 'экз',
  div: 'див',
  chaos: 'хаос',
};

/** Convert a value in Exalted Orbs to the display currency. */
export function convert(ex: number, cur: DisplayCurrency, prices: Prices): number {
  if (cur === 'div') return ex / (prices['Divine Orb'] || 1);
  if (cur === 'chaos') return ex / (prices['Chaos Orb'] || 1);
  return ex;
}

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return '∞';
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString('ru-RU');
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  if (a >= 1) return x.toFixed(2);
  return x.toPrecision(2);
}

export function fmtCost(ex: number, cur: DisplayCurrency, prices: Prices): string {
  return `${fmtNum(convert(ex, cur, prices))} ${CURRENCY_LABEL[cur]}`;
}

export function fmtPct(p: number): string {
  if (p >= 0.995 && p < 1) return '>99%';
  if (p > 0 && p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}
