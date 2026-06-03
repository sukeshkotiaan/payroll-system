const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Multer setup for photo upload
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const allowed = /jpeg|jpg|png/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) return cb(null, true);
    cb(new Error('Only jpg/png images allowed'));
  }
});

// Generate EIN
router.post('/generate-ein', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile } = req.body;
    if (!location || !section || !profile) {
      return res.status(400).json({ success: false, message: 'Location, section and profile required' });
    }

    // Build prefix
    const sectionCode = section === 'Global' ? 'G' : 'S';
    const locationCode = location === 'Thane' ? 'T' : 'P';
    const profileCode = profile === 'Teaching' ? 'T' : 'N';
    const prefix = `${sectionCode}${locationCode}${profileCode}`;

    // Find last EIN with this prefix
    const lastEmployee = await Employee.findOne({
      ein: { $regex: `^${prefix}-` }
    }).sort({ ein: -1 });

    let nextNumber = 1001;
    if (lastEmployee && lastEmployee.ein) {
      const parts = lastEmployee.ein.split('-');
      if (parts.length === 2) {
        const lastNum = parseInt(parts[1]);
        if (!isNaN(lastNum)) nextNumber = lastNum + 1;
      }
    }

    const ein = `${prefix}-${nextNumber}`;
    return res.json({ success: true, ein });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET all employees
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};

    // Accountant sees only own branch and non-restricted
    if (user.role === 'accountant') {
      filter.location = user.branch;
      filter.isRestricted = false;
    }

    // Filter by location if provided
    if (req.query.location) filter.location = req.query.location;
    if (req.query.section) filter.section = req.query.section;
    if (req.query.profile) filter.profile = req.query.profile;
    if (req.query.status) filter.isActive = req.query.status === 'active';

    const employees = await Employee.find(filter).sort({ ein: 1 });
    return res.json({ success: true, employees });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET single employee
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// CREATE employee
router.post('/', isLoggedIn, upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;

    // Check EIN not duplicate
    if (data.ein) {
      const existing = await Employee.findOne({ ein: data.ein });
      if (existing) {
        return res.status(400).json({ success: false, message: 'EIN already exists' });
      }
    }

    // Calculate salary components
    const ctcAnnual = parseFloat(data.ctcAnnual) || 0;
    const ctcMonthly = ctcAnnual / 12;

    const employee = new Employee({
      ...data,
      ctcAnnual,
      ctcMonthly,
      photo: req.file ? `/uploads/${req.file.filename}` : '',
      createdBy: req.session.user.username
    });

    await employee.save();
    return res.json({ success: true, message: 'Employee created successfully', employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE employee
router.put('/:id', isLoggedIn, upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;
    if (req.file) data.photo = `/uploads/${req.file.filename}`;
    data.updatedAt = Date.now();

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { new: true }
    );
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    return res.json({ success: true, message: 'Employee updated successfully', employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DEACTIVATE employee
router.patch('/:id/deactivate', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { isActive: false, dateOfExit: req.body.dateOfExit || Date.now() },
      { new: true }
    );
    return res.json({ success: true, message: 'Employee deactivated', employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// BULK IMPORT from Excel data
router.post('/bulk-import', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { employees } = req.body;
    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const emp of employees) {
      try {
        if (emp.ein) {
          const exists = await Employee.findOne({ ein: emp.ein });
          if (exists) { skipped++; continue; }
        }
        await Employee.create(emp);
        created++;
      } catch (e) {
        errors.push({ ein: emp.ein, error: e.message });
      }
    }

    return res.json({
      success: true,
      message: `Import complete. Created: ${created}, Skipped: ${skipped}`,
      errors
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;