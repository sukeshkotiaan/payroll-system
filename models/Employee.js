const mongoose = require('mongoose');

const qualificationSchema = new mongoose.Schema({
  degree: { type: String, default: '' },
  institution: { type: String, default: '' },
  yearOfPassing: { type: String, default: '' },
  grade: { type: String, default: '' }
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  ein: { type: String, unique: true, sparse: true },
  location: { type: String, required: true },
  title: { type: String, default: '' },
  section: { type: String, required: true },
  profile: { type: String, required: true },
  department: { type: String, default: '' },
  employeeName: { type: String, required: true, trim: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
  designation: { type: String, required: true, trim: true },
  dateOfBirth: { type: Date, required: true },
  dateOfJoining: { type: Date, required: true },
  dateOfExit: { type: Date, default: null },
  panNumber: { type: String, trim: true, uppercase: true, default: '' },
  aadhaarNumber: { type: String, trim: true, default: '' },
  phoneNumber: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  address: { type: String, trim: true, default: '' },
  photo: { type: String, default: '' },
  uanNumber: { type: String, trim: true, default: '' },
  qualifications: { type: [qualificationSchema], default: [] },
  monthlySalary: { type: Number, default: 0 },
  ctcAnnual: { type: Number, required: true },
  ctcMonthly: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  hraAllowance: { type: Number, default: 0 },
  pf: { type: Number, default: 0 },
  pt: { type: Number, default: 0 },
  pfApplicable: { type: Boolean, default: false },
  esicApplicable: { type: Boolean, default: false },
  ptApplicable: { type: Boolean, default: false },
  isRestricted: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  remarks: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Employee', employeeSchema);
