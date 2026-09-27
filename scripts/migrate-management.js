const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Employee = require('../models/Employee');
  const Payroll  = require('../models/Payroll');
  const TDS      = require('../models/TDS');

  // 1. Set isManagement: true for Janhavi (MGT-001)
  const janhavi = await Employee.updateOne(
    { ein: 'MGT-001' },
    { $set: { isManagement: true } }
  );
  console.log('Janhavi isManagement:', janhavi.modifiedCount, 'updated');

  // 2. Rename MGT-01 → STT-1206 (Anju) and MGT-02 → GTT-1057 (Neeta)
  const migrations = [
    { oldEin: 'MGT-01', newEin: 'STT-1206', name: 'Anju Dinesh Sharma' },
    { oldEin: 'MGT-02', newEin: 'GTT-1057', name: 'Neeta Ashok Ramnani' },
  ];

  for (const { oldEin, newEin, name } of migrations) {
    console.log(`\nMigrating ${name}: ${oldEin} → ${newEin}`);

    const empRes = await Employee.updateOne({ ein: oldEin }, { $set: { ein: newEin, isManagement: false } });
    console.log(`  Employee: ${empRes.modifiedCount} updated`);

    const payrollRes = await Payroll.updateMany(
      { 'records.ein': oldEin },
      { $set: { 'records.$[elem].ein': newEin } },
      { arrayFilters: [{ 'elem.ein': oldEin }] }
    );
    console.log(`  Payroll records: ${payrollRes.modifiedCount} docs updated`);

    const tdsRes = await TDS.updateMany({ ein: oldEin }, { $set: { ein: newEin } });
    console.log(`  TDS records: ${tdsRes.modifiedCount} updated`);
  }

  // 3. Verify
  console.log('\n--- Verification ---');
  const mgt = await Employee.find({ isManagement: true }, { ein: 1, employeeName: 1 });
  console.log('Management employees:', mgt.map(e => `${e.ein} ${e.employeeName}`));

  const remaining = await Employee.find({ ein: { $in: ['MGT-01', 'MGT-02'] } });
  console.log('Old EINs remaining (should be 0):', remaining.length);

  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
