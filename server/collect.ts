import { resolve } from 'node:path'
import { Collector } from './collector.ts'

const collector = new Collector(resolve(process.cwd(), 'data/jobfinder.sqlite'))
collector.start()
const keepAlive = setInterval(() => {
  const status = collector.store.taskStats()
  const count = collector.store.count('SELECT count(*) count FROM vacancies')
  const tracks = collector.store.sources.tracks()
  console.log(`${new Date().toISOString()} | вакансий ${count} | hh: очередь ${status.pending} | другие источники: работают ${tracks.filter(item => item.running).length}, с ошибками ${tracks.filter(item => item.phase === 'error').length} | ${collector.store.get('current', '')}`)
}, 30_000)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clearInterval(keepAlive); void collector.close().then(() => process.exit(0)) })
console.log('Параллельный сбор hh.ru и дополнительных источников запущен. База: data/jobfinder.sqlite. Остановка: Ctrl+C.')
