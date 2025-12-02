const express = require('express');
const router = express.Router();
const { sendReloprepConfirmationEmail } = require('../bin/authService');

/**
 * POST /reloprep/send-confirmation
 * Send ReloPrep booking confirmation email with PDF attachment
 *
 * Body params:
 * - email: recipient email
 * - bookingData: { depositAmount, totalAmount, remainingBalance, origin, destination, moveDate, userName }
 * - pdfBase64: (optional) base64-encoded PDF buffer
 */
router.post('/send-confirmation', async (req, res) => {
    try {
        const { email, bookingData, pdfBase64 } = req.body;

        // Validate required fields
        if (!email || !bookingData) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: email and bookingData'
            });
        }

        // Validate bookingData structure
        const { depositAmount, totalAmount, remainingBalance, origin, destination, moveDate } = bookingData;
        if (!depositAmount || !totalAmount || !remainingBalance || !origin || !destination || !moveDate) {
            return res.status(400).json({
                success: false,
                error: 'Invalid bookingData: missing required fields'
            });
        }

        // Convert base64 PDF to buffer if provided
        let pdfBuffer = null;
        if (pdfBase64) {
            try {
                pdfBuffer = Buffer.from(pdfBase64, 'base64');
            } catch (error) {
                console.error('Error converting PDF base64 to buffer:', error);
                // Continue without PDF attachment
            }
        }

        // Send the email
        const result = await sendReloprepConfirmationEmail(email, bookingData, pdfBuffer);

        if (result.success) {
            res.json({
                success: true,
                message: 'Confirmation email sent successfully',
                warning: result.warning
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Failed to send confirmation email'
            });
        }
    } catch (error) {
        console.error('Error in /send-confirmation endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;
