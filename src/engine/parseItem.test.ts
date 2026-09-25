import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { ItemParser, type RuData } from './parseItem';
import type { BaseDef, ModDef } from './types';

const mods: ModDef[] = JSON.parse(fs.readFileSync('public/data/mods.json', 'utf8'));
const bases: BaseDef[] = JSON.parse(fs.readFileSync('public/data/bases.json', 'utf8'));
const ru: RuData = JSON.parse(fs.readFileSync('public/data/ru.json', 'utf8'));
const parser = new ItemParser(bases, mods, ru);

// Real clipboard samples (from the Exiled Exchange 2 test suite, MIT).
const MAGIC_ADV = `Item Class: Two Hand Maces
Rarity: Magic
Crackling Temple Maul of the Brute
--------
Physical Damage: 35-72
Lightning Damage: 1-50 (lightning)
Critical Hit Chance: 5.00%
Attacks per Second: 1.20
--------
Requires: Level 28, 57 (augmented) Str
--------
Item Level: 32
--------
{ Prefix Modifier "Crackling" (Tier: 7) — Damage, Elemental, Lightning, Attack }
Adds 1(1-4) to 50(46-66) Lightning Damage
{ Suffix Modifier "of the Brute" (Tier: 8) — Attribute }
+8(5-8) to Strength
`;

const AMULET_ADV = `Item Class: Amulets
Rarity: Rare
Brood Locket
Gold Amulet
--------
Requires: Level 60
--------
Item Level: 81
--------
Allocates Cooked (enchant)
--------
{ Implicit Modifier }
18(12-20)% increased Rarity of Items found
--------
{ Prefix Modifier "Lady's" (Tier: 5) }
+30(30-33) to Spirit
{ Prefix Modifier "Gentian" (Tier: 6) — Mana }
+90(90-104) to maximum Mana
{ Prefix Modifier "Incanter's" (Tier: 1) — Damage, Caster }
29(27-30)% increased Spell Damage
{ Fractured Suffix Modifier "of the Ice" (Tier: 2) — Elemental, Cold, Resistance }
+37(36-40)% to Cold Resistance
{ Suffix Modifier "of the Sorcerer" (Tier: 1) — Caster, Gem }
+3 to Level of all Spell Skills
{ Desecrated Suffix Modifier "of Amanamu" (Tier: 1) — Elemental, Fire, Chaos, Resistance }
+17(13-17)% to Fire and Chaos Resistances
--------
Fractured Item
`;

const RING_SIMPLE = `Item Class: Rings
Rarity: Rare
Vengeance Loop
Gold Ring
--------
Requires: Level 40
--------
Item Level: 82
--------
12% increased Rarity of Items found (implicit)
--------
+84 to maximum Life
+36% to Fire Resistance (fractured)
+33% to Cold Resistance
--------
Corrupted
`;

const RING_RU = `Класс предмета: Кольца
Редкость: Редкий
Петля мести
Золотое кольцо
--------
Требуется: Уровень 40
--------
Уровень предмета: 82
--------
{ Собственное свойство }
12(6-15)% повышение редкости найденных предметов
--------
{ Префикс "Бодрый" (Уровень: 3) — Здоровье }
+84(70-84) к максимуму здоровья
{ Суффикс "вулкана" (Уровень: 2) — Стихии, Огонь, Сопротивление }
+36(36-40)% к сопротивлению огню
`;

describe('item parser', () => {
  it('parses an advanced magic weapon', () => {
    const p = parser.parse(MAGIC_ADV)!;
    expect(p.rarity).toBe('magic');
    expect(p.base?.name).toBe('Temple Maul');
    expect(p.ilvl).toBe(32);
    expect(p.unmatched).toEqual([]);
    expect(p.mods.map((m) => m.def.s)).toEqual(['p', 's']);
    expect(p.mods[1].def.id).toBe('Strength1');
  });

  it('parses fractured and desecrated mods on an advanced rare amulet', () => {
    const p = parser.parse(AMULET_ADV)!;
    expect(p.base?.name).toBe('Gold Amulet');
    expect(p.mods).toHaveLength(6);
    expect(p.unmatched).toEqual([]);
    const cold = p.mods.find((m) => m.def.x.includes('Cold Resistance'))!;
    expect(cold.mod.fr).toBe(true);
    expect(cold.def.x).toContain('(36-40)');
    const lord = p.mods.find((m) => m.def.x.includes('Fire and Chaos'))!;
    expect(lord.mod.de).toBe(true);
    expect(lord.def.d).toBe(1);
  });

  it('parses a simple copy and picks tiers from values', () => {
    const p = parser.parse(RING_SIMPLE)!;
    expect(p.advanced).toBe(false);
    expect(p.base?.name).toBe('Gold Ring');
    expect(p.corrupted).toBe(true);
    expect(p.unmatched).toEqual([]);
    const life = p.mods.find((m) => m.def.x.includes('maximum Life'))!;
    expect(life.def.x).toContain('(70-84)');
    expect(p.mods.find((m) => m.def.x.includes('Fire'))!.mod.fr).toBe(true);
  });

  it('parses the Russian client', () => {
    const p = parser.parse(RING_RU)!;
    expect(p.language).toBe('ru');
    expect(p.base?.name).toBe('Gold Ring');
    expect(p.ilvl).toBe(82);
    expect(p.unmatched).toEqual([]);
    expect(p.mods.map((m) => m.def.x)).toEqual(['+(70-84) to maximum Life', '+(36-40)% to Fire Resistance']);
  });

  it('finds the base inside a Russian magic name (lowercase) and trusts ranges over affix names', () => {
    const p = parser.parse(`Класс предмета: Кольца
Редкость: Волшебный
Бодрое золотое кольцо
--------
Уровень предмета: 78
--------
{ Префикс "Virile" (Уровень: 3) — Здоровье }
+84(70-84) к максимуму здоровья
`)!;
    expect(p.base?.name).toBe('Gold Ring');
    expect(p.mods[0].def.x).toBe('+(70-84) to maximum Life');
  });

  it('ignores text that is not an item', () => {
    expect(parser.parse('hello world')).toBeNull();
  });
});
