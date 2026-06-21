const express = require('express');
const router = express.Router();
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Settings = require('../models/Settings');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const Arrear = require('../models/Arrear');
const TDS = require('../models/TDS');
const Loan = require('../models/Loan');
const Appraisal = require('../models/Appraisal');

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function getFYForMonth(month, year) {
  const monthIdx = MONTHS.indexOf(month);
  const y = parseInt(year);
  // FY runs June (index 5) to May - if month is June or later, FY starts this year
  const fyStart = monthIdx >= 5 ? y : y - 1;
  return fyStart + '-' + String(fyStart + 1).slice(2);
}

function getGroupName(section, location, profile) {
  if (section === 'State') return 'Xaviers ' + location;
  if (section === 'Global' && profile === 'Teaching') return 'Global Teaching';
  if (section === 'Global' && profile === 'Non-Teaching') return 'Global Non-Teaching';
  return section + ' ' + location + ' ' + profile;
}

function getPT(grossSalary, gender, month, rules) {
  if (!rules.ptApplicable || rules.ptApplicable === 'No') return 0;
  if (gender === 'Female') return 0;
  const slabs = rules.ptSlabs || [];
  const isFebruary = month === 'February';
  if (isFebruary && rules.februaryPT) return rules.februaryPT;
  for (const slab of slabs) {
    if (grossSalary >= slab.min && grossSalary <= slab.max) return slab.amount;
  }
  return 0;
}

function calculatePayroll(emp, attendance, rules, month) {
  const monthlySalary = emp.monthlySalary || 0;
  const daysInMonth = attendance.daysInMonth || 30;
  const lopDays = attendance.lopDays || 0;
  const presentDays = attendance.presentDays || 0;
  const payableDays = attendance.payableDays || 0;
  const otHours = attendance.otHours || 0;

  // LOP calculation
  const lopBase = rules.lopBase === 'basic_only' ?
    (monthlySalary * (rules.basicPercent || 76.923) / 100) : monthlySalary;
  const divisor = rules.lopDivisor === 'fixed_26' ? 26 :
    rules.lopDivisor === 'fixed_30' ? 30 : daysInMonth;
  const lopDeduction = parseFloat((lopBase / divisor * lopDays).toFixed(2));

  // Gross salary
  const grossSalary = parseFloat((monthlySalary - lopDeduction).toFixed(2));

  // Basic and HRA
  const basicPct = rules.basicPercent || 76.923;
  const hraPct = rules.hraPercent || 23.077;
  const basic = parseFloat((grossSalary * basicPct / 100).toFixed(2));
  const hra = parseFloat((grossSalary * hraPct / 100).toFixed(2));

  // PF
  let pfDeduction = 0;
  if (emp.pfApplicable) {
    const pfRate = rules.pfRate || 12;
    const pfCap = rules.pfCap || 1800;
    const pfAge = rules.pfAgeLimit || 58;
    const pfAgeExempt = rules.pfAgeExemption === 'Yes';
    let ageExempt = false;
    if (pfAgeExempt && emp.dateOfBirth) {
      const age = new Date().getFullYear() - new Date(emp.dateOfBirth).getFullYear();
      if (age >= pfAge) ageExempt = true;
    }
    if (!ageExempt) {
      pfDeduction = Math.min(parseFloat((basic * pfRate / 100).toFixed(2)), pfCap);
    }
  }

  // PT
  let ptDeduction = 0;
  if (emp.ptApplicable) {
    ptDeduction = getPT(grossSalary, emp.gender, month, rules);
  }

  // ESIC
  let esicDeduction = 0;
  if (emp.esicApplicable && rules.esicApplicable === 'Yes') {
    const esicLimit = rules.esicSalaryLimit || 21000;
    if (grossSalary <= esicLimit) {
      const esicRate = rules.esicEmployeeRate || 0.75;
      esicDeduction = parseFloat((grossSalary * esicRate / 100).toFixed(2));
    }
  }

  // OT amount (basic / 26 / 8 * OT hours * 2)
  const otAmount = otHours > 0 ?
    parseFloat((basic / 26 / 8 * otHours * 2).toFixed(2)) : 0;

  const totalDeductions = parseFloat(
    (pfDeduction + ptDeduction + esicDeduction).toFixed(2)
  );
  const netSalary = parseFloat(
    (grossSalary - totalDeductions + otAmount).toFixed(2)
  );

  return {
    monthlySalary, daysInMonth, presentDays, lopDays, payableDays,
    lopDeduction, grossSalary, basic, hra,
    pfDeduction, ptDeduction, esicDeduction,
    tdsDeduction: 0, tdsType: 'none', tdsPercent: 0,
    arrear: 0, advance: 0, otHours, otAmount,
    totalDeductions, netSalary
  };
}

