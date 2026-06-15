const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { isLoggedIn } = require('../middleware/auth');

// SEND PAYSLIP EMAIL
router.post('/send-payslip', isLoggedIn, async (req, res) => {
  try {
    const { to, subject, html, employeeName, month, year } = req.body;
    if (!to || !html) return res.status(400).json({ success: false, message: 'Email and payslip content required' });

    // Get email settings from env
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailUser || !gmailPass) {
      return res.status(400).json({
        success: false,
        message: 'Email not configured. Please add GMAIL_USER and GMAIL_PASS in settings.'
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    await transporter.sendMail({
      from: '"Payroll System" <' + gmailUser + '>',
      to,
      subject: subject || 'Salary Slip — ' + month + ' ' + year,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
          <p>Dear ${employeeName},</p>
          <p>Please find your salary slip for <strong>${month} ${year}</strong> below.</p>
          <br>
          ${html}
          <br>
          <p style="color:#999;font-size:11px;">This is an auto-generated email. Please do not reply.</p>
        </div>
      `
    });

    return res.json({ success: true, message: 'Payslip sent to ' + to });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
