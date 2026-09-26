// Parses an item copied from the game with Ctrl+C or Ctrl+Alt+C
// (advanced mod descriptions). English and Russian clients are supported.

import { rareCapacity, spawnWeight } from './item';
import type { BaseDef, ItemMod, ModDef, Rarity, Side } from './types';

export interface RuData {
  /** Russian line template -> English line template */
  templates: Record<string, string>;
  /** Russian base name -> English base name */
  bases: Record<string, string>;
}

export interface ParsedMod {
  mod: ItemMod;
  def: ModDef;
  lines: string[];
}

export interface ParsedItem {
  itemClass: string;
  rarity: Rarity | 'unique' | 'other';
  baseName: string;
  base: BaseDef | null;
  ilvl: number | null;
  mods: ParsedMod[];
  unmatched: string[];
  corrupted: boolean;
  unidentified: boolean;
  advanced: boolean;
  language: 'en' | 'ru';
  /** rare item name ("Honour Suit") */
  name?: string;
  /** property lines: defences, requirements, sockets... */
  props: string[];
  /** implicit modifier lines of the base */
  implicits: string[];
  /** rune / enchant lines */
  runes: string[];
}

/** Must stay identical to template() in scripts/build-data.mjs */
export function template(line: string): string {
  return line
    .replace(/\(-?\d+(?:\.\d+)?-(-?\d+(?:\.\d+)?)\)/g, '#')
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, '#')
    .replace(/[+-]#/g, '#')
    .replace(/#\s*#/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SEP = /^-{4,}$/;
const RARITY: Record<string, ParsedItem['rarity']> = {
  normal: 'normal',
  magic: 'magic',
  rare: 'rare',
  unique: 'unique',
  обычный: 'normal',
  волшебный: 'magic',
  редкий: 'rare',
  уникальный: 'unique',
};
const TAIL_FLAGS = /\s*\((fractured|desecrated|crafted|explicit|implicit|rune|enchant|augmented|расколото|очернено|собственное|руна|зачарование)\)\s*$/i;

/** Numbers shown on a line, and the "(min-max)" ranges from advanced copy. */
function numbers(line: string): { values: number[]; ranges: [number, number][] } {
  const ranges: [number, number][] = [];
  const stripped = line.replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (_, a, b) => {
    ranges.push([parseFloat(a), parseFloat(b)]);
    return '';
  });
  const values = (stripped.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => parseFloat(x.replace(',', '.')));
  return { values, ranges };
}

/** Ranges written in a modifier's text, in order, e.g. "+(36-40)%" -> [[36,40]]. Fixed numbers become [n,n]. */
function modRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    else out.push([parseFloat(m[3]), parseFloat(m[3])]);
  }
  return out;
}

export class ItemParser {
  private byTemplate = new Map<string, ModDef[]>();
  private basesByName = new Map<string, BaseDef[]>();

  constructor(
    bases: BaseDef[],
    mods: ModDef[],
    private ru?: RuData,
  ) {
    for (const m of mods) {
      const key = m.x.split('\n').map(template).sort().join('\n');
      const list = this.byTemplate.get(key);
      if (list) list.push(m);
      else this.byTemplate.set(key, [m]);
    }
    for (const b of bases) {
      const list = this.basesByName.get(b.name);
      if (list) list.push(b);
      else this.basesByName.set(b.name, [b]);
    }
  }

  /** English template for a game line (translating Russian if needed). */
  private tpl(line: string): string {
    const t = template(line);
    if (this.ru && /[а-яё]/i.test(line)) return this.ru.templates[t] ?? t;
    return t;
  }

  private findBase(nameLines: string[], implicitText: string[], ru: boolean): { base: BaseDef | null; name: string } {
    const toEn = (s: string) => (ru && this.ru ? this.ru.bases[s] ?? s : s);
    const pick = (name: string): BaseDef | null => {
      const list = this.basesByName.get(name);
      if (!list) return null;
      if (list.length === 1 || !implicitText.length) return list[0];
      const imp = implicitText.map(template);
      return list.find((b) => b.imp.some((x) => imp.includes(template(x)))) ?? list[0];
    };
    // exact line (normal / rare)
    for (let i = nameLines.length - 1; i >= 0; i--) {
      const b = pick(toEn(nameLines[i]));
      if (b) return { base: b, name: b.name };
    }
    // magic: base name inside "Prefix Base of Suffix"
    const line = (nameLines[nameLines.length - 1] ?? '').toLowerCase();
    let best: string | null = null;
    const names = ru && this.ru ? Object.keys(this.ru.bases) : [...this.basesByName.keys()];
    for (const n of names) if (line.includes(n.toLowerCase()) && (!best || n.length > best.length)) best = n;
    if (best) {
      const b = pick(toEn(best));
      return { base: b, name: b?.name ?? best };
    }
    return { base: null, name: line };
  }

