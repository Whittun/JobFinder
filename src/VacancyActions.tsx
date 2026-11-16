import { useEffect, useState } from 'react'
import type { Vacancy } from './lib/hh'
import { coverLetters, recommendedLetter } from './lib/cover-letters'
import { copyText } from './lib/clipboard'
import { markVacancy } from './lib/workspace'
import './Workspace.css'

export default function VacancyActions({ job, processedAt, canRestore = true, onChanged }: { job: Vacancy; processedAt?: string; canRestore?: boolean; onChanged: () => void }) {
  const recommended = recommendedLetter(job)
  const [letterId, setLetterId] = useState(recommended?.id || coverLetters[0]?.id || '')
  const [copyState, setCopyState] = useState('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = coverLetters.find(letter => letter.id === letterId)
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 3000)
    return () => clearTimeout(timer)
  }, [copyState])
  async function copy(text: string) {
    setCopyState('copying'); setError('')
    try { await copyText(text); setCopyState('copied') }
    catch (failure) { setCopyState('idle'); setError(failure instanceof Error ? failure.message : 'Не удалось скопировать письмо.') }
  }
  async function changeState() {
    setSaving(true); setError('')
    try { await markVacancy(job.id, !processedAt); onChanged() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить отметку.') }
    finally { setSaving(false) }
  }
  return <div className="vacancy-actions" data-actions-for={job.id}>
    {processedAt && <p className="processed-stamp">✓ Откликнулся · {new Date(processedAt).toLocaleString('ru-RU')}</p>}
    <div className="vacancy-action-buttons">
      <button className="process-vacancy" type="button" disabled={saving || (!!processedAt && !canRestore)} title={processedAt ? canRestore ? 'Снять отметку и снова показывать вакансию' : 'Вакансия больше недоступна в общей базе; копия сохранена здесь' : 'Отметить отклик в JobFinder'} onClick={() => { void changeState() }}>{saving ? 'Сохраняем…' : processedAt ? 'Вернуть в выдачу' : '✓ Откликнулся'}</button>
      {recommended && <button className="copy-cover-letter" type="button" disabled={copyState === 'copying'} onClick={() => { void copy(recommended.text) }}>{copyState === 'copied' ? '✓ Скопировано' : copyState === 'copying' ? 'Копируем…' : 'Скопировать сопроводительное'}</button>}
      <span className="copy-feedback" role="status">{!recommended && copyState === 'copied' ? '✓ Сопроводительное скопировано' : ''}</span>
    </div>
    <details className="letter-picker"><summary>{recommended ? 'Текст письма и выбор шаблона' : 'Выбрать сопроводительное вручную'}</summary>
      {!recommended && <p>Для этой профессии подходящий шаблон пока не выбран. Можно использовать сохранённое письмо вручную.</p>}
      <label><span>Сопроводительное</span><select value={letterId} onChange={event => { setLetterId(event.target.value); setCopyState('idle') }}>{coverLetters.map(letter => <option key={letter.id} value={letter.id}>{letter.name}{letter.id === recommended?.id ? ' · рекомендовано' : ''}</option>)}</select></label>
      {selected && <><textarea className="cover-letter-text" aria-label="Текст сопроводительного" readOnly value={selected.text} onFocus={event => event.target.select()} /><button className="copy-cover-letter" type="button" disabled={copyState === 'copying'} onClick={() => { void copy(selected.text) }}>{copyState === 'copied' ? '✓ Скопировано' : 'Скопировать выбранное письмо'}</button></>}
    </details>
    {error && <p className="vacancy-action-error" role="alert">{error}</p>}
  </div>
}
