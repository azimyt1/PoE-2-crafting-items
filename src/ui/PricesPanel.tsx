import { useState } from 'react';
import { ItemIcon, itemRu, itemTitle } from './items';
import { DEFAULT_PRICES } from '../engine/currency';
import { DEFAULT_ESSENCE_PRICES } from '../engine/essences';
import type { Prices } from '../engine/types';
import { CURRENCY_LABEL, fmtCost, fmtNum, type DisplayCurrency } from './format';
import { fetchNinjaPrices } from '../engine/ninja';

export interface PricesFile {
  league: string;
  updatedAt: string;
  source: string;
  prices: Prices;
  /** item name -> icon URL (from poe.ninja) */
  icons?: Record<string, string>;
}

interface Props {
  prices: Prices;
  file: PricesFile | null;
  setFile: (f: PricesFile) => void;
  refresh: () => Promise<boolean>;
  overrides: Prices;
  setOverrides: (p: Prices) => void;
  currency: DisplayCurrency;
}

function group(name: string): string {
  if (name.startsWith('Omen')) return 'Предзнаменования (омены)';
  if (/(Jawbone|Rib|Collarbone)$/.test(name)) return 'Кости Бездны (очернение)';
  if (name.endsWith('Alloy')) return 'Сплавы (руноковка)';
  if (name.includes('Essence')) return 'Сущности (эссенции)';
  if (name.endsWith('Flux')) return 'Флюсы';
  return 'Сферы';
}

export function PricesPanel({ prices, file, setFile, refresh, overrides, setOverrides, currency }: Props) {
  const [q, setQ] = useState('');
  const [json, setJson] = useState('');
  const [league, setLeague] = useState(file?.league ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function direct() {
    if (!league.trim()) {
      setMsg('Укажите название лиги так, как оно написано на poe.ninja.');
      return;
    }
    setBusy(true);
    setMsg('Загружаю с poe.ninja…');
    try {
      const got = await fetchNinjaPrices(league.trim(), async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
      if (!got || Object.keys(got).length < 10) throw new Error('пустой ответ');
      setFile({ league: league.trim(), updatedAt: new Date().toISOString(), source: 'poe.ninja (напрямую)', prices: got });
      setMsg(`Готово: ${Object.keys(got).length} цен.`);
    } catch {
      setMsg(
        'Браузер не пустил запрос к poe.ninja напрямую (так бывает из-за правил безопасности сайтов). Цены всё равно обновляются автоматически каждый час на сервере GitHub.',
      );
    } finally {
      setBusy(false);
    }
  }
  const names = Object.keys({ ...DEFAULT_PRICES, ...DEFAULT_ESSENCE_PRICES }).filter(
    (n) => !q || n.toLowerCase().includes(q.toLowerCase()) || itemRu(n).toLowerCase().includes(q.toLowerCase()),
  );
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
        Цена в поле — <b>в сферах возвышения (экз) за 1 штуку</b>
        {currency !== 'ex' ? <>, рядом — пересчёт в выбранную вверху валюту ({CURRENCY_LABEL[currency]})</> : null}.{' '}
        {file ? (
          <>
            Рыночные цены ({file.source}): лига <b>{file.league}</b>, обновлено {new Date(file.updatedAt).toLocaleString('ru-RU')}. Сервер обновляет их каждый час, открытая страница подхватывает новые цены сама.
          </>
        ) : (
          <span className="warn-inline">Рыночные цены ещё не загружены, сейчас стоят примерные значения. Их можно поправить вручную.</span>
        )}
      </p>
      <p className="muted small">
        Курс: 1 божественная сфера = {fmtNum(prices['Divine Orb'])} экз., 1 сфера хаоса = {fmtNum(prices['Chaos Orb'])} экз. Ручная правка
        сохраняется в браузере и имеет приоритет над загруженными ценами. Наведите на предмет, чтобы прочитать, что он делает.
      </p>
      <div className="row">
        <button
          disabled={busy}
          onClick={async () => {
            setMsg((await refresh()) ? 'Проверил: опубликованные цены актуальны.' : 'Файл цен пока не опубликован.');
          }}
        >
          Проверить свежие цены
        </button>
        <input placeholder="Лига, например Rise of the Abyssal" value={league} onChange={(e) => setLeague(e.target.value)} />
        <button disabled={busy} onClick={direct}>
          Загрузить с poe.ninja напрямую
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
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
              <label key={n} className={'price ' + (n in overrides ? 'manual' : '')} title={itemTitle(n)}>
                <span className="pname">
                  <ItemIcon name={n} size={24} />
                  <span>
                    {itemRu(n)}
                    <span className="muted en">{n}</span>
                  </span>
                </span>
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
                  экз · {source(n)}
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
