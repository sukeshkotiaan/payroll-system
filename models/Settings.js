const mongoose = require('mongoose');

const ptSlabSchema = new mongoose.Schema({
  min: { type: Number, default: 0 },
  max: { type: Number, default: 0 },
  amount: { type: Number, default: 0 }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  // Salary Split
  basicPercent: { type: Number, default: 76.923 },
  hraPercent: { type: Number, default: 23.077 },

  // PF
  pfRate: { type: Number, default: 12 },
  pfCap: { type: Number, default: 1800 },

  // ESIC
  esicRate: { type: Number, default: 0.75 },
  esicLimit: { type: Number, default: 21000 },

  // PT
  ptSlabs: { type: [ptSlabSchema], default: [
    { min: 0, max: 7500, amount: 0 },
    { min: 7501, max: 10000, amount: 175 },
    { min: 10001, max: 999999, amount: 200 }
  ]},
  februaryPT: { type: Number, default: 300 },

  // LOP
  lopBase: { type: String, default: 'total_salary' },
  lopDivisor: { type: String, default: 'actual_days_in_month' },

  // EIN Format
  einStartNumber: { type: Number, default: 1001 },
  einSeparator: { type: String, default: '-' },

  updatedAt: { type: Date, default: Date.now }
});

settingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Settings', settingsSchema);