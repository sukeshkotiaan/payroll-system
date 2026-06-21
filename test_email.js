require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  try {
    const info = await transporter.sendMail({
      from: '"Payroll System Test" <' + process.env.GMAIL_USER + '>',
      to: process.env.GMAIL_USER,
      subject: 'Test Email - Payroll System',
      html: '<h2>Test Successful</h2><p>This is a test email from the Payroll System to confirm Gmail SMTP is working correctly.</p>'
    });
    console.log('SUCCESS! Email sent:', info.messageId);
  } catch (err) {
    console.log('FAILED:', err.message);
  }
}

testEmail();
