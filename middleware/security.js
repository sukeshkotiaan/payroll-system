// ── Security middleware ────────────────────────────────────────────────────────

// HTTP security headers — applied globally in server.js
function securityHeaders(req, res, next) {
  // Prevent browsers from sniffing content types
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Block clickjacking (iframe embedding)
  res.setHeader('X-Frame-Options', 'DENY');
  // Basic XSS filter (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Prevent referrer leaking credentials
  res.setHeader('Referrer-Policy', 'same-origin');
  // Content Security Policy — tight policy for a server-rendered app
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",       // inline scripts used throughout
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",               // data: for base64 logos/photos
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'"
  ].join('; '));
  // Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Prevent caching of sensitive API responses
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

// Sanitize a string for safe use in a MongoDB $regex — escapes regex metacharacters
// to prevent ReDoS attacks via crafted search inputs
function sanitizeRegex(str) {
  if (!str || typeof str !== 'string') return '';
  // Escape all regex special characters
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

// Sanitize all string values in req.query and req.body to remove
// MongoDB operator injection attempts ($where, $gt, $regex etc.)
function noSQLSanitizer(req, res, next) {
  function sanitizeValue(val) {
    if (val && typeof val === 'object') {
      // Remove any key that starts with $ (MongoDB operator)
      for (const key of Object.keys(val)) {
        if (key.startsWith('$')) {
          delete val[key];
        } else {
          sanitizeValue(val[key]);
        }
      }
    }
    return val;
  }
  if (req.query)  sanitizeValue(req.query);
  if (req.body && typeof req.body === 'object') sanitizeValue(req.body);
  if (req.params) sanitizeValue(req.params);
  next();
}

// Management EIN filter — call this in any route where accountants
// must not see management employee data
// Returns a Mongoose filter fragment to add: { ein: { $not: /^MGT-/i } }
function mgtFilter(role) {
  if (role === 'admin' || role === 'management') return {};
  return { ein: { $not: /^MGT-/i } };
}

// Assert the requesting supervisor owns this employee — returns false if not
function supervisorOwns(sessionUser, employee) {
  if (sessionUser.role !== 'supervisor') return true; // non-supervisors skip this check
  return employee.supervisorId &&
    employee.supervisorId.toString() === sessionUser.id.toString();
}

// Generic safe error message — never expose internal details to clients
function safeError(err, context) {
  console.error(`[${context}]`, err.message, err.stack ? '\n' + err.stack : '');
  // In production, return a generic message; in dev, include the actual error
  if (process.env.NODE_ENV === 'production') {
    return 'An error occurred. Please try again or contact support.';
  }
  return err.message;
}

module.exports = { securityHeaders, sanitizeRegex, noSQLSanitizer, mgtFilter, supervisorOwns, safeError };
