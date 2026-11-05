const express = require("express");
const router = express.Router();
const passport = require("passport");
const { generateToken } = require("../utils/generateToken");
const { getFrontendBaseUrl } = require("../utils/appLinks");
const auth = require("../middleware/auth");
const authController = require("../controllers/authController");
const logger = require("../utils/logger");

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account",
  })
);

router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user) => {
    const frontend = getFrontendBaseUrl();
    if (err || !user) {
      if (err) logger.error("Auth", "Google sign-in failed", err.message);
      return res.redirect(`${frontend}/?auth_error=1`);
    }
    const token = generateToken(user);
    res.set("Cache-Control", "no-store");
    return res.redirect(`${frontend}/googleToken#token=${encodeURIComponent(token)}`);
  })(req, res, next);
});

router.get("/me", auth, authController.getMe);

router.post("/logout", auth, authController.logout);

module.exports = router;
