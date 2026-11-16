import type { Named, Vacancy } from './hh.ts'
import type { PriorityMatch } from './priorities.ts'
import type { Recommendation } from './recommendations.ts'

export type AnalyticsFilters = { text: string; area: string; period: string; direction: string; profession: string; workFormat: string; experience: string; technology: string; title: string; salary: string; page: string; group: string; priority: string; recommendation: string }
export const defaultAnalyticsFilters: AnalyticsFilters = { text: '', area: '113', period: '30', direction: '', profession: '', workFormat: 'REMOTE_ONLY', experience: '', technology: '', title: '', salary: 'any', page: '0', group: '', priority: '', recommendation: '' }
export const defaultRemoteFilters: AnalyticsFilters = { ...defaultAnalyticsFilters, workFormat: 'REMOTE_ONLY' }
export const experienceOptions = [
  { id: 'noExperience', name: 'Нет опыта' }, { id: 'between1And3', name: 'От 1 года до 3 лет' },
  { id: 'between3And6', name: 'От 3 до 6 лет' }, { id: 'moreThan6', name: 'Более 6 лет' },
]
export type ProfessionSummary = Ranking & { salaryMedian: number | null; salaryCount: number; noExperience: number }
export type JobGroupSummary = ProfessionSummary & { variants: number; examples: string[] }
export type Ranking = { id: string; name: string; count: number; collected?: number; updatedAt?: string }
export type CollectorStatus = {
  enabled: boolean; running: boolean; current: string; lastError: string | null; nextAt: number;
  pending: number; done: number; failed: number; limited: number; requests: number;
  lastSuccess: string | null; snapshotAt: string | null; scannedRoles: number; knownRoles: number;
  detailPending: number; searchPending: number; rejections: Ranking[];
  optimization?: {
    version: number; intervalSeconds: number; cacheSkipped: number; remotePending: number; hybridPending: number;
    priorityPending: number; blockedUntil: number;
    lastFailure: { at: string; status: number; reason: string; url: string; title: string; retryAfter: string | null } | null;
  };
}
export type Analytics = {
  marketPolicy?: { version: string; included: number; hidden: number; exclusions: { reason: string; name: string; count: number }[] }
  processedTotal: number
  status: CollectorStatus
  totals: { stored: number; filtered: number; market: number | null; employers: number; withSalary: number; medianLower: number | null; salaryCount: number }
  market: { professions: Ranking[]; directions: Ranking[] }
  local: { professions: Ranking[]; directions: Ranking[]; regions: Ranking[]; experience: Ranking[]; formats: Ranking[]; titleSkills: Ranking[]; daily: Ranking[]; languages: Ranking[]; technologies: Ranking[]; tools: Ranking[]; spokenLanguages: Ranking[] }
  options: { professions: Named[]; directions: Named[]; groups: Named[] }
  recent: Vacancy[]
  priority?: { total: number; candidates: number; directions: Ranking[]; matches: Record<string, PriorityMatch[]> }
  recommendations?: Record<string, Recommendation>
  remote?: {
    professions: ProfessionSummary[]; titles: Ranking[]; tagged: number;
    available: number; mixedExcluded: number; page: number; pageSize: number; totalPages: number
    groups: JobGroupSummary[]; descriptions: number
  }
}

export async function getAnalytics(filters: AnalyticsFilters, signal: AbortSignal): Promise<Analytics> {
  const response = await fetch(`/api/analytics?${new URLSearchParams(filters)}`, { signal })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body ? String(body.message) : 'Не удалось прочитать статистику.')
  return body as Analytics
}
