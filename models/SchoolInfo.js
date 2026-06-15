const mongoose = require('mongoose');

const schoolInfoSchema = new mongoose.Schema({
  schoolType: { type: String, enum: ['xaviers', 'global'], required: true, unique: true },
  schoolName: { type: String, default: '' },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  affiliation: { type: String, default: '' },
  logo: { type: String, default: '' }, // Base64 string
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SchoolInfo', schoolInfoSchema);
