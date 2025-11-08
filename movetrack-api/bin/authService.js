const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('./db');

// JWT secret - in production, this should be a strong secret from environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '30d'; // 30 day sessions
const MAGIC_LINK_EXPIRY_MINUTES = 15;

// Email configuration
// For SendGrid SMTP: smtp.sendgrid.net, port 587, username 'apikey', password: your-api-key
let emailTransporter = null;

// Only create email transporter if SMTP credentials are provided
if (process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your-sendgrid-api-key') {
    emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
        port: process.env.SMTP_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER || 'apikey',
            pass: process.env.SMTP_PASS
        }
    });
    console.log('Email transporter configured with SendGrid');
} else {
    console.log('No email credentials - magic links will be logged to console only');
}

/**
 * Generate a cryptographically secure random token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate JWT session token
 */
function generateSessionToken(userId, email) {
    return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify JWT session token
 */
function verifySessionToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Create magic link token and store in database
 */
async function createMagicLinkToken(email, ipAddress, userAgent) {
    try {
        // Check if user exists
        const user = await db.oneOrNone('SELECT user_id, email FROM users WHERE email = $1', [email]);

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // Generate magic link token
        const token = generateToken();
        // Store expiry as UTC timestamp by converting to ISO string
        const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();

        console.log('Creating token with expiry:', expiresAt, 'Current time:', new Date().toISOString());

        // Store token in database
        await db.none(
            `INSERT INTO auth_tokens (user_id, token, token_type, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [user.user_id, token, 'magic_link', expiresAt, ipAddress, userAgent]
        );

        return { success: true, token, userId: user.user_id };
    } catch (error) {
        console.error('Error creating magic link token:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Verify magic link token and create session
 */
async function verifyMagicLinkToken(token, ipAddress, userAgent) {
    try {
        console.log('Verifying token:', token);
        console.log('Current time:', new Date().toISOString());

        // First check if token exists at all
        const tokenCheck = await db.oneOrNone(
            `SELECT at.expires_at, at.used_at, NOW() as current_time
             FROM auth_tokens at
             WHERE at.token = $1 AND at.token_type = 'magic_link'`,
            [token]
        );

        console.log('Token check result:', tokenCheck);

        // Find valid magic link token
        const authToken = await db.oneOrNone(
            `SELECT at.*, u.email, u.user_name
             FROM auth_tokens at
             JOIN users u ON at.user_id = u.user_id
             WHERE at.token = $1
             AND at.token_type = 'magic_link'
             AND at.expires_at > NOW()
             AND at.used_at IS NULL`,
            [token]
        );

        if (!authToken) {
            console.log('Token not found or invalid');
            // Log failed attempt
            await logLoginAttempt(null, 'magic_link', false, ipAddress, userAgent, 'Invalid or expired token');
            return { success: false, error: 'Invalid or expired magic link' };
        }

        // Mark token as used
        await db.none('UPDATE auth_tokens SET used_at = NOW() WHERE token = $1', [token]);

        // Update user's last login
        await db.none('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [authToken.user_id]);

        // Log successful login
        await logLoginAttempt(authToken.user_id, 'magic_link', true, ipAddress, userAgent);

        // Generate session token
        const sessionToken = generateSessionToken(authToken.user_id, authToken.email);
        const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        // Store session token
        await db.none(
            `INSERT INTO auth_tokens (user_id, token, token_type, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [authToken.user_id, sessionToken, 'session', sessionExpiresAt, ipAddress, userAgent]
        );

        return {
            success: true,
            sessionToken,
            user: {
                userId: authToken.user_id,
                email: authToken.email,
                username: authToken.user_name
            }
        };
    } catch (error) {
        console.error('Error verifying magic link token:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send magic link email
 */
async function sendMagicLinkEmail(email, token, baseUrl) {
    const magicLink = `${baseUrl}/login?token=${token}`;

    // In development without email configured, log to console
    if (!emailTransporter) {
        console.log('\n' + '='.repeat(80));
        console.log('MAGIC LINK (Development Mode)');
        console.log('='.repeat(80));
        console.log(`Email: ${email}`);
        console.log(`Magic Link: ${magicLink}`);
        console.log(`Token: ${token}`);
        console.log(`Expires in: ${MAGIC_LINK_EXPIRY_MINUTES} minutes`);
        console.log('='.repeat(80) + '\n');
        return { success: true };
    }

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@movetrack.app',
        to: email,
        subject: 'Your MoveTrack Login Link',
        html: `
            <h2>Login to MoveTrack</h2>
            <p>Click the link below to log in to your account. This link will expire in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.</p>
            <p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background-color: #FF865E; color: white; text-decoration: none; border-radius: 4px;">Log In to MoveTrack</a></p>
            <p>Or copy and paste this link into your browser:</p>
            <p>${magicLink}</p>
            <p>If you didn't request this login link, you can safely ignore this email.</p>
        `,
        text: `
Login to MoveTrack

Click the link below to log in to your account. This link will expire in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.

${magicLink}

If you didn't request this login link, you can safely ignore this email.
        `
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        return { success: true };
    } catch (error) {
        console.error('Error sending magic link email:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Log login attempt for security and analytics
 */
async function logLoginAttempt(userId, loginMethod, success, ipAddress, userAgent, failureReason = null) {
    // Skip logging if no userId (failed attempts without valid user)
    if (!userId) {
        return;
    }

    try {
        await db.none(
            `INSERT INTO login_history (user_id, login_method, success, ip_address, user_agent, failure_reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, loginMethod, success, ipAddress, userAgent, failureReason]
        );
    } catch (error) {
        console.error('Error logging login attempt:', error);
    }
}

/**
 * Logout user by invalidating session token
 */
async function logout(sessionToken) {
    try {
        // Mark session token as used (effectively invalidating it)
        await db.none(
            `UPDATE auth_tokens
             SET used_at = NOW()
             WHERE token = $1 AND token_type = 'session'`,
            [sessionToken]
        );
        return { success: true };
    } catch (error) {
        console.error('Error during logout:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user from session token
 */
async function getUserFromToken(sessionToken) {
    try {
        // Verify JWT
        const decoded = verifySessionToken(sessionToken);
        if (!decoded) {
            return null;
        }

        // Check if session token exists in database and is valid
        const authToken = await db.oneOrNone(
            `SELECT at.*, u.email, u.user_name, u.first_name, u.last_name
             FROM auth_tokens at
             JOIN users u ON at.user_id = u.user_id
             WHERE at.token = $1
             AND at.token_type = 'session'
             AND at.expires_at > NOW()
             AND at.used_at IS NULL`,
            [sessionToken]
        );

        if (!authToken) {
            return null;
        }

        return {
            userId: authToken.user_id,
            email: authToken.email,
            username: authToken.user_name,
            firstName: authToken.first_name,
            lastName: authToken.last_name
        };
    } catch (error) {
        console.error('Error getting user from token:', error);
        return null;
    }
}

module.exports = {
    generateToken,
    generateSessionToken,
    verifySessionToken,
    createMagicLinkToken,
    verifyMagicLinkToken,
    sendMagicLinkEmail,
    logLoginAttempt,
    logout,
    getUserFromToken
};