  /** Choose the tier whose ranges fit the numbers best. */
  private chooseTier(cands: ModDef[], lines: string[], opts: { side?: Side; name?: string; tier?: number; pool?: Set<string> }): ModDef | null {
    let list = cands;
    if (opts.side) list = list.filter((m) => m.s === opts.side);
    if (!list.length) return null;
    const parsed = lines.map((l) => ({ t: this.tpl(l), ...numbers(l) }));
    const score = (m: ModDef): number => {
      let s = 0;
      const modLines = m.x.split('\n').map((x) => ({ t: template(x), r: modRanges(x) }));
      for (const pl of parsed) {
        const ml = modLines.find((x) => x.t === pl.t);
        if (!ml) continue;
        // advanced copy prints the tier range: exact identification
        const ranged = ml.r.filter((r) => r[0] !== r[1]);
        for (const r of pl.ranges)
          if (ranged.some((x) => Math.min(x[0], x[1]) === Math.min(r[0], r[1]) && Math.max(x[0], x[1]) === Math.max(r[0], r[1]))) s += 30;
        // rolled values inside the tier range
        for (let i = 0; i < Math.min(ml.r.length, pl.values.length); i++) {
          const lo = Math.min(ml.r[i][0], ml.r[i][1]);
          const hi = Math.max(ml.r[i][0], ml.r[i][1]);
          if (pl.values[i] >= lo - 1e-9 && pl.values[i] <= hi + 1e-9) s += 3;
        }
      }
      if (opts.name && m.n === opts.name) s += 2;
      if (opts.pool?.has(m.id)) s += 5;
      return s;
    };
    let best: ModDef | null = null;
    let bestScore = -1;
    for (const m of list) {
      const sc = score(m);
      if (sc > bestScore || (sc === bestScore && best && m.l > best.l)) {
        best = m;
        bestScore = sc;
      }
    }
    return best;
  }

