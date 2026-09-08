const mongoose = require('mongoose');

const extraPaySchema = new mongoose.Schema({
  ein:          { type: String, required: true, uppercase: true },
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, required: true },
  location:     { type: String, required: true },
  section:      { type: String, required: true },
  profile:      { type: String, required: true },
  month:        { type: String, required: true },   // e.g. 'August'
  year:         { type: Number, required: true },
  amount:       { type: Number, required: true },
  reason:       { type: String, required: true },   // Extra Classes / Special Duty / Event / Other
  reasonDetail: { type: String, default: '' },      // free-text elaboration
  paymentDate:  { type: Date },
  paymentMode:  { type: String, default: 'Bank Transfer' }, // Bank Transfer / Cash / Cheque
  remarks:      { type: String, default: '' },
  addedBy:      { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('ExtraPay', extraPaySchema);
