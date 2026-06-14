const mongoose = require('mongoose');

const dayRecordSchema = new mongoose.Schema({
  day: { type: Number, required: true },
  status: {
    type: String,
    enum: ['P', 'A', 'CL', 'SL', 'PL', 'SpL', 'H', 'WO', 'HD', 'OT', ''],
    default: ''
  },
  otHours: { type: Number, default: 0 }
}, { _id: false });

const attendanceRecordSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  designation: { type: String, default: '' },
  daysInMonth: { type: Number, default: 30 },
  days: { type: [dayRecordSchema], default: [] },
  presentDays: { type: Number, default: 0 },
  cl: { type: Number, default: 0 },
  sl: { type: Number, default: 0 },
  pl: { type: Number, default: 0 },
  spL: { type: Number, default: 0 },
  absent: { type: Number, default: 0 },
  halfDays: { type: Number, default: 0 },
  weekOff: { type: Number, default: 0 },
  holidays: { type: Number, default: 0 },
  otHours: { type: Number, default: 0 },
  lopDays: { type: Number, default: 0 },
  payableDays: { type: Number, default: 0 },
  remarks: { type: String, default: '' }
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  month: { type: String, required: true },
  year: { type: Number, required: true },
  location: { type: String, required: true },
  section: { type: String, required: true },
  profile: { type: String, required: true },
  groupName: { type: String, default: '' },
  supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: {
    type: String,
    enum: ['Draft', 'Pending', 'Approved', 'Rejected'],
    default: 'Draft'
  },
  records: { type: [attendanceRecordSchema], default: [] },
  uploadedBy: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Attendance', attendanceSchema);
