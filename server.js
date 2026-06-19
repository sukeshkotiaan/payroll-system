require('dotenv').config();
process.on('unhandledRejection', (reason, promise) => {
  console.log('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION:', err.message);
  console.log(err.stack);
});

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');

const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.log('❌ MongoDB Connection Error:', err));

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
    httpOnly: true
  }
}));

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
app.use('/api/schoolinfo', require('./routes/schoolinfo'));
app.use('/api/email', require('./routes/email'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/loans', require('./routes/loans'));

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
app.use('/api/users', require('./routes/users'));

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

app.get('/tds', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'tds.html'));
});

app.get('/loans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'loans.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html'));
});

app.get('/school-info', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'school-info.html'));
});

app.get('/supervisor-mapping', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'supervisor-mapping.html'));
});
app.get('/masters', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'masters.html'));
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API working' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});