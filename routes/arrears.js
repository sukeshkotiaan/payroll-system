const express = require('express');
const router = express.Router();
const Arrear = require('../models/Arrear');
const Employee = require('../models/Employee');
const { isLoggedIn, isAccountantOrAdmin } = require('../middleware/auth');
const { logAudit } = require('./security');

// GET all arrears
router.get('/', isLoggedIn, async (req, res) => {
  try {
    let filter = {};
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein) filter.ein = req.query.ein;
    if (req.query.pulled === 'false') filter.pulledToPayroll = false;
    const arrears = await Arrear.find(filter).sort({ addedAt: -1 });
    return res.json({ success: true, arrears });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET employee by EIN
router.get('/find-employee/:ein', isLoggedIn, async (req, res) => {
  try {
    const employee = await Employee.findOne({
      ein: req.params.ein.toUpperCase(),
      isActive: true
    });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Active employee not found with EIN: ' + req.params.ein
      });
    }
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADD arrear (accountant/admin/management only)
router.post('/', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const { ein, month, year, type, amount, remarks } = req.body;
    if (!ein || !month || !year || !type || amount === undefined) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase() });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    const arrear = await Arrear.create({
      ein: ein.toUpperCase(),
      employeeId: employee._id,
      employeeName: employee.employeeName,
      location: employee.location,
      section: employee.section,
      profile: employee.profile,
      month, year: parseInt(year),
      type, amount: parseFloat(amount),
      remarks: remarks || '',
      addedBy: req.session.user.username
    });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'ARREAR_ADDED', `Added ${type} arrear ₹${amount} for ${ein} (${month} ${year})`, ip);
    return res.json({ success: true, message: 'Arrear added successfully', arrear });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE arrear (accountant/admin/management only)
router.put('/:id', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const arrear = await Arrear.findById(req.params.id);
    if (!arrear) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    if (arrear.pulledToPayroll) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit arrear already pulled to payroll'
      });
    }
    const { type, amount, remarks, month, year } = req.body;
    arrear.type = type || arrear.type;
    arrear.amount = parseFloat(amount) || arrear.amount;
    arrear.remarks = remarks || arrear.remarks;
    arrear.month = month || arrear.month;
    arrear.year = parseInt(year) || arrear.year;
    await arrear.save();
    return res.json({ success: true, message: 'Updated successfully', arrear });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE arrear (accountant/admin/management only)
router.delete('/:id', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const arrear = await Arrear.findById(req.params.id);
    if (!arrear) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    if (arrear.pulledToPayroll) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete arrear already pulled to payroll'
      });
    }
    await Arrear.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET arrears for specific group and month (used by payroll engine)
router.get('/for-payroll', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    const arrears = await Arrear.find({
      location, section, profile,
      month, year: parseInt(year),
      pulledToPayroll: false
    });
    return res.json({ success: true, arrears });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
