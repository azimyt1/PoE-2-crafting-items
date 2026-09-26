import { useState } from 'react';
import { DEFAULT_WEIGHT } from '../engine/item';
import { famMatches, tierLabel, tierLabelEn, type Family } from './families';

interface Props {
  families: Family[];
  /** the user's own weights */
  weights: Record<string, number>;
  setWeights: (w: Record<string, number>) => void;
  /** Craft of Exile weights for this base */
  community: Record<string, number>;
  /** Craft of Exile base group, null if it has no known weights */
  group: string | null;
  builtAt?: string;
}

export function WeightsPanel({ families, weights, setWeights, community, group, builtAt }: Props) {
  const [q, setQ] = useState('');
  const [json, setJson] = useState('');
  const list = families.filter((f) => famMatches(f, q));
  return (
    <section className="card">
      <h2>Веса модов</h2>
      <p>
        Вес определяет, как часто мод выпадает: шанс = вес мода / сумма весов всех модов, которые могут выпасть. В файлах клиента PoE 2
        настоящих весов нет (там только «может выпасть / не может»), поэтому берём веса, которые сообщество измерило экспериментально.
      </p>
      {group ? (
        <p>
          Для этой базы используются веса{' '}
          <a href="https://www.craftofexile.com/weightings?game=poe2" target="_blank" rel="noreferrer">
            Craft of Exile
          </a>{' '}
          (группа «{group}», тиров с весом: {Object.keys(community).length}{builtAt ? `, обновлены ${new Date(builtAt).toLocaleDateString('ru-RU')}` : ''}).
          Модам без известного веса (например, модам лордов Бездны) стоит вес <b>{DEFAULT_WEIGHT}</b>.
        </p>
      ) : null}
      {group ? (
        <p className="muted small">
          Вес 1000 у большинства тиров — это нормально: так считает сообщество. Меньше вес (100–500) обычно у лучших, редких тиров. В
          списке только моды, которые вообще могут выпасть на этой базе (у каждой группы баз свой набор), по-русски; английский
          оригинал — при наведении.
        </p>
      ) : (
        <p>
          Для этой базы у Craft of Exile пока нет весов, поэтому всем модам стоит одинаковый вес <b>{DEFAULT_WEIGHT}</b>. Это главный
          источник неточности расчёта.
        </p>
      )}
      <p className="muted small">
        Любой вес можно поправить ниже или вставить JSON вида {'{"IncreasedLife8": 250, "FireResist7": 600}'} (ключ — внутренний id мода,
        он виден в подсказке). Ваши веса важнее весов Craft of Exile.
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
            <summary title={f.nameEn}>
              {f.side === 'p' ? 'П' : 'С'}: {f.name}
              {f.tiers.some((t) => t.id in weights) ? ' · изменено' : ''}
            </summary>
            {f.tiers.map((t) => (
              <label key={t.id} className="weight" title={`${tierLabelEn(f, t)} (${t.id})`}>
                <span className="small">{tierLabel(f, t)}</span>
                <input
                  type="number"
                  min={0}
                  value={weights[t.id] ?? community[t.id] ?? DEFAULT_WEIGHT}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    const next = { ...weights };
                    if (Number.isFinite(v) && v !== (community[t.id] ?? DEFAULT_WEIGHT)) next[t.id] = v;
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
