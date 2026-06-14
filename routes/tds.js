const express = require('express');
const router = express.Router();
const TDS = require('../models/TDS');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// GET all TDS records
router.get('/', isLoggedIn, async (req, res) => {
  try {
    let filter = {};
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein) filter.ein = req.query.ein;
    const records = await TDS.find(filter).sort({ year: -1, month: -1, ein: 1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// FIND employee by EIN or Name
router.get('/find-employee/:search', isLoggedIn, async (req, res) => {
  try {
    const search = req.params.search.trim();
    let employee = await Employee.findOne({ ein: search.toUpperCase(), isActive: true });
    if (!employee) {
      employee = await Employee.findOne({
        employeeName: { $regex: search, $options: 'i' }, isActive: true
      });
    }
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found: ' + search });
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET TDS for payroll (specific group and month)
router.get('/for-payroll', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    const records = await TDS.find({ location, section, profile, month, year: parseInt(year) });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADD or UPDATE TDS (upsert per employee per month)
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const { ein, month, year, amount, remarks } = req.body;
    if (!ein || !month || !year || amount === undefined) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase() });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const tds = await TDS.findOneAndUpdate(
      { ein: ein.toUpperCase(), month, year: parseInt(year) },
      {
        ein: ein.toUpperCase(),
        employeeId: employee._id,
        employeeName: employee.employeeName,
        location: employee.location,
        section: employee.section,
        profile: employee.profile,
        month, year: parseInt(year),
        amount: parseFloat(amount),
        remarks: remarks || '',
        addedBy: req.session.user.username,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'TDS saved successfully', tds });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE TDS
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await TDS.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
