require('dotenv').config();
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
app.use(express.json());
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