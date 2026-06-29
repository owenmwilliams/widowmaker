const authService = require('./authService');

/**
 * Middleware to verify JWT session token
 * Use this to protect routes that require authentication
 */
async function verifyToken(req, res, next) {
    try {
        // Already authenticated upstream (global requireAuth gate) — don't re-verify.
        if (req.user) {
            return next();
        }

        const authHeader = req.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authorization header required' });
        }

        const token = authHeader.substring(7);
        const user = await authService.getUserFromToken(token);

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }

        // Attach user to request object for use in route handlers
        req.user = user;
        next();
    } catch (error) {
        console.error('[verifyToken] Error in JWT middleware:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * Optional authentication middleware
 * Attaches user to request if token is valid, but doesn't block if invalid
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.get('authorization');

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const user = await authService.getUserFromToken(token);

            if (user) {
                req.user = user;
            }
        }

        next();
    } catch (error) {
        console.error('Error in optional auth middleware:', error);
        next();
    }
}

module.exports = {
    verifyToken,
    optionalAuth
};
