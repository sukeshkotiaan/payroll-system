const mongoose = require('mongoose');

const ptSlabSchema = new mongoose.Schema({
  gender: { type: String, enum: ['Male', 'Female'], default: 'Male' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 0 },
  amount: { type: Number, default: 0 }
}, { _id: false });

const ruleVersionSchema = new mongoose.Schema({
  effectiveMonth: { type: String, required: true },
  effectiveYear: { type: Number, required: true },
  basicPercent: { type: Number, default: 76.923 },
  hraPercent: { type: Number, default: 23.077 },
  lopBase: { type: String, default: 'total_salary' },
  lopDivisor: { type: String, default: 'actual_days_in_month' },
  pfRate: { type: Number, default: 12 },
  pfCap: { type: Number, default: 1800 },
  pfAgeExemption: { type: String, default: 'Yes' },
  pfAgeLimit: { type: Number, default: 58 },
  esicApplicable: { type: String, default: 'No' },
  esicEmployeeRate: { type: Number, default: 0.75 },
  esicEmployerRate: { type: Number, default: 3.25 },
  esicSalaryLimit: { type: Number, default: 21000 },
  ptApplicable: { type: String, default: 'Yes' },
  ptSlabs: { type: [ptSlabSchema], default: [] },
  februaryPT: { type: Number, default: 300 },
  otRate: { type: Number, default: 0 },
  tdsType: { type: String, default: 'manual' },
  tdsRate: { type: Number, default: 10 },
  einSeparator: { type: String, default: '-' },
  einStartNumber: { type: Number, default: 1001 },
  savedBy: { type: String, default: '' },
  savedAt: { type: Date, default: Date.now },
  changeNote: { type: String, default: '' }
});

const locationSettingsSchema = new mongoose.Schema({
  location: { type: String, required: true },
  currentRules: { type: ruleVersionSchema, default: null },
  ruleHistory: { type: [ruleVersionSchema], default: [] }
}, { _id: false });

const correctionAttemptSchema = new mongoose.Schema({
  userId: { type: String },
  username: { type: String },
  attemptedAt: { type: Date, default: Date.now },
  success: { type: Boolean, default: false }
}, { _id: false });

const userLockSchema = new mongoose.Schema({
  username: { type: String, required: true },
  lockedAt: { type: Date, default: Date.now },
  unlockAt: { type: Date },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  locationSettings: { type: [locationSettingsSchema], default: [] },
  correctionPasswordHash: { type: String, default: '' },
  correctionAttempts: { type: [correctionAttemptSchema], default: [] },
  userLocks: { type: [userLockSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', settingsSchema);
