// server.js - UPPORTUNIX Backend API Server
// Node.js + Express + SQLite + JWT Authentication
// AI-Powered Email Sales Automation Platform
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'upportunix-secret-change-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================================
// MIDDLEWARE
// ============================================================================

const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:4000',
    'https://upportunix-ia.fr',
    'https://www.upportunix-ia.fr',
    'https://app.upportunix-ia.fr',
    'https://studio.upportunix-ia.fr'
];
const allowedOrigins = process.env.CORS_ORIGIN
    ? [...defaultOrigins, ...process.env.CORS_ORIGIN.split(',')]
    : defaultOrigins;

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /csv|xlsx|pdf|jpg|jpeg|png/;
        if (allowed.test(path.extname(file.originalname).toLowerCase())) return cb(null, true);
        cb(new Error('Invalid file type'));
    }
});

// ============================================================================
// DATABASE
// ============================================================================

const db = new sqlite3.Database(process.env.DB_PATH || './upportunix.db', (err) => {
    if (err) return console.error('❌ Database error:', err);
    console.log('✅ Connected to SQLite database');
    db.run('PRAGMA foreign_keys = ON');
    initDatabase();
});

function initDatabase() {
    db.serialize(() => {

        // Users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','agency')),
            first_name TEXT,
            last_name TEXT,
            company TEXT,
            phone TEXT,
            avatar TEXT,
            plan TEXT DEFAULT 'starter' CHECK(plan IN ('starter','pro','agency','enterprise')),
            plan_start DATETIME,
            plan_end DATETIME,
            email_quota INTEGER DEFAULT 500,
            email_sent INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','pending')),
            email_verified BOOLEAN DEFAULT 0,
            verification_token TEXT,
            reset_token TEXT,
            reset_token_expires DATETIME,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Contact lists
        db.run(`CREATE TABLE IF NOT EXISTS contact_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            total_contacts INTEGER DEFAULT 0,
            tags TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Contacts
        db.run(`CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            list_id INTEGER,
            email TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            company TEXT,
            job_title TEXT,
            phone TEXT,
            linkedin_url TEXT,
            website TEXT,
            city TEXT,
            country TEXT DEFAULT 'FR',
            tags TEXT,
            custom_fields TEXT,
            status TEXT DEFAULT 'active' CHECK(status IN ('active','unsubscribed','bounced','complained')),
            unsubscribed_at DATETIME,
            bounce_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE SET NULL
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id)`);

        // Email templates
        db.run(`CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            body_text TEXT,
            category TEXT DEFAULT 'sales' CHECK(category IN ('sales','followup','onboarding','newsletter','transactional','other')),
            language TEXT DEFAULT 'fr',
            is_ai_generated BOOLEAN DEFAULT 0,
            ai_prompt TEXT,
            variables TEXT,
            open_rate REAL DEFAULT 0,
            click_rate REAL DEFAULT 0,
            reply_rate REAL DEFAULT 0,
            times_used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Campaigns
        db.run(`CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'sequence' CHECK(type IN ('sequence','blast','trigger')),
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','archived')),
            list_id INTEGER,
            from_name TEXT,
            from_email TEXT,
            reply_to TEXT,
            total_contacts INTEGER DEFAULT 0,
            total_sent INTEGER DEFAULT 0,
            total_opened INTEGER DEFAULT 0,
            total_clicked INTEGER DEFAULT 0,
            total_replied INTEGER DEFAULT 0,
            total_unsubscribed INTEGER DEFAULT 0,
            total_bounced INTEGER DEFAULT 0,
            open_rate REAL DEFAULT 0,
            click_rate REAL DEFAULT 0,
            reply_rate REAL DEFAULT 0,
            timezone TEXT DEFAULT 'Europe/Paris',
            daily_limit INTEGER DEFAULT 100,
            send_on_weekends BOOLEAN DEFAULT 0,
            send_time_start TEXT DEFAULT '08:00',
            send_time_end TEXT DEFAULT '18:00',
            started_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE SET NULL
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`);

        // Campaign steps (sequence emails)
        db.run(`CREATE TABLE IF NOT EXISTS campaign_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            step_number INTEGER NOT NULL,
            template_id INTEGER,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            body_text TEXT,
            delay_days INTEGER DEFAULT 0,
            delay_hours INTEGER DEFAULT 0,
            condition_type TEXT DEFAULT 'always' CHECK(condition_type IN ('always','not_opened','not_replied','opened','clicked')),
            stop_on_reply BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
            FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
        )`);

        // Email sends (tracking per email)
        db.run(`CREATE TABLE IF NOT EXISTS email_sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            step_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            message_id TEXT UNIQUE,
            subject TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','delivered','opened','clicked','replied','bounced','failed','unsubscribed')),
            sent_at DATETIME,
            delivered_at DATETIME,
            first_opened_at DATETIME,
            last_opened_at DATETIME,
            open_count INTEGER DEFAULT 0,
            clicked_at DATETIME,
            click_count INTEGER DEFAULT 0,
            replied_at DATETIME,
            bounced_at DATETIME,
            bounce_type TEXT,
            error_message TEXT,
            tracking_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
            FOREIGN KEY (step_id) REFERENCES campaign_steps(id) ON DELETE CASCADE,
            FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sends_campaign ON email_sends(campaign_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sends_contact ON email_sends(contact_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sends_status ON email_sends(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sends_tracking ON email_sends(tracking_id)`);

        // AI generation logs
        db.run(`CREATE TABLE IF NOT EXISTS ai_generations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT CHECK(type IN ('subject','body','sequence','personalization','icebreaker')),
            prompt TEXT,
            result TEXT,
            model TEXT DEFAULT 'claude-sonnet-4-6',
            tokens_used INTEGER DEFAULT 0,
            campaign_id INTEGER,
            template_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // SMTP configs per user
        db.run(`CREATE TABLE IF NOT EXISTS smtp_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER DEFAULT 587,
            secure BOOLEAN DEFAULT 0,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            from_name TEXT,
            from_email TEXT NOT NULL,
            is_verified BOOLEAN DEFAULT 0,
            is_default BOOLEAN DEFAULT 0,
            daily_limit INTEGER DEFAULT 200,
            sent_today INTEGER DEFAULT 0,
            last_reset_date DATE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Payments
        db.run(`CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'EUR',
            plan TEXT,
            status TEXT CHECK(status IN ('pending','succeeded','failed','refunded')),
            stripe_payment_id TEXT,
            stripe_customer_id TEXT,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Activity log
        db.run(`CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id INTEGER,
            details TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(created_at)`);

        // Default admin
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@upportunix-ia.fr';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
        db.get('SELECT id FROM users WHERE email = ?', [adminEmail], (err, row) => {
            if (!row) {
                bcrypt.hash(adminPassword, 10, (err, hash) => {
                    if (!err) {
                        db.run(`INSERT INTO users (email, password, role, first_name, last_name, status, email_verified, plan)
                            VALUES (?, ?, 'admin', 'Admin', 'UPPORTUNIX', 'active', 1, 'enterprise')`,
                            [adminEmail, hash], () => console.log(`✅ Admin created: ${adminEmail}`));
                    }
                });
            }
        });
        console.log('✅ Database tables ready');
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

function isAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

function logActivity(userId, action, entityType, entityId, details, ip) {
    db.run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, action, entityType, entityId, JSON.stringify(details), ip]);
}

function createTransporter(smtpConfig) {
    return nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: !!smtpConfig.secure,
        auth: { user: smtpConfig.username, pass: smtpConfig.password }
    });
}

// ============================================================================
// AUTH
// ============================================================================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name, company, phone } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (row) return res.status(400).json({ error: 'Email already registered' });
            const hashedPassword = await bcrypt.hash(password, 10);
            const verificationToken = crypto.randomBytes(32).toString('hex');

            db.run(`INSERT INTO users (email, password, first_name, last_name, company, phone, verification_token)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [email, hashedPassword, first_name, last_name, company, phone, verificationToken],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Failed to create account' });
                    logActivity(this.lastID, 'register', 'user', this.lastID, { email }, req.ip);
                    res.status(201).json({ message: 'Account created successfully', userId: this.lastID });
                });
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, plan: user.plan },
            JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        logActivity(user.id, 'login', 'user', user.id, { email }, req.ip);

        res.json({
            token,
            user: {
                id: user.id, email: user.email, role: user.role,
                first_name: user.first_name, last_name: user.last_name,
                company: user.company, plan: user.plan,
                email_quota: user.email_quota, email_sent: user.email_sent
            }
        });
    });
});

