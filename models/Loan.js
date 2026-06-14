const mongoose = require('mongoose');

const loanScheduleSchema = new mongoose.Schema({
  month: { type: String, required: true },
  year: { type: Number, required: true },
  emiAmount: { type: Number, default: 0 },
  principal: { type: Number, default: 0 },
  interest: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  status: { type: String, enum: ['Pending', 'Paid', 'Skipped'], default: 'Pending' },
  paidInPayrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll', default: null }
}, { _id: false });

const loanSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  location: { type: String, default: '' },
  section: { type: String, default: '' },
  profile: { type: String, default: '' },
  loanType: {
    type: String,
    enum: ['Salary Advance', 'Personal Loan', 'Festival Advance', 'Emergency Loan', 'Other'],
    required: true
  },
  loanAmount: { type: Number, required: true },
  interestRate: { type: Number, default: 0 },
  tenure: { type: Number, required: true },
  emiAmount: { type: Number, required: true },
  startMonth: { type: String, required: true },
  startYear: { type: Number, required: true },
  endMonth: { type: String, default: '' },
  endYear: { type: Number, default: null },
  outstandingBalance: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['Active', 'Closed', 'Pre-Closed'],
    default: 'Active'
  },
  schedule: { type: [loanScheduleSchema], default: [] },
  remarks: { type: String, default: '' },
  addedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Loan', loanSchema);
