---
name: tailor-application
description: Generate a tailored resume and cover letter draft for one specific job application, save it to that application's record for review, and update outcome tracking over time.
---

# Tailor Application → Save Draft for Review

Drafts a resume and cover letter tailored to one specific job, using the user's real uploaded
resume content and the job's actual description, then saves the draft to that application's
record in the app so it's visible in the task modal (Career Tracker Details → Application Status
& Materials) for review. This is manually triggered per application, not scheduled automation.

- **Non-negotiable rule:** this only ever *drafts* text into the application record for the user
  to review and copy themselves — it never fills or submits an actual application form (that's
  `apply-to-jobs`'s job) and never invents resume content not traceable to the source resume.
  Never fabricate employers, titles, dates, or metrics that aren't in the source resume.

## 1. Identify the target application

```bash
curl -s http://localhost:3000/api/data
```

- Find the user by `email == "ryanfoxbt@gmail.com"` → `user_id`.
- Find the target job — by company name, job title, or `task_id` if the user gave one directly —
  among `tasks` in the `template_type == "career"` project.
- Find an `applications` row with that `task_id`. If none exists yet, create a draft one first:

```bash
curl -s -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{"user_id":"...","task_id":"...","company":"...","title":"...","job_url":"..."}'
```

- Read the `extracted_text` of **every** `resumes` row for this user with `extraction_status ==
  "ok"` — not just the primary one. Different uploaded versions were written for different target
  roles and each contains real accomplishments/skills the others may have cut for space or framing;
  treat the full set as one pool of real, factual raw material to draw from, so nothing the user
  has ever written about their own experience gets left out of a tailored draft.
  Record whichever single resume most closely matches this job's target role as
  `source_resume_id` (for reference/traceability) — this does not limit which resume's *content*
  you can pull from, only which one gets logged as "the" source.
- Also read `profiles.additional_skills_info` — freeform accomplishments/skills the user wrote
  down that may not appear in any resume file (e.g. a detailed HubSpot accomplishment list). This
  is real, usable material too; pull from it exactly like resume content whenever it's relevant to
  the target role.
- Get the job description text. Check the task's `metadata`/`description` first; if it's not
  there, ask the user for it or fetch the listing page (`metadata.job_url`) via the Chrome tools.
  Never tailor against a job title alone — the whole point is fitting the real listing.

## 2. Draft the materials

Using the combined resume content and the job description:
- **Tailored resume**: real facts pulled from across all the user's resumes, selected and reworded
  to foreground the experience most relevant to this specific role. Do not add employers, titles,
  dates, or numbers that aren't in at least one of the source resumes — reframing/recombining
  existing real facts is the job, never invention.
- **Cover letter draft**: use `profiles.cover_letter_template` as a starting structure if one is
  set, adapted to this company and role.

## 3. Save the draft

```bash
curl -s -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "id": "...",
    "user_id": "...",
    "task_id": "...",
    "company": "...",
    "title": "...",
    "source_resume_id": "...",
    "job_description_text": "...",
    "tailored_resume_text": "...",
    "tailored_cover_letter_text": "..."
  }'
```

Always include `user_id`/`task_id`/`company`/`title` even when updating an existing row — this
endpoint does not COALESCE those fields, so omitting them would null out data already on the row.

## 4. Report back

Tell the user the draft is saved and viewable by opening that task's card → Career Tracker
Details → Application Status & Materials. Remind them to review and edit before using it anywhere
— nothing here has been submitted or sent.

## 5. Recording outcomes (run this anytime, separately from drafting)

When the user tells you what happened with an application (interview scheduled, rejected,
ghosted, offer), update the same record so patterns can be reviewed later:

```bash
curl -s -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{"id":"...","user_id":"...","task_id":"...","company":"...","title":"...","outcome":"interview","outcome_notes":"..."}'
```

Fetch the existing row from `/api/data` first and repost every field you already know alongside
the outcome — same non-COALESCE caveat as above. Never guess an outcome from silence; only set one
when the user explicitly reports it.