app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
        if (!user) return res.json({ message: 'If this email exists, a reset link was sent.' });
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000).toISOString();
        db.run('UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?', [token, expires, user.id]);
        // TODO: send email with reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}
        res.json({ message: 'If this email exists, a reset link was sent.' });
    });
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    db.get('SELECT id FROM users WHERE reset_token=? AND reset_token_expires > ?',
        [token, new Date().toISOString()], async (err, user) => {
        if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
        const hash = await bcrypt.hash(password, 10);
        db.run('UPDATE users SET password=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?', [hash, user.id]);
        res.json({ message: 'Password reset successfully' });
    });
});

// ============================================================================
// USER / PROFILE
// ============================================================================

app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get(`SELECT id, email, role, first_name, last_name, company, phone, avatar, plan,
            email_quota, email_sent, status, created_at, last_login FROM users WHERE id=?`,
        [req.user.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

app.put('/api/user/profile', authenticateToken, (req, res) => {
    const { first_name, last_name, company, phone } = req.body;
    db.run(`UPDATE users SET first_name=?, last_name=?, company=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [first_name, last_name, company, phone, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update profile' });
        res.json({ message: 'Profile updated' });
    });
});

app.put('/api/user/change-password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;
    db.get('SELECT password FROM users WHERE id=?', [req.user.id], async (err, user) => {
        const valid = await bcrypt.compare(current_password, user.password);
        if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
        const hash = await bcrypt.hash(new_password, 10);
        db.run('UPDATE users SET password=? WHERE id=?', [hash, req.user.id]);
        res.json({ message: 'Password changed' });
    });
});

// ============================================================================
// CONTACT LISTS
// ============================================================================

app.get('/api/lists', authenticateToken, (req, res) => {
    db.all('SELECT * FROM contact_lists WHERE user_id=? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/lists', authenticateToken, (req, res) => {
    const { name, description, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'List name required' });
    db.run(`INSERT INTO contact_lists (user_id, name, description, tags) VALUES (?, ?, ?, ?)`,
        [req.user.id, name, description, tags], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to create list' });
        res.status(201).json({ id: this.lastID, name, message: 'List created' });
    });
});

app.put('/api/lists/:id', authenticateToken, (req, res) => {
    const { name, description, tags } = req.body;
    db.run(`UPDATE contact_lists SET name=?, description=?, tags=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
        [name, description, tags, req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'List not found' });
        res.json({ message: 'List updated' });
    });
});

app.delete('/api/lists/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM contact_lists WHERE id=? AND user_id=?', [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'List not found' });
        res.json({ message: 'List deleted' });
    });
});

// ============================================================================
// CONTACTS
// ============================================================================

app.get('/api/contacts', authenticateToken, (req, res) => {
    const { list_id, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM contacts WHERE user_id=?`;
    const params = [req.user.id];

    if (list_id) { query += ' AND list_id=?'; params.push(list_id); }
    if (status) { query += ' AND status=?'; params.push(status); }
    if (search) {
        query += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?)';
        const s = `%${search}%`; params.push(s, s, s, s);
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    db.get(countQuery, params, (err, count) => {
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);
        db.all(query, params, (err, rows) => {
            res.json({ total: count?.total || 0, page: parseInt(page), limit: parseInt(limit), contacts: rows || [] });
        });
    });
});

app.post('/api/contacts', authenticateToken, (req, res) => {
    const { email, first_name, last_name, company, job_title, phone, linkedin_url, list_id, tags, custom_fields } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    db.run(`INSERT INTO contacts (user_id, list_id, email, first_name, last_name, company, job_title, phone, linkedin_url, tags, custom_fields)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, list_id, email, first_name, last_name, company, job_title, phone, linkedin_url, tags, JSON.stringify(custom_fields)],
        function(err) {
            if (err) return res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Email already exists' : 'Failed to add contact' });
            if (list_id) db.run('UPDATE contact_lists SET total_contacts=total_contacts+1 WHERE id=?', [list_id]);
            res.status(201).json({ id: this.lastID, message: 'Contact added' });
        });
});

