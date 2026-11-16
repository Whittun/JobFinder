import type { Vacancy } from './hh.ts'

export type ProcessedVacancy = { vacancy: Vacancy; processedAt: string; canRestore: boolean }
export type ProcessedResult = { total: number; filtered: number; page: number; pageSize: number; totalPages: number; items: ProcessedVacancy[] }

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body ? String(body.message) : 'Не удалось сохранить изменения.')
  return body as T
}

export async function markVacancy(id: string, processed: boolean) {
  return readResponse<{ processed: boolean }>(await fetch('/api/vacancy-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, processed }),
  }))
}

export async function getProcessed(text: string, page: number, signal: AbortSignal) {
  return readResponse<ProcessedResult>(await fetch(`/api/processed?${new URLSearchParams({ text, page: String(page) })}`, { signal }))
}
