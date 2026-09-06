/**
 * process_appraisal.js
 * Reads Appraisal.xlsx, matches each row to the payroll system (by UAN then name),
 * marks unmatched rows "NT" in a new Status column, and outputs two files:
 *   1. Appraisal_Reviewed.xlsx  — original sheet + Status column (for your records)
 *   2. Appraisal_Import.csv     — bulk-import format (EIN, financialYear, monthlySalary, ctcAnnual, remarks)
 */

// Run from project root so node_modules resolves
process.chdir('/Users/sukeshkotian/Desktop/Projects/payroll-system');
require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const path     = require('path');
const fs       = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
const INPUT_FILE  = '/Users/sukeshkotian/Desktop/Appraisal.xlsx';
const OUT_XLSX    = '/Users/sukeshkotian/Desktop/Appraisal_Reviewed.xlsx';
const OUT_CSV     = '/Users/sukeshkotian/Desktop/Appraisal_Import.csv';
const FINANCIAL_YEAR = '2025-26';

// Normalise a name for fuzzy comparison — strips honorifics/prefixes and extra whitespace
const PREFIXES = /^(mr\.|mrs\.|ms\.|dr\.|prof\.|shri\.|smt\.)\s+/i;
const norm = s => String(s || '').toLowerCase()
  .replace(PREFIXES, '')   // remove title
  .replace(/\s+/g, ' ')
  .trim();

// Clean a UAN string: keep digits only (handles "100675476404 (Aadhar Issue)" etc.)
const cleanUAN = s => String(s || '').replace(/\D/g, '').trim();

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const Employee = require('/Users/sukeshkotian/Desktop/Projects/payroll-system/models/Employee');
  const employees = await Employee.find({ isActive: true })
    .select('ein employeeName uanNumber monthlySalary location section profile')
    .lean();

  console.log(`📋 Loaded ${employees.length} active employees from payroll system`);

  // Index by UAN and by normalised name
  const byUAN  = new Map();
  const byName = new Map();
  for (const e of employees) {
    const uanClean = cleanUAN(e.uanNumber);
    if (uanClean) byUAN.set(uanClean, e);
    byName.set(norm(e.employeeName), e);
  }

  // Read input Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT_FILE);
  const ws = wb.worksheets[0];

  // Actual column layout: A=Name, B=Gender, C=UAN, D=Bank, E=Salary
  // Add Status and EIN columns after col E (5)
  const STATUS_COL = 6; // F
  const EIN_COL    = 7; // G

  ws.getCell(1, STATUS_COL).value = 'Status';
  ws.getCell(1, STATUS_COL).font  = { bold: true };
  ws.getCell(1, EIN_COL).value    = 'EIN (matched)';
  ws.getCell(1, EIN_COL).font     = { bold: true };

  // Quick sanity check: show first 3 DB UANs vs first 3 Excel UANs
  const dbUANs = [...byUAN.keys()].slice(0, 3);
  console.log('DB UANs (sample):', dbUANs);

  const importRows = []; // for CSV
  let matched = 0, nt = 0, noSalary = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row  = ws.getRow(r);
    const name   = String(row.getCell(1).value || '').trim(); // Col A: Teacher's Name
    const uan    = cleanUAN(row.getCell(3).value);            // Col C: UAN (digits only)
    const salary = parseFloat(row.getCell(5).value) || 0;    // Col E: Salary (2025-26)

    if (!name) continue; // blank row

    // Try UAN match first, then normalised name match
    let emp = byUAN.get(uan) || byName.get(norm(name));

    if (!emp) {
      // Try partial name match (first 2 words)
      const shortName = norm(name).split(' ').slice(0, 2).join(' ');
      for (const [k, v] of byName) {
        if (k.startsWith(shortName) || shortName.startsWith(k.split(' ').slice(0, 2).join(' '))) {
          emp = v; break;
        }
      }
    }

    if (emp) {
      ws.getCell(r, STATUS_COL).value = 'OK';
      ws.getCell(r, STATUS_COL).font  = { color: { argb: 'FF34A853' } };
      ws.getCell(r, EIN_COL).value    = emp.ein || '';

      if (salary > 0) {
        importRows.push({
          ein: emp.ein,
          employeeName: emp.employeeName,
          financialYear: FINANCIAL_YEAR,
          monthlySalary: salary,
          ctcAnnual: salary * 12,
          remarks: 'Imported from 2025-26 appraisal sheet'
        });
        matched++;
      } else {
        noSalary++;
      }
    } else {
      ws.getCell(r, STATUS_COL).value = 'NT';
      ws.getCell(r, STATUS_COL).font  = { bold: true, color: { argb: 'FFEA4335' } };
      ws.getCell(r, STATUS_COL).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
      ws.getCell(r, EIN_COL).value    = '';
      nt++;
    }
  }

  // Auto-width Status and EIN columns
  ws.getColumn(STATUS_COL).width = 14;
  ws.getColumn(EIN_COL).width    = 16;

  await wb.xlsx.writeFile(OUT_XLSX);
  console.log(`\n✅ Reviewed sheet saved: ${OUT_XLSX}`);

  // Write import CSV
  const csvLines = ['ein,financialYear,monthlySalary,ctcAnnual,remarks'];
  for (const r of importRows) {
    csvLines.push([
      r.ein,
      r.financialYear,
      r.monthlySalary,
      r.ctcAnnual,
      '"' + r.remarks + '"'
    ].join(','));
  }
  fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf8');
  console.log(`✅ Import CSV saved:      ${OUT_CSV}`);

  console.log('\n📊 Summary');
  console.log('─'.repeat(40));
  console.log(`  Matched (ready to import) : ${matched}`);
  console.log(`  Not in system (NT)        : ${nt}`);
  console.log(`  Matched but ₹0 salary     : ${noSalary}`);
  console.log(`  Total rows processed      : ${matched + nt + noSalary}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
