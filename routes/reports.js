const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// ── helpers ───────────────────────────────────────────────────
const round2 = n => parseFloat((n || 0).toFixed(2));

// FY months: June of startYear → May of endYear
function fyMonths(financialYear) {
  const [s, e] = financialYear.split('-').map(Number);
  return [
    { month: 'June',      year: s },
    { month: 'July',      year: s },
    { month: 'August',    year: s },
    { month: 'September', year: s },
    { month: 'October',   year: s },
    { month: 'November',  year: s },
    { month: 'December',  year: s },
    { month: 'January',   year: e },
    { month: 'February',  year: e },
    { month: 'March',     year: e },
    { month: 'April',     year: e },
    { month: 'May',       year: e }
  ];
}

function applyHeaderStyle(row, fgColor) {
  row.eachCell(cell => {
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: fgColor || 'FF1A73E8' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    };
  });
}

function applyTotalStyle(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF1A73E8' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    cell.border = { top: { style: 'medium', color: { argb: 'FF1A73E8' } } };
  });
}

// ── BANK SALARY ADVICE ────────────────────────────────────────
// GET /api/reports/bank-advice?month=&year=&location=&section=&profile=
router.get('/bank-advice', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year, location, section, profile } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'month and year are required' });
    }

    const filter = { month, year: parseInt(year), status: { $in: ['Approved', 'Locked'] } };
    if (location) filter.location = location;
    if (section)  filter.section  = section;
    if (profile)  filter.profile  = profile;

    const payrolls = await Payroll.find(filter).lean();
    if (!payrolls.length) {
      return res.status(404).json({ success: false, message: 'No approved payroll found for the selected period' });
    }

    // Flatten all employee records across payroll groups
    const allRecords = [];
    for (const p of payrolls) {
      for (const r of p.records) {
        allRecords.push({ ...r, groupName: p.groupName });
      }
    }

    // Fetch employee bank details
    const eins = [...new Set(allRecords.map(r => r.ein))];
    const employees = await Employee.find({ ein: { $in: eins } })
      .select('ein paymentMode bankName accountNumber ifscCode accountHolderName')
      .lean();
    const empMap = new Map(employees.map(e => [e.ein, e]));

    // Filter to Bank Transfer employees only
    const bankRows = allRecords
      .filter(r => {
        const emp = empMap.get(r.ein);
        return emp && emp.paymentMode === 'Bank Transfer';
      })
      .sort((a, b) => (a.ein || '').localeCompare(b.ein || ''));

    if (!bankRows.length) {
      return res.status(404).json({ success: false, message: 'No employees with "Bank Transfer" payment mode in the selected payroll' });
    }

    // ── Build Excel workbook ──
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Payroll System';
    wb.created = new Date();

    const ws = wb.addWorksheet('Bank Advice');

    // Title
    ws.mergeCells('A1:H1');
    const t1 = ws.getCell('A1');
    t1.value = 'BANK SALARY ADVICE';
    t1.font  = { bold: true, size: 15 };
    t1.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:H2');
    const t2 = ws.getCell('A2');
    t2.value = month + ' ' + year;
    t2.font  = { size: 12 };
    t2.alignment = { horizontal: 'center' };

    ws.addRow([]); // blank spacer

    // Column headers
    const hdr = ws.addRow(['Sl No', 'EIN', 'Employee Name', 'Designation', 'Bank Name', 'Account Number', 'IFSC Code', 'Net Salary (₹)']);
    applyHeaderStyle(hdr);

    let sl = 1, total = 0;
    for (const r of bankRows) {
      const emp = empMap.get(r.ein) || {};
      const net = r.netSalary || 0;
      total += net;
      const dataRow = ws.addRow([
        sl++,
        r.ein || '',
        r.employeeName || '',
        r.designation || '',
        emp.bankName || '',
        emp.accountNumber || '',
        emp.ifscCode || '',
        round2(net)
      ]);
      dataRow.getCell(8).numFmt = '#,##0.00';
      dataRow.getCell(8).alignment = { horizontal: 'right' };
    }

    // Total row
    const totRow = ws.addRow(['', '', '', '', '', '', 'TOTAL', round2(total)]);
    applyTotalStyle(totRow);
    totRow.getCell(8).numFmt = '#,##0.00';
    totRow.getCell(8).alignment = { horizontal: 'right' };

    // Note row
    ws.addRow([]);
    const noteRow = ws.addRow(['', `Total employees: ${bankRows.length}`, '', '', '', '', 'Generated:', new Date().toLocaleDateString('en-IN')]);
    noteRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF888888' }, size: 10 }; });

    // Column widths
    ws.getColumn(1).width = 7;
    ws.getColumn(2).width = 13;
    ws.getColumn(3).width = 28;
    ws.getColumn(4).width = 22;
    ws.getColumn(5).width = 22;
    ws.getColumn(6).width = 22;
    ws.getColumn(7).width = 14;
    ws.getColumn(8).width = 16;

    // Freeze header
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Bank_Advice_${month}_${year}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Bank advice error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── PF ECR (ECR2) ─────────────────────────────────────────────
// GET /api/reports/pf-ecr?month=&year=&location=&section=&profile=
// Output: EPFO ECR2-style # -delimited text file
router.get('/pf-ecr', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { month, year, location, section, profile } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'month and year are required' });
    }

    const filter = { month, year: parseInt(year), status: { $in: ['Approved', 'Locked'] } };
    if (location) filter.location = location;
    if (section)  filter.section  = section;
    if (profile)  filter.profile  = profile;

    const payrolls = await Payroll.find(filter).lean();
    if (!payrolls.length) {
      return res.status(404).json({ success: false, message: 'No approved payroll found for the selected period' });
    }

    // Collect PF-applicable records
    const pfRecords = [];
    for (const p of payrolls) {
      for (const r of p.records) {
        if (r.pfApplicable && (r.pfDeduction || 0) > 0) {
          pfRecords.push(r);
        }
      }
    }

    if (!pfRecords.length) {
      return res.status(404).json({ success: false, message: 'No PF-applicable employee records found in approved payroll' });
    }

    // Fetch UAN from Employee model
    const eins = pfRecords.map(r => r.ein);
    const employees = await Employee.find({ ein: { $in: eins } }).select('ein uanNumber').lean();
    const uanMap = new Map(employees.map(e => [e.ein, e.uanNumber || '']));

    // ECR2 format:
    // Header row: #~#
    // Data rows:  UAN#MemberName#GrossWages#EPFWages#EPSWages#EDLIWages#EEEPFContrib#ERERPFContrib#ERERSContrib#NCPDays#RefundOfAdvances
    // Footer row: #~#
    const PF_CEILING = 15000;
    const lines = ['#~#'];

    for (const r of pfRecords) {
      const uan      = uanMap.get(r.ein) || '';
      const gross    = Math.round(r.grossSalary  || 0);
      const basic    = r.basic || 0;
      // EPF wages = basic, capped at 15,000
      const epfWages = Math.min(Math.round(basic), PF_CEILING);
      const epsWages = Math.min(epfWages, PF_CEILING);  // EPS wage ceiling same
      const edliWages = epsWages;

      const ee_epf  = Math.round(epfWages * 0.12);        // Employee EPF 12%
      const er_eps  = Math.round(epsWages * 0.0833);      // Employer EPS 8.33%
      const er_epf  = ee_epf - er_eps;                    // Employer diff to EPF (3.67%)
      const ncp     = Math.max(0, Math.round(r.lopDays || 0));

      lines.push([
        uan,
        r.employeeName || '',
        gross,
        epfWages,
        epsWages,
        edliWages,
        ee_epf,
        er_epf,
        er_eps,
        ncp,
        0   // Refund of advances
      ].join('#'));
    }
    lines.push('#~#');

    const content = lines.join('\n');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="PF_ECR_${month}_${year}.txt"`);
    res.send(content);

  } catch (err) {
    console.error('PF ECR error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── YTD SALARY SUMMARY ────────────────────────────────────────
// GET /api/reports/ytd?financialYear=2025-2026&location=&section=&profile=
router.get('/ytd', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { financialYear, location, section, profile } = req.query;
    if (!financialYear || !/^\d{4}-\d{4}$/.test(financialYear)) {
      return res.status(400).json({ success: false, message: 'financialYear is required in format YYYY-YYYY (e.g. 2025-2026)' });
    }

    const months = fyMonths(financialYear);
    const filter = {
      status: { $in: ['Approved', 'Locked'] },
      $or: months.map(m => ({ month: m.month, year: m.year }))
    };
    if (location) filter.location = location;
    if (section)  filter.section  = section;
    if (profile)  filter.profile  = profile;

    const payrolls = await Payroll.find(filter).lean();
    if (!payrolls.length) {
      return res.status(404).json({ success: false, message: 'No approved payroll data found for FY ' + financialYear });
    }

    // Aggregate per employee (keyed by EIN)
    const empAgg = new Map();
    const MONTH_ORDER = ['June','July','August','September','October','November','December','January','February','March','April','May'];

    for (const p of payrolls) {
      const mIdx = MONTH_ORDER.indexOf(p.month);
      for (const r of p.records) {
        if (!empAgg.has(r.ein)) {
          empAgg.set(r.ein, {
            ein: r.ein, name: r.employeeName, designation: r.designation,
            monthCount: 0, lastMonthIdx: -1,
            gross: 0, pf: 0, pt: 0, esic: 0, tds: 0, advance: 0, net: 0
          });
        }
        const e = empAgg.get(r.ein);
        e.monthCount++;
        e.lastMonthIdx = Math.max(e.lastMonthIdx, mIdx);
        e.gross   += r.grossSalary   || 0;
        e.pf      += r.pfDeduction   || 0;
        e.pt      += r.ptDeduction   || 0;
        e.esic    += r.esicDeduction || 0;
        e.tds     += r.tdsDeduction  || 0;
        e.advance += r.advance       || 0;
        e.net     += r.netSalary     || 0;
      }
    }

    const rows = [...empAgg.values()].sort((a, b) => (a.ein || '').localeCompare(b.ein || ''));

    // ── Build Excel ──
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Payroll System';
    wb.created = new Date();

    const ws = wb.addWorksheet('YTD Summary');

    // Title
    ws.mergeCells('A1:K1');
    const t1 = ws.getCell('A1');
    t1.value = 'YEAR-TO-DATE SALARY SUMMARY — Financial Year ' + financialYear;
    t1.font  = { bold: true, size: 14 };
    t1.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:K2');
    const t2 = ws.getCell('A2');
    const filterDesc = [location, section, profile].filter(Boolean).join(' / ') || 'All Groups';
    t2.value = filterDesc + ' | Generated: ' + new Date().toLocaleDateString('en-IN');
    t2.font  = { size: 11, italic: true, color: { argb: 'FF555555' } };
    t2.alignment = { horizontal: 'center' };

    ws.addRow([]);

    const hdr = ws.addRow([
      'EIN', 'Employee Name', 'Designation', 'Months Paid',
      'Gross (₹)', 'PF (₹)', 'PT (₹)', 'ESIC (₹)', 'TDS (₹)', 'Loan/Adv (₹)', 'Net Pay (₹)'
    ]);
    applyHeaderStyle(hdr);

    const moneyFmt  = '#,##0.00';
    const moneyCols = [5, 6, 7, 8, 9, 10, 11];

    let tGross=0, tPF=0, tPT=0, tESIC=0, tTDS=0, tAdv=0, tNet=0;

    for (const r of rows) {
      tGross += r.gross; tPF += r.pf; tPT += r.pt;
      tESIC  += r.esic;  tTDS += r.tds; tAdv += r.advance; tNet += r.net;

      const dataRow = ws.addRow([
        r.ein, r.name, r.designation, r.monthCount,
        round2(r.gross), round2(r.pf), round2(r.pt),
        round2(r.esic), round2(r.tds), round2(r.advance), round2(r.net)
      ]);
      moneyCols.forEach(c => {
        dataRow.getCell(c).numFmt     = moneyFmt;
        dataRow.getCell(c).alignment  = { horizontal: 'right' };
      });
    }

    const totRow = ws.addRow([
      '', 'TOTAL (' + rows.length + ' employees)', '', '',
      round2(tGross), round2(tPF), round2(tPT),
      round2(tESIC), round2(tTDS), round2(tAdv), round2(tNet)
    ]);
    applyTotalStyle(totRow);
    moneyCols.forEach(c => {
      totRow.getCell(c).numFmt    = moneyFmt;
      totRow.getCell(c).alignment = { horizontal: 'right' };
    });

    // Column widths
    [13, 28, 20, 11, 14, 12, 12, 12, 12, 14, 14].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    ws.views = [{ state: 'frozen', ySplit: 4 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="YTD_Summary_FY${financialYear}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('YTD report error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
