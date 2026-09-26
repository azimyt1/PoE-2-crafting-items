// Reads items copied in the game (Ctrl+Alt+C) and hands them to the app.
// Three ways: paste, read the clipboard when this window gets focus,
// or poll the local Windows helper (fully automatic).

import { useEffect, useRef, useState } from 'react';
import type { ItemParser, ParsedItem } from '../engine/parseItem';

export type LinkMode = 'paste' | 'focus' | 'helper';
const HELPER_URL = 'http://localhost:47291/item';

interface Props {
  parser: ItemParser | null;
  poolIds?: Set<string>;
  mode: LinkMode;
  setMode: (m: LinkMode) => void;
  onItem: (p: ParsedItem, raw: string) => void;
  compact?: boolean;
}

export function GameLink({ parser, poolIds, mode, setMode, onItem, compact }: Props) {
  const [status, setStatus] = useState<string>('');
  const [last, setLast] = useState<ParsedItem | null>(null);
  const [text, setText] = useState('');
  const lastRaw = useRef<string>('');
  const onItemRef = useRef(onItem);
  onItemRef.current = onItem;

  function handle(raw: string, source: string) {
    if (!parser || !raw || raw === lastRaw.current) return;
    // a trade-site extension that could not read the listing
    if (/Unknown (Class|Base|Rarity)/.test(raw)) {
      setStatus('Расширение трейда не смогло прочитать объявление (пустой шаблон «Unknown»). Выделите объявление мышкой и нажмите Ctrl+C.');
      return;
    }
    const p = parser.parse(raw, poolIds);
    if (!p) {
      if (source !== 'helper' && source !== 'focus')
        setStatus('Это не похоже на предмет. Скопируйте его в игре через Ctrl+Alt+C или объявление с сайта трейда целиком.');
      return;
    }
    lastRaw.current = raw;
    setLast(p);
    setStatus(`${new Date().toLocaleTimeString('ru-RU')}: прочитан предмет (${source})`);
    onItemRef.current(p, raw);
  }

  // Ctrl+V anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const t = e.clipboardData?.getData('text') ?? '';
      if (t) handle(t, 'вставка');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // read clipboard when the window regains focus
  useEffect(() => {
    if (mode !== 'focus') return;
    const read = async () => {
      try {
        const t = await navigator.clipboard.readText();
        handle(t, 'буфер обмена');
      } catch {
        setStatus('Браузер не дал прочитать буфер обмена. Разрешите доступ (значок в адресной строке) или используйте вставку Ctrl+V.');
      }
    };
    const onFocus = () => void read();
    window.addEventListener('focus', onFocus);
    void read();
    return () => window.removeEventListener('focus', onFocus);
  });

  // poll the local helper
  useEffect(() => {
    if (mode !== 'helper') return;
    let stop = false;
    let seq = -1;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(HELPER_URL, { cache: 'no-store' });
        const j = (await r.json()) as { seq: number; text: string | null };
        if (j.seq !== seq) {
          seq = j.seq;
          if (j.text) handle(j.text, 'помощник');
        }
        setStatus((s) => (s.startsWith('Помощник не отвечает') || !s ? 'Помощник подключён. Копируйте предметы в игре через Ctrl+Alt+C.' : s));
      } catch {
        setStatus('Помощник не отвечает. Запустите helper/start-helper.bat (см. инструкцию ниже).');
      }
      if (!stop) setTimeout(tick, 800);
    };
    void tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, parser]);

  return (
    <div className={'gamelink' + (compact ? ' compact' : '')}>
      <div className="row">
        <b>Предмет из игры:</b>
        <label className="inline">
          <input type="radio" checked={mode === 'paste'} onChange={() => setMode('paste')} /> вставка (Ctrl+V)
        </label>
        <label className="inline">
          <input type="radio" checked={mode === 'focus'} onChange={() => setMode('focus')} /> читать при переходе в это окно
        </label>
        <label className="inline">
          <input type="radio" checked={mode === 'helper'} onChange={() => setMode('helper')} /> помощник для Windows (автоматически)
        </label>
      </div>
      <div className="muted small">
        В игре наведите курсор на предмет и нажмите <b>Ctrl+Alt+C</b> (копия с тирами и префиксами/суффиксами).{' '}
        {mode === 'paste' && 'Затем нажмите Ctrl+V на этой странице.'}
        {mode === 'focus' && 'Затем просто переключитесь в это окно: предмет прочитается сам (браузер один раз спросит разрешение).'}
        {mode === 'helper' && 'Приложение само видит каждый скопированный предмет, даже если оно открыто на втором мониторе.'}
        <br />
        Предмет с сайта трейда: скопируйте его кнопкой копирования (её добавляет расширение «PoE2 Trade Copy Button») или просто
        выделите объявление мышкой и нажмите Ctrl+C, затем Ctrl+V здесь. Тиры в этом случае определяются по значениям модов.
      </div>
      {mode === 'paste' && !compact && (
        <textarea
          rows={3}
          placeholder="…или вставьте текст предмета сюда"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handle(e.target.value, 'вставка');
          }}
        />
      )}
      {mode === 'helper' && (
        <details className="small">
          <summary>Как запустить помощника</summary>
          <ol>
            <li>Скачайте папку <code>helper</code> из репозитория (файлы poe2-helper.ps1 и start-helper.bat).</li>
            <li>Дважды щёлкните start-helper.bat. Откроется чёрное окно — не закрывайте его, пока крафтите.</li>
            <li>Помощник работает только на вашем компьютере и отдаёт этой странице только текст предметов PoE.</li>
          </ol>
        </details>
      )}
      {status && <div className="small">{status}</div>}
      {last && (
        <div className="small">
          {last.baseName || '?'} · {last.rarity === 'rare' ? 'редкий' : last.rarity === 'magic' ? 'магический' : last.rarity === 'normal' ? 'обычный' : last.rarity}
          {last.ilvl ? ` · ilvl ${last.ilvl}` : ''} · модов распознано: {last.mods.length}
          {last.corrupted && <span className="warn-inline"> · осквернён (Corrupted): менять нельзя</span>}
          {!last.advanced && last.mods.length > 0 && <span className="muted"> · простая копия (Ctrl+C): тиры определены по значениям</span>}
          {last.unmatched.length > 0 && <div className="warn-inline">Не распознано: {last.unmatched.join(' · ')}</div>}
          {!last.base && <div className="warn-inline">База не найдена в данных (этот тип предметов пока не поддерживается).</div>}
        </div>
      )}
    </div>
  );
}
