# Other / aggregator platforms — application form notes

Accumulated opportunistically by the `apply-to-jobs` skill, one entry per run. Don't trust these
blindly — sites change; verify against the live page and update the entry if it's stale.

## 2026-07-22 — Pantheon Systems, Inc, Sr. Manager of RevOps - Marketing (via RemoteHunter)

- URL pattern: `remotehunter.com/apply-with-ai/<uuid>?utm_...` — reached via LinkedIn's
  "Apply on company website" link, which opens a new tab/window (not a same-tab navigation).
- Quirk: RemoteHunter is a job-board aggregator, not the employer's own ATS. Its "Apply Now"
  button opens a **"Sign Up & Apply For Free"** modal requiring an account (Google/LinkedIn/
  Facebook OAuth or email+name signup) before any job-specific form is shown.
- Not fillable under the "never create accounts" rule — treat any RemoteHunter (`remotehunter.com`)
  apply link as a hard stop. Flag it for manual application rather than attempting to sign up.

## 2026-07-23 — NTT DATA North America, MarTech Transformation Project Manager (via JobDiva)

- URL pattern: `www1.jobdiva.com/portal/?a=<token>&jobid=<id>#/jobs/<id>?...` — JobDiva is an ATS
  used directly by NTT DATA here (not a third-party aggregator in the RemoteHunter sense).
  `get_page_text`/`read_page`/`find` all worked fine, no iframe issues.
- Clicking "Apply Now" opens a choice modal: **Sign Into My Account / Create an Account + Apply /
  Quick Apply (No Account)**. Always take **Quick Apply (No Account)** on JobDiva — it exists
  specifically to avoid the account-creation gate that would otherwise be a hard stop.
- The quick-apply form itself was minimal: First Name, Last Name, Email, Phone (with an optional
  SMS-consent checkbox — leave unchecked, opting into text messages isn't something to decide on
  the user's behalf), a required Resume upload, and a required "I agree to the Employment Statement
  and Privacy Notice" checkbox.
- **Never check the terms/privacy-notice consent checkbox** — accepting agreements requires the
  user's own explicit action per the standing safety rules this skill operates under, not something
  to tick on their behalf even though the rest of the form is fine to fill mechanically. Leave it
  unchecked and flag it in `notes` alongside the resume-upload gap.
- Read the full job posting text carefully before filling, not just the top-line title match:
  this listing's actual "Required Qualifications" (specific enterprise tools, years of IT PM
  experience) can diverge sharply from what a title-based search match suggests. When the gap is
  large, say so prominently in the application's `notes` rather than quietly filling the simple
  contact form and moving on — a simple quick-apply form being *easy* to fill doesn't mean the
  application is a good use of the user's time.
