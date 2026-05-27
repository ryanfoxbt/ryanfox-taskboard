const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { require: true, rejectUnauthorized: false }
});

// 1. GET ALL DATA
app.get('/api/data', async (req, res) => {
    try {
        // Fetch every table independently to avoid complex GROUP BY errors
        const workspaces = await pool.query('SELECT * FROM workspaces');
        const projects = await pool.query('SELECT * FROM projects');
        const tasks = await pool.query('SELECT * FROM tasks');
        const users = await pool.query('SELECT * FROM users');
        const workspace_members = await pool.query('SELECT * FROM workspace_members');
        const task_assignees = await pool.query('SELECT * FROM task_assignees');
        
        res.json({
            workspaces: workspaces.rows,
            projects: projects.rows,
            tasks: tasks.rows,
            users: users.rows,
            workspace_members: workspace_members.rows,
            task_assignees: task_assignees.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// 2. TASKS & ASSIGNEES
app.post('/api/tasks', async (req, res) => {
    const { id, project_id, parent_task_id, title, description, status, urgency, due_date, assignees } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Save the Task
        await client.query(
            `INSERT INTO tasks (id, project_id, parent_task_id, title, description, status, urgency, due_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET title = $4, description = $5, status = $6, urgency = $7, due_date = $8`,
            [id, project_id, parent_task_id || null, title, description, status, urgency, due_date || null]
        );

        // Wipe old assignees and insert the new ones
        await client.query('DELETE FROM task_assignees WHERE task_id = $1', [id]);
        if (assignees && assignees.length > 0) {
            for (let userId of assignees) {
                await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        // ON DELETE CASCADE will automatically wipe the task_assignees rows
        await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. PROJECTS
app.post('/api/projects', async (req, res) => {
    const { id, workspace_id, name, isSecret, owner_id } = req.body;
    try {
        await pool.query(
            `INSERT INTO projects (id, workspace_id, name, is_secret, owner_id) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4`,
            [id, workspace_id, name, isSecret || false, owner_id || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. WORKSPACES
app.post('/api/workspaces', async (req, res) => {
    const { id, name, userId } = req.body; 
    try {
        await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2', [id, name]);
        if (userId) {
            await pool.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, 'Admin', '{}') ON CONFLICT DO NOTHING`,
                [id, userId]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workspaces/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM workspaces WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. USERS & SETTINGS
app.post('/api/users', async (req, res) => {
    const { id, name, email, role, workspace_id } = req.body;
    try {
        const userRes = await pool.query(
            `INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = $2 RETURNING id`, 
            [id, name, email]
        );
        const actualUserId = userRes.rows[0].id;
        
        await pool.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, $3, '{}')
             ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
            [workspace_id, actualUserId, role]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:userId/:workspaceId', async (req, res) => {
    try {
        await pool.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [req.params.userId, req.params.workspaceId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
    const { workspace_id, user_id, preferences } = req.body;
    try {
        await pool.query(
            `UPDATE workspace_members SET preferences = $1 WHERE workspace_id = $2 AND user_id = $3`,
            [preferences, workspace_id, user_id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;
