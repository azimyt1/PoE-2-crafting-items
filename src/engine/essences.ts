// Essences and alloys. Which modifier each one adds on which base comes from
// the exact table of Craft of Exile (public/data/essences.json, built by
// scripts/build-coe.mjs); this file only holds names and default prices.

import type { Ctx, ModDef, Prices } from './types';

/** English essence suffix -> Russian description */
const FAMILY_RU: Record<string, string> = {
  'the Body': 'Тела (здоровье)',
  'the Mind': 'Разума (мана)',
  Enhancement: 'Улучшения (защита)',
  Abrasion: 'Истирания (физ. урон)',
  Flames: 'Пламени (урон огнём)',
  Ice: 'Льда (урон холодом)',
  Electricity: 'Электричества (урон молнией)',
  Insulation: 'Изоляции (сопр. огню)',
  Thawing: 'Оттаивания (сопр. холоду)',
  Grounding: 'Заземления (сопр. молнии)',
  Ruin: 'Разрушения (сопр. хаосу)',
  Haste: 'Спешки (скорость атаки)',
  Alacrity: 'Проворства (скорость чар)',
  Seeking: 'Поиска (крит)',
  Sorcery: 'Колдовства (урон чарами)',
  Opulence: 'Богатства (редкость)',
  Battle: 'Битвы (атаки)',
  Command: 'Командования (приспешники)',
  'the Infinite': 'Бесконечности (характеристики)',
};

const CORRUPTED = ['Delirium', 'Horror', 'Hysteria', 'Insanity'];
const CORRUPTED_RU: Record<string, string> = { Delirium: 'Бреда', Horror: 'Ужаса', Hysteria: 'Истерии', Insanity: 'Безумия' };

const ALLOYS = [
  'Adaptive Alloy',
  'Celestial Alloy',
  'Cyclonic Alloy',
  'Expansive Alloy',
  'Mystic Alloy',
  'Prismatic Alloy',
  'Protective Alloy',
  'Runic Alloy',
  'Sovereign Alloy',
  'Swift Alloy',
  'Transcendent Alloy',
  "The Runebinder's Alloy",
  "The Runefather's Alloy",
];

const GRADES = [
  { prefix: 'Lesser ', ru: 'Малая', price: 0.1 },
  { prefix: '', ru: 'Обычная', price: 0.4 },
  { prefix: 'Greater ', ru: 'Большая', price: 3 },
  { prefix: 'Perfect ', ru: 'Совершенная', price: 25 },
] as const;

/** Russian display name of an essence or alloy. */
export function essenceRu(name: string): string {
  if (name.endsWith('Alloy')) return `Сплав: ${name}`;
  const m = name.match(/^(Lesser |Greater |Perfect )?Essence of (.+)$/);
  if (!m) return name;
  if (CORRUPTED.includes(m[2])) return `Эссенция ${CORRUPTED_RU[m[2]]}`;
  const grade = GRADES.find((g) => g.prefix === (m[1] ?? '')) ?? GRADES[1];
  return `${grade.ru} эссенция ${FAMILY_RU[m[2]] ?? m[2]}`;
}

/** Placeholder prices in Exalted Orbs (real ones come from poe.ninja). */
export const DEFAULT_ESSENCE_PRICES: Prices = Object.fromEntries([
  ...Object.keys(FAMILY_RU).flatMap((f) => GRADES.map((g) => [`${g.prefix}Essence of ${f}`, g.price])),
  ...CORRUPTED.map((c) => [`Essence of ${c}`, 20]),
  ...ALLOYS.map((a) => [a, 10]),
]);

export interface EssenceOption {
  name: string;
  ru: string;
  /** modifiers it can add (one of them, at random) */
  mods: ModDef[];
  /** used on rare items: removes a random modifier first */
  rare: boolean;
  /** Omens of Crystallisation apply */
  crystal: boolean;
}

/** All essences and alloys usable on this base, with the modifiers they add. */
export function essencesForBase(ctx: Ctx): EssenceOption[] {
  const out: EssenceOption[] = [];
  for (const e of ctx.essences) {
    const mods = e.m.map((id) => ctx.byId.get(id)).filter((m): m is ModDef => !!m);
    if (!mods.length) continue;
    out.push({ name: e.n, ru: essenceRu(e.n), mods, rare: !!e.r, crystal: !!e.c });
  }
  return out;
}
