const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, uploadsDir); },
  filename: function(req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)); }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const allowed = /jpeg|jpg|png/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Only jpg/png allowed'));
  }
});

router.post('/generate-ein', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile } = req.body;
    if (!location || !section || !profile) {
      return res.status(400).json({ success: false, message: 'Location, section and profile required' });
    }
    const sectionCode = section === 'Global' ? 'G' : 'S';
    const locationCode = location === 'Thane' ? 'T' : 'P';
    const profileCode = profile === 'Teaching' ? 'T' : 'N';
    const prefix = sectionCode + locationCode + profileCode;
    const lastEmployee = await Employee.findOne({ ein: { $regex: '^' + prefix + '-' } }).sort({ ein: -1 });
    let nextNumber = 1001;
    if (lastEmployee && lastEmployee.ein) {
      const parts = lastEmployee.ein.split('-');
      if (parts.length === 2) {
        const lastNum = parseInt(parts[1]);
        if (!isNaN(lastNum)) nextNumber = lastNum + 1;
      }
    }
    return res.json({ success: true, ein: prefix + '-' + nextNumber });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', isLoggedIn, async (req, res) => {
  try {
    const user = req.session.user;
    let filter = {};
    if (user.role === 'accountant') {
      filter.location = user.branch;
      filter.isRestricted = false;
    }
    if (req.query.location) filter.location = req.query.location;
    if (req.query.section) filter.section = req.query.section;
    if (req.query.profile) filter.profile = req.query.profile;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.status) filter.isActive = req.query.status === 'active';
    const employees = await Employee.find(filter).sort({ ein: 1 });
    return res.json({ success: true, employees });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


