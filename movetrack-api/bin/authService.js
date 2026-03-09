const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const knexLib = require('knex');

const adminEmailList = (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const proEmailList = (process.env.PRO_USERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
if (!adminEmailList.includes('owen@we3kings.dev')) {
    adminEmailList.push('owen@we3kings.dev');
}

const knex = knexLib({
    client: 'pg',
    connection: {
        host: process.env.MT_DATALAYER_HOSTNAME,
        port: process.env.MT_DATALAYER_PORT,
        user: process.env.MT_DATALAYER_USERNAME,
        password: process.env.MT_DATALAYER_PASSWORD,
        database: process.env.MT_DATALAYER_DATABASE
    }
});

const planTableReady = ensurePlanStatusTable();
let onboardingColumnPromise = null;
const hasOnboardingColumn = async () => {
    if (!onboardingColumnPromise) {
        onboardingColumnPromise = knex.schema.hasColumn('users', 'onboarding_completed').catch(() => false);
    }
    return onboardingColumnPromise;
};

// --- Configuration Guards ----------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production';

const jwtSecretFromEnv = process.env.JWT_SECRET;

if (!jwtSecretFromEnv) {
    if (isProduction) {
        throw new Error('[authService] Missing required environment variable: JWT_SECRET');
    } else {
        console.warn('[authService] JWT_SECRET not set. Using development fallback. DO NOT USE IN PRODUCTION.');
    }
}

if (jwtSecretFromEnv === 'your-secret-key-change-in-production') {
    if (isProduction) {
        throw new Error('[authService] JWT_SECRET must be set to a non-default, secure value.');
    } else {
        console.warn('[authService] Using placeholder JWT_SECRET. Please update .env with a secure value.');
    }
}

// JWT secret - guaranteed to exist thanks to guard above
const JWT_SECRET = jwtSecretFromEnv || 'development-secret-key';
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
 * Hash a token using SHA-256 before storing in database
 * This ensures that even if the database is compromised, the tokens cannot be used
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
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
        // Normalize email to lowercase for consistency
        const normalizedEmail = email.toLowerCase().trim();

        // Check if user exists, create if not
        let user = await db.oneOrNone('SELECT user_id, email FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

        if (!user) {
            // Create new user
            console.log('Creating new user for email:', normalizedEmail);
            user = await db.one(
                `INSERT INTO users (email, created_at, last_login_at)
                 VALUES ($1, NOW(), NOW())
                 RETURNING user_id, email`,
                [normalizedEmail]
            );
            console.log('New user created:', user.user_id);
        } else {
            console.log('Existing user found for email:', normalizedEmail, '- sending new magic link');
        }

        // Generate magic link token
        const token = generateToken();
        const hashedToken = hashToken(token); // Hash token before storing

        // Store expiry as UTC timestamp by converting to ISO string
        const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();

        // Store HASHED token in database (security: db breach won't expose active tokens)
        await db.none(
            `INSERT INTO auth_tokens (user_id, token, token_type, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [user.user_id, hashedToken, 'magic_link', expiresAt, ipAddress, userAgent]
        );

        // Return the UNHASHED token to send via email (only time it exists in plaintext)
        return { success: true, token, userId: user.user_id };
    } catch (error) {
        console.error('Error creating magic link token:', error);
        return { success: false, error: 'Unable to create login link. Please try again.' };
    }
}

/**
 * Verify magic link token and create session
 */
async function verifyMagicLinkToken(token, ipAddress, userAgent) {
    try {
        // Hash the token to compare against database (tokens are stored hashed)
        const hashedToken = hashToken(token);

        // First check if token exists at all
        const tokenCheck = await db.oneOrNone(
            `SELECT at.expires_at, at.used_at, NOW() as current_time
             FROM auth_tokens at
             WHERE at.token = $1 AND at.token_type = 'magic_link'`,
            [hashedToken]
        );

        // Find valid magic link token
        const hasOnboarding = await hasOnboardingColumn();
        const onboardingSelect = hasOnboarding ? ', u.onboarding_completed' : ', NULL::boolean AS onboarding_completed';
        const authToken = await db.oneOrNone(
            `SELECT at.*, u.email, u.first_name, u.last_name${onboardingSelect}, u.email_verified_at
             FROM auth_tokens at
             JOIN users u ON at.user_id = u.user_id
             WHERE at.token = $1
             AND at.token_type = 'magic_link'
             AND at.expires_at > NOW()
             AND at.used_at IS NULL`,
            [hashedToken]
        );

        if (!authToken) {
            console.log('Token not found or invalid');
            // Log failed attempt
            await logLoginAttempt(null, 'magic_link', false, ipAddress, userAgent, 'Invalid or expired token');
            return { success: false, error: 'Invalid or expired magic link' };
        }

        // Mark token as used
        await db.none('UPDATE auth_tokens SET used_at = NOW() WHERE token = $1', [hashedToken]);

        // Update user's last login
        await db.none('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [authToken.user_id]);

        // Mark email as verified on first login (prevents typo attacks)
        await db.none(
            'UPDATE users SET email_verified_at = NOW() WHERE user_id = $1 AND email_verified_at IS NULL',
            [authToken.user_id]
        );

        // Log successful login
        await logLoginAttempt(authToken.user_id, 'magic_link', true, ipAddress, userAgent);

        // Generate session token (JWT)
        const sessionToken = generateSessionToken(authToken.user_id, authToken.email);
        const hashedSessionToken = hashToken(sessionToken); // Hash session token before storing
        const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        // Store HASHED session token (JWTs are also hashed for defense-in-depth)
        await db.none(
            `INSERT INTO auth_tokens (user_id, token, token_type, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [authToken.user_id, hashedSessionToken, 'session', sessionExpiresAt, ipAddress, userAgent]
        );

        const flags = await getPlanForEmail(authToken.email);

        return {
            success: true,
            session_token: sessionToken,
            user: {
                user_id: authToken.user_id,
                email: authToken.email,
                first_name: authToken.first_name,
                last_name: authToken.last_name,
                onboarding_completed: !!authToken.onboarding_completed,
                email_verified: !!authToken.email_verified_at,
                plan: flags.plan,
                is_admin: flags.is_admin
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

    // Always log to console (useful for development and debugging)
    console.log('\n' + '='.repeat(80));
    console.log('MAGIC LINK');
    console.log('='.repeat(80));
    console.log(`Email: ${email}`);
    console.log(`Magic Link: ${magicLink}`);
    const maskedToken = `${token.slice(0, 4)}…${token.slice(-4)}`;
    console.log(`Magic link generated for ${email} (token ${maskedToken})`);
    console.log(`Expires in: ${MAGIC_LINK_EXPIRY_MINUTES} minutes`);
    console.log('='.repeat(80) + '\n');

    // If no email transporter, just log and return success
    if (!emailTransporter) {
        console.log('No email transporter configured - magic link logged above');
        return { success: true };
    }

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
        to: email,
        subject: 'Your Nexus Moves Login Link',
        html: `
            <h2>Login to Nexus Moves</h2>
            <p>Click the link below to log in to your account. This link will expire in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.</p>
            <p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background-color: #FF865E; color: white; text-decoration: none; border-radius: 4px;">Log In to Nexus Moves</a></p>
            <p>Or copy and paste this link into your browser:</p>
            <p>${magicLink}</p>
            <p>If you didn't request this login link, you can safely ignore this email.</p>
        `,
        text: `
Login to Nexus Moves

Click the link below to log in to your account. This link will expire in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.

${magicLink}

If you didn't request this login link, you can safely ignore this email.
        `
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        console.log('Magic link email sent successfully via SendGrid');
        return { success: true };
    } catch (error) {
        console.error('Error sending magic link email:', error);
        // Don't fail - the link is still in the logs and valid
        console.log('Email failed but magic link is still valid (see above)');
        return { success: true }; // Changed from false to true
    }
}

/**
 * Send Nexus Moves booking confirmation email with inventory PDF
 */
async function sendReloprepConfirmationEmail(userEmail, bookingData, pdfBuffer = null) {
    const {
        depositAmount,
        totalAmount,
        remainingBalance,
        origin,
        destination,
        moveDate,
        userName
    } = bookingData;

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
        to: userEmail,
        subject: 'Your Nexus Moves booking is confirmed!',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #1976D2 0%, #1ca1c1 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .detail-box { background: white; padding: 20px; margin: 15px 0; border-left: 4px solid #1976D2; }
                    .price { font-size: 24px; font-weight: bold; color: #1976D2; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd; font-size: 12px; color: #666; }
                    .button { display: inline-block; padding: 12px 30px; background-color: #1976D2; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎉 Your Move is Confirmed!</h1>
                        <p>Thank you for choosing Nexus Moves</p>
                    </div>
                    <div class="content">
                        <h2>Hi${userName ? ' ' + userName : ''}! 👋</h2>
                        <p>Great news! We've received your deposit and your move is now confirmed. We're finding the perfect vetted mover for your relocation.</p>

                        <div class="detail-box">
                            <h3>📍 Move Details</h3>
                            <p><strong>From:</strong> ${origin}</p>
                            <p><strong>To:</strong> ${destination}</p>
                            <p><strong>Move Date:</strong> ${moveDate}</p>
                        </div>

                        <div class="detail-box">
                            <h3>💰 Payment Summary</h3>
                            <p><strong>Total Move Cost:</strong> <span class="price">$${totalAmount.toLocaleString()}</span></p>
                            <p><strong>Deposit Paid (15%):</strong> $${depositAmount.toLocaleString()}</p>
                            <p><strong>Remaining Balance:</strong> $${remainingBalance.toLocaleString()}</p>
                            <p style="font-size: 12px; color: #666; margin-top: 10px;">
                                The remaining balance will be paid directly to your matched moving partner on move day.
                            </p>
                        </div>

                        <div class="detail-box">
                            <h3>📦 Your Inventory PDF</h3>
                            <p>We've attached your complete inventory PDF to this email. This is what we'll share with your matched mover to ensure an accurate quote.</p>
                            <p><strong>⚠️ Important:</strong> Please review your inventory carefully. If anything has changed (added items, removed items, or access conditions), please notify us ASAP at <a href="mailto:support@we3kings.dev">support@we3kings.dev</a></p>
                        </div>

                        <div class="detail-box">
                            <h3>🚚 What Happens Next?</h3>
                            <ol>
                                <li>We're matching you with a vetted, licensed moving partner</li>
                                <li>You'll receive an introduction to your mover within 24-48 hours</li>
                                <li>Your mover will confirm the final details and schedule</li>
                                <li>On move day, you'll pay the remaining balance directly to the mover</li>
                            </ol>
                        </div>

                        <p style="text-align: center; margin-top: 30px;">
                            <a href="mailto:support@we3kings.dev" class="button">Contact Support</a>
                        </p>

                        <div class="footer">
                            <p><strong>Price Guarantee:</strong> This price is guaranteed based on the inventory in your PDF and the access conditions you described. Changes to inventory or access may result in additional charges from the moving partner.</p>
                            <p>Questions? Email us at <a href="mailto:support@we3kings.dev">support@we3kings.dev</a></p>
                            <p style="color: #999; margin-top: 20px;">© ${new Date().getFullYear()} Nexus Moves. All rights reserved.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
Your Nexus Moves booking is confirmed!

Hi${userName ? ' ' + userName : ''}!

Great news! We've received your deposit and your move is now confirmed. We're finding the perfect vetted mover for your relocation.

MOVE DETAILS
From: ${origin}
To: ${destination}
Move Date: ${moveDate}

PAYMENT SUMMARY
Total Move Cost: $${totalAmount.toLocaleString()}
Deposit Paid (15%): $${depositAmount.toLocaleString()}
Remaining Balance: $${remainingBalance.toLocaleString()}

The remaining balance will be paid directly to your matched moving partner on move day.

YOUR INVENTORY PDF
We've attached your complete inventory PDF to this email. This is what we'll share with your matched mover to ensure an accurate quote.

IMPORTANT: Please review your inventory carefully. If anything has changed (added items, removed items, or access conditions), please notify us ASAP at support@we3kings.dev

WHAT HAPPENS NEXT?
1. We're matching you with a vetted, licensed moving partner
2. You'll receive an introduction to your mover within 24-48 hours
3. Your mover will confirm the final details and schedule
4. On move day, you'll pay the remaining balance directly to the mover

Price Guarantee: This price is guaranteed based on the inventory in your PDF and the access conditions you described. Changes to inventory or access may result in additional charges from the moving partner.

Questions? Email us at support@we3kings.dev

© ${new Date().getFullYear()} Nexus Moves. All rights reserved.
        `
    };

    // Attach PDF if provided
    if (pdfBuffer) {
        mailOptions.attachments = [{
            filename: 'move-inventory.pdf',
            content: pdfBuffer,
            contentType: 'application/pdf'
        }];
    }

    try {
        if (emailTransporter) {
            await emailTransporter.sendMail(mailOptions);
            console.log('Nexus Moves confirmation email sent successfully to:', userEmail);
            return { success: true };
        } else {
            console.log('No email transporter configured - would have sent confirmation to:', userEmail);
            console.log('Booking data:', bookingData);
            return { success: true, warning: 'Email not configured' };
        }
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        // Don't fail the booking just because email failed
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
        // Hash the session token to find it in database (tokens are stored hashed)
        const hashedSessionToken = hashToken(sessionToken);

        // Mark session token as used (effectively invalidating it)
        await db.none(
            `UPDATE auth_tokens
             SET used_at = NOW()
             WHERE token = $1 AND token_type = 'session'`,
            [hashedSessionToken]
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
        console.log('[getUserFromToken] Verifying JWT...');
        // Verify JWT (this checks signature and expiration)
        const decoded = verifySessionToken(sessionToken);
        console.log('[getUserFromToken] JWT decoded:', decoded ? { userId: decoded.userId, email: decoded.email } : null);
        if (!decoded) {
            console.log('[getUserFromToken] JWT verification failed');
            return null;
        }

        // JWT is valid, now fetch user from database
        // We trust the JWT since it's cryptographically signed
        const hasOnboarding = await hasOnboardingColumn();
        const onboardingSelect = hasOnboarding ? ', onboarding_completed' : ', NULL::boolean AS onboarding_completed';

        console.log('[getUserFromToken] Fetching user from database by userId:', decoded.userId);
        // user_id is UUID type
        const user = await db.oneOrNone(
            `SELECT user_id, email, first_name, last_name, email_verified_at${onboardingSelect}
             FROM users
             WHERE user_id = $1::uuid`,
            [decoded.userId]
        );

        console.log('[getUserFromToken] User from database:', user ? { user_id: user.user_id, email: user.email } : null);

        if (!user) {
            console.log('[getUserFromToken] User not found in database');
            return null;
        }

        const flags = await getPlanForEmail(user.email);

        return {
            user_id: user.user_id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            onboarding_completed: !!user.onboarding_completed,
            email_verified: !!user.email_verified_at,
            plan: flags.plan,
            is_admin: flags.is_admin
        };
    } catch (error) {
        console.error('Error getting user from token:', error);
        return null;
    }
}

/**
 * Express middleware to authenticate requests using Bearer token
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized - No token provided' });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        const user = await getUserFromToken(token);

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized - Invalid token' });
        }

        // Attach user info to request object
        req.user = {
            user_id: user.user_id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            plan: user.plan,
            is_admin: user.is_admin
        };

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({ error: 'Unauthorized - Authentication failed' });
    }
}

async function getPlanForEmail(email) {
    const normalized = (email || '').toLowerCase();
    const is_admin = adminEmailList.includes(normalized);
    let plan = 'basic';

    if (normalized) {
        const record = await getPlanRecord(normalized);
        if (record) {
            if (record.plan_source === 'move_pack' && record.plan_expires_at && new Date(record.plan_expires_at) < new Date()) {
                await setUserPlanStatus(normalized, {
                    plan_tier: 'basic',
                    plan_source: 'basic',
                    plan_status: 'expired',
                    plan_expires_at: null
                });
            } else if (record.plan_tier) {
                plan = record.plan_tier;
            }
        }
    }

    const is_pro_env = proEmailList.includes(normalized);
    if (is_pro_env || is_admin) {
        plan = 'pro';
    }
    return { plan, is_admin };
}

function resolveEffectivePlan(req) {
    const basePlan = req.user?.plan || 'basic';
    if (req.user?.is_admin) {
        const override = req.headers['x-plan-preview'];
        if (override && ['basic', 'pro'].includes(String(override).toLowerCase())) {
            return String(override).toLowerCase();
        }
    }
    return basePlan;
}

function requireProOrAdmin(req, res, next) {
    const effectivePlan = resolveEffectivePlan(req);
    if (req.user?.is_admin) {
        req.user.effective_plan = effectivePlan;
        return next();
    }
    if (effectivePlan !== 'pro') {
        return res.status(402).json({ error: 'Upgrade to Pro to access this feature.' });
    }
    req.user.effective_plan = effectivePlan;
    next();
}

async function ensurePlanStatusTable() {
    try {
        const exists = await knex.schema.hasTable('user_plans');
        if (!exists) {
            await knex.schema.createTable('user_plans', (table) => {
                table.increments('id').primary();
                table.string('user_email').notNullable().unique();
                table.string('plan_tier').notNullable().defaultTo('basic');
                table.string('plan_source').notNullable().defaultTo('basic');
                table.string('plan_status').notNullable().defaultTo('basic');
                table.timestamp('plan_expires_at', { useTz: true }).nullable();
                table.string('stripe_customer_id').nullable();
                table.string('stripe_subscription_id').nullable();
                table.timestamps(true, true);
            });
        }
    } catch (error) {
        console.error('Failed to ensure user_plans table:', error);
    }
}

async function getPlanRecord(email) {
    const normalized = (email || '').toLowerCase();
    if (!normalized) return null;
    await planTableReady;
    return knex('user_plans').where({ user_email: normalized }).first();
}

async function upsertPlanRecord(email, data) {
    const normalized = (email || '').toLowerCase();
    if (!normalized) return;
    await planTableReady;
    await knex('user_plans')
        .insert({
            user_email: normalized,
            ...data,
            updated_at: knex.fn.now()
        })
        .onConflict('user_email')
        .merge({
            ...data,
            updated_at: knex.fn.now()
        });
}

async function setUserPlanStatus(email, data) {
    const normalized = (email || '').toLowerCase();
    if (!normalized) return;
    const payload = {
        plan_tier: data.plan_tier || 'basic',
        plan_source: data.plan_source || data.plan_tier || 'basic',
        plan_status: data.plan_status || 'active',
        plan_expires_at: data.plan_expires_at || null,
        stripe_customer_id: data.stripe_customer_id || null,
        stripe_subscription_id: data.stripe_subscription_id || null
    };
    await upsertPlanRecord(normalized, payload);
}

module.exports = {
    generateToken,
    generateSessionToken,
    verifySessionToken,
    createMagicLinkToken,
    verifyMagicLinkToken,
    sendMagicLinkEmail,
    sendReloprepConfirmationEmail,
    logLoginAttempt,
    logout,
    getUserFromToken,
    authenticate,
    getPlanForEmail,
    requireProOrAdmin,
    resolveEffectivePlan,
    getPlanRecord,
    upsertPlanRecord,
    setUserPlanStatus
};
