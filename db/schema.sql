-- Can Even (ryanfox-taskboard) schema
-- Derived from queries in api/index.js — no prior schema file existed in the repo.
-- No foreign keys: the app's own insert ordering doesn't guarantee referenced rows
-- exist yet (e.g. POST /workspaces sets owner_id before the user row is created),
-- so referential integrity is handled at the app layer, not the DB layer.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    email TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    owner_id UUID,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID,
    name TEXT,
    is_secret BOOLEAN DEFAULT FALSE,
    owner_id UUID,
    is_deleted BOOLEAN DEFAULT FALSE,
    template_type TEXT,
    settings JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID,
    parent_task_id UUID,
    title TEXT,
    description TEXT,
    status TEXT,
    urgency TEXT,
    due_date TIMESTAMPTZ,
    counter INTEGER,
    timer_running BOOLEAN,
    timer_started_at TIMESTAMPTZ,
    timer_elapsed BIGINT,
    completed_at TIMESTAMPTZ,
    creator_id UUID,
    recurring_type TEXT DEFAULT 'habit',
    is_deleted BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID,
    user_id UUID,
    role TEXT,
    preferences JSONB,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_assignees (
    task_id UUID,
    user_id UUID,
    PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    workspace_id UUID,
    project_id UUID,
    task_id UUID,
    duration_ms BIGINT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_repetitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID,
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID,
    project_id UUID,
    task_id UUID,
    user_id UUID,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    type TEXT,
    title TEXT,
    description TEXT
);

-- Job-application autofill data: one profile per user (personal/contact info,
-- work authorization, resume text) used to fill out ATS forms (Greenhouse, Ashby,
-- Gem, LinkedIn, etc.), plus a tracker for individual application attempts.
CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY,
    full_name TEXT,
    preferred_name TEXT,
    email TEXT,
    phone TEXT,
    address_line1 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT,
    linkedin_url TEXT,
    github_url TEXT,
    portfolio_url TEXT,
    work_authorization TEXT,
    needs_sponsorship BOOLEAN,
    willing_to_relocate BOOLEAN,
    desired_salary TEXT,
    earliest_start_date DATE,
    current_employer TEXT,
    current_title TEXT,
    years_experience NUMERIC,
    resume_text TEXT,
    cover_letter_template TEXT,
    screening_notes TEXT,
    additional_skills_info TEXT,
    eeo_answers JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    task_id UUID,
    company TEXT,
    title TEXT,
    job_url TEXT,
    ats_platform TEXT,
    status TEXT DEFAULT 'draft',
    applied_at TIMESTAMPTZ,
    form_snapshot JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Uploaded resume files (PDF/DOCX), stored with server-extracted plain text
-- so skills can read them without decoding the binary. is_primary marks the
-- default resume for skills/autofill to prefer when several are on file.
CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    label TEXT,
    filename TEXT,
    mime_type TEXT,
    file_size_bytes INTEGER,
    file_data BYTEA,
    extracted_text TEXT,
    extraction_status TEXT DEFAULT 'pending',
    extraction_error TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Adjacent-role ideas surfaced by the suggest-roles skill from resume content
-- (a role type the user may be qualified for, not tied to a specific listing).
CREATE TABLE IF NOT EXISTS role_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    suggested_title TEXT NOT NULL,
    rationale TEXT,
    source_resume_id UUID,
    status TEXT DEFAULT 'new',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Migrations for databases created before these columns existed.
-- CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so new
-- columns need an explicit ALTER for pre-existing installs.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- source_resume_id/job_description_text/tailored_*: what the tailor-application
-- skill drafts and saves for review. outcome/outcome_notes/outcome_updated_at
-- are a separate axis from `status` (fill/submit workflow) - outcome tracks what
-- happened after submission (interview/offer/rejected/ghosted), reported by the
-- user and never guessed, so patterns across applications can be reviewed later.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source_resume_id UUID;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS job_description_text TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_resume_text TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_cover_letter_text TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome_notes TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome_updated_at TIMESTAMPTZ;

-- Freeform accomplishments/skills not captured in any uploaded resume (e.g. a
-- tool-specific accomplishment list) - extra raw material for tailoring and
-- role-suggestion skills alongside resume text, so nothing gets left out just
-- because it never made it into a resume file.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS additional_skills_info TEXT;