// GET all payroll records
router.get('/', isLoggedIn, async (req, res) => {
  try {
    let filter = {};
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.status) filter.status = req.query.status;
    const records = await Payroll.find(filter)
      .select('-records')
      .sort({ year: -1, month: -1 });
    return res.json({ success: true, records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET single payroll
router.get('/:id', isLoggedIn, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, payroll });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PROCESS payroll
router.post('/process', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year, location, section, profile } = req.body;
    if (!month || !year || !location || !section || !profile) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    // Check attendance submitted
    const attendance = await Attendance.findOne({
      month, year: parseInt(year), location, section, profile,
      status: { $in: ['Submitted', 'Locked', 'Pending', 'Approved'] }
    });
    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: 'No submitted attendance found for this group and month'
      });
    }

    // Get calculation rules for location
    const settings = await Settings.findOne();
    const locationRules = settings ?
      settings.locationSettings.find(ls => ls.location === location) : null;
    const rules = locationRules ? locationRules.currentRules : {};

    // Get employees
    const employees = await Employee.find({
      location, section, profile, isActive: true
    });

    // Check if payroll already exists
    let payroll = await Payroll.findOne({
      month, year: parseInt(year), location, section, profile
    });

    if (payroll && payroll.status === 'Locked') {
      return res.status(400).json({
        success: false,
        message: 'Payroll is locked and cannot be reprocessed'
      });
    }

    // Fetch Appraisal records for current FY for this group
    const currentFY = getFYForMonth(month, year);
    const appraisals = await Appraisal.find({
      location, section, profile, financialYear: currentFY
    });
    const appraisalMap = {};
    appraisals.forEach(a => { appraisalMap[a.ein] = a; });

    // Check for employees missing a valid appraisal for current FY
    const missingAppraisal = [];
    for (const emp of employees) {
      const ap = appraisalMap[emp.ein];
      if (!ap || !ap.monthlySalary || ap.monthlySalary <= 0) {
        missingAppraisal.push({
          ein: emp.ein,
          employeeId: emp._id,
          employeeName: emp.employeeName,
          designation: emp.designation,
          currentSalary: emp.monthlySalary || 0
        });
      }
    }

    if (missingAppraisal.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot process payroll: ' + missingAppraisal.length + ' employee(s) missing appraisal for FY ' + currentFY,
        appraisalMissing: true,
        financialYear: currentFY,
        missingList: missingAppraisal
      });
    }

    // Calculate payroll for each employee
    const records = [];
    let totalGross = 0, totalPF = 0, totalPT = 0,
      totalESIC = 0, totalTDS = 0, totalNet = 0;

    for (const emp of employees) {
      const attRecord = attendance.records.find(r => r.ein === emp.ein);
      if (!attRecord) continue;

      // Use appraisal salary as the source of truth for current FY
      const ap = appraisalMap[emp.ein];
      const empForCalc = { ...emp.toObject(), monthlySalary: ap.monthlySalary };

      const calc = calculatePayroll(empForCalc, attRecord, rules, month);

      records.push({
        ein: emp.ein,
        employeeId: emp._id,
        employeeName: emp.employeeName,
        designation: emp.designation,
        gender: emp.gender || '',
        department: emp.department || '',
        pfApplicable: emp.pfApplicable,
        esicApplicable: emp.esicApplicable,
        ptApplicable: emp.ptApplicable,
        ...calc
      });

      totalGross += calc.grossSalary;
      totalPF += calc.pfDeduction;
      totalPT += calc.ptDeduction;
      totalESIC += calc.esicDeduction;
      totalTDS += calc.tdsDeduction;
      totalNet += calc.netSalary;
    }

    // Pull arrears for this group and month
    const arrears = await Arrear.find({
      location, section, profile,
      month, year: parseInt(year),
      pulledToPayroll: false
    });

    // Apply arrears to records
    for (const arrear of arrears) {
      const record = records.find(r => r.ein === arrear.ein);
      if (record) {
        const type = arrear.type;
        const amt = parseFloat(arrear.amount) || 0;
        if (type === 'Arrear' || type === 'Leave Encashment' || type === 'Bonus') {
          record.arrear = parseFloat((record.arrear + amt).toFixed(2));
        } else {
          record.advance = parseFloat((record.advance + amt).toFixed(2));
        }
        if (record.remarks) {
          record.remarks += ', ' + type + ': ' + amt;
        } else {
          record.remarks = type + ': ' + amt;
        }
      }
    }

    // Pull TDS for this group and month
    const tdsRecords = await TDS.find({
      location, section, profile,
      month, year: parseInt(year)
    });
    for (const tds of tdsRecords) {
      const record = records.find(r => r.ein === tds.ein);
      if (record) {
        record.tdsDeduction = parseFloat(tds.amount) || 0;
        record.tdsType = 'manual';
        if (record.remarks) {
          record.remarks += ', TDS: ' + tds.amount;
        } else {
          record.remarks = 'TDS: ' + tds.amount;
        }
      }
    }

    // Pull Loan EMIs for this group and month
    const activeLoans = await Loan.find({
      location, section, profile,
      status: 'Active'
    });
    const paidLoanIds = [];
    for (const loan of activeLoans) {
      const scheduleItem = loan.schedule ? loan.schedule.find(s =>
        s.month === month && s.year === parseInt(year) && s.status === 'Pending'
      ) : null;
      if (!scheduleItem) continue;
      const record = records.find(r => r.ein === loan.ein);
      if (record) {
        const emiAmt = parseFloat(scheduleItem.emiAmount) || 0;
        record.advance = parseFloat((record.advance + emiAmt).toFixed(2));
        if (record.remarks) {
          record.remarks += ', Loan EMI: ' + emiAmt;
        } else {
          record.remarks = 'Loan EMI: ' + emiAmt;
        }
        paidLoanIds.push({ loanId: loan._id, emiAmount: emiAmt });
      }
    }

    // Recalculate totals for all records
    for (const record of records) {
      record.totalDeductions = parseFloat(
        (record.pfDeduction + record.ptDeduction +
          record.esicDeduction + record.tdsDeduction + record.advance).toFixed(2)
      );
      record.netSalary = parseFloat(
        (record.grossSalary - record.totalDeductions +
          record.otAmount + record.arrear).toFixed(2)
      );
    }
    totalNet = records.reduce((s, r) => s + (r.netSalary || 0), 0);

    const groupName = getGroupName(section, location, profile);

    if (payroll) {
      payroll.records = records;
      payroll.attendanceId = attendance._id;
      payroll.totalGross = parseFloat(totalGross.toFixed(2));
      payroll.totalPF = parseFloat(totalPF.toFixed(2));
      payroll.totalPT = parseFloat(totalPT.toFixed(2));
      payroll.totalESIC = parseFloat(totalESIC.toFixed(2));
      payroll.totalTDS = parseFloat(records.reduce((s,r) => s+(r.tdsDeduction||0), 0).toFixed(2));
      payroll.totalNet = parseFloat(totalNet.toFixed(2));
      payroll.status = 'Draft';
      payroll.processedBy = req.session.user.username;
      payroll.processedAt = new Date();
      payroll.updatedAt = new Date();
      payroll.markModified('records');
      await payroll.save();
    } else {
      payroll = await Payroll.create({
        month, year: parseInt(year), location, section, profile,
        groupName, attendanceId: attendance._id,
        records, status: 'Draft',
        totalGross: parseFloat(totalGross.toFixed(2)),
        totalPF: parseFloat(totalPF.toFixed(2)),
        totalPT: parseFloat(totalPT.toFixed(2)),
        totalESIC: parseFloat(totalESIC.toFixed(2)),
        totalTDS: parseFloat(records.reduce((s,r) => s+(r.tdsDeduction||0), 0).toFixed(2)),
        totalNet: parseFloat(totalNet.toFixed(2)),
        processedBy: req.session.user.username,
        processedAt: new Date()
      });
    }

    // Mark arrears as pulled
    await Arrear.updateMany(
      { location, section, profile, month, year: parseInt(year), pulledToPayroll: false },
      { pulledToPayroll: true, payrollId: payroll._id }
    );

    // Mark loan EMIs as paid
    for (const loan of activeLoans) {
      const scheduleItem = loan.schedule ? loan.schedule.find(s =>
        s.month === month && s.year === parseInt(year) && s.status === 'Pending'
      ) : null;
      if (!scheduleItem) continue;
      const record = records.find(r => r.ein === loan.ein);
      if (!record) continue;
      scheduleItem.status = 'Paid';
      scheduleItem.paidInPayrollId = payroll._id;
      loan.totalPaid = parseFloat((loan.totalPaid + scheduleItem.emiAmount).toFixed(2));
      loan.outstandingBalance = scheduleItem.balance;
      if (scheduleItem.balance === 0) loan.status = 'Closed';
      loan.updatedAt = new Date();
      loan.markModified('schedule');
      await loan.save();
    }

    return res.json({
      success: true,
      message: 'Payroll processed for ' + records.length + ' employees',
      payroll
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE single employee payroll (TDS, arrear, advance, remarks)
router.patch('/:id/record', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein, tdsType, tdsPercent, tdsDeduction, arrear, advance, remarks } = req.body;
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    if (payroll.status === 'Locked') {
      return res.status(400).json({ success: false, message: 'Payroll is locked' });
    }
    const record = payroll.records.find(r => r.ein === ein);
    if (record) {
      record.tdsType = tdsType || record.tdsType;
      record.tdsPercent = parseFloat(tdsPercent) || 0;
      if (tdsType === 'percent') {
        record.tdsDeduction = parseFloat(
          (record.grossSalary * record.tdsPercent / 100).toFixed(2)
        );
      } else {
        record.tdsDeduction = parseFloat(tdsDeduction) || 0;
      }
      record.arrear = parseFloat(arrear) || 0;
      record.advance = parseFloat(advance) || 0;
      record.remarks = remarks || '';
      record.totalDeductions = parseFloat(
        (record.pfDeduction + record.ptDeduction +
          record.esicDeduction + record.tdsDeduction + record.advance).toFixed(2)
      );
      record.netSalary = parseFloat(
        (record.grossSalary - record.totalDeductions +
          record.otAmount + record.arrear).toFixed(2)
      );
    }

    // Recalculate totals
    payroll.totalTDS = parseFloat(
      payroll.records.reduce((s, r) => s + (r.tdsDeduction || 0), 0).toFixed(2)
    );
    payroll.totalNet = parseFloat(
      payroll.records.reduce((s, r) => s + (r.netSalary || 0), 0).toFixed(2)
    );
    payroll.updatedAt = new Date();
    payroll.markModified('records');
    await payroll.save();
    return res.json({ success: true, message: 'Updated', record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SUBMIT for approval
router.patch('/:id/submit', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    payroll.status = 'Pending Approval';
    payroll.updatedAt = new Date();
    await payroll.save();
    return res.json({ success: true, message: 'Payroll submitted for approval' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// APPROVE payroll
router.patch('/:id/approve', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    payroll.status = 'Approved';
    payroll.approvedBy = req.session.user.username;
    payroll.approvedAt = new Date();
    payroll.updatedAt = new Date();
    await payroll.save();
    return res.json({ success: true, message: 'Payroll approved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// LOCK payroll
router.patch('/:id/lock', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    payroll.status = 'Locked';
    payroll.updatedAt = new Date();
    await payroll.save();
    return res.json({ success: true, message: 'Payroll locked' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE payroll (draft only)
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    if (payroll.status === 'Locked') {
      return res.status(400).json({ success: false, message: 'Cannot delete locked payroll' });
    }
    await Payroll.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


// BULK PROCESS all groups for a month
router.post('/process-all', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year } = req.body;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year required' });
    }

    const attendances = await Attendance.find({
      month, year: parseInt(year),
      status: { $in: ['Submitted', 'Locked', 'Pending', 'Approved'] }
    });

    if (attendances.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No submitted attendance found for ' + month + ' ' + year
      });
    }

    const results = [];
    const settings = await Settings.findOne();

    for (const attendance of attendances) {
      try {
        const { location, section, profile } = attendance;
        const locationRules = settings ?
          settings.locationSettings.find(ls => ls.location === location) : null;
        const rules = locationRules ? locationRules.currentRules : {};

        const employees = await Employee.find({
          location, section, profile, isActive: true
        });

        let existingPayroll = await Payroll.findOne({
          month, year: parseInt(year), location, section, profile
        });

        if (existingPayroll && existingPayroll.status === 'Locked') {
          results.push({ group: getGroupName(section, location, profile), status: 'Skipped - Locked' });
          continue;
        }

        // Fetch Appraisal records for current FY for this group
        const groupFY = getFYForMonth(month, year);
        const groupAppraisals = await Appraisal.find({
          location, section, profile, financialYear: groupFY
        });
        const groupAppraisalMap = {};
        groupAppraisals.forEach(a => { groupAppraisalMap[a.ein] = a; });

        const groupMissing = employees.filter(emp => {
          const ap = groupAppraisalMap[emp.ein];
          return !ap || !ap.monthlySalary || ap.monthlySalary <= 0;
        });

        if (groupMissing.length > 0) {
          results.push({
            group: getGroupName(section, location, profile),
            status: 'Skipped - ' + groupMissing.length + ' employee(s) missing appraisal for FY ' + groupFY,
            missingList: groupMissing.map(e => ({ ein: e.ein, employeeName: e.employeeName }))
          });
          continue;
        }

        const records = [];
        let totalGross = 0, totalPF = 0, totalPT = 0,
          totalESIC = 0, totalTDS = 0, totalNet = 0;

        for (const emp of employees) {
          const attRecord = attendance.records.find(r => r.ein === emp.ein);
          if (!attRecord) continue;
          const ap = groupAppraisalMap[emp.ein];
          const empForCalc = { ...emp.toObject(), monthlySalary: ap.monthlySalary };
          const calc = calculatePayroll(empForCalc, attRecord, rules, month);
          records.push({
            ein: emp.ein, employeeId: emp._id,
            employeeName: emp.employeeName, designation: emp.designation,
            gender: emp.gender || '', department: emp.department || '',
            pfApplicable: emp.pfApplicable, esicApplicable: emp.esicApplicable,
            ptApplicable: emp.ptApplicable, ...calc
          });
          totalGross += calc.grossSalary;
          totalPF += calc.pfDeduction;
          totalPT += calc.ptDeduction;
          totalESIC += calc.esicDeduction;
          totalTDS += calc.tdsDeduction;
          totalNet += calc.netSalary;
        }

        // Pull arrears
        const arrears = await Arrear.find({
          location, section, profile,
          month, year: parseInt(year), pulledToPayroll: false
        });
        for (const arrear of arrears) {
          const record = records.find(r => r.ein === arrear.ein);
          if (record) {
            const amt = parseFloat(arrear.amount) || 0;
            const type = arrear.type;
            if (type === 'Arrear' || type === 'Leave Encashment' || type === 'Bonus') {
              record.arrear = parseFloat((record.arrear + amt).toFixed(2));
            } else {
              record.advance = parseFloat((record.advance + amt).toFixed(2));
            }
            record.remarks = record.remarks ?
              record.remarks + ', ' + type + ': ' + amt : type + ': ' + amt;
          }
        }

        // Pull TDS
        const tdsRecs = await TDS.find({ location, section, profile, month, year: parseInt(year) });
        for (const tds of tdsRecs) {
          const record = records.find(r => r.ein === tds.ein);
          if (record) {
            record.tdsDeduction = parseFloat(tds.amount) || 0;
            record.tdsType = 'manual';
            record.remarks = record.remarks ? record.remarks + ', TDS: ' + tds.amount : 'TDS: ' + tds.amount;
          }
        }

        // Pull Loan EMIs
        const loans = await Loan.find({ location, section, profile, status: 'Active' });
        for (const loan of loans) {
          const sItem = loan.schedule ? loan.schedule.find(s =>
            s.month === month && s.year === parseInt(year) && s.status === 'Pending'
          ) : null;
          if (!sItem) continue;
          const record = records.find(r => r.ein === loan.ein);
          if (record) {
            const emiAmt = parseFloat(sItem.emiAmount) || 0;
            record.advance = parseFloat((record.advance + emiAmt).toFixed(2));
            record.remarks = record.remarks ? record.remarks + ', Loan EMI: ' + emiAmt : 'Loan EMI: ' + emiAmt;
          }
        }

        // Recalculate totals
        for (const record of records) {
          record.totalDeductions = parseFloat(
            (record.pfDeduction + record.ptDeduction +
              record.esicDeduction + record.tdsDeduction + record.advance).toFixed(2)
          );
          record.netSalary = parseFloat(
            (record.grossSalary - record.totalDeductions +
              record.otAmount + record.arrear).toFixed(2)
          );
        }
        totalNet = records.reduce((s, r) => s + (r.netSalary || 0), 0);

        const groupName = getGroupName(section, location, profile);
        const payrollData = {
          month, year: parseInt(year), location, section, profile,
          groupName, attendanceId: attendance._id, records,
          status: 'Draft',
          totalGross: parseFloat(totalGross.toFixed(2)),
          totalPF: parseFloat(totalPF.toFixed(2)),
          totalPT: parseFloat(totalPT.toFixed(2)),
          totalESIC: parseFloat(totalESIC.toFixed(2)),
          totalTDS: parseFloat(totalTDS.toFixed(2)),
          totalNet: parseFloat(totalNet.toFixed(2)),
          processedBy: req.session.user.username,
          processedAt: new Date()
        };

        if (existingPayroll) {
          Object.assign(existingPayroll, payrollData);
          existingPayroll.markModified('records');
          await existingPayroll.save();
        } else {
          await Payroll.create(payrollData);
        }

        results.push({
          group: groupName,
          employees: records.length,
          status: 'Processed'
        });
      } catch(e) {
        results.push({
          group: attendance.location + ' ' + attendance.section,
          status: 'Error: ' + e.message
        });
      }
    }

    return res.json({
      success: true,
      message: results.filter(r => r.status === 'Processed').length + ' groups processed',
      results
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
