# LinkedIn — application form notes

Accumulated opportunistically by the `apply-to-jobs` skill, one entry per run. Don't trust these
blindly — sites change; verify against the live page and update the entry if it's stale.

## 2026-07-22 — link rot on stored job_url values

- Two of three "Apply Today" tasks had `linkedin.com/jobs/view/<id>/` URLs that no longer matched
  what the task expected:
  - One resolved to a completely different, unrelated job posting (different company/title) —
    LinkedIn appears to reuse/reassign job ids once the original listing closes, rather than
    always showing "removed".
  - One returned LinkedIn's "Job id provided may not be valid or the job posting has been
    removed" page.
- Lesson: before filling anything, always confirm the loaded page's title/company actually matches
  the task's stored `metadata.company`/title. If it doesn't match, or the listing is gone, do not
  apply — flag it instead. LinkedIn job URLs seem to have a fairly short shelf life (these were
  only ~1-2 days old per the `search-jobs` ingest), so a same-day or next-day apply pass is safer
  than letting "Apply Today" items sit for long.
- "Apply on company website" links (as opposed to "Easy Apply") open in a **new browser tab**, not
  the current one — the first click target (a hidden/duplicate `<a>` matched by `find`) didn't
  register; clicking the visible button by coordinate did.

## 2026-07-23 — Easy Apply flow (JazzHR-backed), Active Minds, Inc.

- "Easy Apply" jobs stay entirely inside a LinkedIn modal (`Apply to <Company>`), paged (e.g.
  "1/4 pages", "2/4 pages" shown top-right). Unlike an external ATS iframe, `read_page`/`find`
  work fine here since it's LinkedIn's own DOM, not cross-origin.
- Typical page structure: (1) Contact info — pre-filled from the LinkedIn profile, rarely needs
  changes; (2) Resume selection from a list of every resume ever uploaded to the LinkedIn account,
  radio-button style, with the most recently uploaded one pre-selected by default (verify the date
  — don't assume the top-of-list visual position is the default; scroll to find the one with the
  green checkmark); (3) "Additional Questions" — employer-custom questions, can include free-text
  essays, Yes/No dropdowns, and a required LinkedIn URL field; (4) final review/submit page.
- **The `computer` `type` action drops characters on long strings in this modal** (observed
  consistently, roughly 1 dropped character per 15-20 typed, even when typed in short chunks with
  separate tool calls). Do not trust it for essay-length answers. Instead, load
  `javascript_tool` and set the value directly on the DOM node with the native value setter +
  dispatch `input`/`change` events (React-controlled fields need both events to register the
  change), e.g.:
  ```js
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
  ```
  Match the target textarea/select by its `aria-label` (or associated `<label>` text) containing
  a distinctive substring of the question. For `<select>`, set `.value` to the matching option's
  `value` after finding it by option text, then dispatch `change`.
- Custom employer questions can include things no profile should ever guess at: a "what are your
  pronouns / how do you pronounce your name" question, a "why do you want to work here" essay, and
  a salary-range confirmation. Always cross-check a salary confirmation question against the
  profile's `desired_salary` — if the posted range doesn't clear it, leave the field blank and
  surface the conflict rather than answering "yes" on the candidate's behalf.
