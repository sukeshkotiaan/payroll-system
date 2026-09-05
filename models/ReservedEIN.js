const mongoose = require('mongoose');

const reservedEINSchema = new mongoose.Schema({
  ein: { type: String, required: true, unique: true, uppercase: true, trim: true },
  status: { type: String, enum: ['available', 'assigned'], default: 'available' },
  assignedTo:         { type: String, default: '' },           // employee name
  assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  assignedAt:         { type: Date, default: null },
  createdBy:          { type: String, default: '' },
  createdAt:          { type: Date, default: Date.now }
});

reservedEINSchema.index({ status: 1 });

module.exports = mongoose.model('ReservedEIN', reservedEINSchema);
