const express = require('express');
const router = express.Router();
const ExtraPay = require('../models/ExtraPay');
const Employee = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// GET — list entries (filterable by month, year, location, ein)
router.get('/', isLoggedIn, async (req, res) => {
  try {
    const filter = {};
    if (req.query.month)    filter.month    = req.query.month;
    if (req.query.year)     filter.year     = parseInt(req.query.year);
    if (req.query.location) filter.location = req.query.location;
    if (req.query.ein)      filter.ein      = req.query.ein.toUpperCase();
    const entries = await ExtraPay.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, entries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST — create entry
router.post('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein, month, year, amount, reason, reasonDetail, paymentDate, paymentMode, remarks } = req.body;
    if (!ein || !month || !year || !amount || !reason) {
      return res.status(400).json({ success: false, message: 'EIN, month, year, amount and reason are required' });
    }
    const employee = await Employee.findOne({ ein: ein.toUpperCase(), isActive: true });
    if (!employee) return res.status(404).json({ success: false, message: 'Active employee not found' });

    const entry = await ExtraPay.create({
      ein: employee.ein,
      employeeId: employee._id,
      employeeName: employee.employeeName,
      location: employee.location,
      section: employee.section,
      profile: employee.profile,
      month, year: parseInt(year),
      amount: parseFloat(amount),
      reason, reasonDetail: reasonDetail || '',
      paymentDate: paymentDate ? new Date(paymentDate) : null,
      paymentMode: paymentMode || 'Bank Transfer',
      remarks: remarks || '',
      addedBy: req.session.user.username
    });
    return res.json({ success: true, message: 'Extra pay entry added', entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', isLoggedIn, isAdmin, async (req, res) => {
  try {
    await ExtraPay.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
