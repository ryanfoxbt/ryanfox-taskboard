const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Resend } = require('resend');
const { createClerkClient, verifyToken } = require('@clerk/backend');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { require: true, rejectUnauthorized: false }
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const clerkClient = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null;

// Verifies the caller's Clerk session token server-side and resolves it to a row in
// `users` (by verified email -- never trusted from the request body). Every /api/*
// route that touches user- or workspace-scoped data goes through this, because without
// it any client can claim to be anyone (or no one) and the route handlers below have no
// other way to know who's actually asking.
//
// req.authUserId is null when the token is valid but no `users` row exists yet -- this
// is expected for a brand-new sign-up's very first request, before their account row is
// created. Routes that allow that bootstrap case check for it explicitly; everything
// else should treat a null authUserId as "not a member of anything".
async function requireAuth(req, res, next) {
    if (!clerkClient) return res.status(500).json({ error: 'Auth not configured' });
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'Missing authorization token' });

        const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
        const clerkUser = await clerkClient.users.getUser(payload.sub);
        const email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;
        if (!email) return res.status(403).json({ error: 'Forbidden' });

        const { rows } = await pool.query('SELECT id, is_super_admin FROM users WHERE email = $1', [email]);
        req.authEmail = email;
        req.authUserId = rows[0] ? rows[0].id : null;
        req.authIsSuperAdmin = !!(rows[0] && rows[0].is_super_admin);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Gates the marketing-page CMS write endpoint. Chain after requireAuth.
function requireSuperAdmin(req, res, next) {
    if (!req.authIsSuperAdmin) return res.status(403).json({ error: 'Forbidden' });
    next();
}

// True if `userId` is a member of `workspaceId`. Used to authorize every write that
// targets a specific workspace/project/task instead of trusting the client-supplied id.
async function isWorkspaceMember(userId, workspaceId) {
    if (!userId || !workspaceId) return false;
    const { rows } = await pool.query(
        'SELECT 1 FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]
    );
    return rows.length > 0;
}

// True if `userId` is an Admin-role member of `workspaceId`. Used to gate posting/
// clearing that workspace's announcement banner.
async function isWorkspaceAdmin(userId, workspaceId) {
    if (!userId || !workspaceId) return false;
    const { rows } = await pool.query(
        `SELECT 1 FROM workspace_members WHERE user_id = $1 AND workspace_id = $2 AND role = 'Admin'`,
        [userId, workspaceId]
    );
    return rows.length > 0;
}

// True if `userId` belongs to the workspace that owns `taskId` (via its project).
async function isTaskInUsersWorkspace(userId, taskId) {
    if (!userId || !taskId) return false;
    const { rows } = await pool.query(
        `SELECT 1 FROM tasks t
         JOIN projects p ON p.id = t.project_id
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
         WHERE t.id = $1 AND wm.user_id = $2`, [taskId, userId]
    );
    return rows.length > 0;
}

const defaultPrefs = JSON.stringify({
    projectOrder: [], uiSize: 'auto', notifyAllWorkspaces: true,
    displayConfig: { showDate: true, showUrgency: true, showDesc: true, showAssignee: true }
});

