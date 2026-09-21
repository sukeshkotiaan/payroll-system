const mongoose = require('mongoose');

const schoolInfoSchema = new mongoose.Schema({
  schoolType: { type: String, enum: ['xaviers', 'global'], required: true, unique: true },
  schoolName: { type: String, default: '' },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  affiliation: { type: String, default: '' },
  logo: { type: String, default: '' }, // Base64 string
  bankAccountNumber: { type: String, default: '' }, // School's own bank account (NEFT sender)
  bankServiceOutlet: { type: Number, default: 430 }, // Bank branch/outlet code
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SchoolInfo', schoolInfoSchema);
