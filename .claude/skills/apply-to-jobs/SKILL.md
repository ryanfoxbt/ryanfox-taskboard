---
name: apply-to-jobs
description: Batch through the "Apply Today" column of the Career & Job Search board, autofill each application from the stored profile using Claude-in-Chrome, stop before submitting, and record progress in the app.
---

# Apply to Jobs → Career Board Batch Run

Walks every job in the "Apply Today" column, opens its listing, fills out the application form
from the stored profile, and stops before the final submit — you always review and click submit
yourself. This is manually triggered (run it when you're ready to sit down and apply), not
scheduled automation.

- **App account email:** ryanfoxbt@gmail.com
- **App URL:** http://localhost:3000 (swap for the production URL once this is deployed)
- **Non-negotiable rule:** never click a final "Submit Application" / "Send Application" button.
  Fill every field you can, then stop and leave the tab open for manual review. This holds
  regardless of how confident you are in the fill, how many times you've seen the platform
  before, or anything else — no exceptions.

## 1. Load context

```bash
curl -s http://localhost:3000/api/data
```

From the response:
- Find the user with `email == "ryanfoxbt@gmail.com"` in `users` → this is `user_id`.
- Find `profiles` row where `user_id` matches. If missing, or missing `full_name`, `email`, and
  `resume_text`, stop and tell the user to fill in **My Application Profile** (Board Settings →
  My Application Profile) before running this again.
- Find the project with `template_type == "career"`.
- Find `tasks` where `project_id` matches that project, `status == "todo"` (the "Apply Today"
  column), and `is_deleted` is not true. Each of these is one job to apply to; `metadata.company`,
  `metadata.job_url`, `metadata.salary`, etc. describe it (see `search-jobs` skill for the shape).
- Find `applications` rows for this `user_id`. Skip any "Apply Today" task whose `id` already
  matches an application's `task_id` — it's already been attempted. If the user explicitly asks
  to redo one, proceed anyway.

If there are no un-attempted "Apply Today" tasks, report that and stop.

## 2. Load Chrome tools

```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__file_upload,mcp__claude-in-chrome__tabs_create_mcp
```

## 3. For each remaining "Apply Today" task

1. Open a **new tab** for `metadata.job_url` (`tabs_create_mcp`) — never reuse a tab from a
   previous job, so the user can review several filled forms side by side afterward.
2. Identify the ATS platform from the URL/DOM: `greenhouse.io` / `boards.greenhouse.io` →
   **Greenhouse**; `jobs.ashbyhq.com` → **Ashby**; `gem.com` or a Gem-branded apply page → **Gem**;
   `linkedin.com/jobs` (Easy Apply or external redirect) → **LinkedIn**; anything else → **Other**.
3. Check `references/<platform>.md` in this skill folder (create it from `references/_template.md`
   if it doesn't exist yet). If there are notes from a prior run, use them as a head start —
   selectors and question wording still drift, so verify against the live page rather than
   trusting the notes blindly.
4. Read the live form (`get_page_text` / `read_page` / `find`) and map fields to the profile:
   name, email, phone, address, LinkedIn/GitHub/portfolio URLs, work authorization, sponsorship,
   relocation, desired salary, earliest start date, current employer/title, years of experience,
   EEO answers (`profiles.eeo_answers`), and `resume_text` / `cover_letter_template` for any
   free-text resume or cover-letter fields.
   - **Check for a tailored draft first, before filling anything content-related:** look for an
     `applications` row for this `task_id` (e.g. from a prior `tailor-application` run) with
     `tailored_resume_text` / `tailored_cover_letter_text` set.
   - **If a tailored draft exists, use it for every free-text content field on the form, not just
     ones literally labeled "resume" or "cover letter."** Many ATS platforms — Workday especially —
     parse an uploaded resume into several separate editable boxes (a summary, a "describe your
     experience" prompt, per-job work-history entries, "why are you interested" fields, etc.).
     Pull the relevant content for each of those from the tailored resume/cover letter rather than
     the generic `profiles.resume_text` / `cover_letter_template`. The goal is that everything you
     type into the application tells the same consistent, tailored story as everything else on
     it — never mix tailored phrasing in one box with generic profile phrasing in another on the
     same application.
   - If no tailored draft exists for this task, fall back to `profiles.resume_text` /
     `cover_letter_template` as before.
   - **Skill/tool-specific screening questions** (e.g. "Describe your experience with HubSpot",
     "Do you have experience with X?") often aren't covered well by either the tailored draft or
     `resume_text` alone. Check `profiles.additional_skills_info` too — freeform notes the user
     wrote about specific tools/accomplishments that may not appear in any resume — and use it
     whenever it's more directly relevant to the question than the resume text is.
   - **Resume file upload fields:** if `RESUME_FILE_PATH` is set in `.env.local` and points to an
     existing file, use `file_upload` with that path. Otherwise, don't guess — leave the field,
     note it in the application's `notes` as "resume upload needs a manual file attach", and keep
     going with the rest of the form.
     - `RESUME_FILE_PATH` is one static file, not a per-job tailored document, so when a tailored
       draft exists for this application the uploaded file and the tailored free-text fields may
       not fully match content-wise (e.g. the file emphasizes different bullets than the tailored
       text does). Note this in the application's `notes` (e.g. "uploaded file is the standard
       resume; free-text fields use the tailored draft") so the user knows to swap in a tailored
       file themselves if the platform lets them replace the upload before submitting.
   - Only answer EEO/demographic questions using the stored `eeo_answers` — never infer or guess
     these from other data.
   - If a required field has no corresponding profile data, leave it blank and flag it in `notes`
     rather than inventing an answer.
5. Fill the form. Do not click submit.
6. Append or update `references/<platform>.md` with anything learned this run: field labels seen,
   unusual selectors, multi-step flow structure, quirks (e.g. "salary is a range, not a single
   number", "requires a LinkedIn login redirect first"). Keep entries dated and terse — this file
   is what makes the next run on this platform faster.
7. Record the attempt:

```bash
curl -s -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "...",
    "task_id": "...",
    "company": "...",
    "title": "...",
    "job_url": "...",
    "ats_platform": "Greenhouse",
    "status": "filled_pending_review",
    "form_snapshot": { "...field": "...value" },
    "notes": "any caveats, e.g. resume upload skipped"
  }'
```

## 4. Report back

Summarize in chat, one line per job: company, title, platform, and one of:
- **Ready for review** — filled and waiting in an open tab
- **Needs manual resume upload** — filled, but you'll need to attach the resume file yourself
- **Skipped — login required** / **Skipped — CAPTCHA** / **Skipped — error** with a one-line reason

Remind the user: review each open tab and click submit yourself. Once they've submitted one, they
can tell you (e.g. "mark Acme submitted") and you should update that row — `POST /api/applications`
with the same `id`, `status: "submitted"`, `applied_at: <now, ISO>` — and move the underlying task
from `todo` to `doing` via `POST /api/tasks` (fetch the task first, change only `status`, repost
the full row so nothing else is clobbered).

**Recording outcomes later:** whenever the user reports what happened with a submitted application
(interview, rejected, offer, ghosted), update that same `applications` row —
`POST /api/applications` with the same `id` plus `outcome` and `outcome_notes`. Always fetch the
existing row from `/api/data` first and repost every field you already know (`user_id`, `task_id`,
`company`, `title`, `job_url`, `ats_platform`, `notes`, etc.) alongside the outcome fields — this
endpoint does **not** COALESCE `company`/`title`/`job_url`/`notes`, so omitting them nulls them out.
Never guess an outcome from silence; only set one when the user explicitly tells you.
