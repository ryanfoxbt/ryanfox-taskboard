const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { require: true, rejectUnauthorized: false }
});

// Initialize Resend with your environment variable
const resend = new Resend(process.env.RESEND_API_KEY);

const defaultPrefs = JSON.stringify({ 
    projectOrder: [], uiSize: 'auto', 
    displayConfig: { showDate: true, showUrgency: true, showDesc: true, showAssignee: true } 
});

// 1. GET ALL DATA
app.get('/api/data', async (req, res) => {
    try {
        const workspaces = await pool.query('SELECT * FROM workspaces');
        const projects = await pool.query('SELECT * FROM projects');
        const tasks = await pool.query('SELECT * FROM tasks');
        const users = await pool.query('SELECT * FROM users');
        const workspace_members = await pool.query('SELECT * FROM workspace_members');
        const task_assignees = await pool.query('SELECT * FROM task_assignees');
        
        res.json({ workspaces: workspaces.rows, projects: projects.rows, tasks: tasks.rows, users: users.rows, workspace_members: workspace_members.rows, task_assignees: task_assignees.rows });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch data' }); }
});

// --- 2. TASKS & ASSIGNEES ---
app.post('/api/tasks', async (req, res) => {
    const { 
        id, project_id, parent_task_id, title, description, status, urgency, due_date, assignees,
        counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id
    } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `INSERT INTO tasks (
                id, project_id, parent_task_id, title, description, status, urgency, due_date,
                counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (id) DO UPDATE SET 
                title = $4, 
                description = $5, 
                status = $6, 
                urgency = $7, 
                due_date = $8,
                counter = $9, 
                timer_running = $10, 
                timer_started_at = $11, 
                timer_elapsed = $12,
                completed_at = $13,
                creator_id = $14`, 
            [
                id, project_id, parent_task_id || null, title || null, 
                description !== undefined ? description : null, status || null, 
                urgency || null, due_date || null,
                counter !== undefined ? counter : null, timer_running !== undefined ? timer_running : null, 
                timer_started_at !== undefined ? timer_started_at : null, timer_elapsed !== undefined ? timer_elapsed : null,
                completed_at !== undefined ? completed_at : null, creator_id || null
            ]
        );
        
        if (assignees !== undefined) {
            await client.query('DELETE FROM task_assignees WHERE task_id = $1', [id]);
            if (assignees && assignees.length > 0) {
                for (let userId of assignees) { 
                    await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]); 
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

app.delete('/api/tasks/:id', async (req, res) => {
    try { 
        await pool.query('DELETE FROM task_assignees WHERE task_id = $1 OR task_id IN (SELECT id FROM tasks WHERE parent_task_id = $1)', [req.params.id]); 
        await pool.query('DELETE FROM tasks WHERE id = $1 OR parent_task_id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        console.error("Delete Error:", err);
        res.status(500).json({ error: err.message }); 
    }
});

// 3. --- TIME LOGS ---
app.post('/api/time_logs', async (req, res) => {
    const { id, user_id, workspace_id, project_id, task_id, duration_ms } = req.body;
    try {
        await pool.query(
            `INSERT INTO time_logs (id, user_id, workspace_id, project_id, task_id, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, user_id, workspace_id, project_id, task_id, duration_ms]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 4. --- FEEDBACK ---
app.post('/api/feedback', async (req, res) => {
    const { id, user_id, type, title, description } = req.body;
    try {
        await pool.query(
            `INSERT INTO feedback (id, user_id, type, title, description) VALUES ($1, $2, $3, $4, $5)`,
            [id, user_id, type, title, description]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 5. PROJECTS
app.post('/api/projects', async (req, res) => {
    const { id, workspace_id, name, isSecret, owner_id, notes } = req.body; 
    
    try {
        await pool.query(
            `INSERT INTO projects (id, workspace_id, name, is_secret, owner_id, notes) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4, notes = $6`,
            [id, workspace_id, name, isSecret || false, owner_id || null, notes || '']
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. WORKSPACES
app.post('/api/workspaces', async (req, res) => {
    const { id, name, userId, owner_id } = req.body; 
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2', 
            [id, name, owner_id || userId]
        );
        
        if (userId) {
            await client.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, 'Admin', $3) ON CONFLICT DO NOTHING`,
                [id, userId, defaultPrefs]
            );
            // Default "My Project" is given the exact same owner_id
            await client.query(
                `INSERT INTO projects (id, workspace_id, name, owner_id) VALUES (gen_random_uuid(), $1, 'My Project', $2)`,
                [id, owner_id || userId]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); 
    } finally { client.release(); }
});

app.delete('/api/workspaces/:id', async (req, res) => {
    try { await pool.query('DELETE FROM workspaces WHERE id = $1', [req.params.id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 7. MESSAGES (CHILL CHAT) ---
app.get('/api/messages/:workspace_id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages WHERE workspace_id = $1 ORDER BY created_at ASC', [req.params.workspace_id]);
        res.json(result.rows);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/messages', async (req, res) => {
    const { id, workspace_id, sender_id, sender_name, recipient_id, content, related_task_id } = req.body;
    try {
        await pool.query(
            `INSERT INTO messages (id, workspace_id, sender_id, sender_name, recipient_id, content, related_task_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, workspace_id, sender_id, sender_name, recipient_id || null, content, related_task_id || null]
        );
        res.json({success: true});
    } catch(err) { res.status(500).json({error: err.message}); }
});

// 8. USERS, INVITES & SETTINGS
app.post('/api/users', async (req, res) => {
    const { id, name, email, role, workspace_id, inviter_name, workspace_name, invite_link } = req.body;
    try {
        const userRes = await pool.query(
            `INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = $2 RETURNING id`, 
            [id, name, email]
        );
        const actualUserId = userRes.rows[0].id;
        await pool.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
            [workspace_id, actualUserId, role, defaultPrefs]
        );

        if (process.env.RESEND_API_KEY && inviter_name) {
            try {
                await resend.emails.send({
                  from: 'TaskBoard <invites@ryanfox.co>',
                    to: email,
                    subject: `You've been invited to ${workspace_name}`,
                    html: `
                        <div style="font-family: sans-serif; color: #172b4d;">
                            <h2>Hi ${name},</h2>
                            <p><strong>${inviter_name}</strong> has invited you to collaborate in the <strong>${workspace_name}</strong> workspace.</p>
                            <a href="${invite_link}" style="background-color: #0052cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">Accept Invitation</a>
                        </div>
                    `
                });
            } catch (emailErr) { console.error("Email failed to send", emailErr); }
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/email', async (req, res) => {
    const { id, email } = req.body;
    try {
        await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/users/:userId/:workspaceId', async (req, res) => {
    try { await pool.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [req.params.userId, req.params.workspaceId]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
    const { workspace_id, user_id, preferences } = req.body;
    try { await pool.query(`UPDATE workspace_members SET preferences = $1 WHERE workspace_id = $2 AND user_id = $3`, [preferences, workspace_id, user_id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
