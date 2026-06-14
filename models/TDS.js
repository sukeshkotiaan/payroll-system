const mongoose = require('mongoose');

const tdsSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  location: { type: String, default: '' },
  section: { type: String, default: '' },
  profile: { type: String, default: '' },
  month: { type: String, required: true },
  year: { type: Number, required: true },
  amount: { type: Number, required: true, default: 0 },
  remarks: { type: String, default: '' },
  addedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// One TDS per employee per month
tdsSchema.index({ ein: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('TDS', tdsSchema);
