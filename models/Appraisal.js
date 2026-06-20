const mongoose = require('mongoose');

const appraisalSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  location: { type: String, default: '' },
  section: { type: String, default: '' },
  profile: { type: String, default: '' },
  financialYear: { type: String, required: true },
  monthlySalary: { type: Number, required: true, default: 0 },
  ctcAnnual: { type: Number, required: true, default: 0 },
  remarks: { type: String, default: '' },
  addedBy: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// One appraisal record per employee per financial year
appraisalSchema.index({ ein: 1, financialYear: 1 }, { unique: true });

module.exports = mongoose.model('Appraisal', appraisalSchema);
