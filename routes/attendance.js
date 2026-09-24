const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');
const { logAudit } = require('./security');

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function getMonthIndex(month) { return MONTHS.indexOf(month); }
function getDaysInMonth(month, year) {
  return new Date(parseInt(year), getMonthIndex(month) + 1, 0).getDate();
}
function getGroupName(section, location, profile) {
  if (section === 'State') return 'Xaviers ' + location;
  if (section === 'Global' && profile === 'Teaching') return 'Global Teaching';
  if (section === 'Global' && profile === 'Non-Teaching') return 'Global Non-Teaching';
  return section + ' ' + location + ' ' + profile;
}

// Normalise legacy status values stored in DB
function normaliseStatus(s) {
  if (!s || s === 'Draft' || s === 'Rejected') return '';
  if (s === 'Pending') return 'Submitted';
  return s; // Submitted | Approved | Locked
}

function calculateTotals(days) {
  let presentDays = 0, cl = 0, sl = 0, pl = 0, spL = 0;
  let absent = 0, halfDays = 0, weekOff = 0, holidays = 0, otHours = 0;
  days.forEach(d => {
    switch(d.status) {
      case 'P':   presentDays += 1; break;
      case 'A':   absent += 1; break;
      case 'CL':  cl += 1; presentDays += 1; break;
      case 'SL':  sl += 1; presentDays += 1; break;
      case 'PL':  pl += 1; presentDays += 1; break;
      case 'SpL': spL += 1; presentDays += 1; break;
      case 'H':   holidays += 1; break;
      case 'WO':  weekOff += 1; break;
      case 'HD':  halfDays += 1; presentDays += 0.5; break;
      case 'OT':  presentDays += 1; otHours += d.otHours || 0; break;
    }
  });
  const lopDays = absent;
  const payableDays = presentDays + weekOff + holidays;
  return { presentDays, cl, sl, pl, spL, absent, halfDays, weekOff, holidays, otHours, lopDays, payableDays };
}

// Can this user READ this attendance record?
function canAccessAttendance(user, attendance) {
  if (user.role === 'admin' || user.role === 'management') return true;
  if (user.role === 'accountant') {
    const branches = user.branches || [];
    if (branches.includes('all')) return true;
    return !attendance.location || branches.includes(attendance.location);
  }
  if (user.role === 'supervisor') {
    return attendance.supervisorId && attendance.supervisorId.toString() === user.id.toString();
  }
  return false;
}

// Can this user EDIT this attendance record?
function canEditAttendance(user, attendance) {
  const st = normaliseStatus(attendance.status);
  if (st === 'Locked') return false;
  // Admin / management: can edit anything that isn't Locked
  if (user.role === 'admin' || user.role === 'management') return true;
  // Approved: only admin/management (already handled above)
  if (st === 'Approved') return false;
  // Accountant: can edit Open or Submitted (within their branches)
  if (user.role === 'accountant') {
    const branches = user.branches || [];
    if (branches.includes('all')) return true;
    return !attendance.location || branches.includes(attendance.location);
  }
  // Supervisor: only own Open records
  if (user.role === 'supervisor') {
    if (st === 'Submitted') return false;
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
    if (user.role === 'supervisor') filter.supervisorId = user.id;
    if (req.query.month)    filter.month    = req.query.month;
    if (req.query.year)     filter.year     = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.section)  filter.section  = req.query.section;
    if (req.query.profile)  filter.profile  = req.query.profile;
    const records = await Attendance.find(filter).select('-records').sort({ year: -1, month: -1 });
    // Normalise legacy status values before returning
    const normalised = records.map(r => {
      const obj = r.toObject();
      obj.status = normaliseStatus(obj.status);
      return obj;
    });
    return res.json({ success: true, records: normalised });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance list') });
  }
});

// GET employees for template
router.get('/template/employees', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    if (!month || !year) return res.status(400).json({ success: false, message: 'Month and year required' });
    const user = req.session.user;
    let filter = { isActive: true };
    if (user.role === 'supervisor') {
      filter.supervisorId = user.id;
    } else {
      if (!location || !section || !profile)
        return res.status(400).json({ success: false, message: 'Location, section, profile required' });
      filter.location = location; filter.section = section; filter.profile = profile;
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

// SAVE / UPDATE attendance (full record upsert)
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const { month, year, location, section, profile, records } = req.body;
    if (!month || !year || !location || !section || !profile)
      return res.status(400).json({ success: false, message: 'All fields required' });

    // Supervisors: verify every EIN belongs to their team
    if (user.role === 'supervisor') {
      const submittedEINs = (records || []).map(r => r.ein).filter(Boolean);
      if (submittedEINs.length > 0) {
        const owned = await Employee.find({ ein: { $in: submittedEINs }, supervisorId: user.id, isActive: true }).select('ein');
        const ownedEINs = new Set(owned.map(e => e.ein));
        const unauthorized = submittedEINs.filter(e => !ownedEINs.has(e));
        if (unauthorized.length > 0)
          return res.status(403).json({ success: false, message: 'Access denied — some employees are not in your team' });
      }
    }

    const processedRecords = (records || []).map(r => ({ ...r, ...calculateTotals(r.days || []) }));
    let existing = await Attendance.findOne({ month, year: parseInt(year), location, section, profile });
    if (existing) {
      if (!canEditAttendance(user, existing))
        return res.status(403).json({ success: false, message: 'Access denied — record is locked or you do not have edit rights' });
      existing.records = processedRecords;
      existing.uploadedBy = user.username;
      existing.updatedAt = new Date();
      existing.markModified('records');
      await existing.save();
      const obj = existing.toObject(); obj.status = normaliseStatus(obj.status);
      return res.json({ success: true, message: 'Attendance updated', record: obj });
    }
    const groupName = getGroupName(section, location, profile);
    const attendance = await Attendance.create({
      month, year: parseInt(year), location, section, profile,
      groupName, records: processedRecords,
      supervisorId: user.role === 'supervisor' ? user.id : null,
      uploadedBy: user.username, status: ''
    });
    return res.json({ success: true, message: 'Attendance saved', record: attendance });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance save') });
  }
});

