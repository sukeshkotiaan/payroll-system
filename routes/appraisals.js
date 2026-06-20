const express = require('express');
const router = express.Router();
const Appraisal = require('../models/Appraisal');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// GET all appraisal records
router.get('/', isLoggedIn, async (req, res) => {
  try {
    let filter = {};
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein) filter.ein = req.query.ein;
    const records = await Appraisal.find(filter).sort({ financialYear: -1, ein: 1 });
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

// ADD or UPDATE appraisal (upsert per employee per financial year)
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const { ein, financialYear, monthlySalary, ctcAnnual, remarks } = req.body;
    if (!ein || !financialYear || monthlySalary === undefined || ctcAnnual === undefined) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase() });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const appraisal = await Appraisal.findOneAndUpdate(
      { ein: ein.toUpperCase(), financialYear },
      {
        ein: ein.toUpperCase(),
        employeeId: employee._id,
        employeeName: employee.employeeName,
        location: employee.location,
        section: employee.section,
        profile: employee.profile,
        financialYear,
        monthlySalary: parseFloat(monthlySalary),
        ctcAnnual: parseFloat(ctcAnnual),
        remarks: remarks || '',
        addedBy: req.session.user.username,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'Appraisal record saved successfully', appraisal });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// BULK IMPORT historical appraisal data
router.post('/bulk-import', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ success: false, message: 'No records provided' });
    }
    let imported = 0, skipped = 0;
    const errors = [];

    for (const r of records) {
      try {
        const employee = await Employee.findOne({ ein: String(r.ein).toUpperCase() });
        if (!employee) { skipped++; errors.push(r.ein + ': employee not found'); continue; }

        await Appraisal.findOneAndUpdate(
          { ein: String(r.ein).toUpperCase(), financialYear: String(r.financialYear) },
          {
            ein: String(r.ein).toUpperCase(),
            employeeId: employee._id,
            employeeName: employee.employeeName,
            location: employee.location,
            section: employee.section,
            profile: employee.profile,
            financialYear: String(r.financialYear),
            monthlySalary: parseFloat(r.monthlySalary) || 0,
            ctcAnnual: parseFloat(r.ctcAnnual) || 0,
            remarks: r.remarks || 'Imported from historical data',
            addedBy: req.session.user.username,
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );
        imported++;
      } catch (e) {
        skipped++;
        errors.push((r.ein || 'unknown') + ': ' + e.message);
      }
    }
    return res.json({ success: true, message: 'Import complete', imported, skipped, errors });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE appraisal
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await Appraisal.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
