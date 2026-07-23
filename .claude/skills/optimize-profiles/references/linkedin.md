# LinkedIn — profile-editing notes

Accumulated opportunistically by the `optimize-profiles` skill, one entry per run. Don't trust
these blindly — sites change; verify against the live page and update the entry if it's stale.

Note: `apply-to-jobs/references/linkedin.md` covers the **Easy Apply job-application modal** —
different DOM, different page. This file is specifically about editing the profile itself
(headline, About, Skills, Experience, Open To Work).

## 2026-07-23 — full pass (headline, About, Top Skills, add-skill), Ryan Fox profile

- **Headline and About fields are `contenteditable="true"` `<div>`s, not `<textarea>`/`<input>`.**
  `document.querySelector('textarea')` finds nothing. Find them via
  `document.querySelectorAll('[contenteditable="true"]')` and match on `.innerText` containing a
  distinctive substring of the current value.
- **Setting the text**: focus the div, `Range.selectNodeContents(el)` + `Selection.addRange`,
  `document.execCommand('delete', false, null)` to clear, then
  `document.execCommand('insertText', false, newText)` to insert the new value. This is the
  contenteditable equivalent of the native-value-setter trick used for `<textarea>`/`<input>` in
  the apply-to-jobs Easy Apply modal — the native-setter approach does **not** apply here since
  these aren't real form elements. `execCommand` is deprecated but still works in Chrome for this.
  Multi-paragraph text: use a single `\n\n` between paragraphs in the string passed to
  `insertText` — it renders as one blank line between paragraphs in the saved result (don't add
  extra `\n`s expecting more spacing, it doesn't compound the way plain-text templating suggests).
- **Edit URLs are stable and can be navigated to directly**, skipping the need to `find` a pencil
  icon on the live page: `/edit/intro/` (name, pronouns, **headline**, current position, industry,
  education, location), `/edit/forms/summary/new/` (**About** — note this same modal also
  contains the **Top Skills / pinned-skills picker**, see below), `/details/skills/` (full skill
  list + "Add a skill" button), `/skills/edit/forms/new/` (add a brand-new skill).
- **"Top skills" (the 5-item badge shown under About) is edited from inside the About-edit modal**
  (`/edit/forms/summary/new/`), not from the main Skills list page — scroll down inside that same
  modal past the About textarea to find it. Each pinned skill has an `×` to remove; "+ Add skill"
  opens a text input that searches **your existing skill list first** ("Currently in your Skills
  section") and falls back to LinkedIn's global skill taxonomy ("Additional skills") if you type
  something not already on your profile. Max 5 pinned. This is a separate mechanism from the raw
  order of the full 73-skill list on `/details/skills/` — reordering the full list does NOT change
  this badge, and vice versa.
- **The full skill list (`/details/skills/`) is virtualized/lazy-loaded** — only ~10 entries render
  at a time; `get_page_text` only captures what's currently mounted. Scrolling down triggers more
  to load (watch for a spinner). To get the complete list in one shot rather than scrolling
  repeatedly and re-extracting: `Array.from(document.querySelectorAll('main button[aria-label],
  main a[aria-label]')).map(el=>el.getAttribute('aria-label'))` filtered to ones containing "edit"
  — each skill row's edit control has an aria-label like `"Edit HubSpot CRM skill"`, and (unlike
  the visible text) these appear to already be in the DOM even before that row has scrolled into
  view, so this one query got all 73 without needing to finish scrolling first. Worth re-checking
  on a future run whether that holds, since it wasn't verified against a non-lazy-loaded ground
  truth.
- **Adding a brand-new skill not already on the profile**: `/skills/edit/forms/new/` → type in the
  "Skill" search box → LinkedIn only offers its own standardized taxonomy entries as
  autocomplete options, no free-text skills allowed. "Revenue Operations" (spelled out) returned
  no relevant match (`Accounting`, `Hotel Management`, `Revenue Management`) but the abbreviation
  **"RevOps" is itself a standalone standardized skill entry** — search the exact term/acronym a
  target title uses, not just the expanded form, before concluding a concept isn't supported.
- **"Open to Work" job-title targeting is a separate mechanism from headline/About/Skills text**
  search — it's configured via the "Open to Work" card's "Show details" → pencil, with its own
  `Job titles` (free list, not tied to the visible headline) and `Locations` (defaults to a single
  city even if `Location types` includes Remote — a Remote location type does NOT by itself add
  "United States" or similar to the searchable Locations list). Wasn't touched this run per the
  user's own explicit-approval-required rule for visibility settings; still needs a real run to
  document the edit-field mechanics whenever the user says yes to that piece.
- Experience section already reflected a previously-made correction (a stale "Present" end date
  fixed to an actual end date) — i.e. LinkedIn's Experience entries are edited independently of
  everything above and don't auto-sync with resume file updates; whoever/whatever updated it did so
  by hand at the time, not as a side effect of this skill.
