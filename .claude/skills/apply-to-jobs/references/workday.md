# Workday — application form notes

Accumulated opportunistically by the `apply-to-jobs` skill, one entry per run. Don't trust these
blindly — sites change; verify against the live page and update the entry if it's stale.

## 2026-07-23 — Columbia Sportswear Company, Associate Category Manager, Marketing

- URL pattern: `<company>.wd5.myworkdayjobs.com/<tenant>/job/.../<Job-Title>_R-<id>?source=LinkedIn`
  (`wd5` etc. is the Workday pod number, varies by company).
- Reached via LinkedIn's "Apply on company website" (external redirect, new tab), not Easy Apply.
- Clicking the site's own "Apply" button opens a "Start Your Application" modal with three paths:
  "Autofill with Resume", "Apply Manually", "Use My Last Application" (the last one only shows if
  the browser/account has a prior application on file with this Workday tenant).
- **All three paths lead to a "Create Account" step requiring email + a password meeting a
  complexity policy (special/lowercase/numeric/uppercase char, 8+ length) before any job-specific
  form is shown.** Workday accounts are per-tenant (per-company's Workday instance), not a single
  shared Workday login across employers, so a previously-created account on one company's Workday
  site does NOT carry over to another.
- Treat any `myworkdayjobs.com` apply link as a hard stop, same as RemoteHunter-style
  aggregators — do not create the account. Flag for the user to sign up manually, then resume
  once they're logged in.
- Once past the account gate, Workday's "Autofill with Resume" step typically parses the uploaded
  file into several separate editable boxes (summary, per-job work-history entries, a
  "describe your experience"-style prompt, etc.) rather than one single resume text field. If a
  tailored draft exists for this application (see main SKILL.md), fill all of these from the
  tailored resume/cover letter, not the generic profile text — otherwise the parsed/editable
  sections end up telling a different story than the tailored material elsewhere on the form.
