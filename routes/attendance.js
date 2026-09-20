const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');
const { logAudit } = require('./security');

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function getMonthIndex(month) {
  return MONTHS.indexOf(month);
}

function getDaysInMonth(month, year) {
  return new Date(parseInt(year), getMonthIndex(month) + 1, 0).getDate();
}

function getGroupName(section, location, profile) {
  if (section === 'State') return 'Xaviers ' + location;
  if (section === 'Global' && profile === 'Teaching') return 'Global Teaching';
  if (section === 'Global' && profile === 'Non-Teaching') return 'Global Non-Teaching';
  return section + ' ' + location + ' ' + profile;
}

function calculateTotals(days) {
  let presentDays = 0, cl = 0, sl = 0, pl = 0, spL = 0;
  let absent = 0, halfDays = 0, weekOff = 0, holidays = 0, otHours = 0;
  days.forEach(d => {
    switch(d.status) {
      case 'P':  presentDays += 1; break;
      case 'A':  absent += 1; break;
      case 'CL': cl += 1; presentDays += 1; break;
      case 'SL': sl += 1; presentDays += 1; break;
      case 'PL': pl += 1; presentDays += 1; break;
      case 'SpL': spL += 1; presentDays += 1; break;
      case 'H':  holidays += 1; break;
      case 'WO': weekOff += 1; break;
      case 'HD': halfDays += 1; presentDays += 0.5; break;
      case 'OT': presentDays += 1; otHours += d.otHours || 0; break;
    }
  });
  const lopDays = absent;
  // payableDays = days the employee is entitled to pay (present + paid leaves + week-offs + holidays)
  const payableDays = presentDays + weekOff + holidays;
  return { presentDays, cl, sl, pl, spL, absent, halfDays, weekOff, holidays, otHours, lopDays, payableDays };
}

// ── Ownership helper ──────────────────────────────────────────────────────────
// Supervisors may only access attendance records they own.
// Returns true if the requesting user is allowed to access/modify this record.
function canAccessAttendance(user, attendance) {
  if (user.role === 'admin' || user.role === 'management') return true;
  if (user.role === 'accountant') {
    // Accountants scoped to their branch; no supervisorId restriction needed
    const branches = user.branches || [];
    if (branches.includes('all')) return true;
    return !attendance.location || branches.includes(attendance.location);
  }
  if (user.role === 'supervisor') {
    // Supervisor must own the attendance record
    return attendance.supervisorId && attendance.supervisorId.toString() === user.id.toString();
  }
  return false;
}

// GET all attendance records
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};
    if (user.role === 'accountant') {
      if (user.branches && !user.branches.includes('all')) {
        filter.location = { $in: user.branches };
      }
    }
    if (user.role === 'supervisor') {
      filter.supervisorId = user.id;
    }
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.section) filter.section = req.query.section;
    if (req.query.profile) filter.profile = req.query.profile;
    const records = await Attendance.find(filter)
      .select('-records')
      .sort({ year: -1, month: -1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance list') });
  }
});

// GET employees for template
router.get('/template/employees', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year required' });
    }
    const user = req.session.user;
    let filter = { isActive: true };

    if (user.role === 'supervisor') {
      // Supervisor's team can span any location/section/profile - filter ONLY by supervisorId
      filter.supervisorId = user.id;
    } else {
      // Admin/accountant must specify exact group
      if (!location || !section || !profile) {
        return res.status(400).json({ success: false, message: 'Location, section, profile required' });
      }
      filter.location = location;
      filter.section = section;
      filter.profile = profile;
    }

    const employees = await Employee.find(filter).sort({ ein: 1 });
    const daysInMonth = getDaysInMonth(month, year);
    return res.json({ success: true, employees, daysInMonth });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance template employees') });
  }
});

// GET supervisors list
router.get('/supervisors/list', isLoggedIn, async (req, res) => {
  try {
    const User = require('../models/User');
    const supervisors = await User.find({ role: 'supervisor', isActive: true }, { password: 0 });
    return res.json({ success: true, supervisors });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance supervisors list') });
  }
});

