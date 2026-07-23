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

## 2026-07-23 — Nametag, GTM Operations Manager

- URL pattern: `job-boards.greenhouse.io/<company>/jobs/<numeric id>` (the newer Greenhouse Job
  Boards product, distinct from the embedded-iframe `?gh_jid=` pattern on a company's own site).
  `get_page_text` **worked fine** here (unlike the Pantheon iframe case) — but the actual form
  fields still didn't show up via `read_page`/`find` refs, so still use `computer` (coordinates)
  + screenshots to fill it, even when `get_page_text` can read the static content.
- A logged-in **MyGreenhouse** account (separate from RemoteHunter) auto-fills this style of form
  too: First Name, Last Name, Preferred First Name, Email, Phone, Resume/CV file, and LinkedIn
  Profile were all correctly pre-filled on page load, with a dismissible "Autofilled from
  MyGreenhouse" banner. Still verify every field rather than trusting the banner blindly.
- **Country dropdown next to Phone is the phone country code, not residence** (same as the
  Pantheon case) — it was left blank by the MyGreenhouse autofill even though Phone was filled.
  It's a `<select>`-style dropdown here (not the Pantheon iframe's type-to-filter combobox):
  clicking it opens a list with "United States +1" already at/near the top — just click it.
- Simple version of this form has no EEO/demographic section and no work-authorization/sponsorship
  question at all — don't assume every Greenhouse form has one, check each one on its own.
- Cover Letter is optional and file-upload only here (Attach/Dropbox/Google Drive/"Enter manually"
  — no plain paste-a-text-box option shown by default). `profiles.cover_letter_template` on file
  is a fully-written letter for a *specific* past job/hiring manager, not a generic template —
  never paste it verbatim into a new application; either adapt it first (tailor-application) or
  leave the field blank if it's optional, which is what happened this run.
