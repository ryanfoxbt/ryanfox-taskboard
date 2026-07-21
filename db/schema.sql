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
    is_deleted BOOLEAN DEFAULT FALSE
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
    is_deleted BOOLEAN DEFAULT FALSE
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
