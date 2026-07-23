---
name: suggest-roles
description: Read the user's uploaded resumes and profile, suggest adjacent job roles they're likely qualified for, and persist the suggestions so they show up in the app's Profile modal.
---

# Suggest Adjacent Roles → Profile Modal

Reads the resumes uploaded in **My Application Profile → Resume & Answers**, reasons about what
other job titles the user's real experience would also support, and saves the results back to the
app so they're visible without a chat session — not a one-off answer that disappears. This is
manually triggered (run it whenever the user wants a fresh pass, e.g. after uploading a new resume
version), not scheduled automation.

- **App account email:** ryanfoxbt@gmail.com
- **App URL:** http://localhost:3000 (swap for the production URL once this is deployed)

## 1. Load context

```bash
curl -s http://localhost:3000/api/data
```

From the response:
- Find the user with `email == "ryanfoxbt@gmail.com"` in `users` → this is `user_id`.
- Find `resumes` rows for this `user_id` where `extraction_status == "ok"`. If none exist, stop
  and tell the user to upload a resume (.docx) via **My Application Profile → Resume & Answers**
  first — don't guess at their background from anywhere else.
- Read the `extracted_text` of **every** matching resume, not just the primary one — different
  versions were written for different target roles and each surfaces different accomplishments,
  so the full set is the raw material for spotting adjacency. Treat the `is_primary` one as the
  most current/central version if you need a tiebreaker, but don't skip the others.
- Read the matching `profiles` row too (`current_title`, `years_experience`, `screening_notes`,
  `additional_skills_info`) for extra context alongside the resume text. `additional_skills_info`
  is freeform notes on skills/accomplishments the user wrote down that may not appear in any
  resume file (e.g. a detailed HubSpot accomplishment list) — treat it as equally real raw
  material, not a lesser source than the resumes.
- Find the project with `template_type == "career"` and read its `settings` (`titles`, `industry`)
  — these are the roles the user is *already* targeting; the point of this skill is to surface
  roles *beyond* that list, not repeat it.
- Read existing `role_suggestions` for this `user_id` so you don't spend effort re-reasoning about
  a title already suggested (the endpoint also dedupes server-side by title, but check first).

## 2. Analyze

Read the resume text and `additional_skills_info` together like a recruiter doing a skills-adjacency
pass: what transferable skills,
tools, scope of responsibility, and outcomes would also map onto a *different* job title than the
one the resume was written for? For each adjacent role:
- Write one sentence of concrete rationale tied to specific resume content (a tool used, a metric
  hit, a scope of ownership) — never a generic "you have relevant experience."
- Favor roles that are a genuine stretch-but-plausible fit, not just synonyms of the current title.

Suggest 3-6 roles. Stop there rather than padding the list with weak fits.

## 3. Persist suggestions

```bash
curl -s -X POST http://localhost:3000/api/role-suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "...",
    "suggestions": [
      { "suggested_title": "Product Manager", "rationale": "...", "source_resume_id": "..." }
    ]
  }'
```

The endpoint dedupes by lowercased title and returns `{ inserted, skipped }` — safe to re-run.

## 4. Report back

List each suggestion in chat (title + one-line rationale), and tell the user it's now visible in
**My Application Profile → Resume & Answers**, where they can mark each one "Interested" or
"Not a fit."
