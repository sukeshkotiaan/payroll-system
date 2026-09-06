// Check if user is logged in
const isLoggedIn = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Please login first' });
};

// Check if user is admin or management (operational approver level)
const isAdmin = (req, res, next) => {
  if (req.session && req.session.user &&
    (req.session.user.role === 'admin' || req.session.user.role === 'management')) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied' });
};

// Check if user is system admin only (for destructive or privileged operations)
const isSystemAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied — system administrator only' });
};

// Check if user is admin, management, or accountant (financial data entry)
const isAccountantOrAdmin = (req, res, next) => {
  const role = req.session && req.session.user && req.session.user.role;
  if (role === 'admin' || role === 'management' || role === 'accountant') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied' });
};

// Check role
const hasRole = (...roles) => {
  return (req, res, next) => {
    if (req.session && req.session.user && roles.includes(req.session.user.role)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied' });
  };
};

module.exports = { isLoggedIn, isAdmin, isSystemAdmin, isAccountantOrAdmin, hasRole };