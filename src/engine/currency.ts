// Currency names, rules and placeholder prices.
// Rules follow Path of Exile 2 patch 0.5.x (game data 4.5.5.2).

import { essenceRu } from './essences';
import type { Action, BaseDef, BoneTier, OmenName, OrbTier, Prices } from './types';

export const ORB_NAMES: Record<'transmute' | 'augment' | 'regal' | 'exalt' | 'chaos', [string, string, string]> = {
  transmute: ['Orb of Transmutation', 'Greater Orb of Transmutation', 'Perfect Orb of Transmutation'],
  augment: ['Orb of Augmentation', 'Greater Orb of Augmentation', 'Perfect Orb of Augmentation'],
  regal: ['Regal Orb', 'Greater Regal Orb', 'Perfect Regal Orb'],
  exalt: ['Exalted Orb', 'Greater Exalted Orb', 'Perfect Exalted Orb'],
  chaos: ['Chaos Orb', 'Greater Chaos Orb', 'Perfect Chaos Orb'],
};

/** Minimum modifier level added by Greater / Perfect orbs. */
export const MIN_MOD_LEVEL: Record<keyof typeof ORB_NAMES, [number, number, number]> = {
  transmute: [0, 44, 70],
  augment: [0, 44, 70],
  regal: [0, 35, 50],
  exalt: [0, 35, 50],
  chaos: [0, 35, 50],
};

export const ALCHEMY = 'Orb of Alchemy';
export const ANNUL = 'Orb of Annulment';
export const FRACTURE = 'Fracturing Orb';
export const DIVINE = 'Divine Orb';

/** Bone limits: Gnawed rolls modifiers up to level 64, Ancient only level 40+. */
export const BONE_LEVELS: Record<BoneTier, { min: number; max: number }> = {
  Gnawed: { min: 0, max: 64 },
  Preserved: { min: 0, max: 999 },
  Ancient: { min: 40, max: 999 },
};

/** Bones desecrate jewellery, weapons / quivers and armour only. */
export function canDesecrate(base: BaseDef): boolean {
  return !base.tags.includes('jewel');
}

export function boneKind(base: BaseDef): 'Jawbone' | 'Rib' | 'Collarbone' {
  const t = new Set(base.tags);
  if (t.has('ring') || t.has('amulet') || t.has('belt')) return 'Collarbone';
  if (t.has('weapon') || t.has('wand') || t.has('staff') || t.has('sceptre') || t.has('quiver') || t.has('onehand') || t.has('twohand'))
    return 'Jawbone';
  return 'Rib';
}

export function boneName(base: BaseDef, tier: BoneTier): string {
  return `${tier} ${boneKind(base)}`;
}

/** Items (currency, omens, bones, essences) consumed by an action. */
export function actionItems(action: Action, base: BaseDef): string[] {
  const tier: OrbTier = action.tier ?? 0;
  const items: string[] = [];
  switch (action.kind) {
    case 'transmute':
    case 'augment':
    case 'regal':
    case 'exalt':
    case 'chaos':
      items.push(ORB_NAMES[action.kind][tier]);
      break;
    case 'alchemy':
      items.push(ALCHEMY);
      break;
    case 'annul':
      items.push(ANNUL);
      break;
    case 'fracture':
      items.push(FRACTURE);
      break;
    case 'essence':
      if (action.essence) items.push(action.essence.name);
      break;
    case 'desecrate':
      items.push(boneName(base, action.bone ?? 'Preserved'));
      break;
    case 'restart':
      break;
  }
  for (const o of action.omens ?? []) items.push(o);
  return items;
}

export function actionCost(action: Action, base: BaseDef, prices: Prices, baseCost: number): number {
  if (action.kind === 'restart') return baseCost;
  let c = 0;
  for (const name of actionItems(action, base)) c += prices[name] ?? Infinity;
  return c;
}

export function hasPrice(action: Action, base: BaseDef, prices: Prices): boolean {
  if (action.kind === 'restart') return true;
  return actionItems(action, base).every((n) => Number.isFinite(prices[n]) && prices[n] >= 0);
}