  /**
   * Simple copy and the trade site show one line per stat: the same stat from
   * two modifiers is summed ("+116 to maximum Energy Shield" = a flat Energy
   * Shield modifier + the flat part of a hybrid). Find the smallest set of
   * modifiers, one tier each, whose summed ranges contain every value shown.
   * Returns null when the search is not applicable (the caller falls back).
   */
  private solveSimple(
    lines: { text: string; fr: boolean; de: boolean }[],
    base: BaseDef | null,
    pool?: Set<string>,
  ): { mods: ParsedMod[]; unmatched: string[] } | null {
    const n = lines.length;
    if (!n || n > 12) return null;
    const tags = base ? new Set(base.tags) : null;
    const allowed = (m: ModDef) => !tags || m.e === 1 || spawnWeight(m, tags) > 0;
    const info = lines.map((l) => ({ t: this.tpl(l.text), v: numbers(l.text).values }));

    interface Tier {
      m: ModDef;
      /** per covered line: value ranges */
      r: [number, number][][];
    }
    interface Opt {
      lines: number[];
      tiers: Tier[];
      groups: string[];
      side: Side;
    }
    const opts = new Map<string, Opt>();
    const addOpts = (idx: number[]) => {
      for (const m of this.candidates(idx.map((i) => lines[i].text))) {
        if (!allowed(m)) continue;
        const mlines = m.x.split('\n');
        const r: [number, number][][] = [];
        let ok = true;
        for (const i of idx) {
          const ml = mlines.find((x) => template(x) === info[i].t);
          const rr = ml ? modRanges(ml) : [];
          if (!ml || rr.length !== info[i].v.length) {
            ok = false;
            break;
          }
          r.push(rr);
        }
        if (!ok) continue;
        const key = m.f + '|' + idx.join(',');
        let o = opts.get(key);
        if (!o) opts.set(key, (o = { lines: idx, tiers: [], groups: m.g, side: m.s }));
        o.tiers.push({ m, r });
      }
    };
    for (let i = 0; i < n; i++) addOpts([i]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) addOpts([i, j]);
    const list = [...opts.values()];
    for (const o of list) o.tiers.sort((a, b) => b.m.l - a.m.l);
    const coverable = new Set(list.flatMap((o) => o.lines));
    if (!coverable.size) return null;
    const cap = base ? rareCapacity(base) : { p: 3, s: 3 };

    // tier choice for a set of options: summed ranges must contain the shown values
    const lo = (t: Tier, k: number, vi: number) => Math.min(t.r[k][vi][0], t.r[k][vi][1]);
    const hi = (t: Tier, k: number, vi: number) => Math.max(t.r[k][vi][0], t.r[k][vi][1]);
    const assign = (chosen: Opt[]): number[] | null => {
      const pick: number[] = [];
      const bound = (o: Opt, ti: number | null, line: number, vi: number, f: typeof lo) => {
        const k = o.lines.indexOf(line);
        if (ti !== null) return f(o.tiers[ti], k, vi);
        const vals = o.tiers.map((t) => f(t, k, vi));
        return f === lo ? Math.min(...vals) : Math.max(...vals);
      };
      const fits = (upto: number): boolean => {
        for (const line of coverable) {
          const contrib = chosen.map((o, c) => ({ o, c })).filter(({ o }) => o.lines.includes(line));
          for (let vi = 0; vi < info[line].v.length; vi++) {
            let a = 0;
            let b = 0;
            for (const { o, c } of contrib) {
              const ti = c < upto ? pick[c] : null;
              a += bound(o, ti, line, vi, lo);
              b += bound(o, ti, line, vi, hi);
            }
            const v = info[line].v[vi];
            if (v < a - 1e-6 || v > b + 1e-6) return false;
          }
        }
        return true;
      };
      const rec = (c: number): boolean => {
        if (c === chosen.length) return fits(c);
        for (let ti = 0; ti < chosen[c].tiers.length; ti++) {
          pick[c] = ti;
          if (fits(c + 1) && rec(c + 1)) return true;
        }
        return false;
      };
      return rec(0) ? pick.slice() : null;
    };

    let best: { chosen: Opt[]; pick: number[]; score: number } | null = null;
    let budget = 20000;
    const chosen: Opt[] = [];
    const dfs = (maxSize: number) => {
      if (budget-- <= 0) return;
      const covered = new Set(chosen.flatMap((o) => o.lines));
      const first = [...coverable].find((l) => !covered.has(l));
      if (first === undefined) {
        const pick = assign(chosen);
        if (!pick) return;
        const score = chosen.reduce((s, o, c) => s + (pool?.has(o.tiers[pick[c]].m.id) ? 1 : 0), 0);
        if (!best || score > best.score) best = { chosen: [...chosen], pick, score };
        return;
      }
      if (chosen.length >= maxSize) return;
      const groups = new Set(chosen.flatMap((o) => o.groups));
      const sides = { p: 0, s: 0 };
      for (const o of chosen) sides[o.side]++;
      for (const o of list) {
        if (!o.lines.includes(first) || chosen.includes(o)) continue;
        if (o.groups.some((g) => groups.has(g)) || sides[o.side] >= cap[o.side]) continue;
        chosen.push(o);
        dfs(maxSize);
        chosen.pop();
      }
    };
    for (let size = 1; size <= coverable.size + 2 && !best && budget > 0; size++) dfs(size);
    if (!best) return null;
    const found = best as { chosen: Opt[]; pick: number[] };
    const mods: ParsedMod[] = found.chosen.map((o, c) => {
      const def = o.tiers[found.pick[c]].m;
      const ls = o.lines.map((i) => lines[i]);
      return {
        def,
        lines: ls.map((l) => l.text),
        mod: { id: def.id, ...(ls.some((l) => l.fr) ? { fr: true } : {}), ...(ls.some((l) => l.de) ? { de: true } : {}) },
      };
    });
    const unmatched = lines.filter((_, i) => !coverable.has(i)).map((l) => l.text);
    return { mods, unmatched };
  }

  private candidates(lines: string[]): ModDef[] {
    return this.byTemplate.get(lines.map((l) => this.tpl(l)).sort().join('\n')) ?? [];
  }

