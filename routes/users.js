const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

// GET all users
// Accountants may list only supervisor accounts within their branches
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const requester = req.session.user;
    if (requester.role !== 'admin' && requester.role !== 'management' && requester.role !== 'accountant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    let filter = {};
    if (requester.role === 'accountant') {
      filter.role = 'supervisor';
      const branches = requester.branches || (requester.branch ? [requester.branch] : []);
      if (branches.length > 0 && !branches.includes('all')) {
        filter.branches = { $elemMatch: { $in: branches } };
      }
    }
    const users = await User.find(filter, { password: 0 }).sort({ createdAt: -1 });
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'users list') });
  }
});

// GET single user
router.get('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, { password: 0 });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'users get') });
  }
});

// CREATE user
// Accountants may only create supervisor accounts
router.post('/', isLoggedIn, async (req, res) => {
  try {
    const requester = req.session.user;
    if (requester.role !== 'admin' && requester.role !== 'management' && requester.role !== 'accountant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { username, password, fullName, role, branches, managementLevel, linkedEmployeeId, ein } = req.body;
    // Accountants are strictly limited to creating supervisor accounts
    if (requester.role === 'accountant' && role !== 'supervisor') {
      return res.status(403).json({ success: false, message: 'Accountants can only create Supervisor accounts' });
    }
    if (!username || !password || !fullName || !role) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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
    return res.status(500).json({ success: false, message: safeError(err, 'users create') });
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
    // Don't wipe existing employee link if no new one was provided in this update
    const existingUser = await User.findById(req.params.id);
    const updateData = {
      fullName, role, branches, isActive,
      managementLevel: managementLevel || null,
      employeeId: linkedEmployeeId || (existingUser ? existingUser.employeeId : null),
      ein: ein || (existingUser ? existingUser.ein : null)
    };

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, select: '-password' }
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, message: 'User updated successfully', user });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'users update') });
  }
});

// RESET password — admin always; accountant may reset supervisor accounts within their branches
router.patch('/:id/reset-password', isLoggedIn, async (req, res) => {
  const requester = req.session.user;
  if (requester.role !== 'admin' && requester.role !== 'accountant') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }
    const targetUser = await User.findById(req.params.id).select('username fullName email role branches branch');
    if (requester.role === 'accountant') {
      if (targetUser?.role !== 'supervisor') {
        return res.status(403).json({ success: false, message: 'Accountants can only reset supervisor passwords' });
      }
      const acctBranches = requester.branches || (requester.branch ? [requester.branch] : []);
      if (!acctBranches.includes('all')) {
        const supBranches = targetUser.branches || (targetUser.branch ? [targetUser.branch] : []);
        const overlap = supBranches.some(b => acctBranches.includes(b));
        if (!overlap) {
          return res.status(403).json({ success: false, message: 'Supervisor is not in your branch' });
        }
      }
    }
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });

    // Notify the affected user if they have a registered email
    if (targetUser.email) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
        });
        const resetBy = req.session.user.fullName + ' (' + req.session.user.username + ')';
        await transporter.sendMail({
          from: '"Payroll System Security" <' + process.env.GMAIL_USER + '>',
          to: targetUser.email,
          subject: 'Your Payroll System password was reset',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;">
              <h2 style="color:#1a73e8;">Password Reset Notification</h2>
              <p>Hi <strong>${targetUser.fullName}</strong>,</p>
              <p>Your password for the Payroll System was reset on <strong>${new Date().toLocaleString('en-IN')}</strong> by <strong>${resetBy}</strong>.</p>
              <p>If you requested this reset, no further action is needed.</p>
              <p style="color:#c0392b;"><strong>If you did NOT request this reset, please contact your system administrator immediately.</strong></p>
            </div>
          `
        });
      } catch (mailErr) {
        console.error('[reset-password notification]', mailErr.message);
        // Email failure is non-fatal — password is already reset
      }
    }

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'users reset-password') });
  }
});

// TOGGLE active status
// Accountants may activate/deactivate supervisor accounts only
router.patch('/:id/toggle', isLoggedIn, async (req, res) => {
  try {
    const requester = req.session.user;
    if (requester.role !== 'admin' && requester.role !== 'management' && requester.role !== 'accountant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.params.id === requester.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    // Accountants may only toggle supervisor accounts
    if (requester.role === 'accountant' && user.role !== 'supervisor') {
      return res.status(403).json({ success: false, message: 'Accountants can only manage Supervisor accounts' });
    }
    user.isActive = !user.isActive;
    await user.save();
    return res.json({
      success: true,
      message: user.isActive ? 'User activated' : 'User deactivated',
      user
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'users toggle') });
  }
});

module.exports = router;