// CSV import
app.post('/api/contacts/import', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const { list_id } = req.body;
    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    const lines = fileContent.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const emailIdx = headers.findIndex(h => h.includes('email'));
    if (emailIdx === -1) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'CSV must have an "email" column' }); }

    let imported = 0, skipped = 0;
    const getCol = (headers, cols, name) => { const i = headers.findIndex(h => h.includes(name)); return i >= 0 ? cols[i] : null; };

    const promises = lines.slice(1).map(line => new Promise(resolve => {
        const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));
        const email = cols[emailIdx];
        if (!email || !email.includes('@')) { skipped++; return resolve(); }
        db.run(`INSERT OR IGNORE INTO contacts (user_id, list_id, email, first_name, last_name, company, job_title)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, list_id || null, email, getCol(headers, cols, 'first'), getCol(headers, cols, 'last'),
             getCol(headers, cols, 'company'), getCol(headers, cols, 'title') || getCol(headers, cols, 'job')],
            function() { if (this.changes > 0) imported++; else skipped++; resolve(); });
    }));

    Promise.all(promises).then(() => {
        if (list_id) db.run('UPDATE contact_lists SET total_contacts=(SELECT COUNT(*) FROM contacts WHERE list_id=?) WHERE id=?', [list_id, list_id]);
        fs.unlink(req.file.path, () => {});
        res.json({ message: 'Import complete', imported, skipped });
    });
});

app.put('/api/contacts/:id', authenticateToken, (req, res) => {
    const { first_name, last_name, company, job_title, phone, linkedin_url, tags, status } = req.body;
    db.run(`UPDATE contacts SET first_name=?, last_name=?, company=?, job_title=?, phone=?, linkedin_url=?, tags=?, status=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND user_id=?`,
        [first_name, last_name, company, job_title, phone, linkedin_url, tags, status, req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Contact not found' });
        res.json({ message: 'Contact updated' });
    });
});

app.delete('/api/contacts/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM contacts WHERE id=? AND user_id=?', [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Contact not found' });
        res.json({ message: 'Contact deleted' });
    });
});

// Public unsubscribe
app.get('/unsubscribe/:trackingId', (req, res) => {
    db.get('SELECT contact_id FROM email_sends WHERE tracking_id=?', [req.params.trackingId], (err, send) => {
        if (!send) return res.status(404).send('Invalid link');
        db.run(`UPDATE contacts SET status='unsubscribed', unsubscribed_at=CURRENT_TIMESTAMP WHERE id=?`, [send.contact_id]);
        db.run(`UPDATE email_sends SET status='unsubscribed' WHERE tracking_id=?`, [req.params.trackingId]);
        res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h2>✅ Désabonnement réussi.</h2><p>Vous ne recevrez plus de messages de cette campagne.</p></body></html>');
    });
});

// ============================================================================
// TEMPLATES
// ============================================================================

app.get('/api/templates', authenticateToken, (req, res) => {
    const { category } = req.query;
    let query = 'SELECT * FROM templates WHERE user_id=?';
    const params = [req.user.id];
    if (category) { query += ' AND category=?'; params.push(category); }
    query += ' ORDER BY created_at DESC';
    db.all(query, params, (err, rows) => res.json(rows || []));
});

app.post('/api/templates', authenticateToken, (req, res) => {
    const { name, subject, body_html, body_text, category, language, variables } = req.body;
    if (!name || !subject || !body_html) return res.status(400).json({ error: 'Name, subject, and body required' });
    db.run(`INSERT INTO templates (user_id, name, subject, body_html, body_text, category, language, variables)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, name, subject, body_html, body_text, category || 'sales', language || 'fr', variables],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to create template' });
            res.status(201).json({ id: this.lastID, message: 'Template created' });
        });
});

app.put('/api/templates/:id', authenticateToken, (req, res) => {
    const { name, subject, body_html, body_text, category } = req.body;
    db.run(`UPDATE templates SET name=?, subject=?, body_html=?, body_text=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
        [name, subject, body_html, body_text, category, req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ message: 'Template updated' });
    });
});

app.delete('/api/templates/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM templates WHERE id=? AND user_id=?', [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ message: 'Template deleted' });
    });
});

// ============================================================================
// AI GENERATION (Claude API)
// ============================================================================

app.post('/api/ai/generate', authenticateToken, async (req, res) => {
    const { type, context, language = 'fr', tone = 'professional' } = req.body;
    if (!type || !context) return res.status(400).json({ error: 'Type and context required' });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in .env' });

    const prompts = {
        subject: `Tu es un expert en cold email B2B. Génère 5 lignes d'objet percutantes en ${language}, ton ${tone}.
Contexte: ${context}
Règles: courts (max 50 chars), personnalisables, pas de spam words.
Réponds UNIQUEMENT en JSON valide: {"subjects": ["...", "...", "...", "...", "..."]}`,

        body: `Tu es un expert en copywriting B2B. Génère un email de prospection en ${language}, ton ${tone}.
Contexte: ${context}
Utilise les variables: {{prenom}}, {{entreprise}}, {{poste}}. Structure: accroche, valeur, CTA.
Réponds UNIQUEMENT en JSON valide: {"html": "...", "text": "..."}`,

        sequence: `Tu es un expert en cold email automation. Génère une séquence de 3 emails en ${language}, ton ${tone}.
Contexte: ${context}
Email 1 (Jour 0): Premier contact. Email 2 (Jour 3): Relance si pas de réponse. Email 3 (Jour 7): Dernier contact.
Réponds UNIQUEMENT en JSON valide: {"steps": [{"day": 0, "subject": "...", "html": "...", "text": "..."}, {"day": 3, ...}, {"day": 7, ...}]}`,

        icebreaker: `Tu es un expert en personnalisation d'emails. Génère une phrase d'accroche ultra-personnalisée en ${language}.
Contexte du prospect: ${context}
La phrase doit montrer que tu as fait des recherches. Max 2 phrases. Naturel, pas commercial.
Réponds UNIQUEMENT en JSON valide: {"icebreaker": "..."}`,

        personalization: `Tu es un expert en personnalisation B2B. Génère 3 variantes personnalisées pour ce prospect en ${language}.
Contexte: ${context}
Réponds UNIQUEMENT en JSON valide: {"variants": ["...", "...", "..."]}`
    };

    const prompt = prompts[type];
    if (!prompt) return res.status(400).json({ error: `Unknown type. Available: ${Object.keys(prompts).join(', ')}` });

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();
        if (data.error) return res.status(500).json({ error: data.error.message });

        const resultText = data.content?.[0]?.text || '';
        let result;
        try {
            const clean = resultText.replace(/```json\n?|```/g, '').trim();
            result = JSON.parse(clean);
        } catch { result = { text: resultText }; }

        db.run(`INSERT INTO ai_generations (user_id, type, prompt, result, tokens_used)
            VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, type, context, JSON.stringify(result), data.usage?.output_tokens || 0]);

        res.json({ result, tokens_used: data.usage?.output_tokens || 0 });
    } catch (err) {
        res.status(500).json({ error: 'AI generation failed', details: err.message });
    }
});