// 1. GET ALL DATA -- scoped to the caller's own workspaces. A brand-new sign-up with no
// `users` row yet (authUserId null) gets empty arrays back, which is what
// bootAuthenticatedUser already expects before it provisions their first workspace.
app.get('/api/data', requireAuth, async (req, res) => {
    try {
        const userId = req.authUserId;
        const memberships = userId
            ? await pool.query('SELECT workspace_id FROM workspace_members WHERE user_id = $1', [userId])
            : { rows: [] };
        const workspaceIds = memberships.rows.map(r => r.workspace_id);

        const workspaces = await pool.query('SELECT * FROM workspaces WHERE id = ANY($1) AND is_deleted IS NOT TRUE', [workspaceIds]);
        const projects = await pool.query('SELECT * FROM projects WHERE workspace_id = ANY($1) AND is_deleted IS NOT TRUE', [workspaceIds]);
        const tasks = await pool.query(
            `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
             WHERE p.workspace_id = ANY($1) AND t.is_deleted IS NOT TRUE`, [workspaceIds]);

        const users = await pool.query(
            `SELECT DISTINCT u.* FROM users u JOIN workspace_members wm ON wm.user_id = u.id
             WHERE wm.workspace_id = ANY($1)`, [workspaceIds]);
        const workspace_members = await pool.query('SELECT * FROM workspace_members WHERE workspace_id = ANY($1)', [workspaceIds]);
        const task_assignees = await pool.query(
            `SELECT ta.* FROM task_assignees ta
             JOIN tasks t ON t.id = ta.task_id JOIN projects p ON p.id = t.project_id
             WHERE p.workspace_id = ANY($1)`, [workspaceIds]);
        const time_logs = await pool.query('SELECT * FROM time_logs WHERE workspace_id = ANY($1)', [workspaceIds]);
        const task_repetitions = await pool.query(
            `SELECT tr.* FROM task_repetitions tr
             JOIN tasks t ON t.id = tr.task_id JOIN projects p ON p.id = t.project_id
             WHERE p.workspace_id = ANY($1)`, [workspaceIds]);
        const comments = await pool.query('SELECT * FROM comments WHERE workspace_id = ANY($1) ORDER BY created_at ASC', [workspaceIds]);
        // Notifications are per-user, not per-workspace -- always scope to the caller only.
        const notifications = userId
            ? await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC', [userId])
            : { rows: [] };

        res.json({
            workspaces: workspaces.rows, projects: projects.rows, tasks: tasks.rows,
            users: users.rows, workspace_members: workspace_members.rows,
            task_assignees: task_assignees.rows, time_logs: time_logs.rows,
            task_repetitions: task_repetitions.rows, comments: comments.rows,
            notifications: notifications.rows
        });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch data' }); }
});

// 2. TASKS & ASSIGNEES
app.post('/api/tasks', requireAuth, async (req, res) => {
    const {
        id, project_id, parent_task_id, title, description, status, urgency, due_date, assignees,
        counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id, recurring_type,
        actor_id
    } = req.body; // <-- Added recurring_type

    const projectMember = await pool.query(
        `SELECT 1 FROM projects p JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
         WHERE p.id = $1 AND wm.user_id = $2`, [project_id, req.authUserId]
    );
    if (projectMember.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `INSERT INTO tasks (
                id, project_id, parent_task_id, title, description, status, urgency, due_date,
                counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id, recurring_type
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (id) DO UPDATE SET 
                project_id = $2, parent_task_id = $3, title = $4, description = $5, 
                status = $6, urgency = $7, due_date = $8, counter = $9, 
                timer_running = $10, timer_started_at = $11, timer_elapsed = $12,
                completed_at = $13, creator_id = $14, recurring_type = $15`, 
            [
                id, project_id, parent_task_id || null, title || null, 
                description !== undefined ? description : null, status || null, 
                urgency || null, due_date || null,
                counter !== undefined ? counter : null, timer_running !== undefined ? timer_running : null, 
                timer_started_at !== undefined ? timer_started_at : null, timer_elapsed !== undefined ? timer_elapsed : null,
                completed_at !== undefined ? completed_at : null, creator_id || null, recurring_type || 'habit'
            ]
        );
        
        if (assignees !== undefined) {
            const existing = await client.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [id]);
            const existingIds = new Set(existing.rows.map(r => r.user_id));

            await client.query('DELETE FROM task_assignees WHERE task_id = $1', [id]);
            if (assignees && assignees.length > 0) {
                for (let userId of assignees) {
                    await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
                }
            }

            // Notify newly-added assignees (not the person doing the assigning) that they were assigned.
            if (actor_id && assignees && assignees.length > 0) {
                const newlyAssigned = assignees.filter(userId => userId !== actor_id && !existingIds.has(userId));
                for (const userId of newlyAssigned) {
                    await client.query(
                        `INSERT INTO notifications (user_id, actor_id, task_id, task_title) VALUES ($1, $2, $3, $4)`,
                        [userId, actor_id, id, title || null]
                    );
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: err.message }); 
    } finally { client.release(); }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        if (!(await isTaskInUsersWorkspace(req.authUserId, req.params.id))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await pool.query('UPDATE tasks SET is_deleted = true WHERE id = $1 OR parent_task_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2b. NOTIFICATIONS
app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.authUserId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.authUserId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. TIME LOGS & REPETITIONS
app.post('/api/time_logs', requireAuth, async (req, res) => {
    const { id, user_id, workspace_id, project_id, task_id, duration_ms, created_at } = req.body;
    try {
        if (!(await isWorkspaceMember(req.authUserId, workspace_id))) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(
            `INSERT INTO time_logs (id, user_id, workspace_id, project_id, task_id, duration_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, user_id, workspace_id, project_id, task_id, duration_ms, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/repetitions', requireAuth, async (req, res) => {
    const { id, task_id, user_id, created_at } = req.body;
    try {
        if (!(await isTaskInUsersWorkspace(req.authUserId, task_id))) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(
            `INSERT INTO task_repetitions (id, task_id, user_id, created_at) VALUES ($1, $2, $3, $4)`,
            [id, task_id, user_id, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 4. COMMENTS ENGINE (CREATE, EDIT, DELETE)
app.post('/api/comments', requireAuth, async (req, res) => {
    const { id, workspace_id, project_id, task_id, user_id, content, created_at } = req.body;
    try {
        if (!(await isWorkspaceMember(req.authUserId, workspace_id))) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(
            `INSERT INTO comments (id, workspace_id, project_id, task_id, user_id, content, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, workspace_id, project_id || null, task_id || null, user_id, content, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Edit/delete are author-only, matching the UI (which only ever shows these controls to
// the comment's own author -- see renderTaskComments/renderProjectComments in app.js).
app.put('/api/comments/:id', requireAuth, async (req, res) => {
    const { content } = req.body;
    try {
        const existing = await pool.query('SELECT user_id FROM comments WHERE id = $1', [req.params.id]);
        if (!existing.rows[0] || existing.rows[0].user_id !== req.authUserId) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(`UPDATE comments SET content = $1 WHERE id = $2`, [content, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/comments/:id', requireAuth, async (req, res) => {
    try {
        const existing = await pool.query('SELECT user_id FROM comments WHERE id = $1', [req.params.id]);
        if (!existing.rows[0] || existing.rows[0].user_id !== req.authUserId) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(`DELETE FROM comments WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 5. FEEDBACK
app.post('/api/feedback', requireAuth, async (req, res) => {
    const { id, type, title, description } = req.body;
    try {
        await pool.query(`INSERT INTO feedback (id, user_id, type, title, description) VALUES ($1, $2, $3, $4, $5)`, [id, req.authUserId, type, title, description]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 6. PROJECTS
app.post('/api/projects', requireAuth, async (req, res) => {
    const { id, workspace_id, name, isSecret, owner_id } = req.body;
    try {
        // Renaming an existing project must be authorized against its actual workspace,
        // not whatever workspace_id the client happened to send.
        const existing = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [id]);
        const targetWorkspaceId = existing.rows[0] ? existing.rows[0].workspace_id : workspace_id;
        if (!(await isWorkspaceMember(req.authUserId, targetWorkspaceId))) return res.status(403).json({ error: 'Forbidden' });

        await pool.query(
            `INSERT INTO projects (id, workspace_id, name, is_secret, owner_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4`,
            [id, workspace_id, name, isSecret || false, owner_id || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const existing = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [req.params.id]);
        if (!existing.rows[0] || !(await isWorkspaceMember(req.authUserId, existing.rows[0].workspace_id))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (err) { return res.status(500).json({ error: err.message }); }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE projects SET is_deleted = true WHERE id = $1', [req.params.id]);
        await client.query('UPDATE tasks SET is_deleted = true WHERE project_id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// 7. WORKSPACES
app.post('/api/workspaces', requireAuth, async (req, res) => {
    const { id, name, userId, owner_id } = req.body;

    // Renaming an existing workspace requires membership. Creating a brand new one (the
    // self sign-up bootstrap and "new workspace" flows) has no prior membership to check
    // by definition, so it's allowed for any authenticated caller.
    try {
        const existing = await pool.query('SELECT id FROM workspaces WHERE id = $1', [id]);
        if (existing.rows[0] && !(await isWorkspaceMember(req.authUserId, id))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (err) { return res.status(500).json({ error: err.message }); }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2',
            [id, name, owner_id || userId]
        );
        if (userId) {
            await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, 'Admin', $3) ON CONFLICT DO NOTHING`, [id, userId, defaultPrefs]);
            await client.query(`INSERT INTO projects (id, workspace_id, name, owner_id) VALUES (gen_random_uuid(), $1, 'My Project', $2)`, [id, owner_id || userId]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.delete('/api/workspaces/:id', requireAuth, async (req, res) => {
    try {
        const ws = await pool.query('SELECT owner_id FROM workspaces WHERE id = $1', [req.params.id]);
        const isOwner = ws.rows[0] && (!ws.rows[0].owner_id || ws.rows[0].owner_id === req.authUserId);
        if (!ws.rows[0] || !isOwner || !(await isWorkspaceMember(req.authUserId, req.params.id))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (err) { return res.status(500).json({ error: err.message }); }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE workspaces SET is_deleted = true WHERE id = $1', [req.params.id]);
        await client.query('UPDATE projects SET is_deleted = true WHERE workspace_id = $1', [req.params.id]);
        await client.query('UPDATE tasks SET is_deleted = true WHERE project_id IN (SELECT id FROM projects WHERE workspace_id = $1)', [req.params.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

// 7b. WORKSPACE ANNOUNCEMENTS -- a single current banner per workspace (Admin-only),
// shown only to members actively viewing that workspace (see GET /api/data + app.js).
app.post('/api/workspaces/:id/announcement', requireAuth, async (req, res) => {
    const { content } = req.body;
    try {
        if (!(await isWorkspaceAdmin(req.authUserId, req.params.id))) return res.status(403).json({ error: 'Forbidden' });
        const trimmed = String(content || '').trim().slice(0, 2000);
        if (!trimmed) return res.status(400).json({ error: 'Announcement content is required' });

        await pool.query(
            `UPDATE workspaces SET announcement_id = gen_random_uuid(), announcement_content = $1,
             announcement_author_id = $2, announcement_created_at = now() WHERE id = $3`,
            [trimmed, req.authUserId, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workspaces/:id/announcement', requireAuth, async (req, res) => {
    try {
        if (!(await isWorkspaceAdmin(req.authUserId, req.params.id))) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(
            `UPDATE workspaces SET announcement_id = NULL, announcement_content = NULL,
             announcement_author_id = NULL, announcement_created_at = NULL WHERE id = $1`,
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. CMS CONTENT (marketing pages)
app.get('/api/cms/:pageSlug', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT element_key, content FROM cms_content WHERE page_slug = $1', [req.params.pageSlug]
        );
        const map = {};
        rows.forEach(r => { map[r.element_key] = r.content; });
        res.json(map);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/cms/:pageSlug/:elementKey', requireAuth, requireSuperAdmin, async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query(
            `INSERT INTO cms_content (page_slug, element_key, content, updated_at, updated_by)
             VALUES ($1, $2, $3, now(), $4)
             ON CONFLICT (page_slug, element_key) DO UPDATE SET content = $3, updated_at = now(), updated_by = $4`,
            [req.params.pageSlug, req.params.elementKey, String(content ?? '').slice(0, 5000), req.authUserId]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. USERS & SETTINGS
app.post('/api/users', requireAuth, async (req, res) => {
    const { id, name, email, role, workspace_id, inviter_name, workspace_name, invite_link } = req.body;

    // Two legitimate callers: (a) a brand-new sign-up creating their own account row for
    // the first time (no `users` row exists for them yet, and they can only ever create
    // one with their own verified email), or (b) an existing member of workspace_id
    // inviting someone else into it. Anything else is forbidden.
    const selfBootstrap = !req.authUserId && email === req.authEmail;
    if (!selfBootstrap && !(await isWorkspaceMember(req.authUserId, workspace_id))) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query(`INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = $2 RETURNING id`, [id, name, email]);
        const actualUserId = userRes.rows[0].id;
        await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`, [workspace_id, actualUserId, role, defaultPrefs]);
        await client.query('COMMIT');

        if (process.env.RESEND_API_KEY && inviter_name) {
            try {
                await resend.emails.send({
                  from: 'CanEven <invites@caneven.app>',
                    to: email,
                    subject: `You've been invited to ${workspace_name}`,
                    html: `<div style="font-family: sans-serif; color: #172b4d;"><h2>Hi ${name},</h2><p><strong>${inviter_name}</strong> has invited you to collaborate in the <strong>${workspace_name}</strong> workspace.</p><a href="${invite_link}" style="background-color: #0052cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">Accept Invitation</a></div>`
                });
            } catch (emailErr) { console.error("Email failed to send", emailErr); }
        }
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.put('/api/users/email', requireAuth, async (req, res) => {
    const { id, email } = req.body;
    try {
        const shared = await pool.query(
            `SELECT 1 FROM workspace_members a JOIN workspace_members b ON a.workspace_id = b.workspace_id
             WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`, [req.authUserId, id]
        );
        if (shared.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:userId/:workspaceId', requireAuth, async (req, res) => {
    try {
        if (!(await isWorkspaceMember(req.authUserId, req.params.workspaceId))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await pool.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [req.params.userId, req.params.workspaceId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', requireAuth, async (req, res) => {
    const { workspace_id, user_id, preferences } = req.body;
    try {
        if (user_id !== req.authUserId) return res.status(403).json({ error: 'Forbidden' });
        await pool.query(`UPDATE workspace_members SET preferences = $1 WHERE workspace_id = $2 AND user_id = $3`, [preferences, workspace_id, user_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
