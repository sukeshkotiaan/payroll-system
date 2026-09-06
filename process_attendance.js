/**
 * process_attendance.js
 * Reads Attendance.xlsx, matches each row to the payroll system (by UAN then name),
 * groups employees by location/section/profile, and upserts Attendance documents
 * for the given month/year with status 'Approved' (ready for payroll processing).
 *
 * Usage: node process_attendance.js
 * Outputs a summary + /Desktop/Attendance_Review_Required.xlsx for unmatched rows.
 */

process.chdir('/Users/sukeshkotian/Desktop/Projects/payroll-system');
require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const fs       = require('fs');

const INPUT_FILE     = '/Users/sukeshkotian/Desktop/Attendance.xlsx';
const OUT_REVIEW     = '/Users/sukeshkotian/Desktop/Attendance_Review_Required.xlsx';
const MONTH          = 'August';
const YEAR           = 2026;
const IMPORT_STATUS  = 'Approved'; // payroll can process immediately

// ── helpers ──────────────────────────────────────────────────────────────────
const PREFIXES = /^(mr\.|mrs\.|ms\.|dr\.|prof\.|shri\.|smt\.)\s+/i;
const norm     = s => String(s || '').toLowerCase().replace(PREFIXES, '').replace(/\s+/g, ' ').trim();
const cleanUAN = s => String(s || '').replace(/\D/g, '').trim();

