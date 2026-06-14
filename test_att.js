require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Attendance = require('./models/Attendance');
  try {
    const result = await Attendance.create({
      month: 'June', year: 2026,
      location: 'Thane', section: 'State', profile: 'Teaching',
      groupName: 'Xaviers Thane Teaching',
      records: [{
        ein: 'STT-1001', employeeName: 'Test', daysInMonth: 30,
        days: [{ day: 1, status: 'P', otHours: 0 }],
        presentDays: 1, absent: 0, cl: 0, sl: 0, pl: 0, spL: 0,
        halfDays: 0, weekOff: 0, holidays: 0, otHours: 0, lopDays: 0, payableDays: 1
      }],
      uploadedBy: 'admin'
    });
    console.log('Created:', result._id);
    await Attendance.findByIdAndDelete(result._id);
    console.log('Test passed - deleted');
  } catch(e) {
    console.log('ERROR:', e.message);
  }
  process.exit(0);
});
