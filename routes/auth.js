const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { isLoggedIn } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');

// Seed default admin on first run
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('Admin@1234', 12);
      await User.create({
        username: 'admin',
        password: hashedPassword,
        fullName: 'System Administrator',
        role: 'admin',
        branch: 'all'
      });
      console.log('✅ Default admin created → username: admin / password: Admin@1234');
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

    if (user.role === 'supervisor') {
      const emp = await Employee.findOne({ employeeName: user.fullName, isActive: true });
      if (emp) {
        sessionUser.supervisorEIN = emp.ein;
        sessionUser.supervisorEmployeeId = emp._id;
        sessionUser.location = emp.location;
        sessionUser.section = emp.section;
        sessionUser.profile = emp.profile;
      }
    }

    req.session.user = sessionUser;

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