/**
 * routes/admin/email.js
 *
 * All transactional + support email routes.
 *
 * Mounted at / in app.js to preserve existing client paths:
 *   POST /email/send               – support contact form
 *   POST /email/send/attachments   – support contact form with file attachments
 *   POST /reloprep/send-confirmation – booking confirmation (stubbed – see below)
 */

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

// ── SMTP transport ─────────────────────────────────────────────────────────────

function buildTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.sendgrid.net';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

// ── POST /email/send ──────────────────────────────────────────────────────────
// Support contact form (used by DesktopSupport.vue)
router.post('/email/send', express.json(), (req, res) => {
  const { name, email, message } = req.body;

  const transporter = buildTransporter();
  if (!transporter) {
    return res.status(503).json({ error: 'Email service is not configured' });
  }

  const mailOptions = {
    from: `${name} <support@we3kings.dev>`,
    to: 'support@we3kings.dev',
    subject: `New message from ${name}`,
    text: message,
    replyTo: email
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(500).send('Error sending email');
    }
    console.log('Email sent:', info.response);
    res.send('Email sent successfully');
  });
});

// ── POST /email/send/attachments ──────────────────────────────────────────────
// Support contact form with file attachments (no current frontend caller)
router.post('/email/send/attachments', upload.array('attachments'), (req, res) => {
  const { name, email, message } = req.body;

  const transporter = buildTransporter();
  if (!transporter) {
    return res.status(503).json({ error: 'Email service is not configured' });
  }

  const mailOptions = {
    from: `${name} <dispute@we3kings.dev>`,
    to: 'dispute@we3kings.dev',
    subject: `New message from ${name}`,
    text: message,
    replyTo: email,
    attachments: []
  };

  if (req.files && req.files.length > 0) {
    req.files.forEach((file) => {
      mailOptions.attachments.push({
        filename: file.originalname,
        content: file.buffer
      });
    });
  }

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(500).send('Error sending email');
    }
    console.log('Email sent:', info.response);
    res.send('Email sent successfully');
  });
});

// ── POST /reloprep/send-confirmation ─────────────────────────────────────────
// Booking confirmation email with PDF attachment.
//
// TODO: This route is actively called by DesktopMovePlanning.vue after a user
// completes a deposit payment. When we build out the Reloprep booking flow:
//   1. Replace the stub below with a proper emailService.sendBookingConfirmation(...)
//   2. The email should include: move details, deposit amount, remaining balance,
//      matched mover info, and optionally a PDF inventory export as attachment.
//   3. Consider moving sendReloprepConfirmationEmail out of authService into a
//      dedicated emailService module.
//
// Expected body: { email, bookingData: { depositAmount, totalAmount,
//   remainingBalance, origin, destination, moveDate, userName }, pdfBase64? }
router.post('/reloprep/send-confirmation', express.json(), async (req, res) => {
  const { email, bookingData } = req.body;

  if (!email || !bookingData) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: email and bookingData'
    });
  }

  // Stub: acknowledge the request without actually sending an email.
  // Remove this and wire up a real emailService when the booking flow is ready.
  console.log('[reloprep/send-confirmation] stub — would send confirmation to:', email, bookingData);
  return res.json({
    success: true,
    message: 'Confirmation email queued (stub)',
    warning: 'Email delivery is not implemented yet'
  });
});

module.exports = router;
