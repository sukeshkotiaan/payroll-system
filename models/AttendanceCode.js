const mongoose = require('mongoose');

const attendanceCodeSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  code:      { type: String, required: true, unique: true, maxlength: 5 },
  bgColor:   { type: String, default: '#f0f2f5' },
  textColor: { type: String, default: '#333333' },
  // how this code affects payroll:
  // present = counts as full present day
  // absent  = counts as LOP (loss of pay)
  // half    = counts as 0.5 present days
  // off     = no deduction, no present (week off / holiday)
  logic:    { type: String, enum: ['present','absent','half','off'], default: 'present' },
  isSystem: { type: Boolean, default: false },  // system codes cannot be deleted
  isActive: { type: Boolean, default: true },
  order:    { type: Number, default: 99 }
});

module.exports = mongoose.model('AttendanceCode', attendanceCodeSchema);
