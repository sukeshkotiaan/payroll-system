const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// GET all users
router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 });
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET single user
router.get('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, { password: 0 });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// CREATE user
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { username, password, fullName, role, branches, managementLevel, linkedEmployeeId, ein } = req.body;
    if (!username || !password || !fullName || !role) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      username: username.toLowerCase(),
      password: hashedPassword,
      fullName,
      role,
      managementLevel: managementLevel || null,
      employeeId: linkedEmployeeId || null,
      ein: ein || null,
      branches: branches || ['all']
    });
    return res.json({
      success: true,
      message: 'User created successfully',
      user: { ...user.toObject(), password: undefined }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE user
router.put('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { fullName, role, branches, isActive, managementLevel, linkedEmployeeId, ein } = req.body;
    const currentUser = req.session.user;
    if (req.params.id === currentUser.id && isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { fullName, role, branches, isActive, managementLevel: managementLevel || null, employeeId: linkedEmployeeId || null, ein: ein || null },
      { new: true, select: '-password' }
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, message: 'User updated successfully', user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// RESET password
router.patch('/:id/reset-password', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// TOGGLE active status
router.patch('/:id/toggle', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const currentUser = req.session.user;
    if (req.params.id === currentUser.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    return res.json({
      success: true,
      message: user.isActive ? 'User activated' : 'User deactivated',
      user
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
