/**
 * Restricts a route to authenticated users with one of the supplied roles.
 *
 * @param {...string} roles Roles allowed to call the route.
 * @returns {import('express').RequestHandler} Express authorization middleware.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth?.user?.role;

    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
