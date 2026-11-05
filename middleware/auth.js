const passport = require("passport");
const { sendError } = require("../utils/response");

const authMiddleware = (req, res, next) => {
  passport.authenticate("jwt", { session: false }, (err, user) => {
    if (err) return next(err);
    if (!user) {
      return sendError(res, "Please sign in to continue.", 401, "UNAUTHORIZED");
    }
    req.user = user;
    next();
  })(req, res, next);
};

module.exports = authMiddleware;
