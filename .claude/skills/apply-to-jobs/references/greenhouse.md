# Greenhouse — application form notes

Accumulated opportunistically by the `apply-to-jobs` skill, one entry per run. Don't trust these
blindly — sites change; verify against the live page and update the entry if it's stale.

## 2026-07-23 — Pantheon Systems, Inc, Sr. Manager of RevOps - Marketing

- URL pattern: embedded on the company's own careers page, `?gh_jid=<numeric id>` query param
  gives it away (e.g. `pantheon.io/about/careers/detail?gh_jid=8075768`). The form itself renders
  inside what appears to be a cross-origin iframe: `get_page_text` and `read_page`/`find` on the
  top-level tab return nothing useful for it. **Use `computer` (click by coordinate + type) and
  verify with screenshots** rather than relying on `find`/`read_page` refs for these forms.
- Standard fields, in order: First Name, Last Name, Email, Country (this is the **phone country
  code**, not residence country — a flag+dial-code combobox, separate from Location), Phone,
  Location (City) (free-text combobox with autocomplete, e.g. "Portland, Oregon, United States"),
  Resume/CV (Attach / Dropbox / Enter manually), Cover Letter (optional), LinkedIn Profile,
  Website, a company-specific work-authorization/sponsorship question, and a required "How did
  you hear about us?" free-text field.
- The "Country" combobox and Location combobox are **type-to-filter comboboxes**, not native
  `<select>`s: click the field, type text, a filtered list appears below, click the match. Typing
  and expecting an immediate value-set (like a native select) does not work.
- Below the main form: a standard EEO/voluntary self-identification block (Gender, Hispanic/
  Latino, Race [only shown if Hispanic/Latino answer isn't "Decline to Self Identify"], Veteran
  Status per VEVRAA, and a separate CC-305 Disability Status section). All of these are
  type-to-filter comboboxes with a "Decline to self identify" / "I don't wish to answer" / "I do
  not want to answer" option (wording varies slightly by section) — always available.

### Reached via RemoteHunter (job-board aggregator) — important autofill caveat

- Once logged into a RemoteHunter account, clicking "Apply Now" offers "Proceed to Application"
  (goes straight to the real employer/Greenhouse form) vs. their own "Analyze Resume Match" funnel.
  Use "Proceed to Application" — it's the real form.
- **RemoteHunter (or the browser's saved Greenhouse/"MyGreenhouse" account) auto-filled name,
  email, phone, location, resume file, LinkedIn, and website correctly — but it also auto-filled
  the EEO/demographic questions with GUESSED values (Gender: Male, Hispanic/Latino: No, Race:
  White, Veteran Status: not a veteran, Disability: no disability) that were never provided by the
  user.** These must always be checked and overwritten with the profile's actual `eeo_answers`
  (which default to "decline to answer") before considering the form ready for review. Never trust
  a platform's own autofill for EEO fields — always verify explicitly, every time.
