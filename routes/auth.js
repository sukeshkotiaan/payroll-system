const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { isLoggedIn } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Settings = require('../models/Settings');
const { logAudit } = require('./security');

// Seed default admin on first run
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const crypto = require('crypto');
      const rawPassword = crypto.randomBytes(10).toString('base64url'); // e.g. "a3Fk9mXqZp"
      const hashedPassword = await bcrypt.hash(rawPassword, 12);
      await User.create({
        username: 'admin',
        password: hashedPassword,
        fullName: 'System Administrator',
        role: 'admin',
        branch: 'all'
      });
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('  DEFAULT ADMIN CREATED — CHANGE THIS PASSWORD NOW');
      console.log('  Username : admin');
      console.log(`  Password : ${rawPassword}`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    } else {
      console.log('✅ Admin already exists');
    }
  } catch (err) {
    console.log('Seed error:', err.message);
  }
};
seedAdmin();

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    const sessionUser = {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      managementLevel: user.managementLevel || null,
      branch: user.branch,
      branches: user.branches || []
    };

    // Link ALL roles to their employee record (gives location/section/profile/EIN)
    const emp = await Employee.findOne({ employeeName: user.fullName, isActive: true });
    if (emp) {
      sessionUser.employeeId = emp._id;
      sessionUser.ein = emp.ein;
      sessionUser.location = emp.location;
      sessionUser.section = emp.section;
      sessionUser.profile = emp.profile;
      if (user.role === 'supervisor') {
        sessionUser.supervisorEIN = emp.ein;
        sessionUser.supervisorEmployeeId = emp._id;
      }
      // Self-heal: persist the link to the User record if it was missing
      if (!user.ein || !user.employeeId) {
        user.ein = emp.ein;
        user.employeeId = emp._id;
        await user.save();
      }
    }

    // SECURITY CHECK 1: Supervisor time-window restriction
    if (user.role === 'supervisor') {
      const settings = await Settings.findOne();
      const sec = settings && settings.securityConfig ? settings.securityConfig : {};
      if (sec.supervisorLoginEnabled !== false) {
        const now = new Date();
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const todayDay = days[now.getDay()];
        const allowedDays = sec.supervisorLoginDays || ['Mon','Tue','Wed','Thu','Fri','Sat'];
        const startTime = sec.supervisorLoginStart || '06:00';
        const endTime = sec.supervisorLoginEnd || '20:00';
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        const dayAllowed = allowedDays.includes(todayDay);
        const timeAllowed = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        if (!dayAllowed || !timeAllowed) {
          const msg = sec.supervisorLoginMessage || 'Access is restricted to school hours only.';
          return res.status(403).json({
            success: false,
            message: msg + ' Allowed: ' + allowedDays.join(', ') + ' ' + startTime + ' to ' + endTime
          });
        }
      }
    }

    // SECURITY CHECK 2: Accountant OTP — don't set session yet, return pending
    if (user.role === 'accountant') {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      await logAudit(user._id, user.username, user.fullName, user.role, 'LOGIN_OTP_REQUESTED', 'OTP requested for accountant login', ip);
      // Store temp data in a short-lived session key for OTP verification
      req.session.pendingOTP = {
        userId: user._id.toString(),
        sessionUser,
        emp: emp ? emp._id.toString() : null
      };
      // Check that at least one L1 manager has a registered email before generating OTP
      const l1Users = await User.find({ role: 'management', managementLevel: 'L1', isActive: true });
      const l1Emails = l1Users.map(u => u.email).filter(Boolean);
      if (!l1Emails.length) {
        return res.status(503).json({
          success: false,
          message: 'Login is temporarily unavailable: no Management (L1) contact has an email address registered. Please ask your system administrator to add an email to an L1 management user account before logging in.'
        });
      }

      // Generate and send OTP
      const OTP = require('../models/OTP');
      const crypto = require('crypto');
      const code = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await OTP.deleteMany({ userId: user._id, used: false });
      await OTP.create({ userId: user._id, username: user.username, code, expiresAt });
      const { sendOTPToL1 } = require('./security');
      await sendOTPToL1(user.username, user.fullName, code);
      return res.json({
        success: false,
        otpRequired: true,
        message: 'OTP sent to Management (' + l1Emails.length + ' contact' + (l1Emails.length > 1 ? 's' : '') + '). Please enter the OTP to complete login.'
      });
    }

    req.session.user = sessionUser;

    // Audit log successful login
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(user._id, user.username, user.fullName, user.role, 'LOGIN', 'Successful login', ip);

    // Auto-generate attendance for Management users (all levels)
    if (user.role === 'management' && emp) {
      await autoMarkManagementAttendance(emp, sessionUser);
    }
    return res.json({
      success: true,
      message: 'Login successful',
      user: req.session.user
    });
  } catch (err) {
    console.log('LOGIN ROUTE ERROR:', err.message);
    console.log(err.stack);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// LOGOUT
// VERIFY OTP for accountant login
router.post('/verify-otp', async (req, res) => {
  try {
    const { code } = req.body;
    const pending = req.session.pendingOTP;
    if (!pending) {
      return res.status(400).json({ success: false, message: 'Session expired. Please login again.' });
    }
    const OTP = require('../models/OTP');
    const otp = await OTP.findOne({ userId: pending.userId, used: false });
    if (!otp) return res.status(400).json({ success: false, message: 'No OTP found. Please login again.' });
    if (otp.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'OTP expired. Please login again.' });

    // Brute-force protection: max 5 attempts per OTP
    const MAX_OTP_ATTEMPTS = 5;
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      otp.used = true; // invalidate after too many attempts
      await otp.save();
      delete req.session.pendingOTP;
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please login again.' });
    }

    if (otp.code !== String(code).trim()) {
      otp.attempts += 1;
      await otp.save();
      const remaining = MAX_OTP_ATTEMPTS - otp.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    otp.used = true;
    await otp.save();

    // Complete the login
    req.session.user = pending.sessionUser;
    delete req.session.pendingOTP;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(pending.userId, pending.sessionUser.username, pending.sessionUser.fullName, 'accountant', 'LOGIN', 'Successful login via OTP', ip);

    return res.json({ success: true, message: 'Login successful', user: req.session.user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out' });
});

// GET current user
router.get('/me', isLoggedIn, (req, res) => {
  res.json({ success: true, user: req.session.user });
});


async function autoMarkManagementAttendance(emp, sessionUser) {
  try {
    const now = new Date();
    const month = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'][now.getMonth()];
    const year = now.getFullYear();
    const today = now.getDate();
    const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();

    let record = await Attendance.findOne({
      month, year, location: emp.location, section: emp.section, profile: emp.profile
    });

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, now.getMonth(), d);
      const dayOfWeek = dateObj.getDay(); // 0=Sun, 6=Sat
      let status = '';
      if (d <= today) {
        status = (dayOfWeek === 0 || dayOfWeek === 6) ? 'WO' : 'P';
      }
      days.push({ day: d, status, otHours: 0 });
    }
    const presentCount = days.filter(d => d.status === 'P').length;
    const woCount = days.filter(d => d.status === 'WO').length;

    const empRecord = {
      ein: emp.ein, employeeId: emp._id, employeeName: emp.employeeName,
      designation: emp.designation || '', daysInMonth, days,
      presentDays: presentCount, cl: 0, sl: 0, pl: 0, spL: 0,
      absent: 0, halfDays: 0, weekOff: woCount, holidays: 0, otHours: 0,
      lopDays: 0, payableDays: presentCount + woCount, remarks: 'Auto-marked (Management)'
    };

    if (record) {
      const idx = record.records.findIndex(r => r.ein === emp.ein);
      if (idx >= 0) record.records[idx] = empRecord;
      else record.records.push(empRecord);
      record.updatedAt = new Date();
      await record.save();
    } else {
      const sname = emp.section === 'State' ? 'Xaviers' : 'Global';
      await Attendance.create({
        month, year, location: emp.location, section: emp.section, profile: emp.profile,
        groupName: sname + ' ' + emp.location + ' ' + emp.profile,
        status: 'Approved',
        records: [empRecord],
        uploadedBy: sessionUser.fullName
      });
    }
  } catch (err) {
    console.log('Auto-attendance error:', err.message);
  }
}

module.exports = router;