---
name: search-jobs
description: Run a daily job search with Claude-in-Chrome and push new leads into the Can Even "Career & Job Search" board.
---

# Daily Job Search → Career Board

Run a job search using the criteria saved in the app, driving Chrome exactly like a manual
search, then POST the results back to the app so they show up on the Career & Job Search
board. This is a manually-triggered command (run it yourself each morning) — it is not
scheduled automation.

- **App account email:** ryanfoxbt@gmail.com
- **App URL:** http://localhost:3000 (swap for the production URL once this is deployed)

## 1. Load the saved search criteria

The user's search criteria (titles, industry, location, salary floor, recency, additional
sources) live in the database, editable from the app's UI: open the "Career & Job Search"
project tab, click it again (or its kebab menu) to open **Edit Project**, and fill in the
"Job Search Criteria" section. Do not ask the user to edit this file — it's in the app now.

Fetch the saved criteria at the start of every run:

```bash
curl -s http://localhost:3000/api/data
```

Find the project with `template_type == "career"`, and read its `settings` object:
- `titles` — comma-separated target job titles
- `industry` — target industry/industries
- `location` — location preference (e.g. "Remote (US)")
- `salaryFloor` — minimum acceptable base salary
- `recency` — `"24h"` or `"week"` — how far back to search
- `additionalSources` — newline-separated niche job boards / company career page URLs, in
  addition to LinkedIn Jobs and Google Jobs (always searched by default)

**If `settings` is empty or missing required fields** (no `titles`, `industry`, or
`location`), stop and tell the user to fill in the Job Search Criteria section in the
Career & Job Search project's Edit Project modal before running this again — don't guess
their preferences.

## 2. Run the search

1. Load the Chrome tools first: `ToolSearch` with query
   `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__find"`.
2. Get tab context (`tabs_context_mcp` with `createIfEmpty: true`), then navigate to:
   - LinkedIn Jobs, searched with the saved titles/location filters applied, sorted by date
   - Google Jobs, with a "past 24 hours" (or "past week", per `recency`) filter
   - Each URL listed in `additionalSources`
   The user must already be logged into LinkedIn in their normal Chrome profile — do not
   attempt to log in or handle credentials.
3. Prefer `get_page_text` or `read_page` over screenshots to extract listings —
   screenshots are for verifying layout/spot-checking only, not the primary way to read
   search results.
4. For each job found, note: title, company, location, salary (or an estimate, flagged),
   how recently it was posted, the source, the direct listing URL, and a one-sentence "why
   it fits" based on the saved criteria.
5. Classify each job as `"Apply Today"` (strong fit, meets the salary floor, posted within
   the recency window) or `"Worth Reviewing"` (partial fit, borderline salary/recency/level,
   or details are unclear/undisclosed).

## 3. Push results into the app

Do **not** hardcode the API key anywhere in this file or in chat — read it from
`.env.local` at run time. From the project root:

```bash
KEY=$(grep '^JOB_INGEST_KEY=' .env.local | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/jobs/ingest \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{
    "user_email": "ryanfoxbt@gmail.com",
    "jobs": [
      {
        "category": "Apply Today",
        "company": "...",
        "title": "...",
        "industry": "...",
        "location": "...",
        "salary": "...",
        "salary_estimated": false,
        "posting_date": "...",
        "source": "LinkedIn",
        "job_url": "https://...",
        "fit_reason": "...",
        "notes": "..."
      }
    ]
  }'
```

Field notes (must match `POST /api/jobs/ingest` in `api/index.js`):
- `category` must be exactly `"Apply Today"` or `"Worth Reviewing"` — this determines
  whether the task lands in the To Do column or the Future/leads view.
- `salary_estimated: true` when the salary wasn't posted and you estimated it.
- The endpoint dedupes by `job_url` (falling back to company+title), so it's safe to
  re-submit jobs you're unsure were already added — duplicates are silently skipped, and
  the response tells you how many were `inserted` vs `skipped`.

## 4. Report back

Summarize in chat: how many jobs were found, how many were new (`inserted`) vs already on
the board (`skipped`), and a one-line list of the "Apply Today" ones so the user has a
quick morning read without opening the app.
