const express = require('express');
const router = express.Router();
const Exit = require('../models/Exit');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// GET employee by EIN for exit form
router.get('/find-employee/:ein', isLoggedIn, async (req, res) => {
  try {
    const employee = await Employee.findOne({
      ein: req.params.ein.toUpperCase(),
      isActive: true
    });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Active employee not found with this EIN'
      });
    }
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET all exit requests
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};
    if (user.role === 'accountant') filter.location = user.branch;
    if (req.query.status) filter.status = req.query.status;
    const exits = await Exit.find(filter).sort({ submittedAt: -1 });
    return res.json({ success: true, exits });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SUBMIT exit request
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const data = req.body;
    const employee = await Employee.findById(data.employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    const existing = await Exit.findOne({
      employeeId: data.employeeId,
      status: { $in: ['Pending', 'Approved'] }
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Exit request already exists for this employee'
      });
    }
    const resignDate = new Date(data.resignationDate);
    const lwdDate = new Date(data.lastWorkingDate);
    const noticeDays = Math.ceil((lwdDate - resignDate) / (1000 * 60 * 60 * 24));
    const exit = await Exit.create({
      ...data,
      noticePeriodDays: noticeDays,
      submittedBy: req.session.user.username,
      submittedAt: new Date()
    });
    return res.json({
      success: true,
      message: 'Exit request submitted for approval',
      exit
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// APPROVE exit
router.patch('/:id/approve', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const exit = await Exit.findById(req.params.id);
    if (!exit) {
      return res.status(404).json({ success: false, message: 'Exit not found' });
    }
    exit.status = 'Approved';
    exit.approvedBy = req.session.user.username;
    exit.approvedAt = new Date();
    exit.fnfSettlement = req.body.fnfSettlement || exit.fnfSettlement;
    exit.relievingLetter = req.body.relievingLetter || exit.relievingLetter;
    exit.eligibleForRehire = req.body.eligibleForRehire || exit.eligibleForRehire;
    await exit.save();
    await Employee.findByIdAndUpdate(exit.employeeId, {
      isActive: false,
      dateOfExit: exit.lastWorkingDate
    });
    return res.json({
      success: true,
      message: 'Exit approved. Employee moved to inactive.',
      exit
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// REJECT exit
router.patch('/:id/reject', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const exit = await Exit.findById(req.params.id);
    if (!exit) {
      return res.status(404).json({ success: false, message: 'Exit not found' });
    }
    exit.status = 'Rejected';
    exit.rejectedBy = req.session.user.username;
    exit.rejectedAt = new Date();
    exit.rejectionReason = req.body.rejectionReason || '';
    await exit.save();
    return res.json({ success: true, message: 'Exit request rejected', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE exit details
router.put('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const exit = await Exit.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    return res.json({ success: true, message: 'Updated successfully', exit });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
