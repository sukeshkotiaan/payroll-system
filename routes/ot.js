const express = require('express');
const router = express.Router();
const OT = require('../models/OT');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin, isAccountantOrAdmin, notSupervisor } = require('../middleware/auth');
const { getSettings } = require('../lib/settingsCache');
const { mgtFilter, sanitizeRegex, safeError } = require('../middleware/security');

// GET all OT records — management employees hidden from accountants
router.get('/', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    let filter = { ...mgtFilter(role) };
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein) filter.ein = req.query.ein;
    const records = await OT.find(filter).sort({ year: -1, month: -1, ein: 1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'ot list') });
  }
});

// GET default OT rate from Settings
router.get('/default-rate', isLoggedIn, async (req, res) => {
  try {
    const { location } = req.query;
    const settings = await getSettings();
    let rate = 0;
    if (settings && location) {
      const locSetting = settings.locationSettings.find(ls => ls.location === location);
      if (locSetting && locSetting.currentRules) rate = locSetting.currentRules.otRate || 0;
    }
    return res.json({ success: true, rate });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// FIND employee by EIN or Name — management blocked for non-admin
router.get('/find-employee/:search', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    const search = req.params.search.trim();
    if (/^MGT-/i.test(search) && role !== 'admin' && role !== 'management') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const safe = sanitizeRegex(search);
    let employee = await Employee.findOne({ ein: search.toUpperCase(), isActive: true, ...mgtFilter(role) });
    if (!employee) {
      employee = await Employee.findOne({ employeeName: { $regex: safe, $options: 'i' }, isActive: true, ...mgtFilter(role) });
    }
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'ot find-employee') });
  }
});

// GET OT for payroll (specific group and month)
router.get('/for-payroll', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    const records = await OT.find({ location, section, profile, month, year: parseInt(year) });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADD or UPDATE OT (accountant/admin/management only)
router.post('/', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const { ein, month, year, hours, rate, remarks } = req.body;
    if (!ein || !month || !year || hours === undefined || rate === undefined) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase() });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const amount = parseFloat(hours) * parseFloat(rate);

    const ot = await OT.findOneAndUpdate(
      { ein: ein.toUpperCase(), month, year: parseInt(year) },
      {
        ein: ein.toUpperCase(),
        employeeId: employee._id,
        employeeName: employee.employeeName,
        location: employee.location,
        section: employee.section,
        profile: employee.profile,
        month, year: parseInt(year),
        hours: parseFloat(hours),
        rate: parseFloat(rate),
        amount,
        remarks: remarks || '',
        addedBy: req.session.user.username,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'OT saved successfully', ot });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE OT
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await OT.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
