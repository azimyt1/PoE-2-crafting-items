import { Fragment, useState } from 'react';
import type { PlanStepView, StrategyResult } from '../api';
import type { Prices } from '../engine/types';
import { fmtCost, fmtNum, fmtPct, type DisplayCurrency } from './format';

interface Props {
  results: StrategyResult[];
  running: boolean;
  stale: boolean;
  currency: DisplayCurrency;
  prices: Prices;
  onRecalc: () => void;
  onTrack: (strategyId: string) => void;
  /** the calculation starts from the current item, not a fresh base */
  fromItem?: boolean;
}

export function PlanSteps({ steps, currency, prices }: { steps: PlanStepView[]; currency: DisplayCurrency; prices: Prices }) {
  if (!steps.length) return <div className="muted">Нет шагов.</div>;
  return (
    <ol className="plan">
      {steps.map((s, i) => (
        <li key={i}>
          <div className="step-title">
            {s.title} <span className="muted small">· {fmtCost(s.cost, currency, prices)}</span>
          </div>
          <div className="small">
            Шанс продвинуться: <b>{fmtPct(s.pGood)}</b>
            {s.fallback && (
              <>
                {' '}
                · если не повезло ({fmtPct(s.pFallback ?? 0)}): <span className="fallback">{s.fallback}</span>
              </>
            )}
          </div>
          {s.itemAfter.length > 0 && <div className="muted small">После удачного шага: {s.itemAfter.join(' · ')}</div>}
        </li>
      ))}
    </ol>
  );
}

export function Results({ results, running, stale, currency, prices, onRecalc, onTrack, fromItem }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...results].sort((a, b) => {
    const ka = a.successRate < 0.5 ? 1 : 0;
    const kb = b.successRate < 0.5 ? 1 : 0;
    return ka - kb || a.meanCost - b.meanCost;
  });
  const best = sorted[0];
  return (
    <section className="card">
      <h2>Варианты крафта</h2>
      {fromItem && (
        <p className="muted small">Расчёт от текущего предмета: суммы — сколько ещё потратить, без цены самого предмета.</p>
      )}
      {stale && (
        <div className="warn">
          Цель или цены изменились после расчёта. <button onClick={onRecalc}>Пересчитать</button>
        </div>
      )}
      {!results.length && !running && <p className="muted">Нажмите «Рассчитать варианты крафта» на первой вкладке.</p>}
      {running && <p className="muted">Считаю стратегии… ({results.length} из 6)</p>}
      {best && !best.impossible && (
        <p>
          Самый дешёвый вариант: <b>{best.name}</b>, в среднем <b>{fmtCost(best.meanCost, currency, prices)}</b>. В 9 случаях из 10 уложитесь в{' '}
          {fmtCost(best.p90Cost, currency, prices)}.
        </p>
      )}
      {results.length > 0 && (
        <div className="table-wrap">
          <table className="results">
            <thead>
              <tr>
                <th>Стратегия</th>
                <th title="Доля симуляций, дошедших до цели">Успех</th>
                <th title="Средняя стоимость с учётом новых баз">В среднем</th>
                <th title="Половина попыток дешевле этой суммы">Медиана</th>
                <th title="9 из 10 попыток дешевле этой суммы">90%</th>
                {fromItem ? (
                  <th title="Сколько раз в среднем придётся покупать такой же предмет заново">Покупок заново</th>
                ) : (
                  <th title="Сколько баз в среднем уходит в мусор">Новых баз</th>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <Fragment key={r.strategyId}>
                  <tr className={r === best ? 'best' : ''}>
                    <td>
                      <b>{r.name}</b>
                      <div className="muted small">{r.description}</div>
                    </td>
                    {r.impossible ? (
                      <td colSpan={5} className="muted">
                        Недостижимо этими средствами (нет нужных модов на этом уровне предмета или не хватает слотов)
                      </td>
                    ) : (
                      <>
                        <td>{fmtPct(r.successRate)}</td>
                        <td>
                          <b>{fmtCost(r.meanCost, currency, prices)}</b>
                        </td>
                        <td>{fmtCost(r.medianCost, currency, prices)}</td>
                        <td>{fmtCost(r.p90Cost, currency, prices)}</td>
                        <td>{fmtNum(r.meanRestarts)}</td>
                      </>
                    )}
                    <td className="nowrap">
                      {!r.impossible && (
                        <>
                          <button onClick={() => setOpen(open === r.strategyId ? null : r.strategyId)}>{open === r.strategyId ? 'Скрыть' : 'План'}</button>{' '}
                          <button onClick={() => onTrack(r.strategyId)}>Крафтить</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {open === r.strategyId && (
                    <tr className="plan-row">
                      <td colSpan={7}>
                        <div className="plan-grid">
                          <div>
                            <h3>Удачный сценарий и запасной план</h3>
                            <PlanSteps steps={r.plan} currency={currency} prices={prices} />
                          </div>
                          <div>
                            <h3>Расход в среднем на один готовый предмет</h3>
                            <table className="usage">
                              <tbody>
                                {r.usage.slice(0, 16).map(([name, n]) => (
                                  <tr key={name}>
                                    <td>{name}</td>
                                    <td>{fmtNum(n)} шт.</td>
                                    <td className="muted">{name in prices ? fmtCost(n * prices[name], currency, prices) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="muted small">
                              Первая же база доходит до цели в {fmtPct(r.firstBaseSuccess)} попыток. Оценка модели:{' '}
                              {fmtCost(r.estimate, currency, prices)}. Среднее число действий: {fmtNum(r.meanSteps)}.
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Все числа получены симуляцией: крафт проигрывается сотни раз по правилам игры, и на каждом шаге выбирается действие с минимальной
        ожидаемой стоимостью до цели. Веса модов взяты у Craft of Exile (где они известны), подробнее во вкладке «Веса модов».
      </p>
    </section>
  );
}
