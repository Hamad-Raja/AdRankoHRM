'use strict';
const { z } = require('zod');
const { LOOPBACK } = require('../src/config/local-demo');
const ApiError = require('../src/utils/ApiError');
const { SESSION_COOKIE_NAME } = require('../src/config/auth');
const { requireTrustedOrigin } = require('../src/middleware/csrf');
const { loginLimiter } = require('../src/middleware/rateLimit');
const validate = require('../src/middleware/validate');

function createLocalDemoRouter({ config, prisma }) {
  const router = require('express').Router();
  router.post('/local-demo-login', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const enabled = config.production
      ? process.env.NODE_ENV === 'production' && process.env.OFFICEHR_PRODUCTION_DEMO_ENABLED === 'true'
      : process.env.NODE_ENV === 'development' && process.env.OFFICEHR_LOCAL_DEMO_ENABLED === 'true';
    if (!config.enabled || !enabled) {
      return next(new ApiError(404, 'Endpoint not found.', 'NOT_FOUND'));
    }
    let hostname;
    try { hostname = new URL('http://' + req.get('host')).hostname; } catch { /* rejected below */ }
    if (req.get('origin') !== config.origin || !config.production && (!LOOPBACK.has(req.socket.localAddress) || !LOOPBACK.has(req.socket.remoteAddress) || !LOOPBACK.has(hostname))) {
      return next(new ApiError(403, 'Demo login requires the configured trusted browser origin.', 'LOCAL_DEMO_ORIGIN_REQUIRED'));
    }
    return next();
  }, requireTrustedOrigin, loginLimiter, validate(z.strictObject({ role: z.enum(['HR', 'MANAGER', 'EMPLOYEE']) })), async (req, res, next) => {
    try {
      if (req.cookies?.[SESSION_COOKIE_NAME]) throw new ApiError(409, 'Sign out before choosing another demo account.', 'DEMO_LOGOUT_REQUIRED');
      req.validatedBody = await require('../src/services/local-demo.service').resolveDemoCredentials({ prisma, config, role: req.validatedBody.role });
      return require('../src/controllers/auth.controller').login(req, res, next);
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createLocalDemoRouter };