// SAVE / UPDATE attendance
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const { month, year, location, section, profile, records } = req.body;
    if (!month || !year || !location || !section || !profile) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    // Supervisors: verify every EIN in the submission belongs to their team
    if (user.role === 'supervisor') {
      const submittedEINs = (records || []).map(r => r.ein).filter(Boolean);
      if (submittedEINs.length > 0) {
        const owned = await Employee.find({
          ein: { $in: submittedEINs },
          supervisorId: user.id,
          isActive: true
        }).select('ein');
        const ownedEINs = new Set(owned.map(e => e.ein));
        const unauthorized = submittedEINs.filter(e => !ownedEINs.has(e));
        if (unauthorized.length > 0) {
          return res.status(403).json({
            success: false,
            message: 'Access denied — some employees in this submission are not in your team'
          });
        }
      }
    }

    const processedRecords = records.map(r => {
      const totals = calculateTotals(r.days || []);
      return { ...r, ...totals };
    });
    let existing = await Attendance.findOne({
      month, year: parseInt(year), location, section, profile
    });
    if (existing) {
      // Ownership check on update
      if (!canAccessAttendance(user, existing)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      if (existing.status === 'Approved') {
        return res.status(400).json({ success: false, message: 'Attendance is approved and cannot be edited' });
      }
      existing.records = processedRecords;
      existing.uploadedBy = req.session.user.username;
      existing.updatedAt = new Date();
      existing.markModified('records');
      await existing.save();
      return res.json({ success: true, message: 'Attendance updated successfully', record: existing });
    }
    const groupName = getGroupName(section, location, profile);
    const attendance = await Attendance.create({
      month, year: parseInt(year), location, section, profile,
      groupName, records: processedRecords,
      supervisorId: user.role === 'supervisor' ? user.id : null,
      uploadedBy: user.username
    });
    return res.json({ success: true, message: 'Attendance saved successfully', record: attendance });
  } catch (err) {
    console.error('Attendance POST error:', err.message);
    return res.status(500).json({ success: false, message: safeError(err, 'attendance save') });
  }
});

// UPDATE day status for one employee
router.patch('/:id/day', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const { ein, day, status, otHours } = req.body;
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });

    // Ownership check
    if (!canAccessAttendance(user, attendance)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (attendance.status === 'Locked') {
      return res.status(400).json({ success: false, message: 'Attendance is locked' });
    }

    // Supervisor: the EIN being updated must be in their team
    if (user.role === 'supervisor' && ein) {
      const emp = await Employee.findOne({ ein, supervisorId: user.id, isActive: true }).select('_id');
      if (!emp) return res.status(403).json({ success: false, message: 'Employee not in your team' });
    }

    const record = attendance.records.find(r => r.ein === ein);
    if (record) {
      const dayRecord = record.days.find(d => d.day === parseInt(day));
      if (dayRecord) {
        dayRecord.status = status;
        dayRecord.otHours = status === 'OT' ? (parseFloat(otHours) || 0) : 0;
      } else {
        record.days.push({ day: parseInt(day), status, otHours: status === 'OT' ? (parseFloat(otHours) || 0) : 0 });
      }
      const totals = calculateTotals(record.days);
      Object.assign(record, totals);
    }
    attendance.updatedAt = new Date();
    attendance.markModified('records');
    await attendance.save();
    return res.json({ success: true, message: 'Updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance day update') });
  }
});

// SUBMIT attendance
router.patch('/:id/submit', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });

    // Ownership check
    if (!canAccessAttendance(user, attendance)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    attendance.status = 'Pending';
    attendance.updatedAt = new Date();
    await attendance.save();
    return res.json({ success: true, message: 'Attendance submitted for payroll' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance submit') });
  }
});

// LOCK attendance (admin/management only)
router.patch('/:id/lock', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    attendance.status = 'Locked';
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_LOCKED', `Locked attendance for ${attendance.groupName} ${attendance.month} ${attendance.year}`, ip);
    return res.json({ success: true, message: 'Attendance locked' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance lock') });
  }
});

// DELETE attendance — restricted to admin/management only (irreversible)
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (attendance.status === 'Locked') {
      return res.status(400).json({ success: false, message: 'Cannot delete locked attendance' });
    }
    await Attendance.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance delete') });
  }
});

// APPROVE attendance (admin/management only)
router.patch('/:id/approve', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    attendance.status = 'Approved';
    attendance.updatedAt = new Date();
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_APPROVED', `Approved attendance for ${attendance.groupName} ${attendance.month} ${attendance.year}`, ip);
    return res.json({ success: true, message: 'Attendance approved successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance approve') });
  }
});

// REJECT attendance - returns to Draft (admin/management only)
router.patch('/:id/reject', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    attendance.status = 'Draft';
    attendance.updatedAt = new Date();
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_REJECTED', `Rejected attendance for ${attendance.groupName} ${attendance.month} ${attendance.year}`, ip);
    return res.json({ success: true, message: 'Attendance rejected and returned to Draft' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance reject') });
  }
});

// GET single attendance record — with ownership enforcement
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Not found' });

    if (!canAccessAttendance(user, record)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return res.json({ success: true, record });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance get') });
  }
});

module.exports = router;
