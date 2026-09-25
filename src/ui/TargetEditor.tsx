import { useState } from 'react';
import type { TargetReq } from '../engine/types';
import { tierLabel, type Family } from './families';

interface Props {
  families: Family[];
  reqs: TargetReq[];
  setReqs: (r: TargetReq[]) => void;
  need: number;
  setNeed: (n: number) => void;
  rareCap: { p: number; s: number };
}

export function reqLabel(f: Family, minLevel: number): string {
  const ok = f.tiers.filter((t) => t.l >= minLevel);
  const worst = ok[ok.length - 1];
  return `${f.name} — от T${ok.length} (${worst ? worst.x.replace(/\n/g, ' / ') : '?'})`;
}

export function TargetEditor({ families, reqs, setReqs, need, setNeed, rareCap }: Props) {
  const [q, setQ] = useState('');
  const byFam = new Map(families.map((f) => [f.fam, f]));
  const chosen = new Set(reqs.map((r) => r.fam));
  const filter = (f: Family) => !chosen.has(f.fam) && (!q || f.name.toLowerCase().includes(q.toLowerCase()));
  const prefixes = families.filter((f) => f.side === 'p' && filter(f));
  const suffixes = families.filter((f) => f.side === 's' && filter(f));
  const nP = reqs.filter((r) => r.side === 'p').length;
  const nS = reqs.filter((r) => r.side === 's').length;

  function add(f: Family) {
    if (reqs.length >= 8) return;
    // default: accept the top 3 tiers
    const t = f.tiers[Math.min(2, f.tiers.length - 1)];
    setReqs([...reqs, { fam: f.fam, minLevel: t.l, side: f.side, label: reqLabel(f, t.l) }]);
  }

  function setTier(i: number, minLevel: number) {
    const f = byFam.get(reqs[i].fam)!;
    setReqs(reqs.map((r, k) => (k === i ? { ...r, minLevel, label: reqLabel(f, minLevel) } : r)));
  }

  const col = (title: string, list: Family[]) => (
    <div className="famcol">
      <h3>{title}</h3>
      <div className="famlist">
        {list.map((f) => (
          <button key={f.fam} className={'fam' + (f.desecrated ? ' desecrated' : '')} onClick={() => add(f)} title="Добавить в цель">
            <span>{f.name}</span>
            <span className="muted small">
              {f.tiers.length} тир. · макс. ур. {f.tiers[0].l}
              {f.desecrated ? ' · только осквернение' : ''}
            </span>
          </button>
        ))}
        {!list.length && <div className="muted small">Ничего не найдено</div>}
      </div>
    </div>
  );

  return (
    <section className="card">
      <h2>Желаемые моды</h2>
      {reqs.length === 0 && <p className="muted">Выберите моды из списков ниже. Для каждого можно указать минимально приемлемый тир.</p>}
      {reqs.length > 0 && (
        <table className="reqs">
          <thead>
            <tr>
              <th>Сторона</th>
              <th>Мод</th>
              <th>Минимальный тир (T1 — лучший)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reqs.map((r, i) => {
              const f = byFam.get(r.fam);
              if (!f) return null;
              return (
                <tr key={r.fam}>
                  <td>{r.side === 'p' ? 'Префикс' : 'Суффикс'}</td>
                  <td>{f.name}</td>
                  <td>
                    <select value={r.minLevel} onChange={(e) => setTier(i, +e.target.value)}>
                      {f.tiers.map((t) => (
                        <option key={t.id} value={t.l}>
                          {tierLabel(f, t)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="ghost" onClick={() => setReqs(reqs.filter((_, k) => k !== i))}>
                      Убрать
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(nP > rareCap.p || nS > rareCap.s) && (
        <div className="warn">
          На этой базе помещается {rareCap.p} префикса и {rareCap.s} суффикса. Уменьшите число модов на перегруженной стороне или
          укажите ниже, что достаточно части из них.
        </div>
      )}
      {reqs.length > 1 && (
        <label className="inline">
          Сколько из них обязательно:
          <select value={need} onChange={(e) => setNeed(+e.target.value)}>
            {reqs.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1 === reqs.length ? `все (${i + 1})` : `любые ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <input className="search" placeholder="Поиск мода (по-английски, как в игре: life, resistance, attack speed…)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="famcols">
        {col(`Префиксы (${prefixes.length})`, prefixes)}
        {col(`Суффиксы (${suffixes.length})`, suffixes)}
      </div>
    </section>
  );
}
