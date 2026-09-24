const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const Employee = require('../models/Employee');
const Token    = require('../models/PhotoUploadToken');
const SchoolInfo = require('../models/SchoolInfo');
const { isLoggedIn } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'photo_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG/PNG images are allowed'));
  }
});

// ── Auth helper: supervisor sees only their employees ──────────────────────────
function isSupervisorOrAdmin(req) {
  const role = req.session && req.session.user && req.session.user.role;
  return ['admin', 'management', 'supervisor'].includes(role);
}

// ── GET /api/photo-upload/status  (supervisor/admin) ──────────────────────────
// Returns employee list with photo status for the logged-in supervisor's team
router.get('/status', isLoggedIn, async (req, res) => {
  try {
    if (!isSupervisorOrAdmin(req)) return res.status(403).json({ success: false, message: 'Access denied' });
    const user = req.session.user;
    const filter = { isActive: true };
    if (user.role === 'supervisor') filter.supervisorId = user.id;

    const employees = await Employee.find(filter)
      .select('ein employeeName designation department section location photo photoStatus photoRejectedNote photoLinkSentAt supervisorId supervisorName phoneNumber')
      .sort({ employeeName: 1 });

    // Attach active token info (link sent, expiry) per employee
    const empIds = employees.map(e => e._id);
    const tokens = await Token.find({ employeeId: { $in: empIds }, usedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 });
    const tokenMap = {};
    tokens.forEach(t => {
      if (!tokenMap[t.employeeId.toString()]) tokenMap[t.employeeId.toString()] = t;
    });

    const result = employees.map(e => {
      const tok = tokenMap[e._id.toString()];
      return {
        _id: e._id,
        ein: e.ein,
        employeeName: e.employeeName,
        designation: e.designation,
        department: e.department,
        section: e.section,
        location: e.location,
        photo: e.photo || null,
        photoStatus: e.photoStatus || 'none',
        photoRejectedNote: e.photoRejectedNote || '',
        photoLinkSentAt: e.photoLinkSentAt,
        supervisorName: e.supervisorName,
        phoneNumber: e.phoneNumber || '',
        activeToken: tok ? { expiresAt: tok.expiresAt, createdBy: tok.createdBy } : null
      };
    });

    // Summary counts
    const counts = { total: result.length, none: 0, link_sent: 0, pending_review: 0, approved: 0, rejected: 0 };
    result.forEach(e => {
      if (e.photoStatus === 'approved')       counts.approved++;
      else if (e.photoStatus === 'rejected')  counts.rejected++;
      else if (e.photoStatus === 'pending_review') counts.pending_review++;
      else if (e.activeToken)                 counts.link_sent++;
      else                                    counts.none++;
    });

    return res.json({ success: true, employees: result, counts });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'photo-upload status') });
  }
});

// ── POST /api/photo-upload/generate-link  (supervisor/admin) ──────────────────
// Generates a 7-day upload token for an employee
router.post('/generate-link', isLoggedIn, async (req, res) => {
  try {
    if (!isSupervisorOrAdmin(req)) return res.status(403).json({ success: false, message: 'Access denied' });
    const user = req.session.user;
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId required' });

    const emp = await Employee.findById(employeeId).select('ein employeeName supervisorId phoneNumber');
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Supervisors can only generate links for their own team
    if (user.role === 'supervisor' && (!emp.supervisorId || emp.supervisorId.toString() !== user.id.toString())) {
      return res.status(403).json({ success: false, message: 'This employee is not in your team' });
    }

    // Invalidate any existing unused tokens for this employee
    await Token.deleteMany({ employeeId, usedAt: null });

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await Token.create({ employeeId, token: hashToken(token), expiresAt, createdBy: user.username, createdById: user.id });

    await Employee.findByIdAndUpdate(employeeId, { $set: { photoLinkSentAt: new Date() } });

    return res.json({ success: true, token, expiresAt, employeeName: emp.employeeName, phone: emp.phoneNumber });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'photo-upload generate-link') });
  }
});

