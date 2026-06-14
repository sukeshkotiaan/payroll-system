const mongoose = require('mongoose');

const payrollRecordSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  designation: { type: String, default: '' },
  gender: { type: String, default: '' },
  department: { type: String, default: '' },
  monthlySalary: { type: Number, default: 0 },
  daysInMonth: { type: Number, default: 30 },
  presentDays: { type: Number, default: 0 },
  lopDays: { type: Number, default: 0 },
  payableDays: { type: Number, default: 0 },
  lopDeduction: { type: Number, default: 0 },
  grossSalary: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  hra: { type: Number, default: 0 },
  pfApplicable: { type: Boolean, default: false },
  pfDeduction: { type: Number, default: 0 },
  esicApplicable: { type: Boolean, default: false },
  esicDeduction: { type: Number, default: 0 },
  ptApplicable: { type: Boolean, default: false },
  ptDeduction: { type: Number, default: 0 },
  tdsType: { type: String, enum: ['manual', 'percent', 'none'], default: 'none' },
  tdsPercent: { type: Number, default: 0 },
  tdsDeduction: { type: Number, default: 0 },
  arrear: { type: Number, default: 0 },
  advance: { type: Number, default: 0 },
  otHours: { type: Number, default: 0 },
  otAmount: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  netSalary: { type: Number, default: 0 },
  remarks: { type: String, default: '' }
}, { _id: false });

const payrollSchema = new mongoose.Schema({
  month: { type: String, required: true },
  year: { type: Number, required: true },
  location: { type: String, required: true },
  section: { type: String, required: true },
  profile: { type: String, required: true },
  groupName: { type: String, default: '' },
  attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
  status: {
    type: String,
    enum: ['Draft', 'Pending Approval', 'Approved', 'Locked'],
    default: 'Draft'
  },
  records: { type: [payrollRecordSchema], default: [] },
  totalGross: { type: Number, default: 0 },
  totalPF: { type: Number, default: 0 },
  totalPT: { type: Number, default: 0 },
  totalESIC: { type: Number, default: 0 },
  totalTDS: { type: Number, default: 0 },
  totalNet: { type: Number, default: 0 },
  processedBy: { type: String, default: '' },
  processedAt: { type: Date, default: null },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  remarks: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payroll', payrollSchema);
