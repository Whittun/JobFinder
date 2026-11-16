import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { SourceTrack } from './lib/sources'
import { number } from './lib/hh'
import './CollectorsPanel.css'

type Sources = { enabled: boolean; stored: number; tracks: SourceTrack[]; boards: { source: string; url: string; label: string }[]; events: { id: number; source: string; at: string; level: string; message: string }[] }
const phaseNames = { running: 'Сейчас собирает', waiting: 'Ожидает следующую задачу', paused: 'На паузе', error: 'Есть ошибка', needs_key: 'Нужен ключ поиска' }
const time = (value: string | number | null) => value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'ещё не было'
export default function CollectorsPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem('jobfinder-sources-open') === 'true')
  const [data, setData] = useState<Sources | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [board, setBoard] = useState('')
  const [notice, setNotice] = useState('')
  const [checkedAt, setCheckedAt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const response = await fetch('/api/sources', { signal: controller.signal })
        const body: unknown = await response.json()
        if (!response.ok) throw new Error('Не удалось загрузить состояние источников.')
        if (!controller.signal.aborted) { setData(body as Sources); setCheckedAt(Date.now()); setError('') }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Ошибка загрузки источников.') }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, open ? 5000 : 20000) }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, revision])
  async function change(path: string, body: object, id: string) {
    setBusy(id); setError('')
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result: unknown = await response.json()
      if (!response.ok) throw new Error(result && typeof result === 'object' && 'message' in result ? String(result.message) : 'Не удалось изменить состояние.')
      setRevision(value => value+1)
      return true
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Ошибка управления сбором.'); return false }
    finally { setBusy('') }
  }
  async function addBoard(event: FormEvent) {
    event.preventDefault()
    if (await change('/api/sources/boards', { url: board.trim() }, 'board')) { setBoard(''); setNotice('Карьерная страница добавлена в очередь.') }
  }
  const working = data?.tracks.filter(track => track.running).length || 0
  const checked = data?.tracks.filter(track => track.lastSuccess).length || 0
  const errors = data?.tracks.filter(track => track.enabled && track.phase === 'error').length || 0
  return <section id="collector" className="panel collectors-panel" aria-label="Все сборщики">
    <div className="collectors-heading"><div><span className={`status-pill ${data?.enabled ? 'active' : ''}`}><i className="live-dot"/>{!data ? 'Подключаем источники' : data.enabled ? 'Параллельный сбор включён' : 'Все сборщики на паузе'}</span><h2>Источники вакансий</h2><p>{number(data?.stored || 0)} вакансий в общей базе · {data?.tracks.length || '…'} треков · сейчас работают {working}</p></div><button className="control-button" disabled={!data || !!busy} onClick={() => { if (data) void change('/api/collector', { enabled: !data.enabled }, 'all') }}>{busy === 'all' ? 'Сохраняем…' : data?.enabled ? 'Пауза всех' : 'Продолжить все'}</button></div>
    <details className="collectors-expand" open={open} onToggle={event => { const expanded = event.currentTarget.open; setOpen(expanded); localStorage.setItem('jobfinder-sources-open', String(expanded)) }}><summary><span>{open ? 'Свернуть сборщики' : 'Развернуть сборщики'}</span><span className="collectors-summary-counts">Успешно проверяли: {checked} · с ошибками: {errors}</span></summary>
      <p className="collectors-explanation">Источники работают независимо. Ошибка одного не останавливает остальные. Одновременно выполняется до трёх внешних запросов и отдельный поток hh; запросы к одному сайту разнесены по времени.</p>
      <div className="source-track-grid">{data?.tracks.map(track => <article key={track.id} data-source-id={track.id} className={`source-track ${track.running ? 'source-track-running' : ''}`} style={{ '--track-color': track.color } as CSSProperties}>
        <div className="source-track-heading"><h3><i />{track.name}</h3><button disabled={!!busy} onClick={() => { void change(`/api/sources/${track.id}`, { enabled: !track.enabled }, track.id) }}>{busy === track.id ? '…' : track.enabled ? 'Пауза' : 'Включить'}</button></div>
        <span className={`source-phase source-phase-${track.phase}`}>{!data.enabled ? 'Общая пауза' : phaseNames[track.phase]}</span><p className="source-note">{track.note}</p>
        <p className="source-current"><strong>{track.running ? 'Сейчас:' : 'Последнее задание:'}</strong> {track.current || 'Готовим первый запрос'}</p>
        <div className="source-track-stats"><span><b>{number(track.requests)}</b>запросов</span><span><b>{number(track.saved)}</b>сохранено</span><span><b>{number(track.duplicates)}</b>повторов</span><span><b>{number(track.pending)}</b>в очереди</span></div>
        <p className="source-times">Успешная проверка: {time(track.lastSuccess)}<br />{track.nextAt > checkedAt ? `Следующая попытка не раньше ${time(track.nextAt)}` : 'Следующая задача — по очереди и лимиту сайта'}</p>
        {!!track.rejected && <p className="source-times">Отсеяно по формату, обязанностям или полноте: {number(track.rejected)}</p>}
        {track.lastError && <p className="source-error">{track.lastError}</p>}
        {track.phase === 'needs_key' && <p className="source-key-note">Для автоматического поиска нужен ключ Serper в настройках сервера: SERPER_API_KEY. Остальные источники работают без него.</p>}
      </article>)}</div>
      <details className="source-boards"><summary>Карьерные страницы компаний · {data?.boards.length || 0}</summary><p>Добавь адрес страницы вакансий компании на Ashby, Greenhouse или Lever. Дальше сборщик будет проверять её сам.</p><form onSubmit={event => { void addBoard(event) }}><input type="url" aria-label="Адрес карьерной страницы" value={board} maxLength={1000} onChange={event => setBoard(event.target.value)} required placeholder="https://jobs.ashbyhq.com/company" /><button disabled={!!busy}>Добавить</button></form>{notice && <p role="status">{notice}</p>}<div className="board-links">{data?.boards.map(item => <span key={item.url}>{item.source} · {item.label}</span>)}</div></details>
      <details className="source-log"><summary>Журнал источников · последние события</summary><p>События сохраняются между перезапусками. Показаны последние 35 записей.</p><div>{data?.events.map(event => <p key={event.id} className={event.level === 'error' ? 'source-log-error' : ''}><time>{time(event.at)}</time><strong>{event.source}</strong><span>{event.message}</span></p>)}</div></details>
    </details>
    {error && <p className="source-error" role="alert">{error}</p>}
  </section>
}
