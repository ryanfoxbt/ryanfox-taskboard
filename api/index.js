const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { 
      require: true,
      rejectUnauthorized: false 
  }
});
// --- API ROUTES ---

// 1. Get All Data (Hydrates the frontend in one go)
app.get('/api/data', async (req, res) => {
    try {
        const workspaces = await pool.query('SELECT * FROM workspaces');
        const users = await pool.query('SELECT * FROM users');
        const projects = await pool.query('SELECT * FROM projects');
        const tasks = await pool.query('SELECT * FROM tasks');
        
        res.json({
            workspaces: workspaces.rows,
            users: users.rows,
            projects: projects.rows,
            tasks: tasks.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// 2. Save or Update Task
app.post('/api/tasks', async (req, res) => {
    const { id, project_id, parent_task_id, title, description, status, urgency, due_date } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO tasks (id, project_id, parent_task_id, title, description, status, urgency, due_date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE 
             SET title = $4, description = $5, status = $6, urgency = $7, due_date = $8
             RETURNING *`,
            [id, project_id, parent_task_id || null, title, description, status, urgency, due_date || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save task' });
    }
});

// 3. Delete Task
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// 4. Create Workspace
app.post('/api/workspaces', async (req, res) => {
    const { id, name } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO workspaces (id, name) VALUES ($1, $2) RETURNING *',
            [id, name]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create workspace' });
    }
});

// Export for Vercel Serverless Function
module.exports = app;
