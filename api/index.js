const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Resend } = require('resend');
const multer = require('multer');
const mammoth = require('mammoth');
require('dotenv').config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

// memoryStorage: Vercel serverless functions have no writable disk, and the
// request body cap there is ~4.5MB anyway, so keep this comfortably under it.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { require: true, rejectUnauthorized: false }
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const defaultPrefs = JSON.stringify({ 
    projectOrder: [], uiSize: 'auto', 
    displayConfig: { showDate: true, showUrgency: true, showDesc: true, showAssignee: true } 
});

// 1. GET ALL DATA
app.get('/api/data', async (req, res) => {
    try {
        const workspaces = await pool.query('SELECT * FROM workspaces WHERE is_deleted IS NOT TRUE');
        const projects = await pool.query('SELECT * FROM projects WHERE is_deleted IS NOT TRUE');
        const tasks = await pool.query('SELECT * FROM tasks WHERE is_deleted IS NOT TRUE');
        
        const users = await pool.query('SELECT * FROM users');
        const workspace_members = await pool.query('SELECT * FROM workspace_members');
        const task_assignees = await pool.query('SELECT * FROM task_assignees');
        const time_logs = await pool.query('SELECT * FROM time_logs'); 
        const task_repetitions = await pool.query('SELECT * FROM task_repetitions');
        const comments = await pool.query('SELECT * FROM comments ORDER BY created_at ASC');
        const profiles = await pool.query('SELECT * FROM profiles');
        const applications = await pool.query('SELECT * FROM applications WHERE is_deleted IS NOT TRUE');
        // Explicit column list - never SELECT * here, file_data (bytea) would
        // otherwise get serialized into every page load's JSON payload.
        const resumes = await pool.query(
            `SELECT id, user_id, label, filename, mime_type, file_size_bytes, extracted_text,
                    extraction_status, extraction_error, is_primary, created_at, updated_at
             FROM resumes WHERE is_deleted IS NOT TRUE ORDER BY created_at ASC`
        );
        const role_suggestions = await pool.query('SELECT * FROM role_suggestions WHERE is_deleted IS NOT TRUE');

        res.json({
            workspaces: workspaces.rows, projects: projects.rows, tasks: tasks.rows,
            users: users.rows, workspace_members: workspace_members.rows,
            task_assignees: task_assignees.rows, time_logs: time_logs.rows,
            task_repetitions: task_repetitions.rows, comments: comments.rows,
            profiles: profiles.rows, applications: applications.rows,
            resumes: resumes.rows, role_suggestions: role_suggestions.rows
        });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch data' }); }
});

// 2. TASKS & ASSIGNEES
app.post('/api/tasks', async (req, res) => {
    const {
        id, project_id, parent_task_id, title, description, status, urgency, due_date, assignees,
        counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id, recurring_type, metadata
    } = req.body; // <-- Added recurring_type, metadata

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO tasks (
                id, project_id, parent_task_id, title, description, status, urgency, due_date,
                counter, timer_running, timer_started_at, timer_elapsed, completed_at, creator_id, recurring_type, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO UPDATE SET
                project_id = $2, parent_task_id = $3, title = $4, description = $5,
                status = $6, urgency = $7, due_date = $8, counter = $9,
                timer_running = $10, timer_started_at = $11, timer_elapsed = $12,
                completed_at = $13, creator_id = $14, recurring_type = $15, metadata = $16`,
            [
                id, project_id, parent_task_id || null, title || null,
                description !== undefined ? description : null, status || null,
                urgency || null, due_date || null,
                counter !== undefined ? counter : null, timer_running !== undefined ? timer_running : null,
                timer_started_at !== undefined ? timer_started_at : null, timer_elapsed !== undefined ? timer_elapsed : null,
                completed_at !== undefined ? completed_at : null, creator_id || null, recurring_type || 'habit',
                JSON.stringify(metadata !== undefined ? metadata : {})
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
        await pool.query('UPDATE tasks SET is_deleted = true WHERE id = $1 OR parent_task_id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. TIME LOGS & REPETITIONS
app.post('/api/time_logs', async (req, res) => {
    const { id, user_id, workspace_id, project_id, task_id, duration_ms, created_at } = req.body;
    try {
        await pool.query(
            `INSERT INTO time_logs (id, user_id, workspace_id, project_id, task_id, duration_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, user_id, workspace_id, project_id, task_id, duration_ms, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/repetitions', async (req, res) => {
    const { id, task_id, user_id, created_at } = req.body;
    try {
        await pool.query(
            `INSERT INTO task_repetitions (id, task_id, user_id, created_at) VALUES ($1, $2, $3, $4)`,
            [id, task_id, user_id, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 4. COMMENTS ENGINE (CREATE, EDIT, DELETE)
app.post('/api/comments', async (req, res) => {
    const { id, workspace_id, project_id, task_id, user_id, content, created_at } = req.body;
    try {
        await pool.query(
            `INSERT INTO comments (id, workspace_id, project_id, task_id, user_id, content, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, workspace_id, project_id || null, task_id || null, user_id, content, created_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/comments/:id', async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query(`UPDATE comments SET content = $1 WHERE id = $2`, [content, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/comments/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM comments WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 5. FEEDBACK
app.post('/api/feedback', async (req, res) => {
    const { id, user_id, type, title, description } = req.body;
    try {
        await pool.query(`INSERT INTO feedback (id, user_id, type, title, description) VALUES ($1, $2, $3, $4, $5)`, [id, user_id, type, title, description]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// 6. PROJECTS
app.post('/api/projects', async (req, res) => {
    const { id, workspace_id, name, isSecret, owner_id, settings } = req.body;
    try {
        await pool.query(
            `INSERT INTO projects (id, workspace_id, name, is_secret, owner_id, settings)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
             ON CONFLICT (id) DO UPDATE SET name = $3, is_secret = $4, settings = COALESCE($6::jsonb, projects.settings)`,
            [id, workspace_id, name, isSecret || false, owner_id || null, settings !== undefined ? JSON.stringify(settings) : null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PROJECT_TEMPLATES = {
    career: {
        name: 'Career & Job Search'
        // status buckets reuse existing task statuses: future=leads/worth reviewing,
        // todo=apply today, doing=applied/interviewing, done=offer, complete=archived/rejected
    }
};

app.post('/api/projects/template', async (req, res) => {
    const { workspace_id, template_type, user_id } = req.body;
    const template = PROJECT_TEMPLATES[template_type];
    if (!workspace_id || !template) return res.status(400).json({ error: 'Unknown or missing template_type' });
    try {
        const result = await pool.query(
            `INSERT INTO projects (id, workspace_id, name, owner_id, template_type)
             VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING *`,
            [workspace_id, template.name, user_id || null, template_type]
        );
        res.json({ success: true, project: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
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
            await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role, preferences) VALUES ($1, $2, 'Admin', $3) ON CONFLICT DO NOTHING`, [id, userId, defaultPrefs]);
            await client.query(`INSERT INTO projects (id, workspace_id, name, owner_id) VALUES (gen_random_uuid(), $1, 'My Project', $2)`, [id, owner_id || userId]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.delete('/api/workspaces/:id', async (req, res) => {
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

// 8. JOB INGESTION (daily automation writes career leads here)
app.post('/api/jobs/ingest', async (req, res) => {
    if (!process.env.JOB_INGEST_KEY || req.headers['x-api-key'] !== process.env.JOB_INGEST_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { user_email, jobs } = req.body;
    if (!user_email || !Array.isArray(jobs)) {
        return res.status(400).json({ error: 'user_email and jobs[] are required' });
    }

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [user_email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'No user with that email' });
        const userId = userRes.rows[0].id;

        const wsRes = await pool.query('SELECT workspace_id FROM workspace_members WHERE user_id = $1', [userId]);
        const workspaceIds = wsRes.rows.map(r => r.workspace_id);
        if (workspaceIds.length === 0) return res.status(404).json({ error: 'User has no workspaces' });

        const projRes = await pool.query(
            `SELECT * FROM projects WHERE workspace_id = ANY($1) AND template_type = 'career' AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1`,
            [workspaceIds]
        );
        if (projRes.rows.length === 0) return res.status(404).json({ error: 'No Career & Job Search project found for this user' });
        const project = projRes.rows[0];

        const existingRes = await pool.query(
            `SELECT title, metadata FROM tasks WHERE project_id = $1 AND is_deleted IS NOT TRUE`,
            [project.id]
        );
        const existingUrls = new Set(existingRes.rows.map(r => r.metadata && r.metadata.job_url).filter(Boolean));
        const existingTitles = new Set(existingRes.rows.map(r => (r.title || '').toLowerCase()));

        let inserted = 0;
        for (const job of jobs) {
            const title = `${job.company || 'Unknown'} - ${job.title || 'Untitled Role'}`;
            const isDuplicate = (job.job_url && existingUrls.has(job.job_url)) || existingTitles.has(title.toLowerCase());
            if (isDuplicate) continue;

            const status = job.category === 'Apply Today' ? 'todo' : 'future';
            const description = [job.fit_reason, job.salary ? `Salary: ${job.salary}` : null].filter(Boolean).join('\n\n');
            const metadata = {
                company: job.company || null,
                job_url: job.job_url || null,
                salary: job.salary || null,
                salary_estimated: !!job.salary_estimated,
                location: job.location || null,
                industry: job.industry || null,
                posting_date: job.posting_date || null,
                source: job.source || null,
                fit_reason: job.fit_reason || null,
                notes: job.notes || null
            };

            await pool.query(
                `INSERT INTO tasks (id, project_id, title, description, status, urgency, creator_id, metadata)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, 'low', $5, $6)`,
                [project.id, title, description, status, userId, JSON.stringify(metadata)]
            );
            inserted++;
        }

        res.json({ success: true, inserted, skipped: jobs.length - inserted, project_id: project.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. USERS & SETTINGS
app.post('/api/users', async (req, res) => {
    const { id, name, email, role, workspace_id, inviter_name, workspace_name, invite_link } = req.body;
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
                  from: 'TaskBoard <invites@ryanfox.co>',
                    to: email,
                    subject: `You've been invited to ${workspace_name}`,
                    html: `<div style="font-family: sans-serif; color: #172b4d;"><h2>Hi ${name},</h2><p><strong>${inviter_name}</strong> has invited you to collaborate in the <strong>${workspace_name}</strong> workspace.</p><a href="${invite_link}" style="background-color: #0052cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">Accept Invitation</a></div>`
                });
            } catch (emailErr) { console.error("Email failed to send", emailErr); }
        }
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.put('/api/users/email', async (req, res) => {
    const { id, email } = req.body;
    try {
        await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, id]);
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
    try { await pool.query(`UPDATE workspace_members SET preferences = $1 WHERE workspace_id = $2 AND user_id = $3`, [preferences, workspace_id, user_id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. JOB APPLICATION PROFILE & TRACKER (personal info + resume used to autofill
// ATS forms, and a record of individual application attempts)
app.post('/api/profile', async (req, res) => {
    const {
        user_id, full_name, preferred_name, email, phone, address_line1, city, state,
        postal_code, country, linkedin_url, github_url, portfolio_url, work_authorization,
        needs_sponsorship, willing_to_relocate, desired_salary, earliest_start_date,
        current_employer, current_title, years_experience, resume_text, cover_letter_template,
        screening_notes, eeo_answers, additional_skills_info
    } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    try {
        await pool.query(
            `INSERT INTO profiles (
                user_id, full_name, preferred_name, email, phone, address_line1, city, state,
                postal_code, country, linkedin_url, github_url, portfolio_url, work_authorization,
                needs_sponsorship, willing_to_relocate, desired_salary, earliest_start_date,
                current_employer, current_title, years_experience, resume_text, cover_letter_template,
                screening_notes, eeo_answers, additional_skills_info, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,COALESCE($25::jsonb,'{}'::jsonb),$26,now())
             ON CONFLICT (user_id) DO UPDATE SET
                full_name=$2, preferred_name=$3, email=$4, phone=$5, address_line1=$6, city=$7, state=$8,
                postal_code=$9, country=$10, linkedin_url=$11, github_url=$12, portfolio_url=$13, work_authorization=$14,
                needs_sponsorship=$15, willing_to_relocate=$16, desired_salary=$17, earliest_start_date=$18,
                current_employer=$19, current_title=$20, years_experience=$21, resume_text=$22, cover_letter_template=$23,
                screening_notes=$24, eeo_answers=COALESCE($25::jsonb, profiles.eeo_answers),
                additional_skills_info=$26, updated_at=now()`,
            [
                user_id, full_name || null, preferred_name || null, email || null, phone || null,
                address_line1 || null, city || null, state || null, postal_code || null, country || null,
                linkedin_url || null, github_url || null, portfolio_url || null, work_authorization || null,
                needs_sponsorship !== undefined ? needs_sponsorship : null,
                willing_to_relocate !== undefined ? willing_to_relocate : null,
                desired_salary || null, earliest_start_date || null, current_employer || null, current_title || null,
                years_experience !== undefined && years_experience !== '' ? years_experience : null,
                resume_text || null, cover_letter_template || null, screening_notes || null,
                eeo_answers !== undefined ? JSON.stringify(eeo_answers) : null,
                additional_skills_info || null
            ]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/applications', async (req, res) => {
    const {
        id, user_id, task_id, company, title, job_url, ats_platform, status,
        applied_at, form_snapshot, notes,
        source_resume_id, job_description_text, tailored_resume_text, tailored_cover_letter_text,
        outcome, outcome_notes
    } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO applications (
                id, user_id, task_id, company, title, job_url, ats_platform, status,
                applied_at, form_snapshot, notes, source_resume_id, job_description_text,
                tailored_resume_text, tailored_cover_letter_text, outcome, outcome_notes,
                outcome_updated_at, updated_at
             ) VALUES (
                COALESCE($1, gen_random_uuid()), $2,$3,$4,$5,$6,$7,COALESCE($8,'draft'),$9,
                COALESCE($10::jsonb,'{}'::jsonb),$11,$12,$13,$14,$15,$16,$17,
                CASE WHEN $16::text IS NOT NULL THEN now() ELSE NULL END, now()
             )
             ON CONFLICT (id) DO UPDATE SET
                user_id=$2, task_id=$3, company=$4, title=$5, job_url=$6, ats_platform=$7,
                status=COALESCE($8, applications.status), applied_at=COALESCE($9, applications.applied_at),
                form_snapshot=COALESCE($10::jsonb, applications.form_snapshot), notes=$11,
                source_resume_id=COALESCE($12, applications.source_resume_id),
                job_description_text=COALESCE($13, applications.job_description_text),
                tailored_resume_text=COALESCE($14, applications.tailored_resume_text),
                tailored_cover_letter_text=COALESCE($15, applications.tailored_cover_letter_text),
                outcome=COALESCE($16, applications.outcome),
                outcome_notes=COALESCE($17, applications.outcome_notes),
                outcome_updated_at=CASE WHEN $16::text IS NOT NULL THEN now() ELSE applications.outcome_updated_at END,
                updated_at=now()
             RETURNING *`,
            [
                id || null, user_id || null, task_id || null, company || null, title || null,
                job_url || null, ats_platform || null, status || null, applied_at || null,
                form_snapshot !== undefined ? JSON.stringify(form_snapshot) : null, notes || null,
                source_resume_id || null, job_description_text || null,
                tailored_resume_text || null, tailored_cover_letter_text || null,
                outcome || null, outcome_notes || null
            ]
        );
        res.json({ success: true, application: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/applications/:id', async (req, res) => {
    try {
        await pool.query('UPDATE applications SET is_deleted = true WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. RESUMES (upload, download, manage)
const RESUME_RETURNING_COLS =
    `id, user_id, label, filename, mime_type, file_size_bytes, extracted_text,
     extraction_status, extraction_error, is_primary, created_at, updated_at`;

// PDF support was dropped: real-world resume PDFs (scanned, encrypted, complex
// fonts/layout) crashed the old pure-JS pdf-parse library before a row could
// even be inserted, with no graceful failure to show the user. DOCX (via
// mammoth) has been reliable in practice, so that's the only format accepted.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// profiles.resume_text is what gets pasted verbatim into free-text "resume"
// fields on real ATS application forms (see apply-to-jobs), so it's kept as
// ONE coherent resume - whichever upload is marked primary - rather than a
// concatenation of every uploaded version (which would read as garbled,
// repetitive text to a real screener/form). Tailoring skills get the full
// picture across all resumes directly from the `resumes` table instead.
async function syncResumeTextToProfile(dbClient, userId, extractedText) {
    await dbClient.query(
        `INSERT INTO profiles (user_id, resume_text, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET resume_text = $2, updated_at = now()`,
        [userId, extractedText]
    );
}

app.post('/api/resumes/upload', upload.single('file'), async (req, res) => {
    const { user_id, label } = req.body;
    if (!user_id || !req.file) return res.status(400).json({ error: 'user_id and file are required' });

    if (req.file.mimetype !== DOCX_MIME) {
        return res.status(400).json({
            error: 'Only Word documents (.docx) are supported right now. Save/export your resume as .docx and try again.'
        });
    }

    let extracted_text = null, extraction_status = 'failed', extraction_error = null;
    try {
        extracted_text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
        extraction_status = extracted_text.trim() ? 'ok' : 'failed';
        if (extraction_status === 'failed') extraction_error = 'No text could be extracted from this file.';
    } catch (err) { extraction_error = err.message; }

    try {
        // First resume ever uploaded for this user becomes primary automatically -
        // no manual click needed for the common case of "just uploaded my resume."
        const existing = await pool.query(
            'SELECT COUNT(*)::int AS c FROM resumes WHERE user_id = $1 AND is_deleted IS NOT TRUE', [user_id]
        );
        const makesPrimary = existing.rows[0].c === 0;

        const result = await pool.query(
            `INSERT INTO resumes (
                user_id, label, filename, mime_type, file_size_bytes, file_data,
                extracted_text, extraction_status, extraction_error, is_primary
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING ${RESUME_RETURNING_COLS}`,
            [
                user_id, label || null, req.file.originalname, DOCX_MIME, req.file.size, req.file.buffer,
                extracted_text, extraction_status, extraction_error, makesPrimary
            ]
        );

        if (makesPrimary && extraction_status === 'ok') {
            await syncResumeTextToProfile(pool, user_id, extracted_text);
        }

        res.json({ success: true, resume: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/resumes/:id/download', async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT filename, mime_type, file_data FROM resumes WHERE id = $1 AND is_deleted IS NOT TRUE',
            [req.params.id]
        );
        if (r.rows.length === 0) return res.status(404).end();
        const row = r.rows[0];
        res.set('Content-Type', row.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${(row.filename || 'resume').replace(/"/g, '')}"`);
        res.send(row.file_data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/resumes/:id', async (req, res) => {
    const { label, is_primary } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (is_primary === true) {
            const cur = await client.query(
                'SELECT user_id, extracted_text, extraction_status FROM resumes WHERE id = $1', [req.params.id]
            );
            if (cur.rows.length) {
                await client.query('UPDATE resumes SET is_primary = false WHERE user_id = $1', [cur.rows[0].user_id]);
                if (cur.rows[0].extraction_status === 'ok') {
                    await syncResumeTextToProfile(client, cur.rows[0].user_id, cur.rows[0].extracted_text);
                }
            }
        }
        const result = await client.query(
            `UPDATE resumes SET
                label = COALESCE($1, label),
                is_primary = COALESCE($2, is_primary),
                updated_at = now()
             WHERE id = $3
             RETURNING ${RESUME_RETURNING_COLS}`,
            [label !== undefined ? label : null, is_primary !== undefined ? is_primary : null, req.params.id]
        );
        await client.query('COMMIT');
        res.json({ success: true, resume: result.rows[0] });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
    finally { client.release(); }
});

app.delete('/api/resumes/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT user_id, is_primary FROM resumes WHERE id = $1', [req.params.id]);
        await client.query('UPDATE resumes SET is_deleted = true, is_primary = false WHERE id = $1', [req.params.id]);

        // If the deleted resume was primary, promote the next most recent one so
        // profiles.resume_text (used for ATS autofill) doesn't go stale/orphaned.
        if (cur.rows.length && cur.rows[0].is_primary) {
            const next = await client.query(
                `SELECT id, extracted_text, extraction_status FROM resumes
                 WHERE user_id = $1 AND is_deleted IS NOT TRUE
                 ORDER BY created_at DESC LIMIT 1`,
                [cur.rows[0].user_id]
            );
            if (next.rows.length) {
                await client.query('UPDATE resumes SET is_primary = true WHERE id = $1', [next.rows[0].id]);
                if (next.rows[0].extraction_status === 'ok') {
                    await syncResumeTextToProfile(client, cur.rows[0].user_id, next.rows[0].extracted_text);
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
    finally { client.release(); }
});

// 7. ROLE SUGGESTIONS (written by the suggest-roles skill)
app.post('/api/role-suggestions', async (req, res) => {
    const { user_id, suggestions } = req.body;
    if (!user_id || !Array.isArray(suggestions)) {
        return res.status(400).json({ error: 'user_id and suggestions[] are required' });
    }
    try {
        const existing = await pool.query(
            'SELECT LOWER(suggested_title) AS t FROM role_suggestions WHERE user_id = $1 AND is_deleted IS NOT TRUE',
            [user_id]
        );
        const existingTitles = new Set(existing.rows.map(r => r.t));
        let inserted = 0;
        for (const s of suggestions) {
            if (!s.suggested_title || existingTitles.has(s.suggested_title.toLowerCase())) continue;
            await pool.query(
                'INSERT INTO role_suggestions (user_id, suggested_title, rationale, source_resume_id) VALUES ($1,$2,$3,$4)',
                [user_id, s.suggested_title, s.rationale || null, s.source_resume_id || null]
            );
            existingTitles.add(s.suggested_title.toLowerCase());
            inserted++;
        }
        res.json({ success: true, inserted, skipped: suggestions.length - inserted });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/role-suggestions/:id', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query(
            'UPDATE role_suggestions SET status = COALESCE($1, status), updated_at = now() WHERE id = $2',
            [status || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Multer throws outside the async handlers above (e.g. file-too-large), which
// would otherwise hit Express's default HTML error page instead of clean JSON.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next(err);
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
