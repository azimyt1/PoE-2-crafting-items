// Essence table. The game client does not export which exact tier each
// essence grants, so the tier is approximated by a modifier-level cap per
// essence grade. Values are editable here if better data is found.

import type { Ctx, ModDef, Prices } from './types';

export interface EssenceFamily {
  /** English essence suffix, e.g. "the Body" -> "Essence of the Body" */
  key: string;
  ru: string;
  /** regex on modifier id (without the tier number) */
  mods: RegExp;
}

export const ESSENCE_FAMILIES: EssenceFamily[] = [
  { key: 'the Body', ru: 'Тела (здоровье)', mods: /^IncreasedLife\d+_*$/ },
  { key: 'the Mind', ru: 'Разума (мана)', mods: /^IncreasedMana(TwoHandWeapon)?\d+_*$/ },
  {
    key: 'Enhancement',
    ru: 'Улучшения (% защиты)',
    mods: /^LocalIncreased(PhysicalDamageReductionRatingPercent|EvasionRatingPercent|EnergyShieldPercent|ArmourAndEvasion|ArmourAndEnergyShield|EvasionAndEnergyShield|ArmourAndEvasionAndEnergyShield)\d+_*$/,
  },
  { key: 'Abrasion', ru: 'Истирания (физ. урон)', mods: /^LocalAddedPhysicalDamage(TwoHand)?\d+_*$/ },
  { key: 'Flames', ru: 'Пламени (урон огнём)', mods: /^LocalAddedFireDamage(TwoHand)?\d+_*$/ },
  { key: 'Ice', ru: 'Льда (урон холодом)', mods: /^LocalAddedColdDamage(TwoHand)?\d+_*$/ },
  { key: 'Electricity', ru: 'Электричества (урон молнией)', mods: /^LocalAddedLightningDamage(TwoHand)?\d+_*$/ },
  { key: 'Insulation', ru: 'Изоляции (сопр. огню)', mods: /^FireResist\d+_*$/ },
  { key: 'Thawing', ru: 'Оттаивания (сопр. холоду)', mods: /^ColdResist\d+_*$/ },
  { key: 'Grounding', ru: 'Заземления (сопр. молнии)', mods: /^LightningResist\d+_*$/ },
  { key: 'Ruin', ru: 'Разрушения (сопр. хаосу)', mods: /^ChaosResist\d+_*$/ },
  { key: 'Haste', ru: 'Спешки (скорость атаки)', mods: /^(Local)?IncreasedAttackSpeed\d+_*$/ },
  { key: 'Alacrity', ru: 'Проворства (скорость чар)', mods: /^(IncreasedCastSpeed(TwoHand)?|CastSpeedJewellery)\d+_*$/ },
  { key: 'Seeking', ru: 'Поиска (шанс крита)', mods: /^(LocalCriticalStrikeChance|CriticalStrikeChance|SpellCriticalStrikeChance(TwoHand)?)\d+_*$/ },
  { key: 'Sorcery', ru: 'Колдовства (урон чарами)', mods: /^(SpellDamageOnWeapon|SpellDamageOnTwoHandWeapon|SpellDamage)\d+_*$/ },
  { key: 'Opulence', ru: 'Богатства (редкость)', mods: /^ItemFoundRarityIncrease\d+_*$/ },
];

export const ESSENCE_GRADES = [
  { prefix: 'Lesser ', ru: 'Малая', maxLevel: 16 },
  { prefix: '', ru: 'Обычная', maxLevel: 33 },
  { prefix: 'Greater ', ru: 'Большая', maxLevel: 54 },
] as const;

export function essenceName(fam: EssenceFamily, grade: (typeof ESSENCE_GRADES)[number]): string {
  return `${grade.prefix}Essence of ${fam.key}`;
}

export const DEFAULT_ESSENCE_PRICES: Prices = Object.fromEntries(
  ESSENCE_FAMILIES.flatMap((f) => [
    [essenceName(f, ESSENCE_GRADES[0]), 0.1],
    [essenceName(f, ESSENCE_GRADES[1]), 0.4],
    [essenceName(f, ESSENCE_GRADES[2]), 3],
  ]),
);

export interface EssenceOption {
  name: string;
  ru: string;
  mod: ModDef;
}

/** All essences usable on this base, with the modifier each one guarantees. */
export function essencesForBase(ctx: Ctx): EssenceOption[] {
  const out: EssenceOption[] = [];
  for (const fam of ESSENCE_FAMILIES) {
    const tiers = ctx.regular
      .map((e) => e.mod)
      .filter((m) => fam.mods.test(m.id))
      .sort((a, b) => a.l - b.l);
    if (!tiers.length) continue;
    // One family per essence: if several match (e.g. local and global), keep the first family found.
    const f0 = tiers[0].f;
    const famTiers = tiers.filter((m) => m.f === f0);
    for (const grade of ESSENCE_GRADES) {
      const eligible = famTiers.filter((m) => m.l <= grade.maxLevel);
      const mod = eligible[eligible.length - 1] ?? famTiers[0];
      out.push({ name: essenceName(fam, grade), ru: `${grade.ru} эссенция ${fam.ru}`, mod });
    }
  }
  return out;
}
