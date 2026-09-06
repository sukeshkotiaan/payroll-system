const express = require('express');
const router = express.Router();
const Employee    = require('../models/Employee');
const ReservedEIN = require('../models/ReservedEIN');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const uploadsTmpDir = path.join(__dirname, '../public/uploads/tmp');
if (!fs.existsSync(uploadsTmpDir)) {
  fs.mkdirSync(uploadsTmpDir, { recursive: true });
}

// Multer for employee photo uploads (jpg/png)
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

// Multer for Excel imports (xlsx only, stored in /tmp so it can be deleted after parsing)
const excelUpload = multer({
  dest: path.join(__dirname, '../public/uploads/tmp/'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx') return cb(null, true);
    cb(new Error('Only .xlsx files are allowed'));
  }
});

// ─── EIN HELPERS (mirrors /api/reserved-eins logic) ──────────────────────────

async function getNextAutoEIN(location, section, profile) {
  const secCode  = section  === 'Global' ? 'G' : 'S';
  const locCode  = location === 'Thane'  ? 'T' : 'P';
  const profCode = profile  === 'Teaching' ? 'T' : 'N';
  const prefix   = secCode + locCode + profCode;
  const last = await Employee.findOne({ ein: { $regex: '^' + prefix + '-' } }).sort({ ein: -1 });
  let nextNumber = 1001;
  if (last && last.ein) {
    const parts = last.ein.split('-');
    if (parts.length === 2) {
      const n = parseInt(parts[1]);
      if (!isNaN(n)) nextNumber = n + 1;
    }
  }
  return prefix + '-' + nextNumber;
}

async function getNextReservedEIN() {
  const slot = await require('../models/ReservedEIN').findOne({ status: 'available' }).sort({ ein: 1 });
  return slot || null;
}

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

