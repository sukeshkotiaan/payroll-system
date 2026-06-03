const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const Settings = require('../models/Settings');

// GET calculation rules
router.get('/calc-rules', isLoggedIn, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({
        basicPercent: 76.923,
        hraPercent: 23.077,
        pfRate: 12,
        pfCap: 1800,
        esicRate: 0.75,
        esicLimit: 21000,
        ptSlabs: [
          { min: 0, max: 7500, amount: 0 },
          { min: 7501, max: 10000, amount: 175 },
          { min: 10001, max: 999999, amount: 200 }
        ],
        februaryPT: 300,
        einStartNumber: 1001,
        einSeparator: '-'
      });
    }
    return res.json({ success: true, rules: settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE calculation rules
router.put('/calc-rules', isLoggedIn, isAdmin, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    return res.json({ success: true, message: 'Settings saved', rules: settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;