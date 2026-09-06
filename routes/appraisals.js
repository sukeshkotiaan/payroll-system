const express = require('express');
const router = express.Router();
const Appraisal = require('../models/Appraisal');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { logAudit } = require('./security');

// GET all appraisal records
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;
    if (req.query.location)      filter.location      = req.query.location;
    if (req.query.ein)           filter.ein           = req.query.ein;

    // Appraisals contain salary data — only admin and management may access them.
    const canAccess = user.role === 'admin' || user.role === 'management';
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view appraisal records.'
      });
    }

    const records = await Appraisal.find(filter).sort({ financialYear: -1, ein: 1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// FIND employee by EIN or Name (admin/management only — used on the appraisals page)
router.get('/find-employee/:search', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'management') {
      return res.status(403).json({ success: false, message: 'You do not have permission to view appraisal records.' });
    }
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

// ADD or UPDATE appraisal (admin/management only — salary change)
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
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
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'SALARY_CHANGED', `Appraisal saved for ${ein} FY ${financialYear} — ₹${monthlySalary}/month`, ip);
    return res.json({ success: true, message: 'Appraisal record saved successfully', appraisal });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SEED appraisals from current employee monthlySalary (one-time FY bootstrap)
// POST /api/appraisals/seed-from-employees
// Body: { financialYear, location?, section?, profile?, overwrite? }
//   overwrite=false (default) → skip employees who already have an appraisal for that FY
//   overwrite=true            → update even existing records
router.post('/seed-from-employees', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { financialYear, location, section, profile, overwrite } = req.body;
    if (!financialYear) {
      return res.status(400).json({ success: false, message: 'financialYear is required (e.g. 2026-27)' });
    }

    // Build employee filter
    const empFilter = { isActive: true };
    if (location) empFilter.location = location;
    if (section)  empFilter.section  = section;
    if (profile)  empFilter.profile  = profile;

    const employees = await Employee.find(empFilter);
    if (!employees.length) {
      return res.status(404).json({ success: false, message: 'No active employees found with the given filters' });
    }

    let seeded = 0, skipped = 0, noSalary = 0;
    const errors = [];

    for (const emp of employees) {
      try {
        const salary = emp.monthlySalary || 0;
        if (salary <= 0) { noSalary++; continue; }

        // Check if an appraisal already exists for this FY
        if (!overwrite) {
          const existing = await Appraisal.findOne({ ein: emp.ein, financialYear });
          if (existing && existing.monthlySalary > 0) { skipped++; continue; }
        }

        await Appraisal.findOneAndUpdate(
          { ein: emp.ein, financialYear },
          {
            ein: emp.ein,
            employeeId: emp._id,
            employeeName: emp.employeeName,
            location: emp.location,
            section: emp.section,
            profile: emp.profile,
            financialYear,
            monthlySalary: salary,
            ctcAnnual: salary * 12,
            remarks: 'Seeded from employee record',
            addedBy: req.session.user.username,
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );
        seeded++;
      } catch (e) {
        errors.push({ ein: emp.ein, name: emp.employeeName, error: e.message });
      }
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await logAudit(
      req.session.user.id, req.session.user.username, req.session.user.fullName, req.session.user.role,
      'SALARY_CHANGED',
      `Seed appraisals FY ${financialYear} from employee records — seeded: ${seeded}, skipped: ${skipped}, no-salary: ${noSalary}`,
      ip
    );

    return res.json({
      success: true,
      message: `FY ${financialYear} appraisals seeded — Created/updated: ${seeded}, Already existed (skipped): ${skipped}, No salary on record (skipped): ${noSalary}`,
      seeded, skipped, noSalary, errors
    });
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