// ── GET /api/photo-upload/validate/:token  (PUBLIC — no auth) ─────────────────
router.get('/validate/:token', async (req, res) => {
  try {
    const tok = await Token.findOne({ token: hashToken(req.params.token) });
    if (!tok) return res.status(404).json({ success: false, message: 'Link is invalid or has already been used.' });
    if (tok.expiresAt < new Date()) return res.status(410).json({ success: false, message: 'This link has expired. Please ask your supervisor for a new link.' });

    const emp = await Employee.findById(tok.employeeId).select('employeeName designation department section photo photoStatus photoRejectedNote');
    if (!emp) return res.status(404).json({ success: false, message: 'Employee record not found.' });

    const school = await SchoolInfo.findOne({ schoolType: emp.section === 'Global' ? 'global' : 'xaviers' });

    return res.json({
      success: true,
      employee: {
        employeeName: emp.employeeName,
        designation: emp.designation,
        department: emp.department,
        section: emp.section,
        photoStatus: emp.photoStatus,
        photoRejectedNote: emp.photoRejectedNote,
        hasExistingPhoto: !!emp.photo
      },
      school: school ? { schoolName: school.schoolName, logo: school.logo } : null,
      expiresAt: tok.expiresAt
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'photo-upload validate') });
  }
});

// ── POST /api/photo-upload/submit/:token  (PUBLIC — no auth) ──────────────────
router.post('/submit/:token', upload.single('photo'), async (req, res) => {
  try {
    const tok = await Token.findOne({ token: hashToken(req.params.token) });
    if (!tok)            return res.status(404).json({ success: false, message: 'Invalid link.' });
    if (tok.usedAt)      return res.status(409).json({ success: false, message: 'This link has already been used.' });
    if (tok.expiresAt < new Date()) return res.status(410).json({ success: false, message: 'Link has expired. Please contact your supervisor.' });

    if (!req.file) return res.status(400).json({ success: false, message: 'No photo received.' });

    const photoPath = '/uploads/' + req.file.filename;

    await Employee.findByIdAndUpdate(tok.employeeId, {
      $set: {
        photo: photoPath,
        photoStatus: 'pending_review',
        photoRejectedNote: '',
        updatedAt: new Date()
      }
    });

    tok.usedAt = new Date();
    await tok.save();

    return res.json({ success: true, message: 'Photo uploaded successfully! Your supervisor will review it.' });
  } catch (err) {
    if (req.file) fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
    return res.status(500).json({ success: false, message: safeError(err, 'photo-upload submit') });
  }
});

// ── PATCH /api/photo-upload/review/:employeeId  (supervisor/admin) ────────────
// action: 'approve' | 'reject'
router.patch('/review/:employeeId', isLoggedIn, async (req, res) => {
  try {
    if (!isSupervisorOrAdmin(req)) return res.status(403).json({ success: false, message: 'Access denied' });
    const user = req.session.user;
    const { action, note } = req.body; // action: 'approve' | 'reject', note: optional rejection reason

    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid action' });

    const emp = await Employee.findById(req.params.employeeId);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    if (user.role === 'supervisor' && (!emp.supervisorId || emp.supervisorId.toString() !== user.id.toString())) {
      return res.status(403).json({ success: false, message: 'This employee is not in your team' });
    }

    if (action === 'approve') {
      emp.photoStatus = 'approved';
      emp.photoRejectedNote = '';
    } else {
      emp.photoStatus = 'rejected';
      emp.photoRejectedNote = note || 'Please re-upload a clear photo.';
    }
    emp.updatedAt = new Date();
    await emp.save();

    return res.json({ success: true, message: action === 'approve' ? 'Photo approved.' : 'Photo rejected — employee notified on re-upload.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'photo-upload review') });
  }
});

module.exports = router;
