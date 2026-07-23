---
name: optimize-profiles
description: Draft recruiter-facing optimizations (headline, About, Skills, Experience, Open To Work) for the user's LinkedIn profile — and other job-site profiles over time — from the stored Application Profile and resumes, then apply them via Claude-in-Chrome only after the user approves the exact text.
---

# Optimize Profiles → Recruiter Searchability Pass

Reads everything in **My Application Profile** (profile fields, every uploaded resume,
`additional_skills_info`, the Career board's target titles) and drafts recruiter-optimized text
for a job-site profile, starting with LinkedIn. Other platforms (e.g. Indeed, Ziprecruiter) get
their own `references/<platform>.md` note file the same way `apply-to-jobs` handles multiple ATS
platforms — add support for a new one when the user asks, following the same draft → approve →
apply flow. This is manually triggered (run it after a resume update or a shift in target titles),
not scheduled automation.

- **App account email:** ryanfoxbt@gmail.com
- **App URL:** http://localhost:3000 (swap for the production URL once this is deployed)
- **Non-negotiable rule:** a public profile edit is seen by the user's entire network and by
  recruiters immediately — treat every section like `apply-to-jobs` treats a submit button. Never
  click a final "Save"/"Done"/"Apply" control on any profile-editing UI until you have shown the
  **exact text** for that section in chat and the user has explicitly approved it. Draft first,
  apply second, never combined into one step.
- **Never touch visibility/notification settings** (e.g. "Open to Work" public sharing, "notify
  network of profile changes") without calling them out and getting explicit go-ahead separately —
  these have social consequences (current employer visibility) beyond the text itself.
- **Never fabricate** employers, titles, dates, or metrics not traceable to a stored resume or
  `additional_skills_info`. Reframing and recombining real content for keyword coverage is the
  job; invention is not — same rule `tailor-application` follows.

## 1. Load context

```bash
curl -s http://localhost:3000/api/data
```

From the response:
- Find the user with `email == "ryanfoxbt@gmail.com"` in `users` → this is `user_id`.
- Find `profiles` row where `user_id` matches. If missing `resume_text`, stop and tell the user to
  fill in **My Application Profile** first.
- Read the `extracted_text` of **every** `resumes` row for this user with `extraction_status ==
  "ok"`, not just the primary one — each version emphasizes different real accomplishments and all
  of it is fair material for keyword coverage.
- Read `profiles.additional_skills_info` in full and check it for **corrections** to the resume
  text (e.g. an "EMPLOYMENT UPDATE" note that a job has since ended) as well as additions — use the
  corrected version, never the stale one.
- Read `role_suggestions` for this `user_id` with `status == "interested"` — these are adjacent
  titles worth weaving into keyword coverage alongside the primary target titles.
- Find the project with `template_type == "career"` and read `settings.titles` / `settings.industry`
  / `settings.location` — the primary target titles and constraints the optimization should aim at.

## 2. Read the live profile before drafting anything

Load Chrome tools:

```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__tabs_create_mcp
```

Open `profiles.linkedin_url` in a **new tab**. Read the current Headline, About, Top Skills /
Skills section, and each Experience entry's title/dates/description. This is a diff against the
current live profile, not a from-scratch rewrite — preserve anything already strong and change
what's actually weak or missing, so the user can see clearly what moved and why.

## 3. Draft the optimizations

Recruiters searching LinkedIn (Recruiter seats and free search alike) match primarily on
**Headline, About, Skills, and Experience title/description text** — in roughly that order of
weight. For each section, draft text using only real material from step 1:

- **Headline** (220 char limit): front-load the exact target titles from `settings.titles` and the
  highest-signal tools (e.g. HubSpot, Salesforce, RevOps, Marketing Automation, SQL) — recruiters
  often search exact title/tool strings, so near-verbatim matches to `settings.titles` beat clever
  phrasing. Avoid empty buzzwords ("results-driven", "passionate") that add no search signal.
- **About**: 3-5 short paragraphs, first person, keyword-dense but readable — lead with the
  strongest 0-to-1 story (e.g. a platform built from scratch) and quantified outcomes, then a tools
  paragraph naming the full stack, then what the person is looking for next (tied to the target
  titles). Pull from `resume_text` summaries and `additional_skills_info` accomplishment write-ups
  equally.
- **Skills** (LinkedIn supports pinning up to 3 "Top Skills" plus a longer list): order so the
  target-title-matching tools/skills are first and pinned. Pull the full candidate list from every
  resume's "Core Skills"-equivalent section plus `additional_skills_info`, then prioritize by
  relevance to `settings.titles` and the `interested` role suggestions.
- **Experience**: for each role, rewrite the description to mirror the strongest bullets across all
  resumes for that employer (not just the one primary resume), fix any stale end dates per
  `additional_skills_info` corrections, and make sure the job title used is recruiter-searchable
  (matches how the role is commonly titled in postings, not just the internal title if they differ).
- **Open To Work**: check whether it's already set; if not, propose the target titles/locations
  from `settings` for it, but flag this separately per the visibility rule above rather than
  bundling it into the text-content approval.

## 4. Present drafts for approval

Show each section's proposed final text in chat, next to a one-line note on what changed and why
(e.g. "Headline: added 'RevOps' and 'HubSpot Expert' — both are exact strings in your target
titles/skills but weren't in the current headline"). Wait for the user to approve, edit, or reject
each section individually before touching the live page. Do not proceed to step 5 for any section
that hasn't been explicitly approved as-is or with edits.

## 5. Apply approved changes

For each approved section, open its edit UI on the live profile and enter the approved text
exactly. Check `references/linkedin.md` first for known quirks from prior runs (e.g. whether
`computer` `type` drops characters in a given field — `apply-to-jobs/references/linkedin.md`
documents this happening in the Easy Apply modal's long text areas; if the profile-edit fields
show the same behavior, use `javascript_tool` with the native value setter + `input`/`change`
events instead, same pattern). Save only that section, then move to the next. Never touch a
section the user didn't approve.

Append what you learned this run to `references/linkedin.md` (selectors, modal structure, char
limits actually enforced, anything that silently failed to save).

## 6. Report back

Summarize what was changed (section by section), what was proposed but rejected/edited by the
user, and anything skipped because it needs manual attention (e.g. a LinkedIn feature that
required a login/security-checkpoint interruption). Remind the user to glance at the live profile
once to confirm it renders as expected.

## Adding a new platform

When the user asks to extend this to another job site (Indeed, ZipRecruiter, etc.):
1. Create `references/<platform>.md` from `references/_template.md`.
2. Steps 1, 3, and 4 above are platform-agnostic — reuse them as-is.
3. Steps 2 and 5 are platform-specific (different edit UI, different field names/limits) — work
   out the live-page mechanics the first time and record them in the new reference file so later
   runs are faster.
