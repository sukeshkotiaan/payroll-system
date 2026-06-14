const mongoose = require('mongoose');

const arrearSchema = new mongoose.Schema({
  ein: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, default: '' },
  location: { type: String, default: '' },
  section: { type: String, default: '' },
  profile: { type: String, default: '' },
  month: { type: String, required: true },
  year: { type: Number, required: true },
  type: {
    type: String,
    enum: ['Arrear', 'Advance', 'Loan Deduction', 'Leave Encashment', 'Bonus', 'Other'],
    required: true
  },
  amount: { type: Number, required: true },
  remarks: { type: String, default: '' },
  addedBy: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now },
  pulledToPayroll: { type: Boolean, default: false },
  payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll', default: null }
});

module.exports = mongoose.model('Arrear', arrearSchema);