// PATCH single day (auto-save)
router.patch('/:id/day', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const { ein, day, status, otHours } = req.body;
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canEditAttendance(user, attendance))
      return res.status(403).json({ success: false, message: 'Access denied' });
    if (user.role === 'supervisor' && ein) {
      const emp = await Employee.findOne({ ein, supervisorId: user.id, isActive: true }).select('_id');
      if (!emp) return res.status(403).json({ success: false, message: 'Employee not in your team' });
    }
    const record = attendance.records.find(r => r.ein === ein);
    if (record) {
      const dayRecord = record.days.find(d => d.day === parseInt(day));
      if (dayRecord) { dayRecord.status = status || ''; dayRecord.otHours = 0; }
      else record.days.push({ day: parseInt(day), status: status || '', otHours: 0 });
      Object.assign(record, calculateTotals(record.days));
    }
    attendance.updatedAt = new Date();
    attendance.markModified('records');
    await attendance.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance day update') });
  }
});

// BULK UPDATE — upload all days for multiple employees at once
router.patch('/:id/bulk', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const { records } = req.body; // [{ein, days:[{day,status}]}]
    if (!Array.isArray(records) || !records.length)
      return res.status(400).json({ success: false, message: 'No records provided' });
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canEditAttendance(user, attendance))
      return res.status(403).json({ success: false, message: 'Access denied' });
    for (const update of records) {
      const record = attendance.records.find(r => r.ein === update.ein);
      if (!record) continue;
      record.days = update.days;
      Object.assign(record, calculateTotals(record.days));
    }
    attendance.updatedAt = new Date();
    attendance.markModified('records');
    await attendance.save();
    return res.json({ success: true, updated: records.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'bulk update') });
  }
});

// SUBMIT (Supervisor or Accountant → Submitted)
router.patch('/:id/submit', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canAccessAttendance(user, attendance))
      return res.status(403).json({ success: false, message: 'Access denied' });
    const st = normaliseStatus(attendance.status);
    if (st === 'Locked') return res.status(400).json({ success: false, message: 'Attendance is locked' });
    // Clear any previous rejection note on resubmit
    attendance.rejectionNote = '';
    attendance.rejectedBy = '';
    attendance.rejectedAt = null;
    attendance.status = 'Submitted';
    attendance.updatedAt = new Date();
    await attendance.save();
    return res.json({ success: true, message: 'Submitted for approval' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance submit') });
  }
});

// REOPEN — accountant reverts Submitted → Open after editing a cell
router.patch('/:id/reopen', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canEditAttendance(user, attendance))
      return res.status(403).json({ success: false, message: 'Access denied' });
    const st = normaliseStatus(attendance.status);
    if (st !== 'Submitted') return res.json({ success: true }); // nothing to do
    attendance.status = '';
    attendance.updatedAt = new Date();
    await attendance.save();
    return res.json({ success: true, message: 'Reverted to Open' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance reopen') });
  }
});

// APPROVE (Management/Admin only)
router.patch('/:id/approve', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    const st = normaliseStatus(attendance.status);
    if (st === 'Locked') return res.status(400).json({ success: false, message: 'Already locked' });
    attendance.status = 'Approved';
    attendance.rejectionNote = '';
    attendance.updatedAt = new Date();
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_APPROVED', `Approved ${attendance.groupName} ${attendance.month} ${attendance.year}`, ip);
    return res.json({ success: true, message: 'Approved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance approve') });
  }
});

// SEND BACK (Management/Admin → back to Open with note)
router.patch('/:id/sendback', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    const st = normaliseStatus(attendance.status);
    if (st === 'Locked') return res.status(400).json({ success: false, message: 'Attendance is locked' });
    attendance.status = '';
    attendance.rejectionNote = (req.body.note || '').trim();
    attendance.rejectedBy = req.session.user.fullName || req.session.user.username;
    attendance.rejectedAt = new Date();
    attendance.updatedAt = new Date();
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_SENT_BACK', `Sent back ${attendance.groupName} ${attendance.month} ${attendance.year}: ${attendance.rejectionNote}`, ip);
    return res.json({ success: true, message: 'Sent back to accountant' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance sendback') });
  }
});

// LOCK (called by payroll finalization)
router.patch('/:id/lock', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    attendance.status = 'Locked';
    await attendance.save();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ATTENDANCE_LOCKED', `Locked ${attendance.groupName} ${attendance.month} ${attendance.year}`, ip);
    return res.json({ success: true, message: 'Locked' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance lock') });
  }
});

// DELETE (admin only, not Locked)
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json({ success: false, message: 'Not found' });
    if (normaliseStatus(attendance.status) === 'Locked')
      return res.status(400).json({ success: false, message: 'Cannot delete locked attendance' });
    await Attendance.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance delete') });
  }
});

// GET single record
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canAccessAttendance(user, record))
      return res.status(403).json({ success: false, message: 'Access denied' });
    const obj = record.toObject();
    obj.status = normaliseStatus(obj.status);
    return res.json({ success: true, record: obj });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance get') });
  }
});

module.exports = router;
module.exports.normaliseStatus = normaliseStatus;
