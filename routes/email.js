const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { isLoggedIn, isAccountantOrAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

async function createTransporter() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const { token: accessToken } = await oauth2Client.getAccessToken();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_USER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken
    }
  });
}

// SEND PAYSLIP EMAIL — accountant/admin/management only; supervisors cannot send emails
router.post('/send-payslip', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const { to, subject, html, employeeName, month, year } = req.body;
    if (!to || !html) return res.status(400).json({ success: false, message: 'Email and payslip content required' });

    const gmailUser = process.env.GMAIL_USER;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

    if (!gmailUser || !clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ success: false, message: 'Email not configured. Please set GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN.' });
    }

    const transporter = await createTransporter();

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
    const smtpErrors = {
      EAUTH:       'Gmail authentication failed. Check OAuth credentials.',
      ECONNECTION: 'Could not connect to Gmail. Please try again.',
      ETIMEDOUT:   'Connection to Gmail timed out. Please try again.',
    };
    const friendly = smtpErrors[err.code];
    return res.status(500).json({ success: false, message: friendly || safeError(err, 'email send-payslip') });
  }
});

module.exports = router;
