const express = require('express');
const router = express.Router();
const EmployeeSubmission = require('../models/EmployeeSubmission');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// PUBLIC - submit a new employee form (no login required)
router.post('/submit', async (req, res) => {
  try {
    const data = req.body;
    if (typeof data.qualifications === 'string') {
      try { data.qualifications = JSON.parse(data.qualifications); }
      catch(e) { data.qualifications = []; }
    }
    const submission = await EmployeeSubmission.create(data);
    return res.json({ success: true, message: 'Submitted successfully', submission });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADMIN - get all submissions
router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    let filter = {};
    if (req.query.status) filter.status = req.query.status;
    const submissions = await EmployeeSubmission.find(filter).sort({ submittedAt: -1 });
    return res.json({ success: true, submissions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADMIN - export submissions as Excel
router.get('/export', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const submissions = await EmployeeSubmission.find({ status: 'Pending' }).sort({ submittedAt: 1 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employee Submissions');

    ws.columns = [
      { header: 'Title', key: 'title', width: 10 },
      { header: 'Employee Name', key: 'employeeName', width: 25 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Location', key: 'location', width: 12 },
      { header: 'Section', key: 'section', width: 12 },
      { header: 'Profile', key: 'profile', width: 14 },
      { header: 'Date of Birth', key: 'dateOfBirth', width: 14 },
      { header: 'Date of Joining', key: 'dateOfJoining', width: 14 },
      { header: 'PAN Number', key: 'panNumber', width: 14 },
      { header: 'Aadhaar Number', key: 'aadhaarNumber', width: 16 },
      { header: 'Phone Number', key: 'phoneNumber', width: 14 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Address', key: 'address', width: 35 },
      { header: 'UAN Number', key: 'uanNumber', width: 16 },
      { header: 'Qualifications', key: 'qualText', width: 40 },
      { header: 'Monthly Salary', key: 'monthlySalary', width: 14 },
      { header: 'CTC Annual', key: 'ctcAnnual', width: 14 },
      { header: 'PF Applicable', key: 'pfApplicable', width: 12 },
      { header: 'ESIC Applicable', key: 'esicApplicable', width: 14 },
      { header: 'PT Applicable', key: 'ptApplicable', width: 12 },
      { header: 'Restricted', key: 'isRestricted', width: 10 }
    ];
    ws.getRow(1).font = { bold: true };

    submissions.forEach(s => {
      const qualText = (s.qualifications || []).map(q =>
        q.degree + ' - ' + q.institution + ' (' + q.yearOfPassing + ')'
      ).join('; ');
      ws.addRow({
        title: s.title,
        employeeName: s.employeeName,
        gender: s.gender,
        designation: s.designation,
        department: s.department,
        location: s.location,
        section: s.section,
        profile: s.profile,
        dateOfBirth: s.dateOfBirth ? s.dateOfBirth.toISOString().split('T')[0] : '',
        dateOfJoining: s.dateOfJoining ? s.dateOfJoining.toISOString().split('T')[0] : '',
        panNumber: s.panNumber,
        aadhaarNumber: s.aadhaarNumber,
        phoneNumber: s.phoneNumber,
        email: s.email,
        address: s.address,
        uanNumber: s.uanNumber || '',
        qualText,
        monthlySalary: '',
        ctcAnnual: '',
        pfApplicable: '',
        esicApplicable: '',
        ptApplicable: '',
        isRestricted: ''
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Employee_Submissions.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADMIN - delete a submission
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await EmployeeSubmission.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ADMIN - mark submissions as imported (after they've been added to Excel & uploaded)
router.patch('/mark-imported', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await EmployeeSubmission.updateMany({ status: 'Pending' }, { status: 'Imported' });
    return res.json({ success: true, message: 'All pending submissions marked as imported' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
