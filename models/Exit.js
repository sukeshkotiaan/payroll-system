const mongoose = require('mongoose');

const exitSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true },
  designation: { type: String, default: '' },
  department: { type: String, default: '' },
  location: { type: String, default: '' },
  resignationDate: { type: Date, required: true },
  lastWorkingDate: { type: Date, required: true },
  reasonForLeaving: { type: String, required: true },
  reasonDetails: { type: String, default: '' },
  noticePeriod: { type: String, enum: ['Serving', 'Not Serving'], default: 'Serving' },
  noticePeriodDays: { type: Number, default: 0 },
  fnfSettlement: { type: String, enum: ['Yes', 'No', 'Pending'], default: 'Pending' },
  relievingLetter: { type: String, enum: ['Yes', 'No', 'Pending'], default: 'Pending' },
  eligibleForRehire: { type: String, enum: ['Yes', 'No'], default: 'Yes' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  submittedBy: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: '' },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  remarks: { type: String, default: '' }
});

module.exports = mongoose.model('Exit', exitSchema);
