# Ashby — application form notes

Accumulated opportunistically by the `apply-to-jobs` skill, one entry per run. Don't trust these
blindly — sites change; verify against the live page and update the entry if it's stale.

## 2026-07-23 — Quorum, Marketing Manager, Demand Generation - Strategic & ABM Programs

- URL pattern: the company careers page (`<company>.com/about/careers/?...&ashby_jid=<uuid>`)
  passes the job via an `ashby_jid` query param, but the embedded widget on that page did not
  actually render any job content or open the application (clicking "View Current Openings" just
  changed the URL hash with nothing visible). **Guessed the direct Ashby URL pattern instead:**
  `https://jobs.ashbyhq.com/<company-slug>/<ashby_jid>` — worked immediately, landing on the job's
  Overview tab with a separate "Application" tab alongside it. If a company's own careers page
  embed isn't rendering, try this direct pattern before giving up.
- Unlike the Greenhouse iframe cases, `get_page_text`/`read_page`/`find` **all worked fine** on
  this form — no cross-origin iframe issue. `find` was the fastest way to get a fresh ref for a
  specific field; bulk `read_page` ref numbers seemed to shift across scroll/re-render, so prefer
  re-`find`-ing a field right before filling it rather than reusing refs from an earlier dump.
- No autofill at all on this one — no resume-upload autofill used (no `RESUME_FILE_PATH`
  configured), all fields filled manually via `form_input`.
- **Duplicate/legacy EEO blocks:** this form had gender, race, veteran status, and disability
  status asked **two or three times each**, in different formats — a modern "mark all that apply"
  checkbox version, a "please specify" single-choice radio version, and a legacy compliance-styled
  radio version (separate "Voluntary Self-Identification of Disability" / "Self-Identification of
  Veteran Status" sections with the long OFCCP/VEVRAA legal text). Answer all of them consistently
  from `profiles.eeo_answers` — don't assume filling one covers the others.
- **Hard state-eligibility gate:** the posting listed a specific set of US states it's hiring in
  and asked "Do you currently live in one of these states?" as a Yes/No question. The user's
  actual state (Oregon) was not on the list. Answered honestly (No) rather than guessing/skipping —
  **flag this prominently to the user**, since it likely disqualifies the application outright;
  don't just quietly fill it and move on like a normal field.
- Required free-text screening questions worth grounding carefully rather than guessing broadly:
  "years of experience in X specifically" (e.g. "ABM programs") should be left blank if the
  resumes/profile don't clearly quantify that specific sub-skill, even though a plausible-sounding
  number would be easy to invent — a general "years of experience" field (e.g. total years in
  marketing ops) is not the same claim as "years running ABM programs" specifically.
- "How did you hear about this job?" — answered from the task's own `metadata.source` (how
  `search-jobs` found it), which is the honest, correct source of truth for this question.
- Essay-style "Why do you want to work here?" fields: fine to answer using the user's own real,
  previously-stated preferences (from `profiles.screening_notes`) connected to real facts from the
  job posting — this is legitimate personalization, not invention, as long as no specific false
  claims about familiarity with/motivation for that particular company are fabricated.