const OMEN_RU: Record<OmenName, string> = {
  'Omen of Sinistral Exaltation': 'Омен левого возвышения (только префикс)',
  'Omen of Dextral Exaltation': 'Омен правого возвышения (только суффикс)',
  'Omen of Sinistral Coronation': 'Омен левой коронации (регал: только префикс)',
  'Omen of Dextral Coronation': 'Омен правой коронации (регал: только суффикс)',
  'Omen of Sinistral Alchemy': 'Омен левой алхимии (макс. префиксов)',
  'Omen of Dextral Alchemy': 'Омен правой алхимии (макс. суффиксов)',
  'Omen of Whittling': 'Омен строгания (хаос убирает мод с самым низким уровнем)',
  'Omen of Sinistral Erasure': 'Омен левого стирания (хаос убирает только префикс)',
  'Omen of Dextral Erasure': 'Омен правого стирания (хаос убирает только суффикс)',
  'Omen of Sinistral Annulment': 'Омен левого аннулирования (убрать только префикс)',
  'Omen of Dextral Annulment': 'Омен правого аннулирования (убрать только суффикс)',
  'Omen of Light': 'Омен света (аннулирование убирает только очернённый мод)',
  'Omen of Sinistral Necromancy': 'Омен левой некромантии (кость: только префикс)',
  'Omen of Dextral Necromancy': 'Омен правой некромантии (кость: только суффикс)',
  'Omen of Greater Exaltation': 'Омен большего возвышения (экзальт добавляет 2 мода)',
  'Omen of Sinistral Crystallisation': 'Омен левой кристаллизации (совершенная эссенция убирает только префикс)',
  'Omen of Dextral Crystallisation': 'Омен правой кристаллизации (совершенная эссенция убирает только суффикс)',
};

export function omenRu(o: OmenName): string {
  return OMEN_RU[o] ?? o;
}

const ORB_RU: Record<string, string> = {
  transmute: 'Сфера превращения',
  augment: 'Сфера усиления',
  regal: 'Сфера царей (регал)',
  exalt: 'Сфера возвышения (экзальт)',
  chaos: 'Сфера хаоса',
  alchemy: 'Сфера алхимии',
  annul: 'Сфера отмены (аннулирование)',
  fracture: 'Сфера раскола (закрепить случайный мод)',
  restart: 'Взять новую базу и начать заново',
};
const TIER_RU = ['', 'Большая ', 'Совершенная '];

export function actionTitleRu(a: Action, base: BaseDef): string {
  let t: string;
  if (a.kind === 'essence') t = a.essence ? `${essenceRu(a.essence.name)} (${a.essence.name})` : 'Эссенция';
  else if (a.kind === 'desecrate') t = `Очернение костью: ${boneName(base, a.bone ?? 'Preserved')} (выбрать лучший из 3)`;
  else {
    const tier = a.tier ?? 0;
    const name = ORB_RU[a.kind] ?? a.kind;
    t = tier ? `${TIER_RU[tier]}${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;
  }
  if (a.omens?.length) t += ` + ${a.omens.map(omenRu).join(' + ')}`;
  return t;
}

/**
 * Placeholder prices in Exalted Orbs. They are only rough defaults so the
 * planner works offline; real prices come from poe.ninja (public/data/prices.json)
 * or are typed in by the user.
 */
export const DEFAULT_PRICES: Prices = {
  'Orb of Transmutation': 0.05,
  'Greater Orb of Transmutation': 0.5,
  'Perfect Orb of Transmutation': 4,
  'Orb of Augmentation': 0.05,
  'Greater Orb of Augmentation': 0.5,
  'Perfect Orb of Augmentation': 4,
  'Regal Orb': 0.3,
  'Greater Regal Orb': 2,
  'Perfect Regal Orb': 8,
  'Orb of Alchemy': 0.3,
  'Exalted Orb': 1,
  'Greater Exalted Orb': 5,
  'Perfect Exalted Orb': 25,
  'Chaos Orb': 3,
  'Greater Chaos Orb': 8,
  'Perfect Chaos Orb': 25,
  'Orb of Annulment': 5,
  'Fracturing Orb': 30,
  'Divine Orb': 200,
  'Omen of Sinistral Exaltation': 15,
  'Omen of Dextral Exaltation': 15,
  'Omen of Sinistral Coronation': 3,
  'Omen of Dextral Coronation': 3,
  'Omen of Sinistral Alchemy': 3,
  'Omen of Dextral Alchemy': 3,
  'Omen of Whittling': 25,
  'Omen of Sinistral Erasure': 8,
  'Omen of Dextral Erasure': 8,
  'Omen of Sinistral Annulment': 12,
  'Omen of Dextral Annulment': 12,
  'Omen of Light': 20,
  'Omen of Sinistral Necromancy': 5,
  'Omen of Dextral Necromancy': 5,
  'Omen of Greater Exaltation': 10,
  'Omen of Sinistral Crystallisation': 10,
  'Omen of Dextral Crystallisation': 10,
  'Gnawed Jawbone': 0.3,
  'Preserved Jawbone': 2,
  'Ancient Jawbone': 10,
  'Gnawed Rib': 0.3,
  'Preserved Rib': 2,
  'Ancient Rib': 10,
  'Gnawed Collarbone': 0.5,
  'Preserved Collarbone': 3,
  'Ancient Collarbone': 15,
};
