const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const Employee = require('../models/Employee');
const { isLoggedIn } = require('../middleware/auth');

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

const STATUS_COLORS = {
  P:   { argb: 'FFC8E6C9' },
  A:   { argb: 'FFFFCDD2' },
  CL:  { argb: 'FFFFE0B2' },
  SL:  { argb: 'FFFCE4EC' },
  PL:  { argb: 'FFC5CAE9' },
  SpL: { argb: 'FFE1BEE7' },
  H:   { argb: 'FFB2DFDB' },
  WO:  { argb: 'FFEEEEEE' },
  HD:  { argb: 'FFFFF9C4' },
  OT:  { argb: 'FFBBDEFB' }
};

const HEADER_COLOR = { argb: 'FF1A73E8' };
const SUNDAY_COLOR = { argb: 'FFEA4335' };
const TOTAL_HEADER_COLOR = { argb: 'FF0D47A1' };
const VALID_STATUSES = '"P,A,CL,SL,PL,SpL,H,WO,HD,OT"';

router.get('/download', isLoggedIn, async (req, res) => {
  try {
    const { location, section, profile, month, year, groupName } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year required' });
    }

    const monthIdx = MONTHS.indexOf(month);
    const yr = parseInt(year);
    const daysInMonth = new Date(yr, monthIdx + 1, 0).getDate();
    const shortMonth = month.substring(0, 3);

    // Get employees
    let filter = { isActive: true };
    if (location) filter.location = location;
    if (section) filter.section = section;
    if (profile) filter.profile = profile;
    const employees = await Employee.find(filter).sort({ ein: 1 });

    if (!employees.length) {
      return res.status(404).json({ success: false, message: 'No employees found' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payroll System';
    workbook.created = new Date();

    // ── ATTENDANCE SHEET ──
    const sheetName = (groupName || 'Attendance').substring(0, 31);
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }]
    });

    // Fixed columns
    const fixedCols = [
      { header: 'EIN', key: 'ein', width: 12 },
      { header: 'Employee Name', key: 'name', width: 24 },
      { header: 'Designation', key: 'desig', width: 16 },
      { header: 'Payable', key: 'payable', width: 9 },
      { header: 'Present', key: 'present', width: 9 },
      { header: 'CL', key: 'cl', width: 7 },
      { header: 'SL', key: 'sl', width: 7 },
      { header: 'PL', key: 'pl', width: 7 },
      { header: 'Sp.L', key: 'spl', width: 7 },
      { header: 'HD', key: 'hd', width: 7 },
      { header: 'Absent', key: 'absent', width: 9 },
      { header: 'OT', key: 'ot', width: 7 }
    ];
    const FC = fixedCols.length; // 12

    // Day columns
    const dayCols = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(yr, monthIdx, d);
      const dayName = ['Su','Mo','Tu','We','Th','Fr','Sa'][date.getDay()];
      dayCols.push({ header: d + '\n' + dayName, key: 'd' + d, width: 5, day: d, isSunday: date.getDay() === 0 });
    }

    ws.columns = [...fixedCols, ...dayCols];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.height = 30;
    ws.columns.forEach((col, ci) => {
      const cell = headerRow.getCell(ci + 1);
      const isSunday = ci >= FC && dayCols[ci - FC]?.isSunday;
      const isTotal = ci >= 3 && ci < FC;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: isSunday ? SUNDAY_COLOR : isTotal ? TOTAL_HEADER_COLOR : HEADER_COLOR };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
    });

    // Helper: column letter
    const colLetter = idx => {
      let s = ''; idx++;
      while (idx > 0) { const r = (idx-1)%26; s = String.fromCharCode(65+r)+s; idx = Math.floor((idx-1)/26); }
      return s;
    };

    const dayStartCol = colLetter(FC);
    const dayEndCol = colLetter(FC + daysInMonth - 1);

    // Add employee rows
    employees.forEach((emp, ei) => {
      const rowNum = ei + 2;
      const row = ws.getRow(rowNum);
      row.height = 20;
      const rangeStr = dayStartCol + rowNum + ':' + dayEndCol + rowNum;

      // Fixed data
      row.getCell(1).value = emp.ein || '';
      row.getCell(2).value = emp.employeeName || '';
      row.getCell(3).value = emp.designation || '';

      // COUNTIF formulas
      // Payable = P + OT + CL + SL + PL + SpL + HD*0.5
      row.getCell(4).value = { formula: 'COUNTIF('+rangeStr+',"P")+COUNTIF('+rangeStr+',"OT")+COUNTIF('+rangeStr+',"CL")+COUNTIF('+rangeStr+',"SL")+COUNTIF('+rangeStr+',"PL")+COUNTIF('+rangeStr+',"SpL")+COUNTIF('+rangeStr+',"HD")*0.5' };
      row.getCell(5).value = { formula: 'COUNTIF('+rangeStr+',"P")' };
      row.getCell(6).value = { formula: 'COUNTIF('+rangeStr+',"CL")' };
      row.getCell(7).value = { formula: 'COUNTIF('+rangeStr+',"SL")' };
      row.getCell(8).value = { formula: 'COUNTIF('+rangeStr+',"PL")' };
      row.getCell(9).value = { formula: 'COUNTIF('+rangeStr+',"SpL")' };
      row.getCell(10).value = { formula: 'COUNTIF('+rangeStr+',"HD")' };
      row.getCell(11).value = { formula: 'COUNTIF('+rangeStr+',"A")' };
      row.getCell(12).value = { formula: 'COUNTIF('+rangeStr+',"OT")' };

      // Style fixed cols
      for (let c = 1; c <= FC; c++) {
        const cell = row.getCell(c);
        cell.alignment = { horizontal: c <= 3 ? 'left' : 'center', vertical: 'middle' };
        cell.border = { right: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
        if (c <= 3) cell.font = { size: 10 };
        else { cell.font = { bold: true, size: 10, color: { argb: 'FF1A73E8' } }; }
      }

      // Day cells - empty with dropdown
      for (let d = 1; d <= daysInMonth; d++) {
        const cell = row.getCell(FC + d);
        cell.value = '';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { right: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
        // Sunday column background
        const date = new Date(yr, monthIdx, d);
        if (date.getDay() === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
        }
        // Add dropdown validation
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [VALID_STATUSES],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Invalid Status',
          error: 'Please select: P, A, CL, SL, PL, SpL, H, WO, HD, or OT'
        };
      }

      // Alternate row shading
      if (ei % 2 === 1) {
        for (let c = 1; c <= 3; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
        }
      }
    });

    // ── INSTRUCTIONS SHEET ──
    const wsInstr = workbook.addWorksheet('Instructions');
    wsInstr.columns = [{ width: 12 }, { width: 30 }, { width: 5 }, { width: 12 }, { width: 30 }];

    const instrRows = [
      ['ATTENDANCE STATUS CODES'],
      ['Code', 'Meaning', '', 'Code', 'Meaning'],
      ['P', 'Present', '', 'H', 'Holiday'],
      ['A', 'Absent (LOP)', '', 'WO', 'Week Off'],
      ['CL', 'Casual Leave', '', 'HD', 'Half Day (counts as 0.5)'],
      ['SL', 'Sick Leave', '', 'OT', 'Overtime'],
      ['PL', 'Paid Leave', '', '', ''],
      ['SpL', 'Special Leave', '', '', ''],
      [''],
      ['INSTRUCTIONS:'],
      ['1. Click any day cell and select status from dropdown'],
      ['2. Leave blank if employee was absent with no record'],
      ['3. Summary columns auto-calculate'],
      ['4. Do NOT edit EIN, Name or Designation'],
      ['5. Upload this file back to the system when complete'],
    ];

    instrRows.forEach((r, i) => {
      const row = wsInstr.addRow(r);
      if (i === 0) {
        row.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1A73E8' } };
      }
      if (i === 1) {
        row.eachCell(cell => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: HEADER_COLOR };
        });
      }
      // Color code the status cells
      const statusColorMap = { P: 'FFC8E6C9', A: 'FFFFCDD2', CL: 'FFFFE0B2', SL: 'FFFCE4EC', PL: 'FFC5CAE9', SpL: 'FFE1BEE7', H: 'FFB2DFDB', WO: 'FFEEEEEE', HD: 'FFFFF9C4', OT: 'FFBBDEFB' };
      if (r[0] && statusColorMap[r[0]]) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColorMap[r[0]] } };
        row.getCell(1).font = { bold: true };
      }
      if (r[3] && statusColorMap[r[3]]) {
        row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColorMap[r[3]] } };
        row.getCell(4).font = { bold: true };
      }
    });

    // Send file
    const fileName = 'Attendance_' + (groupName || 'All').replace(/ /g, '_') + '_' + month + '_' + year + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
