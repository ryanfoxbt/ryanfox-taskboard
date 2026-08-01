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

## 2026-07-29 — Dynatrace, Strategic Marketing Operations Technology Manager (SAP SuccessFactors)

- URL pattern: `career41.sapsf.com/careers?company=<slug>` — the "Apply Today" task's stored
  `job_url` was just this generic company search landing page, not a specific requisition. Had to
  go find the real posting first: `dynatrace.com/careers/jobs/` → use the **Team filter**
  ("Marketing and Communication") rather than the free-text search box, then click through
  See more → Apply now (opens the SuccessFactors form in the same tab, replacing the marketing
  site). If a stored `job_url` 404s or lands on a generic search page, check for a Team/department
  filter on the employer's own careers site before giving up.
- The `dynatrace.com/careers/jobs/` search-box textbox scrambles fast-typed input (e.g. "Marketing"
  came out "Mreig") — looks like a debounced re-render eating keystrokes. Don't fight it; use the
  Team/Location/Seniority dropdown filters instead, they're reliable.
- Cookie consent banner on dynatrace.com reappeared after the first "Reject All" click (likely two
  stacked banner instances); clicking "Reject All" a second time at explicit coordinates cleared it.
- **SuccessFactors requires creating a password-protected candidate account** (Email, Retype Email,
  Choose Password, Retype Password) as part of the same form as the rest of the application —
  there's no guest/quick-apply bypass like JobDiva's. Filled every other field (name, address,
  salary expectations, EEO answers, etc.) but left both password fields blank per the
  never-create-accounts rule, and flagged it in `notes`. Unlike the RemoteHunter case, this wasn't
  a hard stop on the whole form — the account-creation fields are just two blanks embedded in an
  otherwise fully-fillable page, so fill everything else and flag only the password.
- Form quirks: "Salary Expectations" wants a bare number (it auto-formats to `80,000.00`) with
  currency picked separately via a "Currency for Salary Expectations" dropdown — don't put a `$`
  or "base" text in the number field itself. "Country:" (address) and "Country/Region of
  Residence:" are two separate fields with the same value in this case but must be filled
  independently. Gender is a radio-button group (`UL` element) that `form_input` rejects — use
  `find` for the specific "Male"/"Female" radio option and `computer` `left_click` on it instead.
  Race/Veteran Status/Disability are all custom SAP UI5 comboboxes that `form_input` handles fine
  by label text (e.g. "Decline to answer", "I am not a Protected Veteran").
- Resume upload is a custom widget ("Upload a Resume" button opening a dialog), not a plain file
  input — no `RESUME_FILE_PATH` was configured this run so it was left blank and flagged.

## 2026-07-29 — Privy, Remote Marketing Ops Manager (via Monster.com offsite-apply flow)

- URL pattern: `monster.com/profile/apply/upload?applyContext=<base64 JSON>` — reached via a
  Google Jobs listing that routed through Monster rather than the employer's own site. The
  base64 `applyContext` payload decodes to flowType/jobId/redirectUri/jobTitle, confirming this is
  Monster's own "offsite apply" resume-collection step, not Privy's ATS.
  `flowType":"OFFSITE"` in that payload is the tell that Monster will eventually bounce the
  candidate onward rather than host the full application itself.
- **Hard resume-upload gate**: the entire page is "Add Your Resume" (Upload My Resume / Google
  Drive / Dropbox / OneDrive / Build My Resume) with no other fields, no skip link, and no manual
  text-entry fallback. Nothing else on the application is reachable until a file is attached.
  If `RESUME_FILE_PATH` isn't configured, there is nothing to fill — don't fabricate a resume file
  to get past it; log it as a blocker (`status: "draft"`) and leave the tab open on the upload
  step for the user.
- Worth revisiting once `tailor-application` has run for this task: if a tailored resume draft
  exists, the right move is to render it to a file and upload that (better than a generic
  `RESUME_FILE_PATH` static file) rather than just unblocking with the generic resume.
