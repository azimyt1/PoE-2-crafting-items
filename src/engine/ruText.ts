// Russian display text for modifier lines (from the Russian game client
// strings in public/data/ru.json). Values and ranges are taken from the
// English line; lines without a translation stay in English.

import { template } from './parseItem';

let display: Record<string, string> = {};

/** Called once the data is loaded (in the page and in the worker). */
export function setRuDisplay(d: Record<string, string> | undefined): void {
  display = d ?? {};
}

const TOKEN = /[+-]?\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)|[+-]?\d+(?:\.\d+)?/g;

/** One modifier line in Russian, e.g. "+(60-69) к максимуму здоровья". */
export function ruLine(line: string): string {
  const ru = display[template(line)];
  if (!ru) return line;
  const tokens = line.match(TOKEN) ?? [];
  if ((ru.match(/#/g) ?? []).length !== tokens.length) return line;
  let k = 0;
  return ru.replace(/([+-]?)#/g, (_, sign: string) => {
    let v = tokens[k++];
    if (sign && /^[+-]/.test(v)) v = v.slice(1);
    return sign + v;
  });
}

/** A modifier text (lines separated by "\n") in Russian, lines joined with " / ". */
export function ruText(text: string): string {
  if (!text.trim()) return '(мод без текста)';
  return text.split('\n').map(ruLine).join(' / ');
}

/** Russian template of a line ("#" for values), or null. */
export function ruTemplate(line: string): string | null {
  return display[template(line)] ?? null;
}
