// Archived-format fixtures are independent of the active worker registry.
export const retiredSourceFixtures = [
  { id: 'himalayas', kind: 'json', url: 'https://himalayas.app/jobs/api' },
  { id: 'remotive', kind: 'json', url: 'https://remotive.com/api/remote-jobs' },
  { id: 'remoteok', kind: 'json', url: 'https://remoteok.com/api' },
  { id: 'tg-react', kind: 'telegram', url: 'https://t.me/s/job_react' },
].map(source => ({ ...source, name: source.id, pace: 15000, interval: 3600000, note: 'Archived fixture', color: '#000000' }))
