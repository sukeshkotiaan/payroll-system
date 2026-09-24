const express = require('express');
const router = express.Router();
const Exit = require('../models/Exit');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin, hasRole } = require('../middleware/auth');
const { mgtFilter, safeError } = require('../middleware/security');

// FIND employee by EIN for exit form
// Supervisors: only their team; accountants: no management employees
router.get('/find-employee/:ein', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    const ein = req.params.ein.toUpperCase();

    // Block management lookup for accountants/supervisors
    if (/^MGT-/i.test(ein) && user.role !== 'admin' && user.role !== 'management') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const employee = await Employee.findOne({ ein, isActive: true })
      .select('_id ein employeeName designation supervisorId isActive');
    if (!employee) return res.status(404).json({ success: false, message: 'Active employee not found with this EIN' });

    if (user.role === 'supervisor') {
      const owns = employee.supervisorId && employee.supervisorId.toString() === user.id.toString();
      if (!owns) return res.status(403).json({ success: false, message: 'This employee is not in your team' });
    }
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits find-employee') });
  }
});

// LIST exits — all filtering done at DB level
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};

    // Supervisors see only exits they submitted (DB-level, not in-memory)
    if (user.role === 'supervisor') {
      filter.submittedBy = user.username;
    }

    // Accountants scoped to their branch
    if (user.role === 'accountant') filter.location = user.branch;

    // Non-admin/management must not see management employee exits
    if (user.role !== 'admin' && user.role !== 'management') {
      filter.ein = { $not: /^MGT-/i };
    }

    if (req.query.status) filter.status = req.query.status;
    if (req.query.employeeId) filter.employeeId = req.query.employeeId;

    const exits = await Exit.find(filter).sort({ submittedAt: -1 });
    return res.json({ success: true, exits });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits list') });
  }
});

// SUBMIT exit request
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const data = req.body;
    const user = req.session.user;
    const employee = await Employee.findById(data.employeeId).select('_id ein supervisorId');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Block management exits from non-admin
    if (employee.ein && /^MGT-/i.test(employee.ein) && user.role !== 'admin' && user.role !== 'management') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Supervisors can only raise exit requests for their own team
    if (user.role === 'supervisor') {
      const owns = employee.supervisorId && employee.supervisorId.toString() === user.id.toString();
      if (!owns) return res.status(403).json({ success: false, message: 'You can only raise exit requests for your own team members' });
    }

    const existing = await Exit.findOne({ employeeId: data.employeeId, status: { $in: ['Pending', 'Approved'] } });
    if (existing) return res.status(400).json({ success: false, message: 'Exit request already exists for this employee' });

    const resignDate = new Date(data.resignationDate);
    const lwdDate    = new Date(data.lastWorkingDate);
    const noticeDays = Math.ceil((lwdDate - resignDate) / (1000 * 60 * 60 * 24));
    const exit = await Exit.create({
      ...data,
      noticePeriodDays: noticeDays,
      submittedBy: user.username,
      submittedAt: new Date()
    });
    return res.json({ success: true, message: 'Exit request submitted for approval', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits post') });
  }
});

router.patch('/:id/approve', isLoggedIn, hasRole('admin', 'management', 'accountant'), async (req, res) => {
  try {
    const exit = await Exit.findById(req.params.id);
    if (!exit) return res.status(404).json({ success: false, message: 'Exit not found' });
    // Accountants cannot approve management exits
    if (exit.ein && /^MGT-/i.test(exit.ein) && req.session.user.role === 'accountant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    exit.status = 'Approved';
    exit.approvedBy = req.session.user.username;
    exit.approvedAt = new Date();
    exit.fnfSettlement = req.body.fnfSettlement || exit.fnfSettlement;
    exit.relievingLetter = req.body.relievingLetter || exit.relievingLetter;
    exit.eligibleForRehire = req.body.eligibleForRehire || exit.eligibleForRehire;
    await exit.save();
    await Employee.findByIdAndUpdate(exit.employeeId, { isActive: false, dateOfExit: exit.lastWorkingDate });
    return res.json({ success: true, message: 'Exit approved. Employee moved to inactive.', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits approve') });
  }
});

router.patch('/:id/reject', isLoggedIn, hasRole('admin', 'management', 'accountant'), async (req, res) => {
  try {
    const exit = await Exit.findById(req.params.id);
    if (!exit) return res.status(404).json({ success: false, message: 'Exit not found' });
    if (exit.ein && /^MGT-/i.test(exit.ein) && req.session.user.role === 'accountant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    exit.status = 'Rejected';
    exit.rejectedBy  = req.session.user.username;
    exit.rejectedAt  = new Date();
    exit.rejectionReason = req.body.rejectionReason || '';
    await exit.save();
    return res.json({ success: true, message: 'Exit request rejected', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits reject') });
  }
});

router.put('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { resignationDate, lastWorkingDate, noticeType, reasonForLeaving,
            noticePeriodDays, fnfSettlement, relievingLetter, eligibleForRehire, remarks } = req.body;
    const allowed = {};
    if (resignationDate  !== undefined) allowed.resignationDate  = resignationDate;
    if (lastWorkingDate  !== undefined) allowed.lastWorkingDate  = lastWorkingDate;
    if (noticeType       !== undefined) allowed.noticeType       = noticeType;
    if (reasonForLeaving !== undefined) allowed.reasonForLeaving = reasonForLeaving;
    if (noticePeriodDays !== undefined) allowed.noticePeriodDays = noticePeriodDays;
    if (fnfSettlement    !== undefined) allowed.fnfSettlement    = fnfSettlement;
    if (relievingLetter  !== undefined) allowed.relievingLetter  = relievingLetter;
    if (eligibleForRehire !== undefined) allowed.eligibleForRehire = eligibleForRehire;
    if (remarks          !== undefined) allowed.remarks          = remarks;
    const exit = await Exit.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true });
    return res.json({ success: true, message: 'Updated successfully', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'exits put') });
  }
});

module.exports = router;
