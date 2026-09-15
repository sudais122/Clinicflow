
import rateLimit from "express-rate-limit";

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
const RELAXED_MULTIPLIER = 1000;

function effectiveMax(max) {
  return RATE_LIMIT_ENABLED ? max : max * RELAXED_MULTIPLIER;
}

function rateLimitHandler(req, res) {
  res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
  });
}

function makeIpLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max: effectiveMax(max),
    standardHeaders: true, 
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator: (req) => req.ip,
  });
}

function makeUserLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max: effectiveMax(max),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator: (req) => (req.user?._id ? String(req.user._id) : req.ip),
  });
}

/* ---------- Authentication ---------- */
export const loginLimiter = makeIpLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
export const registerLimiter = makeIpLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
export const forgotPasswordLimiter = makeIpLimiter({ windowMs: 15 * 60 * 1000, max: 3 });
export const otpLimiter = makeIpLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
export const refreshTokenLimiter = makeIpLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const logoutLimiter = makeUserLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

/* ---------- Appointments ---------- */
export const appointmentBookLimiter = makeUserLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const appointmentCancelLimiter = makeUserLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const appointmentStatusLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 30 });

/* ---------- Queue ---------- */
export const queueLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 60 });

/* ---------- Clinic open/close ---------- */
export const clinicLimiter = makeUserLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

/* ---------- Dashboard / Analytics ---------- */
export const dashboardLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 60 });

/* ---------- General-purpose ---------- */
export const normalGetLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 100 });
export const normalWriteLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 30 });

/* ---------- Admin ---------- */
export const adminLimiter = makeUserLimiter({ windowMs: 60 * 1000, max: 60 });

/* ---------- Global fallback ---------- */
export const globalLimiter = makeIpLimiter({ windowMs: 60 * 1000, max: 200 });