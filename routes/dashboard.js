const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Loan = require('../models/Loan');
const { isLoggedIn } = require('../middleware/auth');

router.get('/stats', isLoggedIn, async (req, res) => {
  try {
    const now = new Date();
    const month = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'][now.getMonth()];
    const year = now.getFullYear();

    // Total active employees
    const totalEmployees = await Employee.countDocuments({ isActive: true });

    // This month payroll total
    const payrolls = await Payroll.find({ month, year });
    const monthlyTotal = payrolls.reduce((s, p) => s + (p.totalNet || 0), 0);
    const payrollGroups = payrolls.length;

    // Pending attendance approvals
    const pendingAttendance = await Attendance.countDocuments({ status: 'Pending' });

    // Active loans
    const activeLoans = await Loan.countDocuments({ status: 'Active' });

    // Payroll status this month
    const processedGroups = payrolls.filter(p => p.status !== 'Draft').length;

    return res.json({
      success: true,
      stats: {
        totalEmployees,
        monthlyTotal,
        payrollGroups,
        processedGroups,
        pendingAttendance,
        activeLoans,
        month,
        year
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
