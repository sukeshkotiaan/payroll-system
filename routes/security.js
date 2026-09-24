const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const OTP = require('../models/OTP');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Settings = require('../models/Settings');
const nodemailer = require('nodemailer');
const { isLoggedIn, notSupervisor } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

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

// GENERATE OTP for accountant login — admin-only internal route (not used by the login flow,
// which calls sendOTPToL1 directly from auth.js).  Restricted to admin to prevent misuse.
router.post('/generate-otp', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    // Only admin may trigger a manual OTP generation to prevent social-engineering abuse
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { userId, username, fullName } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

    await OTP.deleteMany({ userId, used: false });
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await OTP.create({ userId, username, code, expiresAt });
    await sendOTPToL1(username, fullName, code);

    return res.json({ success: true, message: 'OTP sent to Management L1' });
  } catch (err) {
    console.error('[generate-otp]', err.message);
    return res.status(500).json({ success: false, message: 'An error occurred. Please try again.' });
  }
});

// VERIFY OTP — validates OTP during the accountant login flow.
// Requires a pending OTP session established by POST /api/auth/login.
// The userId in the request must match the session's pendingOTP.userId.
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ success: false, message: 'userId and code are required' });
    }
    // Require a valid pending OTP session; userId must match the session's record
    const pending = req.session && req.session.pendingOTP;
    if (!pending || String(pending.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'No pending login session. Please login again.' });
    }
    const otp = await OTP.findOne({ userId, used: false });

    if (!otp) return res.status(400).json({ success: false, message: 'No OTP found. Please try logging in again.' });
    if (otp.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'OTP has expired. Please login again.' });

    const MAX_OTP_ATTEMPTS = 5;
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      otp.used = true;
      await otp.save();
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    if (otp.code !== String(code).trim()) {
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
    console.error('[verify-otp]', err.message);
    return res.status(500).json({ success: false, message: 'An error occurred. Please try again.' });
  }
});

// GET security config (for Settings page)
router.get('/config', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const config = settings ? (settings.securityConfig || {}) : {};
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'security config get') });
  }
});

// SAVE security config (L1 + Admin only)
// NOTE: managementLevel is stored as Number (1, 2, 3) in the User model, not as 'L1'/'L2'.
router.post('/config', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const isL1 = user.role === 'management' && Number(user.managementLevel) === 1;
    if (user.role !== 'admin' && !isL1) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.securityConfig = req.body;
    await settings.save();
    return res.json({ success: true, message: 'Security settings saved' });
  } catch (err) {
    console.error('[security config save]', err.message);
    return res.status(500).json({ success: false, message: 'An error occurred. Please try again.' });
  }
});

// GET audit logs (Admin + L1 only)
router.get('/audit-log', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const isL1 = user.role === 'management' && Number(user.managementLevel) === 1;
    if (user.role !== 'admin' && !isL1) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const filter = {};
    if (req.query.username) filter.username = req.query.username;
    if (req.query.role) filter.role = req.query.role;
    if (req.query.from) filter.timestamp = { $gte: new Date(req.query.from) };
    if (req.query.to) filter.timestamp = { ...filter.timestamp, $lte: new Date(req.query.to) };

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const skip  = Math.max(parseInt(req.query.skip)  || 0, 0);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(filter)
    ]);
    return res.json({ success: true, logs, pagination: { skip, limit, total } });
  } catch (err) {
    console.error('[audit log]', err.message);
    return res.status(500).json({ success: false, message: 'An error occurred. Please try again.' });
  }
});

module.exports = { router, logAudit, sendOTPToL1 };
