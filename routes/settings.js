const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const Settings = require('../models/Settings');
const Master = require('../models/Master');

const defaultRules = (location, month, year, username) => ({
  effectiveMonth: month,
  effectiveYear: year,
  basicPercent: 76.923,
  hraPercent: 23.077,
  lopBase: 'total_salary',
  lopDivisor: 'actual_days_in_month',
  pfRate: 12,
  pfCap: 1800,
  pfAgeExemption: 'Yes',
  pfAgeLimit: 58,
  esicApplicable: 'No',
  esicEmployeeRate: 0.75,
  esicEmployerRate: 3.25,
  esicSalaryLimit: 21000,
  ptApplicable: 'Yes',
  ptSlabs: [
    { min: 0, max: 7500, amount: 0 },
    { min: 7501, max: 10000, amount: 175 },
    { min: 10001, max: 999999, amount: 200 }
  ],
  februaryPT: 300,
  tdsType: 'manual',
  tdsRate: 10,
  einSeparator: '-',
  einStartNumber: 1001,
  savedBy: username || 'system',
  savedAt: new Date(),
  changeNote: 'Initial setup'
});

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    const locations = await Master.find({ type: 'location', isActive: true });
    const locationList = locations.length > 0
      ? locations.map(l => l.value)
      : ['Thane', 'Panvel'];
    const now = new Date();
    const month = now.toLocaleString('en-IN', { month: 'long' });
    const year = now.getFullYear();
    settings = await Settings.create({
      locationSettings: locationList.map(loc => ({
        location: loc,
        currentRules: defaultRules(loc, month, year, 'system'),
        ruleHistory: []
      }))
    });
    console.log('✅ Default settings created');
  }
  return settings;
};

// GET all location rules
router.get('/calc-rules', isLoggedIn, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const rules = settings.locationSettings.map(ls => ({
      location: ls.location,
      ...ls.currentRules.toObject()
    }));
    return res.json({ success: true, rules });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET rules for specific location
router.get('/calc-rules/:location', isLoggedIn, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const ls = settings.locationSettings.find(
      l => l.location === req.params.location
    );
    if (!ls) {
      const now = new Date();
      return res.json({
        success: true,
        rules: defaultRules(
          req.params.location,
          now.toLocaleString('en-IN', { month: 'long' }),
          now.getFullYear(),
          'system'
        )
      });
    }
    return res.json({ success: true, rules: ls.currentRules });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET rule history for location
router.get('/rule-history/:location', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const ls = settings.locationSettings.find(
      l => l.location === req.params.location
    );
    if (!ls) return res.json({ success: true, history: [] });
    const history = [ls.currentRules, ...ls.ruleHistory]
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SAVE rules for specific location
router.put('/calc-rules/:location', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const { effectiveMonth, effectiveYear, changeNote, ...ruleData } = req.body;
    if (!effectiveMonth || !effectiveYear) {
      return res.status(400).json({
        success: false,
        message: 'Effective month and year are required'
      });
    }
    const newRule = {
      ...ruleData,
      effectiveMonth,
      effectiveYear: parseInt(effectiveYear),
      changeNote: changeNote || '',
      savedBy: req.session.user.username,
      savedAt: new Date()
    };
    const lsIndex = settings.locationSettings.findIndex(
      l => l.location === req.params.location
    );
    if (lsIndex >= 0) {
      const current = settings.locationSettings[lsIndex].currentRules;
      if (current) {
        settings.locationSettings[lsIndex].ruleHistory.push(current);
      }
      settings.locationSettings[lsIndex].currentRules = newRule;
    } else {
      settings.locationSettings.push({
        location: req.params.location,
        currentRules: newRule,
        ruleHistory: []
      });
    }
    settings.markModified('locationSettings');
    settings.updatedAt = new Date();
    await settings.save();
    return res.json({
      success: true,
      message: req.params.location + ' rules saved for ' + effectiveMonth + ' ' + effectiveYear,
      rules: newRule
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SET correction password
router.post('/correction-password', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    const settings = await getOrCreateSettings();
    settings.correctionPasswordHash = await bcrypt.hash(password, 12);
    settings.markModified('correctionPasswordHash');
    await settings.save();
    return res.json({ success: true, message: 'Correction password set successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// VERIFY correction password
router.post('/verify-correction-password', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    const username = req.session.user.username;
    const settings = await getOrCreateSettings();

    // Check if user is locked
    const lockIndex = settings.userLocks.findIndex(
      l => l.username === username
    );
    if (lockIndex >= 0) {
      const lock = settings.userLocks[lockIndex];
      if (lock.unlockAt && new Date() < new Date(lock.unlockAt)) {
        const minutesLeft = Math.ceil(
          (new Date(lock.unlockAt) - new Date()) / 60000
        );
        return res.status(403).json({
          success: false,
          message: 'Account locked. Try again in ' + minutesLeft + ' minutes',
          locked: true
        });
      } else {
        settings.userLocks.splice(lockIndex, 1);
        settings.markModified('userLocks');
      }
    }

    if (!settings.correctionPasswordHash) {
      return res.status(400).json({
        success: false,
        message: 'Correction password not set. Please set it in Settings first.'
      });
    }

    const isMatch = await bcrypt.compare(password, settings.correctionPasswordHash);

    settings.correctionAttempts.push({
      userId: req.session.user.id,
      username,
      attemptedAt: new Date(),
      success: isMatch
    });

    if (!isMatch) {
      const recentAttempts = settings.correctionAttempts.filter(
        a => a.username === username &&
          !a.success &&
          new Date() - new Date(a.attemptedAt) < 3600000
      );
      if (recentAttempts.length >= 3) {
        const unlockAt = new Date(Date.now() + 3600000);
        const existingLock = settings.userLocks.findIndex(
          l => l.username === username
        );
        if (existingLock >= 0) {
          settings.userLocks[existingLock] = {
            username,
            lockedAt: new Date(),
            unlockAt,
            attempts: recentAttempts.length
          };
        } else {
          settings.userLocks.push({
            username,
            lockedAt: new Date(),
            unlockAt,
            attempts: recentAttempts.length
          });
        }
        settings.markModified('userLocks');
        await settings.save();
        return res.status(403).json({
          success: false,
          message: 'Too many wrong attempts. Locked for 1 hour.',
          locked: true
        });
      }
      settings.markModified('correctionAttempts');
      await settings.save();
      const attemptsLeft = 3 - recentAttempts.length;
      return res.status(401).json({
        success: false,
        message: 'Wrong password. ' + attemptsLeft + ' attempt(s) remaining.'
      });
    }

    settings.markModified('correctionAttempts');
    await settings.save();
    return res.json({ success: true, message: 'Password verified' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
