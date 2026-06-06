const express = require('express');
const router = express.Router();
const Master = require('../models/Master');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

const ALL_MENUS = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'employees', label: '👥 Employee Master' },
  { key: 'exits', label: '🚪 Exit Management' },
  { key: 'attendance', label: '📋 Attendance Upload' },
  { key: 'payroll', label: '💰 Payroll Processing' },
  { key: 'payroll-approval', label: '✅ Payroll Approval' },
  { key: 'payslip', label: '🧾 Payslip' },
  { key: 'archive', label: '📁 Archive' },
  { key: 'reports', label: '📊 Reports' },
  { key: 'masters', label: '📋 Masters' },
  { key: 'settings', label: '⚙️ Settings' },
  { key: 'users', label: '👤 User Management' }
];

const seedMasters = async () => {
  try {
    const count = await Master.countDocuments();
    if (count === 0) {
      await Master.insertMany([
        { type: 'location', value: 'Thane' },
        { type: 'location', value: 'Panvel' },
        { type: 'section', value: 'Global' },
        { type: 'section', value: 'State' },
        { type: 'profile', value: 'Teaching' },
        { type: 'profile', value: 'Non-Teaching' },
        { type: 'department', value: 'Primary' },
        { type: 'department', value: 'Secondary' },
        { type: 'department', value: 'Junior College' },
        { type: 'department', value: 'Back Office' },
        { type: 'department', value: 'Admin' },
        { type: 'designation', value: 'Teacher' },
        { type: 'designation', value: 'Senior Teacher' },
        { type: 'designation', value: 'Head of Department' },
        { type: 'designation', value: 'Principal' },
        { type: 'designation', value: 'Vice Principal' },
        { type: 'designation', value: 'Clerk' },
        { type: 'designation', value: 'Accountant' },
        { type: 'designation', value: 'Peon' },
        { type: 'designation', value: 'Security Guard' },
        {
          type: 'role', value: 'management',
          permissions: ALL_MENUS.map(m => m.key)
        },
        {
          type: 'role', value: 'accountant',
          permissions: ['dashboard','employees','attendance','payroll','payslip','archive']
        }
      ]);
      console.log('✅ Default masters seeded');
    }
  } catch (err) {
    console.log('Masters seed error:', err.message);
  }
};
seedMasters();

// GET all menus list
router.get('/menus', isLoggedIn, async (req, res) => {
  return res.json({ success: true, menus: ALL_MENUS });
});

// GET masters by type
router.get('/:type', isLoggedIn, async (req, res) => {
  try {
    const filter = { type: req.params.type };
    if (req.query.all !== 'true') filter.isActive = true;
    const masters = await Master.find(filter).sort({ value: 1 });
    return res.json({ success: true, masters });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET all masters
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const masters = await Master.find().sort({ type: 1, value: 1 });
    return res.json({ success: true, masters });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADD master
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { type, value, permissions } = req.body;
    if (!type || !value) {
      return res.status(400).json({ success: false, message: 'Type and value required' });
    }
    const existing = await Master.findOne({ type, value });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Value already exists' });
    }
    const master = await Master.create({
      type, value,
      permissions: permissions || []
    });
    return res.json({ success: true, message: 'Added successfully', master });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE master
router.put('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const master = await Master.findByIdAndUpdate(
      req.params.id,
      { value: req.body.value, permissions: req.body.permissions },
      { new: true }
    );
    return res.json({ success: true, message: 'Updated successfully', master });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// TOGGLE active
router.patch('/:id/toggle', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const master = await Master.findById(req.params.id);
    master.isActive = !master.isActive;
    await master.save();
    return res.json({
      success: true,
      message: master.isActive ? 'Activated' : 'Deactivated',
      master
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
