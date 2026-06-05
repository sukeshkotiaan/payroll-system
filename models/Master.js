const mongoose = require('mongoose');

const masterSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['location', 'section', 'profile', 'department', 'designation', 'role', 'export-permission'],
    required: true
  },
  value: {
    type: String,
    required: true,
    trim: true
  },
  permissions: {
    type: [String],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Master', masterSchema);
