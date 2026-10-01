/**
 * EPFO wage ceiling update — effective 17 September 2026
 * Central EPFO change: ceiling raised from ₹15,000 to ₹25,000
 * PF cap (12% × ₹25,000) = ₹3,000 (was ₹1,800)
 *
 * This script:
 *   1. Updates pfCap from 1800 → 3000 in Settings for all locations
 *   2. Marks 3 newly eligible employees as pfApplicable: true
 */

require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Settings = require('../models/Settings');
  const Employee = require('../models/Employee');

  // ── 1. Update pfCap in Settings ──────────────────────────────────────────
  const s = await Settings.findOne();
  if (!s) { console.error('No settings found'); return mongoose.disconnect(); }

  for (const ls of s.locationSettings) {
    if (ls.currentRules) {
      const prev = ls.currentRules.pfCap;
      ls.currentRules.pfCap = 3000;
      ls.currentRules.changeNote =
        'EPFO wage ceiling raised to ₹25,000 w.e.f. 17 Sep 2026 — pfCap updated from ₹' + prev + ' to ₹3000';
      ls.currentRules.savedAt = new Date();
      console.log('Settings [' + ls.location + ']: pfCap ₹' + prev + ' → ₹3000');
    }
  }
  s.updatedAt = new Date();
  s.markModified('locationSettings');
  await s.save();
  console.log('Settings saved.\n');

  // ── 2. Enroll newly eligible employees ───────────────────────────────────
  // Employees with basic salary between ₹15,001–₹25,000 who were not in PF
  // (basic ≈ 76.923% of monthlySalary)
  const newlyEligible = [
    { ein: 'STN-1044', note: 'Salary ₹25,000 | basic ₹19,231 — above old ceiling, under new' },
    { ein: 'STT-1082', note: 'Salary ₹29,750 | basic ₹22,885 — above old ceiling, under new' },
    { ein: 'GTN-1019', note: 'Salary ₹15,000 | basic ₹11,538 — was below old ceiling; enroll now' },
  ];

  for (const { ein, note } of newlyEligible) {
    const emp = await Employee.findOne({ ein });
    if (!emp) { console.log('NOT FOUND:', ein); continue; }
    if (emp.pfApplicable) { console.log('ALREADY enrolled:', ein, emp.employeeName); continue; }
    emp.pfApplicable = true;
    await emp.save();
    console.log('PF enrolled:', ein, emp.employeeName, '|', note);
  }

  // ── 3. Summary of impact ──────────────────────────────────────────────────
  const affected = await Employee.countDocuments({
    isActive: true,
    isManagement: { $ne: true },
    pfApplicable: true,
    $expr: {
      $and: [
        { $gt: [{ $multiply: ['$monthlySalary', 0.76923] }, 15000] },
        { $lte: [{ $multiply: ['$monthlySalary', 0.76923] }, 25000] }
      ]
    }
  });
  console.log('\n─────────────────────────────────────────────');
  console.log('PF deduction increase for', affected, 'employees');
  console.log('(basic between ₹15,001–₹25,000 — capped at actual 12%, max ₹3,000)');
  console.log('─────────────────────────────────────────────');
  console.log('Done.');

  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
