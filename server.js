require('dotenv').config();
process.on('unhandledRejection', (reason, promise) => {
  console.log('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION:', err.message);
  console.log(err.stack);
  process.exit(1);
});

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const { securityHeaders, noSQLSanitizer } = require('./middleware/security');

// Trust Render.com / reverse-proxy so that req.ip resolves correctly
app.set('trust proxy', 1);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.log('❌ MongoDB Connection Error:', err));

// Rate limiting — login endpoint: max 10 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});

// Security headers on every response
app.use(securityHeaders);

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Block /uploads/* from the unauthenticated static middleware — must run before express.static
// Employee photos are served through the authenticated route registered below after session init.
app.use('/uploads', (req, res, next) => {
  // Allow access only after session is verified (session middleware hasn't run yet here,
  // so we redirect to the authenticated /api/uploads/* handler instead of 403-ing directly).
  // Returning 403 here effectively blocks all static serving of uploads.
  return res.status(403).json({ success: false, message: 'Direct access to uploads is not permitted' });
});

// Serve static public assets (CSS, JS, HTML pages) — uploads directory is blocked above
app.use(express.static(path.join(__dirname, 'public')));

// NoSQL injection prevention — sanitize req.query/body/params on every API call
app.use('/api/', noSQLSanitizer);

// Apply login rate limiter early (before session middleware to save DB round-trips on blocked requests)
app.use('/api/auth/login', loginLimiter);

// Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// ── Authenticated file serving for employee photos ────────────────────────────
// /uploads/* is blocked from anonymous access above; authenticated users get it here.
// Public photo-upload page (token-auth) is also allowed for upload submissions.
app.get('/uploads/*', (req, res, next) => {
  // Allow: authenticated session OR a valid upload-photo page session check is done
  // in the public upload flow (the file is served only when a valid token was used).
  // For simplicity and security, require a session for all direct file reads.
  if (req.session && req.session.user) return next();
  // No session — deny
  return res.status(401).json({ success: false, message: 'Authentication required' });
}, (req, res) => {
  const requestedPath = req.params[0]; // everything after /uploads/
  // Prevent path traversal — reject any path with '..' segments
  if (requestedPath.includes('..') || requestedPath.includes('%2e') || requestedPath.includes('%2E')) {
    return res.status(400).json({ success: false, message: 'Invalid path' });
  }
  const filePath = path.join(__dirname, 'public', 'uploads', requestedPath);
  // Ensure the resolved path stays inside the uploads directory
  const uploadsBase = path.resolve(path.join(__dirname, 'public', 'uploads'));
  if (!path.resolve(filePath).startsWith(uploadsBase + path.sep) &&
      path.resolve(filePath) !== uploadsBase) {
    return res.status(400).json({ success: false, message: 'Invalid path' });
  }
  res.sendFile(filePath, err => {
    if (err) return res.status(404).json({ success: false, message: 'File not found' });
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/exits', require('./routes/exits'));
app.use('/api/users', require('./routes/users'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/attendance-template', require('./routes/attendance-template'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/arrears', require('./routes/arrears'));
app.use('/api/tds', require('./routes/tds'));
app.use('/api/ot', require('./routes/ot'));
app.use('/api/appraisals', require('./routes/appraisals'));
app.use('/api/security', require('./routes/security').router);
app.use('/api/employee-submissions', require('./routes/employeeSubmissions'));
app.use('/api/reserved-eins', require('./routes/reservedEins'));
app.use('/api/schoolinfo', require('./routes/schoolinfo'));
app.use('/api/email', require('./routes/email'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/extra-pay', require('./routes/extra-pay'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/photo-upload', require('./routes/photo-upload'));

// Page Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});
app.get('/employees', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'employees.html'));
});
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'settings.html'));
});
app.get('/exits', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'exits.html'));
});
app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'users.html'));
});

app.get('/attendance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'attendance.html'));
});

app.get('/payslip', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'payslip.html'));
});

app.get('/payroll', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'payroll.html'));
});

app.get('/arrears', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'arrears.html'));
});

app.get('/audit-log', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'audit-log.html'));
});

app.get('/submissions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'submissions.html'));
});

app.get('/join-form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'join-form.html'));
});

app.get('/appraisals', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'appraisals.html'));
});

app.get('/adjustments', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'adjustments.html'));
});

app.get('/payroll-status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'payroll-status.html'));
});

// Legacy dead-link redirect
app.get('/payroll-approval', (req, res) => { res.redirect('/payroll-status'); });

app.get('/ot', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'ot.html'));
});

app.get('/tds', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'tds.html'));
});

app.get('/loans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'loans.html'));
});

app.get('/extra-pay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'extra-pay.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html'));
});

app.get('/school-info', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'school-info.html'));
});

app.get('/bank-details', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'bank-details.html'));
});

app.get('/supervisor-mapping', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'supervisor-mapping.html'));
});
app.get('/masters', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'masters.html'));
});

app.get('/id-cards', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'id-cards.html'));
});

app.get('/photo-task', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'photo-task.html'));
});

// Public — no auth (token is the auth)
app.get('/upload-photo/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'upload-photo.html'));
});

app.get('/attendance-exceptions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'attendance-exceptions.html'));
});

// Health check — used by load balancers and uptime monitors
app.get('/healthz', (req, res) => {
  const dbState = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (dbState === 1) {
    return res.json({ status: 'ok', db: 'connected' });
  }
  return res.status(503).json({ status: 'degraded', db: 'disconnected' });
});

// Removed: /api/test endpoint (unnecessary exposure in production)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});