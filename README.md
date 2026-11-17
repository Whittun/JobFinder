[Русская версия](README.ru.md)

# JobFinder — Remote Web Jobs

A local tool for finding and analyzing remote jobs in web development, HTML/CSS implementation, web service support, QA, infrastructure, web design, technical analysis, and integrations. It focuses on roles with Russian-language workplace communication that allow working from Russia or do not explicitly prohibit it.

## Getting started

Requires Node.js 24+ with built-in SQLite support.

```sh
npm install
npm run dev
```

Collection runs alongside the web server. To run a separate background collector, use `npm run collect`. The CLI and web server share the same database, worker leases, and request limits. A browser does not need to stay open.

## Job selection

- Only web-related roles qualify. General technical positions must include web context in their descriptions or skills, such as HTTP, browsers, websites, web services, REST, or web frameworks.
- Marketing, influencer marketing, sales, teaching, purely mobile/game/embedded development, accounting, and hardware support are excluded.
- A full description is required. A search result alone does not become a saved vacancy.
- Management and senior roles are excluded from all listings and statistics: senior/sr, lead/team lead, head/director, staff/principal, and equivalent Russian titles. Selection checks the title, structured seniority, and explicit level requirements in the description. Mentoring or working under a senior colleague does not exclude junior/middle positions. Previously collected jobs are hidden with a flag while preserving history; new ineligible jobs are not saved.
- Workplace communication must be in Russian. An English description requires explicit evidence of a Russian-speaking team. English for reading documentation is allowed.
- Jobs explicitly prohibiting work from Russia, requiring residence abroad, or restricting applicants to a list of countries that excludes Russia are rejected. The absence of a prohibition is accepted. Selection is heuristic; ambiguous requirements should be checked in the original posting.
- Both remote and hybrid jobs are stored. The interface shows fully remote jobs by default.

Selection rules: `server/web-scope.ts`, `server/selection.ts`, and `src/lib/market-policy.ts`. Selection version: `web-remote-v2`.

## Interface

The main page provides search by title, description, and company; filters for profession, experience, publication date, and salary; and vacancy cards with full descriptions and source links. Expandable analytics show professions, programming languages, technologies, and tools, with clickable filters. Statistics describe the collected sample, not the entire job market.

The expandable collector panel displays colored source tracks, queues, recent tasks, errors, and an event log. Sources can be paused individually or together. Pausing does not reset a website's cooldown.

Marking a vacancy as applied removes it from active listings. The processed jobs section preserves application history. The cover letter section stores the user's letter and provides a copy button; eligible vacancy cards also let you copy it directly.

## How collection works

- **HH:** targeted searches for web and technical roles instead of crawling every profession. Clearly unrelated candidates are rejected before their descriptions are fetched. Jobs are deduplicated by ID, detail pages are cached for three days, and new search windows overlap to reduce missed results. A check on November 16, 2026 returned HTTP 403 from the public API on this machine, so the collector uses HTML pages. It does not bypass CAPTCHAs or access restrictions.
- **Habr Career, Geekjob, and BUDU:** public search results → preliminary title filtering → full vacancy pages/JSON-LD. Habr searches request remote jobs.
- **getmatch:** sitemap → technical URL filtering → full vacancy checks, starting with the newest IDs. Up to 1,000 relevant links are scheduled per pass; company pages and the rest of the archive are not crawled.
- **Greenhouse:** a small listing without `content=true` → preliminary role and seniority filtering → individual full descriptions. Escaped HTML is decoded before the shared selection rules run.
- **Lever:** the public API with `limit=1&skip=N`. Small pages are fetched sequentially with per-host pacing. Each page refreshes every six hours, with a limit of 1,000 positions per board per pass.
- **We Work Remotely (RSS) and Ashby (API):** the same strict selection rules apply. An international feed does not automatically make a vacancy eligible. Board names are normalized so case variations do not trigger duplicate collection.
- **Retired sources:** checks on November 16, 2026 found Himalayas, Remotive, Remote OK, and two Telegram feeds unavailable from this machine. They were removed from scheduling and the UI; old tasks were stopped without deleting vacancies or history. See the [collector health report (Russian)](docs/worker-health.md) for findings and verification details.
- Requests use conditional headers when ETag/Last-Modified validators are available. HTTP 304 skips downloading and parsing the body; only successfully parsed responses update the validators.
- Up to three external requests run concurrently, plus a separate HH worker. Per-host pacing and worker leases are shared across processes. HTTP 403/429 and network errors trigger automatic backoff, respecting Retry-After. An unavailable source does not stop the others.

Duplicates are merged by original URL/ID or an exact match of employer, title, and description. Aggregator links to HH are recognized without starting another HH crawl. Indirect redirects and rewritten postings may remain separate records.

Source definitions and intervals: `src/lib/sources.ts`. Queue and execution: `server/source-state.ts` and `server/source-runner.ts`. Parsers: `server/source-adapters.ts`.

API documentation: [HH API](https://api.hh.ru/openapi/redoc), [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html), and [Lever Postings API](https://github.com/lever/postings-api).

## Data and reset

SQLite data is stored in `data/jobfinder.sqlite`, excluded from Git and HTTP access. The database holds vacancies, skills, dictionaries, queues, HTTP validators, event logs, and a separate application history. API keys are not sent to the client.

```sh
npm run reset-data -- --fresh-sources
```

This clears vacancies, queues, and source state while preserving personal marks and their snapshots. Stop the collectors before resetting and restart them afterward; fresh queues are created on startup. Add `--paused` to leave collection disabled. Running `npm run reset-data` without `--fresh-sources` preserves registered boards and recurring tasks. Use `JOBFINDER_DB` to select a separate database for checks.

## Validation

```sh
npm test
npm run lint
npm run build
npm run audit-data
```

Tests cover web role selection, language and geographic restrictions, deduplication, persistent queues, worker leases and backoff, HTTP 304 handling, preservation of personal marks, filters, and statistics. `audit-data` opens the live database in read-only mode.
