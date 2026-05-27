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
        const workspaces = await pool.query('SELECT * FROM workspaces');
        const projects = await pool.query('SELECT * FROM projects');
        const tasks = await pool.query('SELECT * FROM tasks');
        
        // Fetch users and their linked workspace IDs
        const users = await pool.query(`
            SELECT u.id, u.name, u.email, wm.role, wm.preferences, 
                   array_agg(wm.workspace_id) as workspace_ids
            FROM users u
            JOIN workspace_members wm ON u.id = wm.user_id
            GROUP BY u.id, u.name, u.email, wm.role, wm.preferences
        `);
        
        res.json({
            workspaces: workspaces.rows,
            projects: projects.rows,
            tasks: tasks.rows,
            users: users.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// 2. TASKS
app.post('/api/tasks', async (req, res) => {
    const { id, project_id, parent_task_id, title, description, status, urgency, due_date } = req.body;
    try {
        await pool.query(
            `INSERT INTO tasks (id, project_id, parent_task_id, title, description, status, urgency, due_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET title = $4, description = $5, status = $6, urgency = $7, due_date = $8`,
            [id, project_id, parent_task_id || null, title, description, status, urgency, due_date || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. PROJECTS
app.post('/api/projects', async (req, res) => {
    const { id, workspace_id, name, isSecret } = req.body;
    try {
        await pool.query(
            `INSERT INTO projects (id, workspace_id, name, is_secret) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4`,
            [id, workspace_id, name, isSecret || false]
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
    const { id, name, userId } = req.body; // Need the user who created it to link them
    try {
        await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2', [id, name]);
        // If a userId is provided, link them as an Admin to this new workspace
        if (userId) {
            await pool.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'Admin') ON CONFLICT DO NOTHING`,
                [id, userId]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. USERS
app.post('/api/users', async (req, res) => {
    const { id, name, email, role, workspace_id } = req.body;
    try {
        // Insert user (if they don't exist)
        await pool.query(
            `INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2`, 
            [id, name, email]
        );
        // Link them to the workspace
        await pool.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
            [workspace_id, id, role, '{}']
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

module.exports = app;
