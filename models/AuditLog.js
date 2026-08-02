const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: { type: String, default: '' },
  action: { type: String, required: true },
  details: { type: String, default: '' },
  ip: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
});

// Auto-delete logs older than 90 days
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
// Index for fast queries
auditLogSchema.index({ username: 1, timestamp: -1 });
auditLogSchema.index({ role: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
