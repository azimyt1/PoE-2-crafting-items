import { useState } from 'react';
import type { TargetReq } from '../engine/types';
import { tierLabel, type Family } from './families';

interface Props {
  families: Family[];
  reqs: TargetReq[];
  setReqs: (r: TargetReq[]) => void;
  need: number;
  setNeed: (n: number) => void;
  open: { p: number; s: number };
  setOpen: (o: { p: number; s: number }) => void;
  rareCap: { p: number; s: number };
  /** slots already held by kept modifiers of the current item */
  taken?: { p: number; s: number };
  /** how many of each extra group (1, 2, 3) are needed */
  groupNeed: Record<string, number>;
  setGroupNeed: (g: Record<string, number>) => void;
}

const GROUPS = [
  { id: 0, ru: 'обязательный' },
  { id: 1, ru: 'группа А' },
  { id: 2, ru: 'группа Б' },
  { id: 3, ru: 'группа В' },
];

export function reqLabel(f: Family, minLevel: number): string {
  const ok = f.tiers.filter((t) => t.l >= minLevel);
  const worst = ok[ok.length - 1];
  return `${f.name} — от T${ok.length} (${worst ? worst.x.replace(/\n/g, ' / ') : '?'})`;
}

export function TargetEditor({
  families,
  reqs,
  setReqs,
  need,
  setNeed,
  open,
  setOpen,
  rareCap,
  taken = { p: 0, s: 0 },
  groupNeed,
  setGroupNeed,
}: Props) {
  const [q, setQ] = useState('');
  const byFam = new Map(families.map((f) => [f.fam, f]));
  const chosen = new Set(reqs.map((r) => r.fam));
  const filter = (f: Family) => !chosen.has(f.fam) && (!q || f.name.toLowerCase().includes(q.toLowerCase()));
  const prefixes = families.filter((f) => f.side === 'p' && filter(f));
  const suffixes = families.filter((f) => f.side === 's' && filter(f));
  const main = reqs.filter((r) => !r.group);
  // slots surely needed: all-required main list + kept modifiers (groups can pick either side)
  const sure = main.length > 0 && need >= main.length ? main : [];
  const nP = sure.filter((r) => r.side === 'p').length + taken.p;
  const nS = sure.filter((r) => r.side === 's').length + taken.s;
  const groupSize = (g: number) => reqs.filter((r) => (r.group ?? 0) === g).length;

  function add(f: Family) {
    if (reqs.length >= 10) return;
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
          <button key={f.fam} className={'fam' + (f.desecrated ? ' desecrated' : '') + (f.essence ? ' essence' : '')} onClick={() => add(f)} title="Добавить в цель">
            <span>{f.name}</span>
            <span className="muted small">
              {f.tiers.length} тир. · макс. ур. {f.tiers[0].l}
              {f.desecrated ? ' · только очернение' : ''}
              {f.essence ? ' · только эссенция или сплав' : ''}
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
              <th title="Моды одной группы взаимозаменяемы: нужно столько из группы, сколько указано ниже">Группа</th>
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
                    <select value={r.group ?? 0} onChange={(e) => setReqs(reqs.map((x, k) => (k === i ? { ...x, group: +e.target.value } : x)))}>
                      {GROUPS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.ru}
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
      {main.length > 1 && (
        <label className="inline">
          Из модов «обязательный» нужно:
          <select value={need} onChange={(e) => setNeed(+e.target.value)}>
            {main.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1 === main.length ? `все (${i + 1})` : `любые ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {GROUPS.filter((g) => g.id > 0 && groupSize(g.id) > 0).map((g) => {
        const n = groupSize(g.id);
        const v = Math.min(groupNeed[g.id] ?? 1, n);
        return (
          <label key={g.id} className="inline">
            Из {g.ru.replace('группа', 'группы')} ({n}) нужно:
            <select value={v} onChange={(e) => setGroupNeed({ ...groupNeed, [g.id]: +e.target.value })}>
              {Array.from({ length: n }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1 === n ? `все (${i + 1})` : `любой ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {reqs.length > 0 && (
        <p className="muted small">
          Группы — для «подойдёт любой из»: например, поставьте сопротивления огню, холоду и молнии в «группу А» и выберите «любой 1».
        </p>
      )}
      <div className="row">
        <label className="inline" title="Свободное место нужно, чтобы потом добавить мод оменом, эссенцией или сплавом">
          Оставить свободными: префиксов
          <select value={open.p} onChange={(e) => setOpen({ ...open, p: +e.target.value })}>
            {Array.from({ length: rareCap.p + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          суффиксов
          <select value={open.s} onChange={(e) => setOpen({ ...open, s: +e.target.value })}>
            {Array.from({ length: rareCap.s + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(nP + open.p > rareCap.p || nS + open.s > rareCap.s) && open.p + open.s > 0 && (
        <div className="warn">Нужные моды и свободные места не помещаются на эту базу.</div>
      )}
      <input className="search" placeholder="Поиск мода (по-английски, как в игре: life, resistance, attack speed…)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="famcols">
        {col(`Префиксы (${prefixes.length})`, prefixes)}
        {col(`Суффиксы (${suffixes.length})`, suffixes)}
      </div>
    </section>
  );
}
