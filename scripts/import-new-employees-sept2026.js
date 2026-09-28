const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
require('dotenv').config();

function parseApplicable(val) {
  if (!val) return false;
  const s = String(val).toLowerCase();
  return s === 'yes' || s.includes('from');
}

function nextEIN(prefix, existing) {
  const nums = existing
    .filter(e => e.toUpperCase().startsWith(prefix + '-'))
    .map(e => parseInt(e.split('-')[1]))
    .filter(n => !isNaN(n));
  return prefix + '-' + ((nums.length ? Math.max(...nums) : 1000) + 1);
}

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Employee = require('../models/Employee');

  // Get all existing EINs to determine next available
  const allEmps = await Employee.find({}, { ein: 1 }).lean();
  const allEins = allEmps.map(e => e.ein);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/Users/sukeshkotian/Desktop/NewEmployees_Details_Form_Sept 2026.xlsx');
  const ws = wb.worksheets[0];

  const getCell = (row, col) => {
    const c = row.getCell(col);
    if (!c.value && c.value !== 0) return '';
    if (c.value && c.value.result !== undefined) return c.value.result;
    if (c.value && c.value.text) return c.value.text;
    if (c.value instanceof Date) return c.value;
    return String(c.value).trim();
  };

  // Skip rows 3,4,6 (Arjun Doke=row5, Triyuginath=row6, Rajendra=row17 in Excel → 0-indexed rows)
  // Excel rows: 3=Madhukar, 4=Kamtaprasad, 5=Arjun(SKIP), 6=Triyuginath(SKIP),
  //             7=Harish, 8=Kavita, 9=Tamli, 10=Neelam, 11=Bhavesh, 12=Rajesh,
  //             13=Bhagyashree, 14=Manasvi, 15=Suman, 16=Trupti, 17=Rajendra(SKIP)
  const SKIP_ROWS = new Set([5, 6, 17]); // Excel row numbers to skip

  const toImport = [];

  for (let i = 3; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const sno = getCell(r, 1);
    if (!sno) continue;
    if (SKIP_ROWS.has(i)) { console.log(`Skipping row ${i} (incomplete data)`); continue; }

    const section  = String(getCell(r, 10)).trim();
    const location = String(getCell(r, 9)).trim();
    const profile  = String(getCell(r, 11)).trim();

    const sectionCode  = section  === 'Global' ? 'G' : 'S';
    const locationCode = location === 'Thane'  ? 'T' : 'P';
    const profileCode  = profile  === 'Teaching' ? 'T' : 'N';
    const prefix = sectionCode + locationCode + profileCode;

    // Generate next EIN and add it to allEins so next iteration picks up
    const ein = nextEIN(prefix, allEins);
    allEins.push(ein);

    const salary = parseFloat(getCell(r, 12)) || 0;
    const dobRaw = r.getCell(5).value;
    const dojRaw = r.getCell(6).value;

    const bankAcc = String(getCell(r, 24)).trim();
    const hasBank = bankAcc && bankAcc !== '-' && bankAcc !== '';
    const paymentMode = hasBank ? 'Bank Transfer' : 'Cash';

    const email = String(getCell(r, 21)).trim();

    toImport.push({
      ein,
      title:        String(getCell(r, 2)).trim(),
      employeeName: String(getCell(r, 3)).trim(),
      gender:       String(getCell(r, 4)).trim(),
      dateOfBirth:  dobRaw instanceof Date ? dobRaw : new Date(dobRaw),
      dateOfJoining: dojRaw instanceof Date ? dojRaw : new Date(dojRaw),
      designation:  String(getCell(r, 7)).trim(),
      department:   String(getCell(r, 8)).trim(),
      location, section, profile,
      monthlySalary: salary,
      ctcAnnual:     salary * 12,
      ctcMonthly:    salary,
      pfApplicable:  parseApplicable(getCell(r, 14)),
      esicApplicable: parseApplicable(getCell(r, 15)),
      ptApplicable:  parseApplicable(getCell(r, 16)),
      panNumber:     String(getCell(r, 17)).trim(),
      aadhaarNumber: String(getCell(r, 18)).trim(),
      uanNumber:     String(getCell(r, 19)).trim(),
      phoneNumber:   String(getCell(r, 20)).trim(),
      email:         (email === '-' || !email) ? '' : email,
      qualifications: [], // free text — not structured
      address:       String(getCell(r, 23)).trim(),
      accountNumber: hasBank ? bankAcc : '',
      bankName:      hasBank ? String(getCell(r, 25)).trim() : '',
      ifscCode:      hasBank ? String(getCell(r, 26)).trim().toUpperCase() : '',
      accountHolderName: hasBank ? String(getCell(r, 27)).trim() : '',
      paymentMode,
      isActive:      true,
      isManagement:  false,
      isRestricted:  false,
      createdBy:     'import-sept-2026'
    });
  }

  console.log(`\nImporting ${toImport.length} employees...\n`);

  for (const data of toImport) {
    try {
      const existing = await Employee.findOne({ ein: data.ein });
      if (existing) { console.log(`SKIP (EIN exists): ${data.ein} ${data.employeeName}`); continue; }
      const emp = new Employee(data);
      await emp.save();
      console.log(`✓ ${emp.ein}  ${emp.employeeName}  ${emp.section} ${emp.location} ${emp.profile}  ₹${emp.monthlySalary}`);
    } catch (err) {
      console.error(`✗ ${data.ein} ${data.employeeName}: ${err.message}`);
    }
  }

  console.log('\nDone.');
  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
