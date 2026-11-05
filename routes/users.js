const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const userController = require("../controllers/userController");
const { locationLimiter, telegramVerifyLimiter } = require("../middleware/rateLimit");

router.get("/me", auth, userController.getProfile);

router.patch("/me", auth, userController.updateProfile);

router.post("/location", auth, locationLimiter, userController.resolveLocation);

router.post("/telegram/verify", auth, telegramVerifyLimiter, userController.verifyTelegramCode);

router.delete("/telegram/disconnect", auth, userController.disconnectTelegram);

module.exports = router;