  /**
   * Text without the game's "Item Class:" header: the trade site copy button
   * (browser extensions: "Rarity: ...", name, base, then modifiers marked
   * "(explicit)") or a listing selected with the mouse. Rebuilt into the
   * game's simple copy format.
   */
  private normalizeForeign(raw: string[]): string[] | null {
    const rar = raw.findIndex((l) => /^(Rarity|Редкость):/i.test(l));
    if (rar >= 0) return [/^Редкость/i.test(raw[rar]) ? 'Класс предмета: ' : 'Item Class: ', ...raw.slice(rar)];
    // Selected listing text: find the line holding the base type.
    // Price, seller and whisper lines of the listing are not part of the item.
    const junk = /^(~|Asking Price|Price:|Цена|Whisper|Direct Whisper|Travel to|Listed|Выставлен|Написать|IGN:|Seller)/i;
    const lines = raw.filter((l) => l && !junk.test(l));
    const ruNames = this.ru ? Object.keys(this.ru.bases) : [];
    const isRu = lines.some((l) => /[а-яё]/i.test(l));
    const names = isRu ? ruNames : [...this.basesByName.keys()];
    const baseIdx = lines.findIndex((l) => names.includes(l));
    let idx = baseIdx;
    let magic = false;
    if (idx < 0) {
      // magic items: "Prefix Base of Suffix" in one line
      idx = lines.findIndex((l) => names.some((n) => n.length > 3 && l.includes(n)) && !/\d/.test(l));
      magic = idx >= 0;
    }
    if (idx < 0) return null;
    const rare = !magic && idx > 0 && !/:/.test(lines[idx - 1]) && !/\d/.test(lines[idx - 1]);
    const rarity = rare ? 'Rare' : magic ? 'Magic' : 'Normal';
    const ilvl = lines.find((l) => /^(Item Level|Уровень предмета):/i.test(l));
    const out = [isRu ? 'Класс предмета: ' : 'Item Class: ', `${isRu ? 'Редкость' : 'Rarity'}: ${rarity}`];
    if (rare) out.push(lines[idx - 1]);
    out.push(lines[idx], '--------');
    if (ilvl) out.push(ilvl, '--------');
    // unmarked text: the base's own implicit lines are not modifiers
    const baseLine = lines[idx];
    const enName = isRu && this.ru ? (this.ru.bases[baseLine] ?? baseLine) : baseLine;
    const base = this.basesByName.get(enName)?.[0] ?? [...this.basesByName.entries()].find(([n]) => baseLine.includes(n))?.[1][0];
    const imp = new Set((base?.imp ?? []).flatMap((x) => x.split('\n')).map(template));
    for (const l of lines.slice(idx + 1)) {
      if (l === ilvl) continue;
      if (imp.has(template(l))) {
        out.push(`${l} (implicit)`);
        continue;
      }
      out.push(l);
    }
    return out;
  }