// CHECK for duplicate bank account number
router.get('/check-account/:accountNumber', isLoggedIn, async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const excludeId = req.query.excludeId;
    if (!accountNumber) return res.json({ success: true, duplicates: [] });
    const filter = { accountNumber, isActive: true };
    if (excludeId) filter._id = { $ne: excludeId };
    const duplicates = await Employee.find(filter).select('ein employeeName');
    return res.json({ success: true, duplicates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET team bank details (narrow scope - no salary/sensitive fields)
router.get('/my-team-bank', isLoggedIn, async (req, res) => {
  try {
    const role = req.session.user.role;
    let filter = { isActive: true };
    if (role === 'supervisor') {
      filter.supervisorId = req.session.user.id;
    }
    const employees = await Employee.find(filter)
      .select('ein employeeName designation location bankName accountNumber ifscCode accountHolderName bankVerificationStatus bankVerifiedBy bankVerifiedAt')
      .sort({ ein: 1 });
    return res.json({ success: true, employees });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE bank details only (used by My Team Bank Details page)
router.patch('/:id/bank-details', isLoggedIn, async (req, res) => {
  try {
    const { bankName, accountNumber, ifscCode, accountHolderName } = req.body;
    const role = req.session.user.role;

    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    if (role === 'supervisor' && (!employee.supervisorId || employee.supervisorId.toString() !== req.session.user.id.toString())) {
      return res.status(403).json({ success: false, message: 'You can only update bank details for your own team' });
    }

    if (accountNumber) {
      const dup = await Employee.findOne({ accountNumber, isActive: true, _id: { $ne: req.params.id } });
      if (dup) {
        return res.status(400).json({ success: false, message: 'This account number is already used by ' + dup.employeeName + ' (' + dup.ein + ')' });
      }
    }

    employee.bankName = bankName || '';
    employee.accountNumber = accountNumber || '';
    employee.ifscCode = (ifscCode || '').toUpperCase();
    employee.accountHolderName = accountHolderName || '';

    const canVerify = role === 'admin' || role === 'management' || role === 'accountant';
    if (canVerify && req.body.verify === 'true') {
      employee.bankVerificationStatus = 'Verified';
      employee.bankVerifiedBy = req.session.user.fullName;
      employee.bankVerifiedAt = new Date();
    } else {
      employee.bankVerificationStatus = (bankName || accountNumber || ifscCode) ? 'Pending' : 'Not Filled';
      employee.bankVerifiedBy = '';
      employee.bankVerifiedAt = null;
    }

    await employee.save();
    return res.json({ success: true, message: 'Bank details updated', employee });
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

router.post('/', isLoggedIn, isAdmin, (req, res, next) => {
  if (req.is('multipart/form-data')) return upload.single('photo')(req, res, next);
  next();
}, async (req, res) => {
  try {
    const data = req.body;
    if (typeof data.qualifications === 'string') {
      try { data.qualifications = JSON.parse(data.qualifications); }
      catch(e) { data.qualifications = []; }
    }
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
      pfApplicable: data.pfApplicable === true || data.pfApplicable === 'true',
      esicApplicable: data.esicApplicable === true || data.esicApplicable === 'true',
      ptApplicable: data.ptApplicable === true || data.ptApplicable === 'true',
      isRestricted: data.isRestricted === true || data.isRestricted === 'true',
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

// PUT handles both JSON (no photo) and multipart/form-data (with photo)
// When the client sends JSON, express.json() has already parsed req.body
// and multer.single() is a no-op (non-multipart request passes through).
// When the client sends FormData (photo upload), multer parses req.body.
router.put('/:id', isLoggedIn, isAdmin, (req, res, next) => {
  // Only run multer if the request is multipart (has a photo)
  if (req.is('multipart/form-data')) {
    return upload.single('photo')(req, res, next);
  }
  next();
}, async (req, res) => {
  try {
    console.log('PUT /employees/:id =>', req.params.id, '| content-type:', req.headers['content-type']);
    const data = { ...req.body };
    if (req.file) data.photo = '/uploads/' + req.file.filename;
    data.updatedAt = Date.now();
    // qualifications may be an array (JSON body) or a JSON string (FormData body)
    if (typeof data.qualifications === 'string') {
      try { data.qualifications = JSON.parse(data.qualifications); }
      catch(e) { data.qualifications = []; }
    }
    // Coerce string booleans from FormData to real booleans
    ['pfApplicable','esicApplicable','ptApplicable','isRestricted'].forEach(k => {
      if (typeof data[k] === 'string') data[k] = data[k] === 'true';
    });
    if (data.monthlySalary) data.ctcAnnual = parseFloat(data.monthlySalary) * 12;
    if (data.bankVerifiedAt === '') data.bankVerifiedAt = null;
    delete data._id;
    const employee = await Employee.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    console.log('PUT /employees/:id result:', employee ? 'updated ' + employee.employeeName : 'NOT FOUND id=' + req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found. Please refresh the page and try again.' });
    return res.json({ success: true, message: 'Employee updated successfully', employee });
  } catch (err) {
    console.error('PUT /employees/:id error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH EIN only — JSON body, no multer, for quick EIN reassignment from admin
router.patch('/:id/ein', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein } = req.body;
    if (!ein || !ein.trim()) return res.status(400).json({ success: false, message: 'EIN is required' });
    const newEIN = ein.trim().toUpperCase();
    // Check if another employee already has this EIN
    const conflict = await Employee.findOne({ ein: newEIN, _id: { $ne: req.params.id } });
    if (conflict) {
      return res.status(400).json({ success: false, message: `EIN ${newEIN} is already assigned to ${conflict.employeeName}` });
    }
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { $set: { ein: newEIN, updatedAt: Date.now() } },
      { new: true }
    );
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    console.log('PATCH EIN:', employee.employeeName, '->', newEIN);
    return res.json({ success: true, message: `EIN updated to ${newEIN}`, employee });
  } catch (err) {
    console.error('PATCH /:id/ein error:', err.message);
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

// ─── EXCEL UPLOAD & BULK CREATE ───────────────────────────────────────────────
//
// Matches Employee_Import_Ready_v2.xlsx column layout:
//   EIN | Title | Employee Name | Gender | Designation | Department |
//   Location | Section | Profile | Date of Birth | Date of Joining |
//   PAN Number | Aadhaar Number | Phone Number | Email | Address |
//   Monthly Salary | CTC Annual | PF Applicable | ESIC Applicable |
//   PT Applicable | Restricted | UAN Number | Bank Account Number
//
// Rules:
//   • EIN filled in file  → used as-is
//   • EIN blank + designation in managementDesignations list
//                         → pulls next available reserved EIN (e.g. MGT-001) from pool
//   • EIN blank, no match → auto-generated from Location/Section/Profile (e.g. STT-1001)
//   • Rows where Employee Name is empty or "Blank" are silently skipped
//   • Dates accepted as DD/MM/YYYY strings or native Excel date values
//   • Bank account number set to Pending verification if present
//
// Form fields:
//   file                    — the .xlsx file (required)
//   managementDesignations  — comma-separated list of designations that should get
//                             reserved MGT EINs, e.g. "Principal,Director,Vice Principal"
//
router.post('/upload-excel', isLoggedIn, isAdmin, excelUpload.single('file'), async (req, res) => {
  const tmpPath = req.file ? req.file.path : null;

  // Normalise a header string to a plain lowercase key for matching
  const key = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

  // Parse a date that could be a DD/MM/YYYY string, an ISO string, or a JS Date
  const parseDate = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    const s = String(raw).trim();
    // DD/MM/YYYY
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    // Fallback: let JS parse it
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  // Derive a 3-letter EIN prefix from location/section/profile
  const getPrefix = (location, section, profile) => {
    const secCode  = section  === 'Global'  ? 'G' : 'S';
    const locCode  = location === 'Thane'   ? 'T' : 'P';
    const profCode = profile  === 'Teaching' ? 'T' : 'N';
    return secCode + locCode + profCode;
  };

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const clearFirst = req.body.clearFirst === 'true';

    // ── Step 0: Clear non-MGT employees if requested ──────────────────────
    let deletedCount = 0;
    if (clearFirst) {
      const deleted = await Employee.deleteMany({ ein: { $not: /^MGT-/i } });
      deletedCount = deleted.deletedCount;
      console.log('clearFirst: deleted', deletedCount, 'non-MGT employees');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tmpPath);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return res.status(400).json({ success: false, message: 'Excel file has no worksheets' });
    }

    // Build header → column-index map from row 1
    const headerRow = sheet.getRow(1).values; // array is 1-indexed
    const colMap = {};
    for (let c = 1; c < headerRow.length; c++) {
      if (headerRow[c] != null) colMap[key(headerRow[c])] = c;
    }

    // Require the four columns that drive EIN generation
    for (const req_col of ['employeename', 'location', 'section', 'profile']) {
      if (colMap[req_col] == null) {
        return res.status(400).json({
          success: false,
          message: `Missing required column: "${req_col}" — check your header row`
        });
      }
    }

    // Read a cell value as a trimmed string
    const col = (row, name) => {
      const idx = colMap[key(name)];
      if (idx == null) return '';
      const cell = row.getCell(idx);
      if (cell.value == null) return '';
      // ExcelJS may return { text, hyperlink } objects for rich cells
      if (typeof cell.value === 'object' && cell.value.text) return String(cell.value.text).trim();
      return String(cell.value).trim();
    };

    // Build the set of designations that should receive reserved (MGT) EINs
    const mgtDesignations = new Set(
      (req.body.managementDesignations || '')
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(Boolean)
    );

    const results = { created: 0, updated: 0, skipped: 0, skippedRows: [], errors: [], rows: [] };
    if (clearFirst) results.deletedBefore = deletedCount;

    // ── PASS 1: Collect all valid rows ────────────────────────────────────
    // We defer EIN assignment for auto-prefix rows so we can sort by tenure.
    const validRows = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (!row.hasValues) continue;

      const employeeName = col(row, 'Employee Name');
      if (!employeeName || employeeName.toLowerCase() === 'blank') {
        results.skipped++;
        results.skippedRows.push({ row: r, reason: employeeName ? 'Name is "Blank"' : 'Empty name' });
        continue;
      }

      const location    = col(row, 'Location');
      const section     = col(row, 'Section');
      const profile     = col(row, 'Profile');
      const designation = col(row, 'Designation');

      if (!location || !section || !profile) {
        results.errors.push({ row: r, name: employeeName, error: 'Missing Location / Section / Profile' });
        continue;
      }

      const fileEIN  = col(row, 'EIN');  // non-empty → use as-is
      const isMgt    = mgtDesignations.size > 0 && mgtDesignations.has(designation.toLowerCase());
      const prefix   = (!fileEIN && !isMgt) ? getPrefix(location, section, profile) : null;

      const monthlySalary = parseFloat(col(row, 'Monthly Salary')) || 0;
      const ctcAnnualRaw  = parseFloat(col(row, 'CTC Annual'))     || 0;
      const ctcAnnual     = ctcAnnualRaw || monthlySalary * 12;
      const accountNumber = col(row, 'Bank Account Number') || '';
      const dateOfJoining = parseDate(col(row, 'Date of Joining'));

      validRows.push({
        rowNum: r,
        employeeName,
        designation,
        location, section, profile, prefix,
        fileEIN,
        isMgt,
        dateOfJoining,
        // full empData fields (EIN assigned later for auto/reserved rows)
        fields: {
          title:          col(row, 'Title')          || '',
          employeeName,
          gender:         col(row, 'Gender')         || '',
          designation,
          department:     col(row, 'Department')     || '',
          location, section, profile,
          dateOfBirth:    parseDate(col(row, 'Date of Birth')),
          dateOfJoining,
          panNumber:      col(row, 'PAN Number')     || '',
          aadhaarNumber:  col(row, 'Aadhaar Number') || '',
          phoneNumber:    col(row, 'Phone Number')   || '',
          email:          col(row, 'Email')          || '',
          address:        col(row, 'Address')        || '',
          monthlySalary,
          ctcAnnual,
          ctcMonthly:     ctcAnnual / 12,
          pfApplicable:   col(row, 'PF Applicable').toLowerCase()   === 'yes',
          esicApplicable: col(row, 'ESIC Applicable').toLowerCase() === 'yes',
          ptApplicable:   col(row, 'PT Applicable').toLowerCase()   === 'yes',
          isRestricted:   col(row, 'Restricted').toLowerCase()      === 'yes',
          uanNumber:      col(row, 'UAN Number')     || '',
          accountNumber,
          // Read bank details from file; fall back to defaults when blank
          bankName:          col(row, 'Bank Name')   || (accountNumber ? 'IDBI' : ''),
          ifscCode:         (col(row, 'IFSC Code')   || (accountNumber ? 'IBKL0000430' : '')).toUpperCase(),
          accountHolderName: col(row, 'Account Holder Name') || (accountNumber ? employeeName : ''),
          paymentMode:       col(row, 'Payment Mode') || 'Bank Transfer',
          bankVerificationStatus: accountNumber ? 'Pending' : 'Not Filled',
          isActive:       true,
          createdBy:      req.session.user.username,
          updatedAt:      new Date()
        }
      });
    }

    // ── Between passes: assign EINs for auto-prefix rows by tenure ────────
    // Group rows that need a prefix-based EIN by prefix, sort oldest→newest
    // joining date, then assign sequential numbers so the most senior
    // employee gets the lowest EIN (e.g. STT-1001).
    const prefixGroups = {};
    for (const vr of validRows) {
      if (!vr.fileEIN && !vr.isMgt && vr.prefix) {
        if (!prefixGroups[vr.prefix]) prefixGroups[vr.prefix] = [];
        prefixGroups[vr.prefix].push(vr);
      }
    }

    for (const prefix of Object.keys(prefixGroups)) {
      // Sort ascending: oldest joining date → lowest EIN number
      // Rows with no joining date go to the end
      prefixGroups[prefix].sort((a, b) => {
        if (!a.dateOfJoining && !b.dateOfJoining) return 0;
        if (!a.dateOfJoining) return 1;
        if (!b.dateOfJoining) return -1;
        return a.dateOfJoining - b.dateOfJoining;
      });

      // Determine starting counter:
      //   clearFirst → fresh start at 1000 (first assigned will be 1001)
      //   otherwise  → find the highest existing EIN for this prefix
      let counter = 1000;
      if (!clearFirst) {
        const last = await Employee.findOne({ ein: { $regex: '^' + prefix + '-' } }).sort({ ein: -1 });
        if (last && last.ein) {
          const n = parseInt((last.ein.split('-')[1]) || '1000');
          if (!isNaN(n)) counter = n;
        }
      }

      for (const vr of prefixGroups[prefix]) {
        counter++;
        vr.assignedEIN = prefix + '-' + counter;
      }
    }

    // ── PASS 2: Upsert each row with its final EIN ─────────────────────────
    for (const vr of validRows) {
      const { rowNum, employeeName, fileEIN, isMgt, fields } = vr;

      try {
        let einValue  = fileEIN || vr.assignedEIN || null;
        let einSource = fileEIN ? 'provided' : (isMgt ? 'reserved' : 'auto');
        let reservedSlot = null;

        // MGT designation → pull from reserved pool (or name-match existing MGT employee)
        if (isMgt && !fileEIN) {
          // First check if they already have an MGT EIN in the DB (name match)
          const existingMgt = await Employee.findOne({
            employeeName: { $regex: '^' + employeeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' },
            ein: /^MGT-/i
          });
          if (existingMgt) {
            einValue  = existingMgt.ein;
            einSource = 'mgt-name-match';
          } else {
            reservedSlot = await ReservedEIN.findOne({ status: 'available' }).sort({ ein: 1 });
            if (!reservedSlot) {
              results.errors.push({
                row: rowNum, name: employeeName,
                error: `Designation "${vr.designation}" needs a reserved EIN but the pool is empty. ` +
                       'Seed more with POST /api/reserved-eins/seed.'
              });
              continue;
            }
            einValue  = reservedSlot.ein;
            einSource = 'reserved';
          }
        }

        if (!einValue) {
          results.errors.push({ row: rowNum, name: employeeName, error: 'Could not determine EIN' });
          continue;
        }

        const empData = { ...fields, ein: einValue };

        // ── Upsert ──────────────────────────────────────────────────────────
        // Priority 1: match by EIN if the file provided one
        // Priority 2: match by name (handles re-import when clearFirst=false)
        let existing = null;
        if (fileEIN) {
          existing = await Employee.findOne({ ein: einValue });
        } else if (einSource === 'mgt-name-match') {
          existing = await Employee.findOne({ ein: einValue });
        } else if (!clearFirst) {
          // name-match upsert — only needed when we didn't just clear the table
          existing = await Employee.findOne({
            employeeName: { $regex: '^' + employeeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' }
          });
        }

        if (existing) {
          // Preserve the existing EIN on a name-match update so we don't shift EINs
          const updateData = { ...empData };
          if (einSource === 'auto' || einSource === 'mgt-name-match') {
            updateData.ein = existing.ein;
          }
          await Employee.findByIdAndUpdate(existing._id, { $set: updateData }, { runValidators: false });
          results.updated++;
          results.rows.push({ row: rowNum, ein: existing.ein, name: employeeName, action: 'updated', einSource });
        } else {
          const doc = new Employee(empData);
          const created = await doc.save({ validateBeforeSave: false });
          results.created++;
          results.rows.push({ row: rowNum, ein: einValue, name: employeeName, action: 'created', einSource });

          if (reservedSlot) {
            reservedSlot.status             = 'assigned';
            reservedSlot.assignedTo         = employeeName;
            reservedSlot.assignedEmployeeId = created._id;
            reservedSlot.assignedAt         = new Date();
            await reservedSlot.save();
          }
        }
      } catch (e) {
        results.errors.push({ row: rowNum, name: employeeName, error: e.message });
      }
    }

    const msgParts = [`Import complete — Created: ${results.created}, Updated: ${results.updated}, Skipped: ${results.skipped}, Errors: ${results.errors.length}`];
    if (clearFirst) msgParts.push(`(cleared ${deletedCount} previous employees before import)`);

    return res.json({
      success: true,
      message: msgParts.join(' '),
      ...results,
      skippedRows: results.skippedRows
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
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

module.exports = router;
