const express = require('express');
const router = express.Router();
const { isLoggedIn, isAccountantOrAdmin } = require('../middleware/auth');
const { safeError } = require('../middleware/security');

async function getGmailAccessToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type:    'refresh_token'
      })
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('No access token returned: ' + JSON.stringify(data));
    return data.access_token;
  } finally {
    clearTimeout(timer);
  }
}

function encodeHeader(str) {
  return '=?UTF-8?B?' + Buffer.from(str, 'utf8').toString('base64') + '?=';
}

async function sendGmailMessage(accessToken, { from, to, subject, html }) {
  const mime = [
    'MIME-Version: 1.0',
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html
  ].join('\r\n');

  const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Gmail API error: ' + JSON.stringify(data));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// SEND PAYSLIP EMAIL — accountant/admin/management only
router.post('/send-payslip', isLoggedIn, isAccountantOrAdmin, async (req, res) => {
  try {
    const { to, subject, html, employeeName, month, year } = req.body;
    if (!to || !html) return res.status(400).json({ success: false, message: 'Email and payslip content required' });

    const gmailUser      = process.env.GMAIL_USER;
    const clientId       = process.env.GMAIL_CLIENT_ID;
    const clientSecret   = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken   = process.env.GMAIL_REFRESH_TOKEN;

    if (!gmailUser || !clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ success: false, message: 'Email not configured. Set GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN.' });
    }

    const accessToken = await getGmailAccessToken();

    await sendGmailMessage(accessToken, {
      from: '"Pay Slip" <' + gmailUser + '>',
      to,
      subject: subject || 'Salary Slip — ' + month + ' ' + year,
      html: `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
        <p>Dear ${employeeName},</p>
        <p>Please find your salary slip for <strong>${month} ${year}</strong> below.</p>
        <br>${html}<br>
        <p style="color:#999;font-size:11px;">This is an auto-generated email. Please do not reply.</p>
      </div>`
    });

    return res.json({ success: true, message: 'Payslip sent to ' + to });
  } catch (err) {
    console.error('[email send-payslip]', err.name, err.message);
    const msg = err.name === 'AbortError'
      ? 'Gmail API request timed out. Check server network access.'
      : (err.message.startsWith('Gmail API error:') ? err.message : safeError(err, 'email send-payslip'));
    return res.status(500).json({ success: false, message: msg });
  }
});

module.exports = router;
