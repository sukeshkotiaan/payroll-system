const express = require('express');
const router = express.Router();
const Loan = require('../models/Loan');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin, notSupervisor } = require('../middleware/auth');
const { mgtFilter, sanitizeRegex, safeError } = require('../middleware/security');

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

// GET all loans — management employees hidden from accountants
router.get('/', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    let filter = { ...mgtFilter(role) };
    if (req.query.ein) filter.ein = req.query.ein;
    if (req.query.location) filter.location = req.query.location;
    if (req.query.status) filter.status = req.query.status;
    const loans = await Loan.find(filter).select('-schedule').sort({ createdAt: -1 });
    return res.json({ success: true, loans });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'loans list') });
  }
});

// GET single loan with schedule
router.get('/:id', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Not found' });
    // Block accountants from seeing management loans
    if (loan.ein && /^MGT-/i.test(loan.ein) && role !== 'admin' && role !== 'management') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return res.json({ success: true, loan });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'loans get') });
  }
});

// GET employee by EIN or Name — management blocked for non-admin
router.get('/find-employee/:search', isLoggedIn, notSupervisor, async (req, res) => {
  try {
    const role = req.session.user.role;
    const search = req.params.search.trim();
    if (/^MGT-/i.test(search) && role !== 'admin' && role !== 'management') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const safe = sanitizeRegex(search);
    let employee = await Employee.findOne({ ein: search.toUpperCase(), isActive: true, ...mgtFilter(role) });
    if (!employee) {
      employee = await Employee.findOne({ employeeName: { $regex: safe, $options: 'i' }, isActive: true, ...mgtFilter(role) });
    }
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    return res.json({ success: true, employee });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'loans find-employee') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans calculate-emi') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans for-payroll') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans create') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans pay-emi') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans pre-close') });
  }
});

// SKIP EMI for a month
router.patch('/:id/skip-emi', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year, skipType } = req.body; // skipType: 'add_to_next' | 'extend_tenure'
    if (!month || !year || !skipType) {
      return res.status(400).json({ success: false, message: 'month, year and skipType are required' });
    }
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    const idx = loan.schedule.findIndex(s =>
      s.month === month && s.year === parseInt(year) && s.status === 'Pending'
    );
    if (idx === -1) {
      return res.status(400).json({ success: false, message: 'No pending EMI found for ' + month + ' ' + year });
    }

    const skippedItem = loan.schedule[idx];
    const skippedEMI = skippedItem.emiAmount;
    skippedItem.status = 'Skipped';

    if (skipType === 'add_to_next') {
      // Find the next Pending entry after the skipped one
      const nextPending = loan.schedule.find((s, i) => i > idx && s.status === 'Pending');
      if (!nextPending) {
        return res.status(400).json({
          success: false,
          message: 'No next pending EMI exists to add to. Please use "Extend Tenure" instead.'
        });
      }
      nextPending.emiAmount = parseFloat((nextPending.emiAmount + skippedEMI).toFixed(2));
      nextPending.principal = parseFloat((nextPending.principal + skippedEMI).toFixed(2));

    } else if (skipType === 'extend_tenure') {
      // Add a new entry one month after the current last schedule entry
      const last = loan.schedule[loan.schedule.length - 1];
      let newMonthIdx = MONTHS.indexOf(last.month) + 1;
      let newYear = last.year;
      if (newMonthIdx > 11) { newMonthIdx = 0; newYear++; }
      loan.schedule.push({
        month: MONTHS[newMonthIdx],
        year: newYear,
        emiAmount: loan.emiAmount,
        principal: loan.emiAmount,
        interest: 0,
        balance: 0,
        status: 'Pending'
      });
      loan.endMonth = MONTHS[newMonthIdx];
      loan.endYear = newYear;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid skipType' });
    }

    loan.markModified('schedule');
    loan.updatedAt = new Date();
    await loan.save();
    return res.json({ success: true, message: 'EMI skipped successfully', loan });
  } catch (err) {
    return res.status(500).json({ success: false, message: safeError(err, 'loans skip-emi') });
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
    return res.status(500).json({ success: false, message: safeError(err, 'loans delete') });
  }
});

module.exports = router;