  parse(text: string, poolIds?: Set<string>): ParsedItem | null {
    let raw = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
    let first = raw.findIndex((l) => /^(Item Class|Класс предмета):/i.test(l));
    if (first < 0) {
      const norm = this.normalizeForeign(raw);
      if (!norm) return null;
      raw = norm;
      first = 0;
    }
    const lines = raw.slice(first);
    const ru = /^Класс предмета:/i.test(lines[0]);
    const sections: string[][] = [[]];
    for (const l of lines) {
      if (SEP.test(l)) sections.push([]);
      else if (l) sections[sections.length - 1].push(l);
    }
    const head = sections[0];
    const itemClass = head[0].replace(/^[^:]+:\s*/, '');
    const rarityWord = (head[1] ?? '').replace(/^[^:]+:\s*/, '').toLowerCase();
    const rarity = RARITY[rarityWord] ?? 'other';
    const nameLines = head.slice(2);

    const flat = lines.filter((l) => l && !SEP.test(l));
    const ilvlLine = flat.find((l) => /^(Item Level|Уровень предмета):/i.test(l));
    const ilvl = ilvlLine ? parseInt(ilvlLine.replace(/\D+/g, ''), 10) || null : null;
    const corrupted = flat.some((l) => /^(Corrupted|Осквернено)$/i.test(l));
    const unidentified = flat.some((l) => /^(Unidentified|Неопознано)/i.test(l));
    const advanced = flat.some((l) => /^\{.*\}$/.test(l));

    // implicit lines (for telling apart bases with the same name)
    const implicitText: string[] = [];
    // everything else shown on the item, for display
    const props: string[] = [];
    const runes: string[] = [];
    for (const sec of sections.slice(1))
      for (const l of sec) {
        if (/^\{.*\}$/.test(l)) continue;
        if (/\((rune|enchant|руна|зачарование)\)$/i.test(l)) runes.push(l.replace(TAIL_FLAGS, ''));
        else if (/^(Item Level|Уровень предмета|Note|Rarity|Редкость|Item Class|Класс предмета):/i.test(l)) continue;
        else if (/:\s/.test(l) && !/\d%?\s/.test(l.split(':')[0])) props.push(l.replace(/\s*\(augmented\)$/i, ''));
      }
    const out: ParsedItem = {
      name: rarity === 'rare' || rarity === 'unique' ? nameLines[0] : undefined,
      props,
      implicits: implicitText,
      runes,
      itemClass,
      rarity,
      baseName: '',
      base: null,
      ilvl,
      mods: [],
      unmatched: [],
      corrupted,
      unidentified,
      advanced,
      language: ru ? 'ru' : 'en',
    };

    if (advanced) {
      type Block = { side?: Side; skip: boolean; fr: boolean; de: boolean; name?: string; tier?: number; lines: string[] };
      let cur = null as Block | null;
      const blocks: Block[] = [];
      for (const sec of sections.slice(1)) {
        for (const l of sec) {
          const h = l.match(/^\{\s*(.+?)\s*\}$/);
          if (h) {
            const inner = h[1];
            const type = inner.split('—')[0];
            const name = type.match(/"([^"]+)"/)?.[1];
            const tier = type.match(/\((?:Tier|Уровень):\s*(\d+)\)/)?.[1];
            const isPrefix = /Prefix|Префикс/i.test(type);
            const isSuffix = /Suffix|Суффикс/i.test(type);
            const implicit = /Implicit|Собственное/i.test(type);
            cur = {
              side: isPrefix ? 'p' : isSuffix ? 's' : undefined,
              skip: implicit || (!isPrefix && !isSuffix),
              fr: /Fractured|Расколот/i.test(type),
              de: /Desecrated|Очернён/i.test(type),
              name,
              tier: tier ? +tier : undefined,
              lines: [],
            };
            if (!cur.skip) blocks.push(cur);
            continue;
          }
          if (cur) {
            if (cur.skip) {
              implicitText.push(l.replace(TAIL_FLAGS, ''));
              continue;
            }
            if (/\(fractured|расколото\)/i.test(l)) cur.fr = true;
            if (/\(desecrated|очернено\)/i.test(l)) cur.de = true;
            cur.lines.push(l.replace(TAIL_FLAGS, '').replace(TAIL_FLAGS, ''));
          }
        }
        cur = null; // a section break ends the current block
      }
      const fb = this.findBase(nameLines, implicitText, ru);
      out.base = fb.base;
      out.baseName = fb.name;
      for (const b of blocks) {
        if (!b.lines.length) continue;
        const def = this.chooseTier(this.candidates(b.lines), b.lines, { side: b.side, name: b.name, tier: b.tier, pool: poolIds });
        if (def) out.mods.push({ def, lines: b.lines, mod: { id: def.id, ...(b.fr ? { fr: true } : {}), ...(b.de ? { de: true } : {}) } });
        else out.unmatched.push(b.lines.join(' / '));
      }
    } else {
      // simple copy: explicit lines follow the item level section
      const ilvlSec = sections.findIndex((s) => s.some((l) => /^(Item Level|Уровень предмета):/i.test(l)));
      const candidatesLines: { text: string; fr: boolean; de: boolean }[] = [];
      for (const sec of sections.slice(ilvlSec >= 0 ? ilvlSec + 1 : 1)) {
        for (const l of sec) {
          if (/\((implicit|собственное)\)$/i.test(l)) {
            implicitText.push(l.replace(TAIL_FLAGS, ''));
            continue;
          }
          if (/\((rune|enchant|руна|зачарование)\)$/i.test(l)) continue;
          if (/^(Corrupted|Осквернено|Fractured Item|Расколотый предмет|Unidentified|Неопознано)/i.test(l)) continue;
          if (/:\s/.test(l) && !/\d%?\s/.test(l.split(':')[0])) continue; // "Key: value" property lines
          candidatesLines.push({
            text: l.replace(TAIL_FLAGS, ''),
            fr: /\((fractured|расколото)\)$/i.test(l),
            de: /\((desecrated|очернено)\)$/i.test(l),
          });
        }
      }
      const fb = this.findBase(nameLines, implicitText, ru);
      out.base = fb.base;
      out.baseName = fb.name;
      const solved = this.solveSimple(candidatesLines, out.base, poolIds);
      if (solved) {
        out.mods.push(...solved.mods);
        out.unmatched.push(...solved.unmatched);
        return out;
      }
      for (let i = 0; i < candidatesLines.length; ) {
        let done = false;
        for (const k of [2, 1]) {
          const group = candidatesLines.slice(i, i + k);
          if (group.length < k) continue;
          const texts = group.map((g) => g.text);
          const def = this.chooseTier(this.candidates(texts), texts, { pool: poolIds });
          if (def) {
            out.mods.push({
              def,
              lines: texts,
              mod: { id: def.id, ...(group.some((g) => g.fr) ? { fr: true } : {}), ...(group.some((g) => g.de) ? { de: true } : {}) },
            });
            i += k;
            done = true;
            break;
          }
        }
        if (!done) {
          out.unmatched.push(candidatesLines[i].text);
          i++;
        }
      }
    }
    return out;
  }
}