app.get('/api/ai/history', authenticateToken, (req, res) => {
    db.all('SELECT id, type, prompt, created_at FROM ai_generations WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
        [req.user.id], (err, rows) => res.json(rows || []));
});

// ============================================================================
// CAMPAIGNS
// ============================================================================

app.get('/api/campaigns', authenticateToken, (req, res) => {
    const { status } = req.query;
    let query = 'SELECT * FROM campaigns WHERE user_id=?';
    const params = [req.user.id];
    if (status) { query += ' AND status=?'; params.push(status); }
    query += ' ORDER BY created_at DESC';
    db.all(query, params, (err, rows) => res.json(rows || []));
});

app.get('/api/campaigns/:id', authenticateToken, (req, res) => {
    db.get('SELECT * FROM campaigns WHERE id=? AND user_id=?', [req.params.id, req.user.id], (err, campaign) => {
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        db.all('SELECT * FROM campaign_steps WHERE campaign_id=? ORDER BY step_number', [req.params.id], (err, steps) => {
            res.json({ ...campaign, steps: steps || [] });
        });
    });
});

app.post('/api/campaigns', authenticateToken, (req, res) => {
    const { name, type, list_id, from_name, from_email, reply_to,
            timezone, daily_limit, send_on_weekends, send_time_start, send_time_end } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name required' });

    db.run(`INSERT INTO campaigns (user_id, name, type, list_id, from_name, from_email, reply_to,
            timezone, daily_limit, send_on_weekends, send_time_start, send_time_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, name, type || 'sequence', list_id, from_name, from_email, reply_to,
         timezone || 'Europe/Paris', daily_limit || 100, send_on_weekends ? 1 : 0,
         send_time_start || '08:00', send_time_end || '18:00'],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to create campaign' });
            logActivity(req.user.id, 'campaign_created', 'campaign', this.lastID, { name }, req.ip);
            res.status(201).json({ id: this.lastID, message: 'Campaign created' });
        });
});

app.put('/api/campaigns/:id', authenticateToken, (req, res) => {
    const { name, status, list_id, from_name, from_email, reply_to,
            daily_limit, send_on_weekends, send_time_start, send_time_end } = req.body;
    db.run(`UPDATE campaigns SET name=?, status=?, list_id=?, from_name=?, from_email=?, reply_to=?,
            daily_limit=?, send_on_weekends=?, send_time_start=?, send_time_end=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND user_id=?`,
        [name, status, list_id, from_name, from_email, reply_to, daily_limit,
         send_on_weekends ? 1 : 0, send_time_start, send_time_end, req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ message: 'Campaign updated' });
    });
});

app.delete('/api/campaigns/:id', authenticateToken, (req, res) => {
    db.run("UPDATE campaigns SET status='archived' WHERE id=? AND user_id=?", [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ message: 'Campaign archived' });
    });
});

app.post('/api/campaigns/:id/launch', authenticateToken, (req, res) => {
    db.get('SELECT * FROM campaigns WHERE id=? AND user_id=?', [req.params.id, req.user.id], (err, campaign) => {
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        if (campaign.status === 'active') return res.status(400).json({ error: 'Campaign already active' });
        if (!campaign.list_id) return res.status(400).json({ error: 'Campaign needs a contact list' });

        db.get('SELECT COUNT(*) as count FROM campaign_steps WHERE campaign_id=?', [campaign.id], (err, s) => {
            if (!s?.count) return res.status(400).json({ error: 'Campaign needs at least one email step' });

            db.get(`SELECT COUNT(*) as count FROM contacts WHERE list_id=? AND status='active'`,
                [campaign.list_id], (err, result) => {
                const contactCount = result?.count || 0;

                db.run(`UPDATE campaigns SET status='active', started_at=CURRENT_TIMESTAMP,
                        total_contacts=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                    [contactCount, campaign.id]);

                logActivity(req.user.id, 'campaign_launched', 'campaign', campaign.id, { contactCount }, req.ip);
                res.json({ message: 'Campaign launched', total_contacts: contactCount });
            });
        });
    });
});

app.post('/api/campaigns/:id/pause', authenticateToken, (req, res) => {
    db.run(`UPDATE campaigns SET status='paused', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
        [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ message: 'Campaign paused' });
    });
});

app.post('/api/campaigns/:id/resume', authenticateToken, (req, res) => {
    db.run(`UPDATE campaigns SET status='active', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
        [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ message: 'Campaign resumed' });
    });
});

