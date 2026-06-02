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
        counter, timer_running, timer_started_at, timer_elapsed, completed_at // <-- Added completed_at
    } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `INSERT INTO tasks (
                id, project_id, parent_task_id, title, description, status, urgency, due_date,
                counter, timer_running, timer_started_at, timer_elapsed, completed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET 
                title = COALESCE($4, tasks.title), 
                description = COALESCE($5, tasks.description), 
                status = COALESCE($6, tasks.status), 
                urgency = COALESCE($7, tasks.urgency), 
                due_date = COALESCE($8, tasks.due_date),
                counter = COALESCE($9, tasks.counter), 
                timer_running = COALESCE($10, tasks.timer_running), 
                timer_started_at = COALESCE($11, tasks.timer_started_at), 
                timer_elapsed = COALESCE($12, tasks.timer_elapsed),
                completed_at = $13`, // Explicitly update completed_at (allows setting to null if reopened)
            [
                id, project_id, parent_task_id || null, title || null, 
                description !== undefined ? description : null, status || null, 
                urgency || null, due_date || null,
                counter !== undefined ? counter : null, timer_running !== undefined ? timer_running : null, 
                timer_started_at !== undefined ? timer_started_at : null, timer_elapsed !== undefined ? timer_elapsed : null,
                completed_at !== undefined ? completed_at : null
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

// --- NEW: TIME LOGS (PATH B) ---
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

// --- NEW: FEEDBACK ---
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

// 3. PROJECTS
app.post('/api/projects', async (req, res) => {
    // 1. Added 'notes' to the destructured variables
    const { id, workspace_id, name, isSecret, owner_id, notes } = req.body; 
    
    try {
        await pool.query(
            // 2. Added 'notes' to the columns, VALUES ($6), and the ON CONFLICT update list
            `INSERT INTO projects (id, workspace_id, name, is_secret, owner_id, notes) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4, notes = $6`,
            
            // 3. Added 'notes' to the parameter array (defaulting to a blank string if empty)
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
    } 
    catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 4. WORKSPACES
app.post('/api/workspaces', async (req, res) => {
    const { id, name, userId } = req.body; 
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2', [id, name]);
        
        if (userId) {
            // Link User to Workspace
            await client.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, 'Admin', $3) ON CONFLICT DO NOTHING`,
                [id, userId, defaultPrefs]
            );
            // Create Default "Me" Project Automatically
            await client.query(
                `INSERT INTO projects (workspace_id, name, owner_id) VALUES ($1, 'Me', $2)`,
                [id, userId]
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

// 5. USERS, INVITES & SETTINGS
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

        // TRIGGER RESEND EMAIL (Only triggers if an inviter_name is provided)
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

app.delete('/api/users/:userId/:workspaceId', async (req, res) => {
    try { await pool.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [req.params.userId, req.params.workspaceId]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
    const { workspace_id, user_id, preferences } = req.body;
    try { await pool.query(`UPDATE workspace_members SET preferences = $1 WHERE workspace_id = $2 AND user_id = $3`, [preferences, workspace_id, user_id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;
