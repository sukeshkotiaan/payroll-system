const mongoose = require('mongoose');

const photoUploadTokenSchema = new mongoose.Schema({
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  token:        { type: String, required: true, unique: true },
  expiresAt:    { type: Date, required: true },
  createdBy:    { type: String, default: '' }, // username of supervisor/admin who sent it
  createdById:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  usedAt:       { type: Date, default: null },
  createdAt:    { type: Date, default: Date.now }
});

photoUploadTokenSchema.index({ token: 1 });
photoUploadTokenSchema.index({ employeeId: 1 });
photoUploadTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PhotoUploadToken', photoUploadTokenSchema);
