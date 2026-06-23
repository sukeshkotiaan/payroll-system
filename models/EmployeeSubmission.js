const mongoose = require('mongoose');

const qualificationSchema = new mongoose.Schema({
  degree: { type: String, default: '' },
  institution: { type: String, default: '' },
  yearOfPassing: { type: String, default: '' },
  grade: { type: String, default: '' }
}, { _id: false });

const employeeSubmissionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: { type: String, required: true },
  section: { type: String, required: true },
  profile: { type: String, required: true },
  department: { type: String, required: true },
  employeeName: { type: String, required: true, trim: true },
  gender: { type: String, required: true },
  designation: { type: String, required: true, trim: true },
  dateOfBirth: { type: Date, required: true },
  dateOfJoining: { type: Date, required: true },
  panNumber: { type: String, required: true, trim: true, uppercase: true },
  aadhaarNumber: { type: String, required: true, trim: true },
  phoneNumber: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  address: { type: String, required: true, trim: true },
  uanNumber: { type: String, default: '' },
  qualifications: { type: [qualificationSchema], default: [] },
  submittedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending', 'Imported'], default: 'Pending' }
});

module.exports = mongoose.model('EmployeeSubmission', employeeSubmissionSchema);
