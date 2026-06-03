const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');

// Placeholder — full module coming next
router.get('/', isLoggedIn, (req, res) => {
  res.json({ success: true, message: 'Employees route working' });
});

module.exports = router;