// Campaign steps
app.get('/api/campaigns/:id/steps', authenticateToken, (req, res) => {
    db.all('SELECT * FROM campaign_steps WHERE campaign_id=? ORDER BY step_number', [req.params.id], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/campaigns/:id/steps', authenticateToken, (req, res) => {
    const { step_number, subject, body_html, body_text, delay_days, delay_hours,
            condition_type, stop_on_reply, template_id } = req.body;
    if (!subject || !body_html) return res.status(400).json({ error: 'Subject and body required' });

    db.run(`INSERT INTO campaign_steps (campaign_id, step_number, subject, body_html, body_text,
            delay_days, delay_hours, condition_type, stop_on_reply, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, step_number || 1, subject, body_html, body_text || '',
         delay_days || 0, delay_hours || 0, condition_type || 'always',
         stop_on_reply !== false ? 1 : 0, template_id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to add step' });
            res.status(201).json({ id: this.lastID, message: 'Step added' });
        });
});

app.put('/api/campaigns/:id/steps/:stepId', authenticateToken, (req, res) => {
    const { subject, body_html, body_text, delay_days, delay_hours, condition_type, stop_on_reply } = req.body;
    db.run(`UPDATE campaign_steps SET subject=?, body_html=?, body_text=?, delay_days=?, delay_hours=?,
            condition_type=?, stop_on_reply=? WHERE id=? AND campaign_id=?`,
        [subject, body_html, body_text, delay_days, delay_hours, condition_type,
         stop_on_reply ? 1 : 0, req.params.stepId, req.params.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Step not found' });
        res.json({ message: 'Step updated' });
    });
});

app.delete('/api/campaigns/:id/steps/:stepId', authenticateToken, (req, res) => {
    db.run('DELETE FROM campaign_steps WHERE id=? AND campaign_id=?', [req.params.stepId, req.params.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Step not found' });
        res.json({ message: 'Step deleted' });
    });
});

// Campaign analytics
app.get('/api/campaigns/:id/stats', authenticateToken, (req, res) => {
    const campaignId = req.params.id;
    db.get('SELECT * FROM campaigns WHERE id=? AND user_id=?', [campaignId, req.user.id], (err, campaign) => {
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        db.all(`SELECT status, COUNT(*) as count FROM email_sends WHERE campaign_id=? GROUP BY status`, [campaignId], (err, breakdown) => {
            db.all(`SELECT DATE(sent_at) as date, COUNT(*) as sent,
                    SUM(CASE WHEN open_count>0 THEN 1 ELSE 0 END) as opened,
                    SUM(CASE WHEN click_count>0 THEN 1 ELSE 0 END) as clicked
                    FROM email_sends WHERE campaign_id=? AND sent_at IS NOT NULL
                    GROUP BY DATE(sent_at) ORDER BY date`,
                [campaignId], (err, timeline) => {

                db.all(`SELECT cs.step_number, COUNT(*) as sent,
                        SUM(CASE WHEN es.open_count>0 THEN 1 ELSE 0 END) as opened,
                        SUM(CASE WHEN es.click_count>0 THEN 1 ELSE 0 END) as clicked,
                        SUM(CASE WHEN es.status='replied' THEN 1 ELSE 0 END) as replied
                        FROM email_sends es
                        JOIN campaign_steps cs ON es.step_id = cs.id
                        WHERE es.campaign_id=? GROUP BY cs.step_number ORDER BY cs.step_number`,
                    [campaignId], (err, stepStats) => {

                    const stats = {};
                    (breakdown || []).forEach(r => { stats[r.status] = r.count; });
                    res.json({
                        campaign: {
                            id: campaign.id, name: campaign.name, status: campaign.status,
                            total_contacts: campaign.total_contacts,
                            open_rate: campaign.open_rate, click_rate: campaign.click_rate, reply_rate: campaign.reply_rate
                        },
                        breakdown: stats,
                        timeline: timeline || [],
                        steps: stepStats || []
                    });
                });
            });
        });
    });
});

// ============================================================================
// EMAIL TRACKING
// ============================================================================

app.get('/track/open/:trackingId', (req, res) => {
    db.get('SELECT id, campaign_id, open_count FROM email_sends WHERE tracking_id=?', [req.params.trackingId], (err, send) => {
        if (send) {
            const isFirstOpen = send.open_count === 0;
            db.run(`UPDATE email_sends SET
                status=CASE WHEN status IN ('sent','delivered') THEN 'opened' ELSE status END,
                open_count=open_count+1,
                first_opened_at=CASE WHEN open_count=0 THEN CURRENT_TIMESTAMP ELSE first_opened_at END,
                last_opened_at=CURRENT_TIMESTAMP WHERE id=?`, [send.id]);

            if (isFirstOpen) {
                db.run(`UPDATE campaigns SET total_opened=total_opened+1,
                    open_rate=ROUND((total_opened+1.0)/NULLIF(total_sent,0)*100,2) WHERE id=?`, [send.campaign_id]);
            }
        }
    });
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.set('Content-Type', 'image/gif').set('Cache-Control', 'no-cache, no-store').end(pixel);
});

app.get('/track/click/:trackingId', (req, res) => {
    const { url } = req.query;
    db.get('SELECT id, campaign_id, click_count FROM email_sends WHERE tracking_id=?', [req.params.trackingId], (err, send) => {
        if (send) {
            db.run(`UPDATE email_sends SET
                clicked_at=CASE WHEN clicked_at IS NULL THEN CURRENT_TIMESTAMP ELSE clicked_at END,
                click_count=click_count+1,
                status=CASE WHEN status IN ('sent','delivered','opened') THEN 'clicked' ELSE status END WHERE id=?`, [send.id]);
            db.run(`UPDATE campaigns SET total_clicked=total_clicked+1,
                click_rate=ROUND((total_clicked+1.0)/NULLIF(total_sent,0)*100,2) WHERE id=?`, [send.campaign_id]);
        }
    });
    if (url) return res.redirect(decodeURIComponent(url));
    res.status(400).send('Missing redirect URL');
});

// ============================================================================
// SMTP CONFIGS
// ============================================================================

app.get('/api/smtp', authenticateToken, (req, res) => {
    db.all(`SELECT id, name, host, port, secure, username, from_name, from_email,
            is_verified, is_default, daily_limit, sent_today FROM smtp_configs WHERE user_id=?`,
        [req.user.id], (err, rows) => res.json(rows || []));
});

app.post('/api/smtp', authenticateToken, async (req, res) => {
    const { name, host, port, secure, username, password, from_name, from_email, is_default } = req.body;
    if (!host || !username || !password || !from_email) return res.status(400).json({ error: 'host, username, password and from_email required' });

    if (is_default) db.run('UPDATE smtp_configs SET is_default=0 WHERE user_id=?', [req.user.id]);

    let verified = false;
    try {
        const transporter = createTransporter({ host, port: port || 587, secure: secure || false, username, password });
        await transporter.verify();
        verified = true;
    } catch (e) {}

    db.run(`INSERT INTO smtp_configs (user_id, name, host, port, secure, username, password, from_name, from_email, is_verified, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, name || host, host, port || 587, secure ? 1 : 0, username, password, from_name, from_email, verified ? 1 : 0, is_default ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to save SMTP config' });
            res.status(201).json({ id: this.lastID, verified, message: verified ? 'SMTP verified and saved' : 'SMTP saved (connection not verified)' });
        });
});

app.post('/api/smtp/:id/test', authenticateToken, async (req, res) => {
    db.get('SELECT * FROM smtp_configs WHERE id=? AND user_id=?', [req.params.id, req.user.id], async (err, smtp) => {
        if (!smtp) return res.status(404).json({ error: 'SMTP config not found' });
        try {
            const transporter = createTransporter(smtp);
            await transporter.verify();
            await transporter.sendMail({
                from: `${smtp.from_name} <${smtp.from_email}>`,
                to: req.user.email,
                subject: '✅ Test SMTP UPPORTUNIX',
                text: 'Votre configuration SMTP fonctionne correctement.'
            });
            db.run('UPDATE smtp_configs SET is_verified=1 WHERE id=?', [smtp.id]);
            res.json({ success: true, message: 'SMTP verified. Test email sent to ' + req.user.email });
        } catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
});

app.delete('/api/smtp/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM smtp_configs WHERE id=? AND user_id=?', [req.params.id, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'SMTP config not found' });
        res.json({ message: 'SMTP config deleted' });
    });
});

