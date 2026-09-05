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

router.post('/', isLoggedIn, isAdmin, upload.single('photo'), async (req, res) => {
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

router.put('/:id', isLoggedIn, isAdmin, upload.single('photo'), async (req, res) => {
  try {
    console.log('PUT /employees/:id =>', req.params.id, '| body keys:', Object.keys(req.body || {}));
    const data = req.body;
    if (req.file) data.photo = '/uploads/' + req.file.filename;
    data.updatedAt = Date.now();
    if (typeof data.qualifications === 'string') {
      try { data.qualifications = JSON.parse(data.qualifications); }
      catch(e) { data.qualifications = []; }
    }
    if (data.monthlySalary) {
      data.ctcAnnual = parseFloat(data.monthlySalary) * 12;
    }
    if (data.bankVerifiedAt === '') data.bankVerifiedAt = null;
    // Remove _id from $set to avoid Mongoose immutable field error
    delete data._id;
    const employee = await Employee.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    console.log('PUT /employees/:id result:', employee ? 'found & updated' : 'NOT FOUND for id=' + req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found. Try refreshing the page and editing again.' });
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

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
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

    // Cache the highest existing EIN number per prefix so we don't query DB for every row
    const einCounters = {};
    const getAutoEIN = async (location, section, profile) => {
      const secCode  = section  === 'Global'      ? 'G' : 'S';
      const locCode  = location === 'Thane'        ? 'T' : 'P';
      const profCode = profile  === 'Teaching'     ? 'T' : 'N';
      const prefix   = secCode + locCode + profCode;
      if (einCounters[prefix] == null) {
        const last = await Employee.findOne({ ein: { $regex: '^' + prefix + '-' } }).sort({ ein: -1 });
        einCounters[prefix] = 1000;
        if (last && last.ein) {
          const n = parseInt((last.ein.split('-')[1]) || '1000');
          if (!isNaN(n)) einCounters[prefix] = n;
        }
      }
      einCounters[prefix]++;
      return prefix + '-' + einCounters[prefix];
    };

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (!row.hasValues) continue;

      const employeeName = col(row, 'Employee Name');
      // Skip placeholder / blank rows
      if (!employeeName || employeeName.toLowerCase() === 'blank') {
        results.skipped++;
        results.skippedRows.push({ row: r, reason: employeeName ? 'Name is "Blank"' : 'Empty name' });
        continue;
      }

      const location = col(row, 'Location');
      const section  = col(row, 'Section');
      const profile  = col(row, 'Profile');

      if (!location || !section || !profile) {
        results.errors.push({ row: r, name: employeeName, error: 'Missing Location / Section / Profile' });
        continue;
      }

      try {
        // ── EIN ────────────────────────────────────────────────────────────
        let einValue     = col(row, 'EIN');
        let einSource    = 'provided';
        let reservedSlot = null;

        if (!einValue) {
          const designation = col(row, 'Designation');
          const isMgt = mgtDesignations.size > 0 &&
                        mgtDesignations.has(designation.toLowerCase());

          if (isMgt) {
            reservedSlot = await ReservedEIN.findOne({ status: 'available' }).sort({ ein: 1 });
            if (!reservedSlot) {
              results.errors.push({
                row: r, name: employeeName,
                error: `Designation "${designation}" needs a reserved EIN but the pool is empty. ` +
                       'Seed more with POST /api/reserved-eins/seed.'
              });
              continue;
            }
            einValue  = reservedSlot.ein;
            einSource = 'reserved';
          } else {
            einValue  = await getAutoEIN(location, section, profile);
            einSource = 'auto';
          }
        }

        // ── Salary / CTC ───────────────────────────────────────────────────
        const monthlySalary = parseFloat(col(row, 'Monthly Salary')) || 0;
        const ctcAnnualRaw  = parseFloat(col(row, 'CTC Annual'))     || 0;
        const ctcAnnual     = ctcAnnualRaw || monthlySalary * 12;

        // ── Bank account ───────────────────────────────────────────────────
        const accountNumber = col(row, 'Bank Account Number') || '';

        // ── Build the full employee record ──────────────────────────────────
        const empData = {
          ein:            einValue,
          title:          col(row, 'Title')          || '',
          employeeName,
          gender:         col(row, 'Gender')         || '',
          designation:    col(row, 'Designation')    || '',
          department:     col(row, 'Department')     || '',
          location,
          section,
          profile,
          dateOfBirth:    parseDate(col(row, 'Date of Birth')),
          dateOfJoining:  parseDate(col(row, 'Date of Joining')),
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
          bankVerificationStatus: accountNumber ? 'Pending' : 'Not Filled',
          isActive:       true,
          createdBy:      req.session.user.username,
          updatedAt:      new Date()
        };

        // ── Upsert: match on existing EIN ──────────────────────────────────
        const existing = await Employee.findOne({ ein: einValue });
        if (existing) {
          await Employee.findByIdAndUpdate(existing._id, { $set: empData });
          results.updated++;
          results.rows.push({ row: r, ein: einValue, name: employeeName, action: 'updated', einSource });
        } else {
          const created = await Employee.create(empData);
          results.created++;
          results.rows.push({ row: r, ein: einValue, name: employeeName, action: 'created', einSource });

          // Mark reserved slot as assigned if we used one
          if (reservedSlot) {
            reservedSlot.status             = 'assigned';
            reservedSlot.assignedTo         = employeeName;
            reservedSlot.assignedEmployeeId = created._id;
            reservedSlot.assignedAt         = new Date();
            await reservedSlot.save();
          }
        }
      } catch (e) {
        results.errors.push({ row: r, name: employeeName, error: e.message });
      }
    }

    return res.json({
      success: true,
      message: `Import complete — Created: ${results.created}, Updated: ${results.updated}, Skipped: ${results.skipped}, Errors: ${results.errors.length}`,
      ...results,
      skippedRows: results.skippedRows   // explicit for clarity
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
