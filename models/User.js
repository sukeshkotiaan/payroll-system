const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, enum: ['admin', 'management', 'accountant', 'supervisor'], required: true },
  managementLevel: { type: Number, enum: [1, 2, 3], default: null },
  mappedSupervisors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  accountantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  ein: { type: String, default: null },
  email: { type: String, default: '', trim: true, lowercase: true },
  branches: { type: [String], default: ['all'] },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: null }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
