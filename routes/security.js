const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const OTP = require('../models/OTP');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Settings = require('../models/Settings');
const nodemailer = require('nodemailer');
const { isLoggedIn } = require('../middleware/auth');

// Helper: generate cryptographically secure 6-digit OTP
function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Helper: send OTP email to all Management L1 users
async function sendOTPToL1(username, fullName, code) {
  const l1Users = await User.find({ role: 'management', managementLevel: 'L1', isActive: true });
  const emails = l1Users.map(u => u.email).filter(Boolean);
  if (!emails.length) {
    console.log('No L1 users with email found');
    return;
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
  await transporter.sendMail({
    from: '"Payroll System Security" <' + process.env.GMAIL_USER + '>',
    to: emails.join(','),
    subject: 'Login OTP — ' + fullName + ' (' + username + ')',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;">
        <h2 style="color:#1a73e8;">Login OTP Request</h2>
        <p><strong>${fullName}</strong> (${username}) is attempting to log into the Payroll System.</p>
        <div style="background:#f0f2f5;padding:20px;border-radius:8px;text-align:center;margin:20px 0;">
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a73e8;">${code}</div>
          <div style="color:#666;margin-top:8px;">Valid for 5 minutes</div>
        </div>
        <p>Share this OTP with the user to complete their login.</p>
        <p style="color:#999;font-size:12px;">If you did not expect this login attempt, please investigate immediately.</p>
      </div>
    `
  });
}

// Helper: log audit event
async function logAudit(userId, username, fullName, role, action, details, ip) {
  try {
    await AuditLog.create({ userId, username, fullName, role, action, details, ip });
  } catch(e) {
    console.error('Audit log error:', e.message);
  }
}

// GENERATE OTP for accountant login (called from auth.js after password verified)
router.post('/generate-otp', isLoggedIn, async (req, res) => {
  try {
    const { userId, username, fullName } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

    // Invalidate any existing OTPs for this user
    await OTP.deleteMany({ userId, used: false });

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await OTP.create({ userId, username, code, expiresAt });

    // Send to all L1 management users
    await sendOTPToL1(username, fullName, code);

    return res.json({ success: true, message: 'OTP sent to Management L1' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// VERIFY OTP (with brute-force protection — max 5 attempts)
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, code } = req.body;
    const otp = await OTP.findOne({ userId, used: false });

    if (!otp) return res.status(400).json({ success: false, message: 'No OTP found. Please try logging in again.' });
    if (otp.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'OTP has expired. Please login again.' });

    const MAX_OTP_ATTEMPTS = 5;
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      otp.used = true;
      await otp.save();
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    if (otp.code !== code) {
      otp.attempts = (otp.attempts || 0) + 1;
      await otp.save();
      const remaining = MAX_OTP_ATTEMPTS - otp.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    otp.used = true;
    await otp.save();

    return res.json({ success: true, message: 'OTP verified' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET security config (for Settings page)
router.get('/config', isLoggedIn, async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const config = settings ? (settings.securityConfig || {}) : {};
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SAVE security config (L1 + Admin only)
router.post('/config', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    if (user.role !== 'admin' && !(user.role === 'management' && user.managementLevel === 'L1')) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.securityConfig = req.body;
    await settings.save();
    return res.json({ success: true, message: 'Security settings saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET audit logs (Admin + L1 only)
router.get('/audit-log', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    if (user.role !== 'admin' && !(user.role === 'management' && user.managementLevel === 'L1')) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const filter = {};
    if (req.query.username) filter.username = req.query.username;
    if (req.query.role) filter.role = req.query.role;
    if (req.query.from) filter.timestamp = { $gte: new Date(req.query.from) };
    if (req.query.to) filter.timestamp = { ...filter.timestamp, $lte: new Date(req.query.to) };

    const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(500);
    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { router, logAudit, sendOTPToL1 };