// ============================================================================
// ANALYTICS / DASHBOARD
// ============================================================================

app.get('/api/analytics/dashboard', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { period = '30d' } = req.query;
    const days = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const stats = {};

    db.get(`SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM campaigns WHERE user_id=?`,
        [userId], (err, campaigns) => {
        stats.campaigns = campaigns || { total: 0, active: 0 };

        db.get('SELECT COUNT(*) as total FROM contacts WHERE user_id=?', [userId], (err, c) => {
            stats.contacts = c?.total || 0;

            db.get(`SELECT
                COUNT(*) as total_sent,
                SUM(CASE WHEN open_count>0 THEN 1 ELSE 0 END) as total_opened,
                SUM(CASE WHEN click_count>0 THEN 1 ELSE 0 END) as total_clicked,
                SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) as total_replied,
                SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) as total_bounced
                FROM email_sends WHERE user_id=? AND sent_at >= ?`,
                [userId, since], (err, emailStats) => {
                stats.emails = emailStats || { total_sent: 0, total_opened: 0, total_clicked: 0, total_replied: 0, total_bounced: 0 };
                const sent = emailStats?.total_sent || 0;
                stats.emails.open_rate = sent > 0 ? Math.round((emailStats.total_opened / sent) * 1000) / 10 : 0;
                stats.emails.click_rate = sent > 0 ? Math.round((emailStats.total_clicked / sent) * 1000) / 10 : 0;
                stats.emails.reply_rate = sent > 0 ? Math.round((emailStats.total_replied / sent) * 1000) / 10 : 0;
                stats.emails.bounce_rate = sent > 0 ? Math.round((emailStats.total_bounced / sent) * 1000) / 10 : 0;

                db.all(`SELECT DATE(sent_at) as date, COUNT(*) as sent,
                        SUM(CASE WHEN open_count>0 THEN 1 ELSE 0 END) as opened,
                        SUM(CASE WHEN click_count>0 THEN 1 ELSE 0 END) as clicked,
                        SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) as replied
                        FROM email_sends WHERE user_id=? AND sent_at >= ?
                        GROUP BY DATE(sent_at) ORDER BY date`,
                    [userId, since], (err, timeline) => {
                    stats.timeline = timeline || [];

                    db.all(`SELECT id, name, total_sent, open_rate, click_rate, reply_rate, status
                            FROM campaigns WHERE user_id=? AND total_sent>0
                            ORDER BY reply_rate DESC LIMIT 5`,
                        [userId], (err, topCampaigns) => {
                        stats.top_campaigns = topCampaigns || [];

                        db.get('SELECT COUNT(*) as pending FROM users WHERE status="pending"',
                            [], (err, p) => {
                            if (req.user.role === 'admin') stats.pending_approvals = p?.pending || 0;
                            res.json({ period, since, stats });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/analytics/contacts', authenticateToken, (req, res) => {
    const userId = req.user.id;
    db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsubscribed,
        SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) as bounced
        FROM contacts WHERE user_id=?`, [userId], (err, overview) => {

        db.all(`SELECT country, COUNT(*) as count FROM contacts WHERE user_id=?
                GROUP BY country ORDER BY count DESC LIMIT 10`, [userId], (err, byCountry) => {

            db.all(`SELECT DATE(created_at) as date, COUNT(*) as added
                    FROM contacts WHERE user_id=? AND created_at >= date('now','-30 days')
                    GROUP BY DATE(created_at) ORDER BY date`, [userId], (err, growth) => {

                res.json({ overview: overview || {}, by_country: byCountry || [], growth: growth || [] });
            });
        });
    });
});

app.get('/api/analytics/campaigns', authenticateToken, (req, res) => {
    db.all(`SELECT c.id, c.name, c.status, c.type, c.total_contacts, c.total_sent,
            c.open_rate, c.click_rate, c.reply_rate, c.started_at, c.completed_at,
            COUNT(DISTINCT cs.id) as step_count
            FROM campaigns c
            LEFT JOIN campaign_steps cs ON c.id=cs.campaign_id
            WHERE c.user_id=?
            GROUP BY c.id ORDER BY c.created_at DESC`,
        [req.user.id], (err, rows) => res.json(rows || []));
});

// ============================================================================
// ADMIN
// ============================================================================

app.get('/api/admin/users', authenticateToken, isAdmin, (req, res) => {
    const { status, plan, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT id, email, role, first_name, last_name, company, plan, status, email_sent, email_quota, created_at, last_login FROM users WHERE 1=1`;
    const params = [];

    if (status) { query += ' AND status=?'; params.push(status); }
    if (plan) { query += ' AND plan=?'; params.push(plan); }
    if (search) { query += ' AND (email LIKE ? OR company LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    db.all(query, params, (err, rows) => res.json(rows || []));
});

app.put('/api/admin/users/:id', authenticateToken, isAdmin, (req, res) => {
    const { status, plan, email_quota, role } = req.body;
    db.run(`UPDATE users SET status=?, plan=?, email_quota=?, role=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [status, plan, email_quota, role, req.params.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User updated' });
    });
});

app.get('/api/admin/stats', authenticateToken, isAdmin, (req, res) => {
    db.get('SELECT COUNT(*) as total_users, SUM(CASE WHEN status="active" THEN 1 ELSE 0 END) as active_users FROM users', (err, users) => {
        db.get('SELECT COUNT(*) as total, SUM(CASE WHEN status="active" THEN 1 ELSE 0 END) as active FROM campaigns', (err, campaigns) => {
            db.get('SELECT COUNT(*) as total_sends FROM email_sends', (err, sends) => {
                db.get('SELECT SUM(amount) as revenue, COUNT(*) as transactions FROM payments WHERE status="succeeded"', (err, revenue) => {
                    db.all('SELECT plan, COUNT(*) as count FROM users GROUP BY plan', (err, plans) => {
                        res.json({ users, campaigns, sends, revenue, plans: plans || [] });
                    });
                });
            });
        });
    });
});

app.get('/api/admin/activity', authenticateToken, isAdmin, (req, res) => {
    db.all(`SELECT al.*, u.email as user_email FROM activity_log al
            LEFT JOIN users u ON al.user_id=u.id
            ORDER BY al.created_at DESC LIMIT 200`,
        [], (err, rows) => res.json(rows || []));
});

// ============================================================================
// PAYMENTS
// ============================================================================

// Plans Upportunix IA — Email AI 29€/mois
const PLAN_PRICES = {
    starter: 0,       // essai 14 jours
    email_ai: 2900,   // 29€/mois — Email AI
    studio: 0         // sur devis — Studio IA
};

const PLAN_QUOTAS = {
    starter: 100,     // 100 emails pendant l'essai
    email_ai: 1000,   // 1000 emails/mois
    studio: 99999     // illimité pour Studio
};

app.post('/api/payments/create-intent', authenticateToken, (req, res) => {
    const { plan } = req.body;
    const amount = PLAN_PRICES[plan];
    if (amount === undefined || amount === 0) return res.status(400).json({ error: 'Plan invalide ou gratuit' });

    const simulatedPaymentId = 'pi_upportunix_' + Date.now();
    const quota = PLAN_QUOTAS[plan] || 1000;

    db.run(`INSERT INTO payments (user_id, amount, plan, status, stripe_payment_id, description)
        VALUES (?, ?, ?, 'pending', ?, ?)`,
        [req.user.id, amount / 100, plan, simulatedPaymentId, `UPPORTUNIX IA — ${plan}`],
        function(err) {
            if (err) return res.status(500).json({ error: 'Échec création paiement' });
            // Update user plan and quota
            db.run(`UPDATE users SET plan=?, email_quota=?, plan_start=CURRENT_TIMESTAMP,
                    plan_end=datetime('now', '+1 month'), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [plan, quota, req.user.id]);
            res.json({ paymentId: this.lastID, clientSecret: 'simulated_' + simulatedPaymentId, amount, plan });
        });
});

// Stripe webhook (placeholder)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    // TODO: Verify Stripe webhook signature and process events
    // const sig = req.headers['stripe-signature'];
    // const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    res.json({ received: true });
});

app.get('/api/payments', authenticateToken, (req, res) => {
    db.all('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

// ============================================================================
// STUDIO IA — CONTACT FORM
// Route publique pour recevoir les demandes de studio.upportunix-ia.fr
// ============================================================================

// Table studio_contacts (créée au démarrage)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS studio_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT,
        last_name TEXT,
        email TEXT NOT NULL,
        company TEXT,
        service TEXT,
        message TEXT,
        ip_address TEXT,
        status TEXT DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','closed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.post('/api/studio/contact', (req, res) => {
    const { first_name, last_name, email, company, service, message } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'Email et message requis' });

    db.run(`INSERT INTO studio_contacts (first_name, last_name, email, company, service, message, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [first_name, last_name, email, company, service, message, req.ip],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erreur serveur' });

            // Notifier l'admin par email si SMTP configuré
            const adminEmail = process.env.ADMIN_EMAIL || 'studio@upportunix-ia.fr';
            const smtpHost = process.env.SMTP_HOST;
            if (smtpHost) {
                const transporter = nodemailer.createTransport({
                    host: smtpHost,
                    port: parseInt(process.env.SMTP_PORT) || 587,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                });
                transporter.sendMail({
                    from: `"UPPORTUNIX Studio" <${process.env.SMTP_USER}>`,
                    to: adminEmail,
                    subject: `[Studio] Nouvelle demande de ${first_name} ${last_name} — ${company}`,
                    html: `<h2>Nouvelle demande Studio IA</h2>
                           <p><strong>Nom :</strong> ${first_name} ${last_name}</p>
                           <p><strong>Email :</strong> ${email}</p>
                           <p><strong>Entreprise :</strong> ${company}</p>
                           <p><strong>Service :</strong> ${service}</p>
                           <p><strong>Message :</strong><br>${message}</p>`
                }).catch(e => console.error('Studio email notification failed:', e));
            }

            res.status(201).json({ message: 'Demande envoyée avec succès', id: this.lastID });
        }
    );
});

// Vue admin des demandes Studio
app.get('/api/studio/contacts', authenticateToken, isAdmin, (req, res) => {
    db.all('SELECT * FROM studio_contacts ORDER BY created_at DESC', [], (err, rows) => {
        res.json(rows || []);
    });
});

app.put('/api/studio/contacts/:id', authenticateToken, isAdmin, (req, res) => {
    const { status } = req.body;
    db.run('UPDATE studio_contacts SET status=? WHERE id=?', [status, req.params.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ error: 'Contact not found' });
        res.json({ message: 'Statut mis à jour' });
    });
});

// ============================================================================
// SCHEDULER — Envoi automatique des séquences email
// Tourne toutes les 5 minutes, envoie les emails en attente
// ============================================================================

const SCHEDULER_INTERVAL = parseInt(process.env.SCHEDULER_INTERVAL_MS) || 5 * 60 * 1000; // 5 min

async function runEmailScheduler() {
    const now = new Date();
    const hour = now.getHours();

    // Récupère toutes les campagnes actives
    db.all(`SELECT c.*, s.host, s.port, s.secure, s.username, s.password, s.from_name, s.from_email as smtp_from
            FROM campaigns c
            LEFT JOIN smtp_configs s ON s.user_id = c.user_id AND s.is_default = 1
            WHERE c.status = 'active'`,
        [], (err, campaigns) => {
            if (err || !campaigns.length) return;

            campaigns.forEach(campaign => {
                // Respecter les plages horaires d'envoi
                const startHour = parseInt((campaign.send_time_start || '08:00').split(':')[0]);
                const endHour = parseInt((campaign.send_time_end || '18:00').split(':')[0]);
                if (hour < startHour || hour >= endHour) return;

                // Pas d'envoi le week-end si désactivé
                const day = now.getDay();
                if (!campaign.send_on_weekends && (day === 0 || day === 6)) return;

                if (!campaign.host) return; // pas de SMTP configuré

                // Récupère les étapes de la campagne
                db.all(`SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_number`,
                    [campaign.id], (err, steps) => {
                        if (!steps || !steps.length) return;

                        steps.forEach(step => {
                            // Contacts actifs de la liste qui n'ont pas encore reçu cet email
                            db.all(`SELECT c.* FROM contacts c
                                    WHERE c.list_id = ? AND c.status = 'active'
                                    AND c.id NOT IN (
                                        SELECT contact_id FROM email_sends
                                        WHERE campaign_id = ? AND step_id = ?
                                    )
                                    LIMIT ?`,
                                [campaign.list_id, campaign.id, step.id, campaign.daily_limit || 100],
                                (err, contacts) => {
                                    if (!contacts || !contacts.length) return;

                                    const transporter = createTransporter(campaign);

                                    contacts.forEach(contact => {
                                        // Personnaliser le contenu
                                        const personalize = (text) => (text || '')
                                            .replace(/\{\{prenom\}\}/gi, contact.first_name || '')
                                            .replace(/\{\{nom\}\}/gi, contact.last_name || '')
                                            .replace(/\{\{entreprise\}\}/gi, contact.company || '')
                                            .replace(/\{\{poste\}\}/gi, contact.job_title || '');

                                        const trackingId = crypto.randomBytes(16).toString('hex');
                                        const subject = personalize(step.subject);
                                        const apiUrl = process.env.API_URL || 'http://localhost:4000';
                                        const trackPixel = `<img src="${apiUrl}/track/open/${trackingId}" width="1" height="1" style="display:none"/>`;
                                        const unsubLink = `<p style="font-size:11px;color:#999;margin-top:20px"><a href="${apiUrl}/unsubscribe/${trackingId}">Se désabonner</a></p>`;
                                        const bodyHtml = personalize(step.body_html) + trackPixel + unsubLink;

                                        // Insérer le send en base
                                        db.run(`INSERT INTO email_sends (campaign_id, step_id, contact_id, user_id, subject, status, tracking_id, message_id)
                                                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
                                            [campaign.id, step.id, contact.id, campaign.user_id, subject, trackingId, trackingId],
                                            function(err) {
                                                if (err) return;
                                                const sendId = this.lastID;

                                                transporter.sendMail({
                                                    from: `"${campaign.from_name || campaign.smtp_from}" <${campaign.from_email || campaign.smtp_from}>`,
                                                    to: contact.email,
                                                    subject,
                                                    html: bodyHtml,
                                                    text: personalize(step.body_text || '')
                                                }).then(() => {
                                                    db.run(`UPDATE email_sends SET status='sent', sent_at=CURRENT_TIMESTAMP, message_id=? WHERE id=?`,
                                                        [trackingId, sendId]);
                                                    db.run(`UPDATE campaigns SET total_sent=total_sent+1 WHERE id=?`, [campaign.id]);
                                                    db.run(`UPDATE users SET email_sent=email_sent+1 WHERE id=?`, [campaign.user_id]);
                                                }).catch(e => {
                                                    db.run(`UPDATE email_sends SET status='failed', error_message=? WHERE id=?`,
                                                        [e.message, sendId]);
                                                });
                                            }
                                        );
                                    });
                                }
                            );
                        });
                    }
                );
            });
        }
    );
}

