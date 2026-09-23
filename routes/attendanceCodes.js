const express = require('express');
const router = express.Router();
const AttendanceCode = require('../models/AttendanceCode');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

const SYSTEM_CODES = [
  { code: 'P',   name: 'Present',       bgColor: '#e6f4ea', textColor: '#34a853', logic: 'present', isSystem: true, order: 1 },
  { code: 'A',   name: 'Absent',        bgColor: '#fce8e6', textColor: '#ea4335', logic: 'absent',  isSystem: true, order: 2 },
  { code: 'HD',  name: 'Half Day',      bgColor: '#fff9c4', textColor: '#f57f17', logic: 'half',    isSystem: true, order: 3 },
  { code: 'WO',  name: 'Week Off',      bgColor: '#f5f5f5', textColor: '#757575', logic: 'off',     isSystem: true, order: 4 },
  { code: 'H',   name: 'Holiday',       bgColor: '#e0f2f1', textColor: '#00695c', logic: 'off',     isSystem: true, order: 5 },
  { code: 'CL',  name: 'Casual Leave',  bgColor: '#fff3e0', textColor: '#e65100', logic: 'present', isSystem: false, order: 6 },
  { code: 'SL',  name: 'Sick Leave',    bgColor: '#fce4ec', textColor: '#c2185b', logic: 'present', isSystem: false, order: 7 },
  { code: 'PL',  name: 'Paid Leave',    bgColor: '#e8eaf6', textColor: '#3949ab', logic: 'present', isSystem: false, order: 8 },
  { code: 'SpL', name: 'Special Leave', bgColor: '#f3e5f5', textColor: '#7b1fa2', logic: 'present', isSystem: false, order: 9 },
];

async function seedCodes() {
  try {
    const count = await AttendanceCode.countDocuments();
    if (count === 0) {
      await AttendanceCode.insertMany(SYSTEM_CODES);
    }
  } catch (e) {}
}
seedCodes();

// GET all active codes (used by attendance page)
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const all = req.query.all === 'true';
    const filter = all ? {} : { isActive: true };
    const codes = await AttendanceCode.find(filter).sort({ order: 1, code: 1 });
    return res.json({ success: true, codes });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance-codes get') });
  }
});

// POST create new code
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { name, code, bgColor, textColor, logic, order } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'Name and code are required' });
    const upper = code.toUpperCase();
    const exists = await AttendanceCode.findOne({ code: upper });
    if (exists) return res.status(400).json({ success: false, message: 'Code already exists' });
    const ac = await AttendanceCode.create({
      name, code: upper, bgColor: bgColor || '#f0f2f5',
      textColor: textColor || '#333333', logic: logic || 'present',
      order: order || 99, isSystem: false
    });
    return res.json({ success: true, message: 'Code created', code: ac });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance-codes post') });
  }
});

// PUT update
router.put('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { name, bgColor, textColor, logic, order, isActive } = req.body;
    const ac = await AttendanceCode.findById(req.params.id);
    if (!ac) return res.status(404).json({ success: false, message: 'Not found' });
    if (name)      ac.name      = name;
    if (bgColor)   ac.bgColor   = bgColor;
    if (textColor) ac.textColor = textColor;
    if (logic)     ac.logic     = logic;
    if (order !== undefined) ac.order = order;
    if (isActive !== undefined) ac.isActive = isActive;
    await ac.save();
    return res.json({ success: true, message: 'Updated', code: ac });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance-codes put') });
  }
});

// PATCH toggle active
router.patch('/:id/toggle', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const ac = await AttendanceCode.findById(req.params.id);
    if (!ac) return res.status(404).json({ success: false, message: 'Not found' });
    if (ac.isSystem && ac.isActive) {
      return res.status(400).json({ success: false, message: 'System codes cannot be deactivated' });
    }
    ac.isActive = !ac.isActive;
    await ac.save();
    return res.json({ success: true, message: ac.isActive ? 'Activated' : 'Deactivated', code: ac });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance-codes toggle') });
  }
});

// DELETE — only non-system codes
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const ac = await AttendanceCode.findById(req.params.id);
    if (!ac) return res.status(404).json({ success: false, message: 'Not found' });
    if (ac.isSystem) return res.status(400).json({ success: false, message: 'System codes cannot be deleted' });
    await AttendanceCode.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'attendance-codes delete') });
  }
});

module.exports = router;
