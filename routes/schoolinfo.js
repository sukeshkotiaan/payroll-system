const express = require('express');
const router = express.Router();
const SchoolInfo = require('../models/SchoolInfo');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

// GET all school info
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const schools = await SchoolInfo.find();
    return res.json({ success: true, schools });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'schoolinfo list') });
  }
});

// GET single school info
router.get('/:type', isLoggedIn, async (req, res) => {
  try {
    const school = await SchoolInfo.findOne({ schoolType: req.params.type });
    return res.json({ success: true, school });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'schoolinfo get') });
  }
});

// SAVE school info (upsert)
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { schoolType, schoolName, address, phone, email, affiliation, logo, bankAccountNumber, bankServiceOutlet } = req.body;
    if (!schoolType) return res.status(400).json({ success: false, message: 'School type required' });
    const school = await SchoolInfo.findOneAndUpdate(
      { schoolType },
      { schoolType, schoolName, address, phone, email, affiliation, logo,
        bankAccountNumber: bankAccountNumber || '',
        bankServiceOutlet: parseInt(bankServiceOutlet) || 430,
        updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'School info saved', school });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'schoolinfo post') });
  }
});

module.exports = router;
