const nodemailer = require('nodemailer');
var express = require('express');
var router = express.Router();

const multer = require('multer');
// const { resolve } = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function buildTransporter() {
    const host = process.env.SMTP_HOST || 'smtp.sendgrid.net';
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
            user,
            pass
        }
    });
}

router.post('/send', (req, res) => {
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

router.post('/send/attachments', upload.array('attachments'), (req, res) => {
    const { name, email, message } = req.body;
    const transporter = buildTransporter();
    if (!transporter) {
        return res.status(503).json({ error: 'Email service is not configured' });
    }
  
    const mailOptions = {
        from: `${name} <dispute@we3kings.dev>`, // Replace with your email address
        to: 'dispute@we3kings.dev', // Replace with recipient's email address
        subject: `New message from ${name}`,
        text: message,
        replyTo: email,
        attachments: [] // Initialize the attachments array as an empty array
      };
    
  
    // Attach files to the email, if any
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

module.exports = router;
