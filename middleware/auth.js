// Check if user is logged in
const isLoggedIn = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Please login first' });
};

// Check if user is admin or management
const isAdmin = (req, res, next) => {
  if (req.session && req.session.user &&
    (req.session.user.role === 'admin' || req.session.user.role === 'management')) {
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

module.exports = { isLoggedIn, isAdmin, hasRole };