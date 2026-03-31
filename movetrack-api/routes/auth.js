var express = require('express');
var router = express.Router();
const authService = require('../services/infra/authService');

/**
 * POST /auth/request-magic-link
 * Request a magic link to be sent to the user's email
 */
router.post('/request-magic-link', async function(req, res, next) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, error: 'Invalid email format' });
        }

        // Get client IP and user agent
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('user-agent');

        // Create magic link token
        const result = await authService.createMagicLinkToken(email, ipAddress, userAgent);

        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }

        // Send magic link email
        const baseUrl = process.env.NODE_ENV === 'development'
            ? 'http://localhost:5173'
            : 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app';

        const emailResult = await authService.sendMagicLinkEmail(email, result.token, baseUrl);

        if (!emailResult.success) {
            return res.status(500).json({ success: false, error: 'Failed to send email' });
        }

        res.json({ success: true, message: 'Magic link sent to your email' });
    } catch (error) {
        console.error('Error in request-magic-link:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /auth/verify-magic-link
 * Verify magic link token and create session
 */
router.get('/verify-magic-link', async function(req, res, next) {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ success: false, error: 'Token is required' });
        }

        // Get client IP and user agent
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('user-agent');

        // Verify magic link and create session
        const result = await authService.verifyMagicLinkToken(token, ipAddress, userAgent);

        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }

        const sessionToken = result.session_token || result.sessionToken;
        res.json({
            success: true,
            session_token: sessionToken,
            sessionToken,
            user: result.user
        });
    } catch (error) {
        console.error('Error in verify-magic-link:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /auth/logout
 * Logout user by invalidating session token
 */
router.post('/logout', async function(req, res, next) {
    try {
        const { sessionToken } = req.body;
        const authHeader = req.get('authorization');

        // Get token from body or Authorization header
        const token = sessionToken || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

        if (!token) {
            return res.status(400).json({ success: false, error: 'Session token is required' });
        }

        const result = await authService.logout(token);

        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Error in logout:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /auth/me
 * Get current user information from session token
 */
router.get('/me', async function(req, res, next) {
    try {
        const authHeader = req.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authorization header required' });
        }

        const token = authHeader.substring(7);
        const user = await authService.getUserFromToken(token);

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error('Error in /me:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
