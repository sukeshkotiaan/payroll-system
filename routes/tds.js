const express = require('express');
const router = express.Router();
const TDS = require('../models/TDS');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin, isAccountantOrAdmin, notSupervisor } = require('../middleware/auth');
const { mgtFilter, sanitizeRegex, safeError } = require('../middleware/security');

// GET all TDS records — management hidden from accountants
router.get('/', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    let filter = { ...mgtFilter(role) };
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein) filter.ein = req.query.ein;
    const records = await TDS.find(filter).sort({ year: -1, month: -1, ein: 1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'tds list') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'tds find-employee') });
  }
});

// GET TDS for payroll (specific group and month)
router.get('/for-payroll', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    const records = await TDS.find({ location, section, profile, month, year: parseInt(year) });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'tds for-payroll') });
  }
});

// ADD or UPDATE TDS (accountant/admin/management only)
router.post('/', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
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
    return res.status(500).json({ success: false, message: safeError(err, 'tds post') });
  }
});

// BULK SAVE TDS entries for a month
router.post('/bulk', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const { month, year, entries } = req.body;
    if (!month || !year || !Array.isArray(entries)) {
      return res.status(400).json({ success: false, message: 'month, year and entries required' });
    }
    const eins = entries.map(e => e.ein.toUpperCase());
    const employees = await Employee.find({ ein: { $in: eins } });
    const empMap = {};
    employees.forEach(e => { empMap[e.ein] = e; });

    const ops = entries.map(entry => {
      const emp = empMap[entry.ein.toUpperCase()];
      if (!emp) return null;
      return {
        updateOne: {
          filter: { ein: emp.ein, month, year: parseInt(year) },
          update: {
            $set: {
              ein: emp.ein,
              employeeId: emp._id,
              employeeName: emp.employeeName,
              location: emp.location,
              section: emp.section,
              profile: emp.profile,
              month, year: parseInt(year),
              amount: parseFloat(entry.amount) || 0,
              remarks: entry.remarks || '',
              addedBy: req.session.user.username,
              updatedAt: new Date()
            }
          },
          upsert: true
        }
      };
    }).filter(Boolean);

    if (ops.length) await TDS.bulkWrite(ops);
    return res.json({ success: true, message: ops.length + ' TDS records saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'tds bulk') });
  }
});

// DELETE TDS
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await TDS.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'tds delete') });
  }
});

module.exports = router;
