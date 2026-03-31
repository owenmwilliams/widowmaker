const authService = require('./authService');

/**
 * Middleware to verify JWT session token
 * Use this to protect routes that require authentication
 */
async function verifyToken(req, res, next) {
    try {
        const authHeader = req.get('authorization');
        console.log('[verifyToken] Checking auth for:', req.method, req.path);
        console.log('[verifyToken] Auth header present:', !!authHeader);

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('[verifyToken] Missing or invalid Authorization header');
            return res.status(401).json({ success: false, error: 'Authorization header required' });
        }

        const token = authHeader.substring(7);
        console.log('[verifyToken] Token length:', token.length);

        const user = await authService.getUserFromToken(token);
        console.log('[verifyToken] User from token:', user ? { user_id: user.user_id, email: user.email } : null);

        if (!user) {
            console.log('[verifyToken] getUserFromToken returned null');
            return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }

        // Attach user to request object for use in route handlers
        req.user = user;
        console.log('[verifyToken] User attached to request:', { user_id: req.user.user_id });
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
