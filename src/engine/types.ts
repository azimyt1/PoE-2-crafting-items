// Core data types of the crafting engine.

export type Side = 'p' | 's';
export type Rarity = 'normal' | 'magic' | 'rare';

/** Modifier definition as produced by scripts/build-data.mjs */
export interface ModDef {
  id: string;
  /** affix name, e.g. "of the Brute" */
  n: string;
  /** p = prefix, s = suffix */
  s: Side;
  /** exclusive groups: an item cannot have two mods sharing a group */
  g: string[];
  /** family key: same stats on the same side = tiers of one modifier */
  f: string;
  /** modifier level (item level required to roll it) */
  l: number;
  /** display text */
  x: string;
  /** spawn weights in RePoE order: first tag present on the item decides */
  w: [string, number][];
  /** modifier tags (life, defences, attack...) */
  tg: string[];
  /** 1 = desecrated-only modifier (Abyss lords) */
  d: 0 | 1;
  /** 1 = only added by essences / alloys, never rolls */
  e?: 1;
  /** stat ranges */
  st: [number, number][];
}

export interface BaseDef {
  id: string;
  name: string;
  cls: string;
  tags: string[];
  lvl: number;
  imp: string[];
  def: { ar?: number; ev?: number; es?: number };
}

export interface ItemMod {
  id: string;
  /** fractured: can never be removed */
  fr?: boolean;
  /** added by desecration: Omen of Light annulment can target it */
  de?: boolean;
}

export interface Item {
  rarity: Rarity;
  mods: ItemMod[];
}

export interface PoolEntry {
  mod: ModDef;
  w: number;
}

/** One wanted modifier: a family with a minimum modifier level (= minimum tier). */
export interface TargetReq {
  fam: string;
  minLevel: number;
  side: Side;
  label: string;
}

export interface Target {
  reqs: TargetReq[];
  /** how many of reqs must be on the item (default: all) */
  need: number;
  /** free prefix / suffix slots the finished rare item must keep (for later crafting) */
  open?: { p: number; s: number };
}

/** Prices in Exalted Orbs, keyed by in-game English item name. */
export type Prices = Record<string, number>;

export interface Ctx {
  base: BaseDef;
  ilvl: number;
  /** regular modifiers that can roll on this base at this item level */
  regular: PoolEntry[];
  /** desecrated-only (Abyss lord) modifiers for this base */
  lords: PoolEntry[];
  byId: Map<string, ModDef>;
  /** max prefixes / suffixes on a rare (after base implicits like Dusk Ring) */
  rareCap: { p: number; s: number };
  prices: Prices;
  /** price of a fresh base item, in exalts */
  baseCost: number;
  /** groups of every family, used to detect blockers */
  famGroups: Map<string, Set<string>>;
  /** essences and alloys usable on this base (exact table from Craft of Exile) */
  essences: EssenceDef[];
  /** modifiers that only essences / alloys add on this base (can be targets) */
  essenceMods: ModDef[];
}

export type OmenName =
  | 'Omen of Sinistral Exaltation'
  | 'Omen of Dextral Exaltation'
  | 'Omen of Sinistral Coronation'
  | 'Omen of Dextral Coronation'
  | 'Omen of Sinistral Alchemy'
  | 'Omen of Dextral Alchemy'
  | 'Omen of Whittling'
  | 'Omen of Sinistral Erasure'
  | 'Omen of Dextral Erasure'
  | 'Omen of Sinistral Annulment'
  | 'Omen of Dextral Annulment'
  | 'Omen of Light'
  | 'Omen of Sinistral Necromancy'
  | 'Omen of Dextral Necromancy'
  | 'Omen of Greater Exaltation'
  | 'Omen of Sinistral Crystallisation'
  | 'Omen of Dextral Crystallisation';

export type ActionKind =
  | 'transmute'
  | 'augment'
  | 'regal'
  | 'alchemy'
  | 'exalt'
  | 'chaos'
  | 'annul'
  | 'essence'
  | 'desecrate'
  | 'fracture'
  | 'restart';

/** 0 = normal orb, 1 = Greater, 2 = Perfect */
export type OrbTier = 0 | 1 | 2;

/** One essence or alloy on a base group, as in public/data/essences.json */
export interface EssenceDef {
  /** full item name, e.g. "Greater Essence of the Body" */
  n: string;
  /** 1 = used on rare items: removes a random modifier first (Perfect, corrupted essences, alloys) */
  r: 0 | 1;
  /** 1 = Omens of Crystallisation apply */
  c: 0 | 1;
  /** modifier ids; the essence adds one of them */
  m: string[];
}

export interface EssenceUse {
  /** full item name, e.g. "Greater Essence of the Body" */
  name: string;
  /** modifiers it can add on this base (one of them, at random) */
  modIds: string[];
  /** used on a rare item, removes a random modifier first */
  rare?: boolean;
  /** abstract model only: index of the essence in its own table */
  ref?: number;
}

export type BoneTier = 'Gnawed' | 'Preserved' | 'Ancient';

export interface Action {
  kind: ActionKind;
  tier?: OrbTier;
  omens?: OmenName[];
  essence?: EssenceUse;
  bone?: BoneTier;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  /** how a normal item becomes magic/rare */
  start: 'transmute' | 'alchemy';
  allow: {
    augment: boolean;
    regal: boolean;
    exalt: boolean;
    chaos: boolean;
    annul: boolean;
    essence: boolean;
    desecrate: boolean;
    /** Fracturing Orb: lock a random modifier on a rare item with 4+ modifiers */
    fracture: boolean;
    omens: boolean;
    /** allow Greater / Perfect orbs */
    higherTiers: boolean;
    restart: boolean;
  };
}
