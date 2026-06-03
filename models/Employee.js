const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  ein: {
    type: String,
    unique: true,
    sparse: true
  },
  location: {
    type: String,
    enum: ['Thane', 'Panvel'],
    required: true
  },
  section: {
    type: String,
    enum: ['Global', 'State'],
    required: true
  },
  profile: {
    type: String,
    enum: ['Teaching', 'Non-Teaching'],
    required: true
  },
  employeeName: {
    type: String,
    required: true,
    trim: true
  },
  designation: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  dateOfJoining: {
    type: Date,
    required: true
  },
  dateOfExit: {
    type: Date,
    default: null
  },
  panNumber: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  },
  aadhaarNumber: {
    type: String,
    trim: true,
    default: ''
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  photo: {
    type: String,
    default: ''
  },
  uanNumber: {
    type: String,
    trim: true,
    default: ''
  },

  // Salary
  ctcAnnual: {
    type: Number,
    required: true
  },
  ctcMonthly: {
    type: Number
  },
  basic: {
    type: Number
  },
  hraAllowance: {
    type: Number
  },
  pf: {
    type: Number
  },
  pt: {
    type: Number
  },

  // Flags
  pfApplicable: {
    type: Boolean,
    default: true
  },
  esicApplicable: {
    type: Boolean,
    default: false
  },
  ptApplicable: {
    type: Boolean,
    default: true
  },
  isRestricted: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  remarks: {
    type: String,
    default: ''
  },
  createdBy: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Auto update updatedAt
employeeSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Employee', employeeSchema);