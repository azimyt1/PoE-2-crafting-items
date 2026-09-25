import { useState } from 'react';
import { DEFAULT_PRICES } from '../engine/currency';
import { DEFAULT_ESSENCE_PRICES } from '../engine/essences';
import type { Prices } from '../engine/types';
import { fmtCost, type DisplayCurrency } from './format';

export interface PricesFile {
  league: string;
  updatedAt: string;
  source: string;
  prices: Prices;
}

interface Props {
  prices: Prices;
  file: PricesFile | null;
  overrides: Prices;
  setOverrides: (p: Prices) => void;
  currency: DisplayCurrency;
}

function group(name: string): string {
  if (name.startsWith('Omen')) return 'Омены';
  if (/(Jawbone|Rib|Collarbone)$/.test(name)) return 'Кости Бездны (осквернение)';
  if (name.includes('Essence')) return 'Эссенции';
  return 'Сферы';
}

export function PricesPanel({ prices, file, overrides, setOverrides, currency }: Props) {
  const [q, setQ] = useState('');
  const [json, setJson] = useState('');
  const names = Object.keys({ ...DEFAULT_PRICES, ...DEFAULT_ESSENCE_PRICES }).filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const g = group(n);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }
  const source = (n: string) => (n in overrides ? 'вручную' : file && n in file.prices ? 'poe.ninja' : 'примерная');

  return (
    <section className="card">
      <h2>Цены</h2>
      <p>
        Все цены хранятся в <b>сферах возвышения</b> (Exalted Orb).{' '}
        {file ? (
          <>
            Рыночные цены загружены с poe.ninja: лига <b>{file.league}</b>, обновлено {new Date(file.updatedAt).toLocaleString('ru-RU')}.
          </>
        ) : (
          <span className="warn-inline">Рыночные цены ещё не загружены, сейчас стоят примерные значения. Их можно поправить вручную.</span>
        )}
      </p>
      <p className="muted small">
        1 божественная сфера = {prices['Divine Orb']} экз., 1 сфера хаоса = {prices['Chaos Orb']} экз. Ручная правка сохраняется в браузере и
        имеет приоритет над загруженными ценами.
      </p>
      <div className="row">
        <input className="search" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setOverrides({})} disabled={!Object.keys(overrides).length}>
          Сбросить ручные правки ({Object.keys(overrides).length})
        </button>
      </div>
      {[...groups.entries()].map(([g, list]) => (
        <div key={g}>
          <h3>{g}</h3>
          <div className="prices">
            {list.map((n) => (
              <label key={n} className={'price ' + (n in overrides ? 'manual' : '')}>
                <span>{n}</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={prices[n] ?? ''}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    const next = { ...overrides };
                    if (Number.isFinite(v)) next[n] = v;
                    else delete next[n];
                    setOverrides(next);
                  }}
                />
                <span className="muted small">
                  {source(n)}
                  {currency !== 'ex' && prices[n] !== undefined ? ` · ${fmtCost(prices[n], currency, prices)}` : ''}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <h3>Импорт цен</h3>
      <p className="muted small">Можно вставить JSON вида {'{"Exalted Orb": 1, "Divine Orb": 250}'} — значения в сферах возвышения.</p>
      <textarea rows={4} value={json} onChange={(e) => setJson(e.target.value)} />
      <button
        onClick={() => {
          try {
            const obj = JSON.parse(json);
            const next = { ...overrides };
            for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && v >= 0) next[k] = v;
            setOverrides(next);
            setJson('');
          } catch {
            alert('Не получилось прочитать JSON');
          }
        }}
      >
        Применить
      </button>
    </section>
  );
}
