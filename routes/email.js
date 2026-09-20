const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { isLoggedIn, isAccountantOrAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

// SEND PAYSLIP EMAIL — accountant/admin/management only; supervisors cannot send emails
router.post('/send-payslip', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
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
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,   // STARTTLS on 587 (Render blocks 465/SSL)
      family: 4,       // force IPv4 — Render has no IPv6 outbound
      auth: { user: gmailUser, pass: gmailPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
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
    console.error('[email send-payslip]', err.code, err.message);
    // Surface actionable SMTP errors — these don't leak sensitive details
    const smtpErrors = {
      EAUTH:        'Gmail authentication failed. Check that the App Password in GMAIL_PASS is correct and 2FA is enabled on the Gmail account.',
      ECONNECTION:  'Could not connect to Gmail SMTP. The server may be temporarily unreachable — please try again.',
      ETIMEDOUT:    'Connection to Gmail timed out. Please try again in a moment.',
      ENETUNREACH:  'Network unreachable — the server cannot reach Gmail SMTP. Contact support.',
      EMESSAGE:     'Email was rejected by Gmail. Check the recipient address and try again.',
    };
    const friendly = smtpErrors[err.code];
    return res.status(500).json({ success: false, message: friendly || safeError(err, 'email send-payslip') });
  }
});

module.exports = router;