// SEARCH employees by EIN or Name
router.get('/search', isLoggedIn, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q || q.length < 2) return res.json({ success: true, employees: [] });
    const includeInactive = req.query.includeInactive === 'true';
    const filter = {
      $or: [
        { ein: { $regex: '^' + q, $options: 'i' } },
        { employeeName: { $regex: q, $options: 'i' } }
      ]
    };
    if (!includeInactive) filter.isActive = true;

    // Supervisors only ever search within their own mapped team
    if (req.session.user.role === 'supervisor') {
      filter.supervisorId = req.session.user.id;
    }
    const employees = await Employee.find(filter)
      .select('ein employeeName designation location section profile monthlySalary isActive dateOfExit')
      .limit(10);
    return res.json({ success: true, employees });
  } catch (err) {
    console.error('Search error:', err.message, err.stack);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', isLoggedIn, upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;
    console.log('Creating employee:', data.employeeName);
    if (data.ein) {
      const existing = await Employee.findOne({ ein: data.ein });
      if (existing) return res.status(400).json({ success: false, message: 'EIN already exists' });
    }
    const monthlySalary = parseFloat(data.monthlySalary) || 0;
    const ctcAnnual = parseFloat(data.ctcAnnual) || monthlySalary * 12;
    const newEmployee = new Employee({
      ein: data.ein || '',
      location: data.location,
      section: data.section,
      profile: data.profile,
      department: data.department || '',
      employeeName: data.employeeName,
      designation: data.designation,
      dateOfBirth: data.dateOfBirth,
      dateOfJoining: data.dateOfJoining,
      panNumber: data.panNumber || '',
      aadhaarNumber: data.aadhaarNumber || '',
      phoneNumber: data.phoneNumber,
      email: data.email || '',
      address: data.address || '',
      uanNumber: data.uanNumber || '',
      monthlySalary: monthlySalary,
      ctcAnnual: ctcAnnual,
      ctcMonthly: ctcAnnual / 12,
      basic: parseFloat(data.basic) || 0,
      hraAllowance: parseFloat(data.hraAllowance) || 0,
      pf: parseFloat(data.pf) || 0,
      pt: parseFloat(data.pt) || 0,
      pfApplicable: data.pfApplicable === 'true',
      esicApplicable: data.esicApplicable === 'true',
      ptApplicable: data.ptApplicable === 'true',
      isRestricted: data.isRestricted === 'true',
      photo: req.file ? '/uploads/' + req.file.filename : '',
      createdBy: req.session.user.username
    });
    await newEmployee.save();
    console.log('Employee saved:', newEmployee.ein);
    return res.json({ success: true, message: 'Employee created successfully', employee: newEmployee });
  } catch (err) {
    console.log('Create error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', isLoggedIn, upload.single('photo'), async (req, res) => {
  try {
    const data = req.body;
    if (req.file) data.photo = '/uploads/' + req.file.filename;
    data.updatedAt = Date.now();
    if (data.monthlySalary) {
      data.ctcAnnual = parseFloat(data.monthlySalary) * 12;
    }
    const employee = await Employee.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    return res.json({ success: true, message: 'Employee updated successfully', employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

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

router.post('/bulk-import', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { employees } = req.body;
    let created = 0;
    let skipped = 0;
    const errors = [];

    const einCounters = {};
    const getNextEIN = async (location, section, profile) => {
      const locCode = location === 'Thane' ? 'T' : location === 'Panvel' ? 'P' : location.charAt(0).toUpperCase();
      const secCode = section === 'State' ? 'S' : section === 'Global' ? 'G' : section.charAt(0).toUpperCase();
      const proCode = profile === 'Teaching' ? 'T' : profile === 'Non-Teaching' ? 'N' : profile.charAt(0).toUpperCase();
      const prefix = secCode + locCode + proCode;
      if (!einCounters[prefix]) {
        const all = await Employee.find({ ein: { $regex: '^' + prefix + '-' } }).select('ein');
        const nums = all.map(e => parseInt(e.ein.split('-')[1])).filter(n => Number.isFinite(n));
        einCounters[prefix] = nums.length > 0 ? Math.max(...nums) : 1000;
      }
      einCounters[prefix]++;
      return prefix + '-' + einCounters[prefix];
    };

    for (const emp of employees) {
      try {
        if (emp.ein && emp.ein.trim()) {
          const exists = await Employee.findOne({ ein: emp.ein });
          if (exists) {
            await Employee.findByIdAndUpdate(exists._id, { $set: emp });
            skipped++;
            continue;
          }
        } else {
          emp.ein = await getNextEIN(emp.location, emp.section, emp.profile);
        }
        await Employee.create(emp);
        created++;
      } catch (e) {
        errors.push({ name: emp.employeeName, error: e.message });
      }
    }
    return res.json({ success: true, message: 'Import complete. Created: ' + created + ', Skipped: ' + skipped, errors });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;

// BULK UPDATE SUPERVISOR
router.patch('/bulk-update-supervisor', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { employeeIds, supervisorId, supervisorName } = req.body;
    if (!employeeIds || !employeeIds.length) {
      return res.status(400).json({ success: false, message: 'No employees selected' });
    }
    await Employee.updateMany(
      { _id: { $in: employeeIds } },
      { $set: { supervisorId: supervisorId || null, supervisorName: supervisorName || '' } }
    );
    const action = supervisorId ? 'assigned to supervisor' : 'unassigned from supervisor';
    return res.json({ success: true, message: employeeIds.length + ' employees ' + action });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// BULK UPDATE SUPERVISOR
router.patch('/bulk-update-supervisor', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { employeeIds, supervisorId, supervisorName } = req.body;
    if (!employeeIds || !employeeIds.length) {
      return res.status(400).json({ success: false, message: 'No employees selected' });
    }
    await Employee.updateMany(
      { _id: { $in: employeeIds } },
      { $set: { supervisorId: supervisorId || null, supervisorName: supervisorName || '' } }
    );
    const action = supervisorId ? 'assigned to supervisor' : 'unassigned from supervisor';
    return res.json({ success: true, message: employeeIds.length + ' employees ' + action });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
