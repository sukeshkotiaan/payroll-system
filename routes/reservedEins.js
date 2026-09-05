const express = require('express');
const router = express.Router();
const ReservedEIN = require('../models/ReservedEIN');
const Employee    = require('../models/Employee');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Parse "MGT-001" → { prefix: "MGT", number: 1 }
function parseEIN(ein) {
  const match = ein.trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: parseInt(match[2], 10) };
}

// Format number with padding, e.g. prefix="MGT", n=3, pad=3 → "MGT-003"
function formatEIN(prefix, n, pad = 3) {
  return prefix.toUpperCase() + '-' + String(n).padStart(pad, '0');
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
// GET /api/reserved-eins?status=available|assigned
router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const eins = await ReservedEIN.find(filter).sort({ ein: 1 });
    const total     = await ReservedEIN.countDocuments({});
    const available = await ReservedEIN.countDocuments({ status: 'available' });
    const assigned  = total - available;
    return res.json({ success: true, eins, summary: { total, available, assigned } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── SEED A RANGE ─────────────────────────────────────────────────────────────
// POST /api/reserved-eins/seed
// Body: { prefix: "MGT", from: 1, to: 50 }   → creates MGT-001 … MGT-050
// OR    { eins: ["MGT-001", "MGT-005", …] }   → explicit list
router.post('/seed', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { prefix, from, to, eins: explicitList } = req.body;
    const toCreate = [];

    if (explicitList && Array.isArray(explicitList) && explicitList.length) {
      for (const e of explicitList) {
        if (!parseEIN(e)) {
          return res.status(400).json({ success: false, message: 'Invalid EIN format: ' + e + ' (expected PREFIX-NNN)' });
        }
        toCreate.push(e.trim().toUpperCase());
      }
    } else if (prefix && from != null && to != null) {
      const f = parseInt(from);
      const t = parseInt(to);
      if (isNaN(f) || isNaN(t) || f < 1 || t < f) {
        return res.status(400).json({ success: false, message: 'Invalid range — from must be ≥ 1 and ≤ to' });
      }
      if (t - f + 1 > 500) {
        return res.status(400).json({ success: false, message: 'Cannot seed more than 500 EINs at once' });
      }
      const pad = String(t).length;    // pad to the width of the largest number
      for (let n = f; n <= t; n++) {
        toCreate.push(formatEIN(prefix, n, pad));
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide { prefix, from, to } for a range, or { eins: [...] } for an explicit list'
      });
    }

    // Insert only the ones that don't exist yet
    let added = 0, skipped = 0;
    for (const ein of toCreate) {
      const exists = await ReservedEIN.findOne({ ein });
      if (exists) { skipped++; continue; }
      await ReservedEIN.create({ ein, createdBy: req.session.user.username });
      added++;
    }

    return res.json({
      success: true,
      message: `Added ${added} reserved EIN${added !== 1 ? 's' : ''}` + (skipped ? `, ${skipped} already existed` : ''),
      added,
      skipped
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MANUALLY ASSIGN ──────────────────────────────────────────────────────────
// POST /api/reserved-eins/assign
// Body: { ein: "MGT-003", employeeId: "..." }
// OR omit ein to get the next available one
router.post('/assign', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein, employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId required' });

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    let reserved;
    if (ein) {
      reserved = await ReservedEIN.findOne({ ein: ein.toUpperCase() });
      if (!reserved) return res.status(404).json({ success: false, message: 'Reserved EIN not found: ' + ein });
      if (reserved.status === 'assigned') {
        return res.status(400).json({ success: false, message: ein + ' is already assigned to ' + reserved.assignedTo });
      }
    } else {
      // Pick the next available
      reserved = await ReservedEIN.findOne({ status: 'available' }).sort({ ein: 1 });
      if (!reserved) return res.status(404).json({ success: false, message: 'No available reserved EINs in the pool' });
    }

    // Update the reserved slot
    reserved.status             = 'assigned';
    reserved.assignedTo         = employee.employeeName;
    reserved.assignedEmployeeId = employee._id;
    reserved.assignedAt         = new Date();
    await reserved.save();

    // Update the employee record
    const oldEIN = employee.ein;
    employee.ein = reserved.ein;
    await employee.save();

    return res.json({
      success: true,
      message: `Assigned ${reserved.ein} to ${employee.employeeName}` + (oldEIN ? ` (was: ${oldEIN})` : ''),
      ein: reserved.ein,
      employee
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── RELEASE (un-assign) ──────────────────────────────────────────────────────
// POST /api/reserved-eins/release
// Body: { ein: "MGT-003" }
router.post('/release', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { ein } = req.body;
    if (!ein) return res.status(400).json({ success: false, message: 'ein required' });
    const reserved = await ReservedEIN.findOne({ ein: ein.toUpperCase() });
    if (!reserved) return res.status(404).json({ success: false, message: 'Reserved EIN not found' });
    if (reserved.status === 'available') {
      return res.status(400).json({ success: false, message: ein + ' is already available (not assigned)' });
    }

    const prevEmployee = reserved.assignedTo;
    reserved.status             = 'available';
    reserved.assignedTo         = '';
    reserved.assignedEmployeeId = null;
    reserved.assignedAt         = null;
    await reserved.save();

    return res.json({ success: true, message: `${ein} released (was assigned to ${prevEmployee})` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE FROM POOL ─────────────────────────────────────────────────────────
// DELETE /api/reserved-eins/:ein
router.delete('/:ein', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const ein = req.params.ein.toUpperCase();
    const reserved = await ReservedEIN.findOne({ ein });
    if (!reserved) return res.status(404).json({ success: false, message: 'Not found' });
    if (reserved.status === 'assigned') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete ${ein} — it is assigned to ${reserved.assignedTo}. Release it first.`
      });
    }
    await ReservedEIN.deleteOne({ ein });
    return res.json({ success: true, message: `${ein} removed from the reserved pool` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
