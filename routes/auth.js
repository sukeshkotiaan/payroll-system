const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { isLoggedIn } = require('../middleware/auth');
const Employee = require('../models/Employee');

// Seed default admin on first run
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('Admin@1234', 12);
      await User.create({
        username: 'admin',
        password: hashedPassword,
        fullName: 'System Administrator',
        role: 'admin',
        branch: 'all'
      });
      console.log('✅ Default admin created → username: admin / password: Admin@1234');
    } else {
      console.log('✅ Admin already exists');
    }
  } catch (err) {
    console.log('Seed error:', err.message);
  }
};
seedAdmin();

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    const sessionUser = {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      branch: user.branch,
      branches: user.branches || []
    };

    if (user.role === 'supervisor') {
      const emp = await Employee.findOne({ employeeName: user.fullName, isActive: true });
      if (emp) {
        sessionUser.supervisorEIN = emp.ein;
        sessionUser.supervisorEmployeeId = emp._id;
        sessionUser.location = emp.location;
        sessionUser.section = emp.section;
        sessionUser.profile = emp.profile;
      }
    }

    req.session.user = sessionUser;
    return res.json({
      success: true,
      message: 'Login successful',
      user: req.session.user
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// LOGOUT
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out' });
});

// GET current user
router.get('/me', isLoggedIn, (req, res) => {
  res.json({ success: true, user: req.session.user });
});

module.exports = router;