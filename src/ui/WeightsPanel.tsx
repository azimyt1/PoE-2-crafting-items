import { useState } from 'react';
import { DEFAULT_WEIGHT } from '../engine/item';
import { tierLabel, type Family } from './families';

interface Props {
  families: Family[];
  weights: Record<string, number>;
  setWeights: (w: Record<string, number>) => void;
}

export function WeightsPanel({ families, weights, setWeights }: Props) {
  const [q, setQ] = useState('');
  const [json, setJson] = useState('');
  const list = families.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <h2>Веса модов</h2>
      <p>
        Вес определяет, как часто мод выпадает: шанс = вес мода / сумма весов всех модов, которые могут выпасть. В файлах клиента PoE 2
        настоящие веса скрыты (там только «может выпасть / не может»). Поэтому по умолчанию всем модам стоит одинаковый вес{' '}
        <b>{DEFAULT_WEIGHT}</b>. Это главный источник неточности расчёта.
      </p>
      <p className="muted small">
        Сообщество оценивает веса экспериментально (например, Craft of Exile и poe2db). Если у вас есть такие данные, впишите их ниже или
        вставьте JSON вида {'{"IncreasedLife8": 250, "FireResist7": 600}'} (ключ — внутренний id мода, он виден в подсказке).
      </p>
      <div className="row">
        <input className="search" placeholder="Поиск мода" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setWeights({})} disabled={!Object.keys(weights).length}>
          Сбросить ({Object.keys(weights).length})
        </button>
      </div>
      <div className="weights">
        {list.map((f) => (
          <details key={f.fam}>
            <summary>
              {f.side === 'p' ? 'П' : 'С'}: {f.name}
              {f.tiers.some((t) => t.id in weights) ? ' · изменено' : ''}
            </summary>
            {f.tiers.map((t) => (
              <label key={t.id} className="weight" title={t.id}>
                <span className="small">{tierLabel(f, t)}</span>
                <input
                  type="number"
                  min={0}
                  value={weights[t.id] ?? DEFAULT_WEIGHT}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    const next = { ...weights };
                    if (Number.isFinite(v) && v !== DEFAULT_WEIGHT) next[t.id] = v;
                    else delete next[t.id];
                    setWeights(next);
                  }}
                />
              </label>
            ))}
          </details>
        ))}
      </div>
      <h3>Импорт / экспорт</h3>
      <textarea rows={4} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"IncreasedLife8": 250}' />
      <div className="row">
        <button
          onClick={() => {
            try {
              const obj = JSON.parse(json);
              const next = { ...weights };
              for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && v >= 0) next[k] = v;
              setWeights(next);
              setJson('');
            } catch {
              alert('Не получилось прочитать JSON');
            }
          }}
        >
          Импортировать
        </button>
        <button onClick={() => setJson(JSON.stringify(weights, null, 1))}>Показать мои веса</button>
      </div>
    </section>
  );
}