function getGroupName(section, location, profile) {
  if (section === 'State') return 'Xaviers ' + location;
  if (section === 'Global' && profile === 'Teaching')     return 'Global Teaching';
  if (section === 'Global' && profile === 'Non-Teaching') return 'Global Non-Teaching';
  return section + ' ' + location + ' ' + profile;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const Employee   = require('./models/Employee');
  const Attendance = require('./models/Attendance');

  // Load active employees
  const employees = await Employee.find({ isActive: true })
    .select('ein employeeName uanNumber designation location section profile')
    .lean();
  console.log(`📋 Loaded ${employees.length} active employees`);

  // Index by UAN and normalised name
  const byUAN  = new Map();
  const byName = new Map();
  for (const e of employees) {
    const u = cleanUAN(e.uanNumber);
    if (u) byUAN.set(u, e);
    byName.set(norm(e.employeeName), e);
  }

  // ── Read Excel ──────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT_FILE);
  const ws = wb.worksheets[0];
  console.log(`📄 Excel rows: ${ws.rowCount - 1} (excl. header)`);

  const matched  = []; // { emp, daysInMonth, presentDays, cl, absent }
  const ntRows   = []; // unmatched — for review sheet

  for (let r = 2; r <= ws.rowCount; r++) {
    const row     = ws.getRow(r);
    const name    = String(row.getCell(1).value || '').trim();
    const rawUAN  = String(row.getCell(3).value || '');
    const uan     = cleanUAN(rawUAN);
    const daysInMonth  = parseFloat(row.getCell(11).value) || 31;
    const presentDays  = parseFloat(row.getCell(12).value) || 0;
    const cl           = parseFloat(row.getCell(13).value) || 0;
    const absent       = parseFloat(row.getCell(14).value) || 0;

    if (!name) continue;

    // Match: UAN → exact name → partial name (first 2 words)
    let emp = byUAN.get(uan) || byName.get(norm(name));
    if (!emp) {
      const shortName = norm(name).split(' ').slice(0, 2).join(' ');
      for (const [k, v] of byName) {
        if (k.startsWith(shortName) || shortName.startsWith(k.split(' ').slice(0, 2).join(' '))) {
          emp = v; break;
        }
      }
    }

    if (emp) {
      const payableDays = parseFloat((presentDays + cl).toFixed(2));
      const lopDays     = parseFloat(absent.toFixed(2));
      matched.push({ emp, daysInMonth, presentDays, cl, absent, lopDays, payableDays });
    } else {
      ntRows.push({ name, rawUAN, daysInMonth, presentDays, cl, absent });
    }
  }

  console.log(`\n🔍 Matched: ${matched.length} | Not matched (NT): ${ntRows.length}`);

  // ── Group matched employees by location/section/profile ────────────────────
  const groups = new Map(); // key = "loc|sec|prof"
  for (const m of matched) {
    const { location, section, profile } = m.emp;
    const key = `${location}|${section}|${profile}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  console.log(`📦 Groups to upsert: ${groups.size}`);

  // ── Upsert one Attendance document per group ────────────────────────────────
  let upserted = 0, skipped = 0;
  const groupErrors = [];

  for (const [key, members] of groups) {
    const [location, section, profile] = key.split('|');
    const groupName = getGroupName(section, location, profile);

    const records = members.map(m => ({
      ein:          m.emp.ein,
      employeeId:   m.emp._id,
      employeeName: m.emp.employeeName,
      designation:  m.emp.designation || '',
      daysInMonth:  m.daysInMonth,
      days:         [], // daily breakdown not in this Excel
      presentDays:  m.presentDays,
      cl:           m.cl,
      sl:           0,
      pl:           0,
      spL:          0,
      absent:       m.absent,
      halfDays:     0,
      weekOff:      0,
      holidays:     0,
      otHours:      0,
      lopDays:      m.lopDays,
      payableDays:  m.payableDays,
      remarks:      'Imported from Attendance.xlsx'
    }));

    try {
      await Attendance.findOneAndUpdate(
        { month: MONTH, year: YEAR, location, section, profile },
        {
          month: MONTH,
          year:  YEAR,
          location, section, profile, groupName,
          status:     IMPORT_STATUS,
          records,
          uploadedBy: 'admin-import',
          uploadedAt: new Date(),
          updatedAt:  new Date()
        },
        { upsert: true }
      );
      upserted++;
      console.log(`  ✅ ${groupName.padEnd(30)} — ${records.length} employees`);
    } catch (e) {
      skipped++;
      groupErrors.push(`${groupName}: ${e.message}`);
      console.log(`  ❌ ${groupName} — ${e.message}`);
    }
  }

  // ── Write review sheet for NT rows ─────────────────────────────────────────
  if (ntRows.length > 0) {
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Not Matched (NT)');
    const HD = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA4335' } },
      alignment: { horizontal: 'center' }
    };
    ['Teacher\'s Name', 'UAN', 'Days in Month', 'Present', 'CL', 'Absent', 'Action Required'].forEach((h, i) => {
      const cell = ws2.getCell(1, i + 1);
      cell.value = h; cell.font = HD.font; cell.fill = HD.fill; cell.alignment = HD.alignment;
    });
    ntRows.forEach((r, i) => {
      const row = ws2.getRow(i + 2);
      row.getCell(1).value = r.name;
      row.getCell(2).value = r.rawUAN;
      row.getCell(3).value = r.daysInMonth;
      row.getCell(4).value = r.presentDays;
      row.getCell(5).value = r.cl;
      row.getCell(6).value = r.absent;
      row.getCell(7).value = 'Add employee to payroll system, then re-run';
      row.getCell(7).font  = { italic: true, color: { argb: 'FF888888' } };
      row.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
    });
    [28, 16, 14, 10, 8, 10, 38].forEach((w, i) => ws2.getColumn(i + 1).width = w);
    await wb2.xlsx.writeFile(OUT_REVIEW);
    console.log(`\n📋 Review sheet saved: ${OUT_REVIEW}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n📊 Summary — ' + MONTH + ' ' + YEAR);
  console.log('─'.repeat(44));
  console.log(`  Employees matched & imported : ${matched.length}`);
  console.log(`  Not in payroll system (NT)   : ${ntRows.length}`);
  console.log(`  Groups upserted              : ${upserted}`);
  console.log(`  Groups failed                : ${skipped}`);
  if (groupErrors.length) console.log('  Errors:', groupErrors);
  console.log(`\n  Status set to: ${IMPORT_STATUS}`);
  console.log('  Payroll can now be processed for all groups ✅');

  await mongoose.disconnect();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
