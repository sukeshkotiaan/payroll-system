const express = require('express');
const router = express.Router();
const Loan = require('../models/Loan');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function generateSchedule(loanAmount, interestRate, tenure, startMonth, startYear, emiAmount) {
  const schedule = [];
  let balance = loanAmount;
  let monthIdx = MONTHS.indexOf(startMonth);
  let year = parseInt(startYear);

  for (let i = 0; i < tenure; i++) {
    const interest = parseFloat((balance * (interestRate / 100) / 12).toFixed(2));
    const principal = parseFloat((emiAmount - interest).toFixed(2));
    balance = parseFloat((balance - principal).toFixed(2));
    if (i === tenure - 1) balance = 0;

    schedule.push({
      month: MONTHS[monthIdx],
      year,
      emiAmount,
      principal,
      interest,
      balance: Math.max(0, balance),
      status: 'Pending'
    });

    monthIdx++;
    if (monthIdx > 11) { monthIdx = 0; year++; }
  }
  return schedule;
}

function calculateEMI(principal, rate, tenure) {
  if (rate === 0) return parseFloat((principal / tenure).toFixed(2));
  const monthlyRate = rate / 100 / 12;
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenure) /
    (Math.pow(1 + monthlyRate, tenure) - 1);
  return parseFloat(emi.toFixed(2));
}

// GET all loans
router.get('/', isLoggedIn, async (req, res) => {
  try {
    let filter = {};
    if (req.query.ein) filter.ein = req.query.ein;
    if (req.query.location) filter.location = req.query.location;
    if (req.query.status) filter.status = req.query.status;
    const loans = await Loan.find(filter).select('-schedule').sort({ createdAt: -1 });
    return res.json({ success: true, loans });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET single loan with schedule
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, loan });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET employee by EIN or Name
router.get('/find-employee/:search', isLoggedIn, async (req, res) => {
  try {
    const search = req.params.search.trim();
    let employee = await Employee.findOne({ ein: search.toUpperCase(), isActive: true });
    if (!employee) {
      employee = await Employee.findOne({
        employeeName: { $regex: search, $options: 'i' }, isActive: true
      });
    }
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// CALCULATE EMI (preview)
router.post('/calculate-emi', isLoggedIn, async (req, res) => {
  try {
    const { loanAmount, interestRate, tenure } = req.body;
    const emi = calculateEMI(parseFloat(loanAmount), parseFloat(interestRate), parseInt(tenure));
    const totalPayable = parseFloat((emi * tenure).toFixed(2));
    const totalInterest = parseFloat((totalPayable - loanAmount).toFixed(2));
    return res.json({ success: true, emi, totalPayable, totalInterest });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET active loans for payroll
router.get('/for-payroll/active', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year } = req.query;
    const loans = await Loan.find({ location, section, profile, status: 'Active' });
    const result = loans.map(loan => {
      const scheduleItem = loan.schedule.find(s =>
        s.month === month && s.year === parseInt(year) && s.status === 'Pending'
      );
      if (!scheduleItem) return null;
      return {
        loanId: loan._id,
        ein: loan.ein,
        employeeName: loan.employeeName,
        loanType: loan.loanType,
        emiAmount: scheduleItem.emiAmount,
        balance: scheduleItem.balance
      };
    }).filter(Boolean);
    return res.json({ success: true, loans: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// CREATE loan
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein, loanType, loanAmount, interestRate, tenure, startMonth, startYear, remarks } = req.body;
    if (!ein || !loanType || !loanAmount || !tenure || !startMonth || !startYear) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase() });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const rate = parseFloat(interestRate) || 0;
    const emi = calculateEMI(parseFloat(loanAmount), rate, parseInt(tenure));
    const schedule = generateSchedule(parseFloat(loanAmount), rate, parseInt(tenure), startMonth, parseInt(startYear), emi);

    const lastSchedule = schedule[schedule.length - 1];
    const endIdx = MONTHS.indexOf(lastSchedule.month);
    const monthNames = MONTHS;

    const loan = await Loan.create({
      ein: ein.toUpperCase(),
      employeeId: employee._id,
      employeeName: employee.employeeName,
      location: employee.location,
      section: employee.section,
      profile: employee.profile,
      loanType, loanAmount: parseFloat(loanAmount),
      interestRate: rate, tenure: parseInt(tenure),
      emiAmount: emi,
      startMonth, startYear: parseInt(startYear),
      endMonth: lastSchedule.month,
      endYear: lastSchedule.year,
      outstandingBalance: parseFloat(loanAmount),
      totalPaid: 0,
      status: 'Active',
      schedule,
      remarks: remarks || '',
      addedBy: req.session.user.username
    });
    return res.json({ success: true, message: 'Loan created successfully', loan });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// MARK EMI as paid
router.patch('/:id/pay-emi', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year, payrollId } = req.body;
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Not found' });

    const scheduleItem = loan.schedule.find(s =>
      s.month === month && s.year === parseInt(year) && s.status === 'Pending'
    );
    if (!scheduleItem) {
      return res.status(400).json({ success: false, message: 'No pending EMI for this month' });
    }

    scheduleItem.status = 'Paid';
    scheduleItem.paidInPayrollId = payrollId || null;
    loan.totalPaid = parseFloat((loan.totalPaid + scheduleItem.emiAmount).toFixed(2));
    loan.outstandingBalance = scheduleItem.balance;

    if (scheduleItem.balance === 0) loan.status = 'Closed';
    loan.updatedAt = new Date();
    loan.markModified('schedule');
    await loan.save();
    return res.json({ success: true, message: 'EMI marked as paid', loan });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PRE-CLOSE loan
router.patch('/:id/pre-close', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Not found' });
    loan.status = 'Pre-Closed';
    loan.outstandingBalance = 0;
    loan.updatedAt = new Date();
    await loan.save();
    return res.json({ success: true, message: 'Loan pre-closed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE loan
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Not found' });
    if (loan.status === 'Active' && loan.totalPaid > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete active loan with payments' });
    }
    await Loan.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