// Démarrer le scheduler
setInterval(runEmailScheduler, SCHEDULER_INTERVAL);
console.log(`⏰ Email scheduler démarré — interval: ${SCHEDULER_INTERVAL / 1000}s`);

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'UPPORTUNIX IA API',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        database: 'connected',
        ai_model: 'claude-sonnet-4-6',
        scheduler: 'active',
        features: ['email-ai', 'studio-contact', 'sequences', 'tracking', 'rgpd']
    });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║        📧 UPPORTUNIX IA API v2.0 — Running                       ║
║                                                                   ║
║        Port: ${PORT}                                                ║
║        Environment: ${NODE_ENV}                                    ║
║        AI Model: claude-sonnet-4-6                                ║
║                                                                   ║
║        AUTH          POST  /api/auth/register                     ║
║                      POST  /api/auth/login                        ║
║                      POST  /api/auth/forgot-password              ║
║                      POST  /api/auth/reset-password               ║
║                                                                   ║
║        CONTACTS      GET   /api/contacts                          ║
║                      POST  /api/contacts                          ║
║                      POST  /api/contacts/import (CSV)             ║
║                      GET   /api/lists                             ║
║                                                                   ║
║        CAMPAIGNS     GET   /api/campaigns                         ║
║                      POST  /api/campaigns                         ║
║                      POST  /api/campaigns/:id/launch              ║
║                      GET   /api/campaigns/:id/stats               ║
║                      GET   /api/campaigns/:id/steps               ║
║                                                                   ║
║        TEMPLATES     GET   /api/templates                         ║
║                      POST  /api/templates                         ║
║                                                                   ║
║        AI            POST  /api/ai/generate (claude-sonnet-4-6)   ║
║                      GET   /api/ai/history                        ║
║                                                                   ║
║        SMTP          GET   /api/smtp                              ║
║                      POST  /api/smtp                              ║
║                      POST  /api/smtp/:id/test                     ║
║                                                                   ║
║        ANALYTICS     GET   /api/analytics/dashboard               ║
║                      GET   /api/analytics/campaigns               ║
║                      GET   /api/analytics/contacts                ║
║                                                                   ║
║        STUDIO        POST  /api/studio/contact  (public)          ║
║                      GET   /api/studio/contacts (admin)           ║
║                                                                   ║
║        ADMIN         GET   /api/admin/users                       ║
║                      GET   /api/admin/stats                       ║
║                      GET   /api/admin/activity                    ║
║                                                                   ║
║        TRACKING      GET   /track/open/:id                        ║
║                      GET   /track/click/:id                       ║
║                      GET   /unsubscribe/:id                       ║
║                                                                   ║
║        SCHEDULER     ⏰ Actif — envoi séquences toutes les 5min   ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});

process.on('SIGINT', () => {
    db.close(() => { console.log('✅ Database closed'); process.exit(0); });
});
