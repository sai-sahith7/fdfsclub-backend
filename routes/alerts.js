const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const alertController = require("../controllers/alertController");
const { alertCreateLimiter } = require("../middleware/rateLimit");

router.get("/", auth, alertController.getAlerts);

router.get("/:alertId", auth, alertController.getAlert);

router.post("/", auth, alertCreateLimiter, alertController.createAlert);

router.delete("/:alertId", auth, alertController.cancelAlert);

router.post("/:alertId/restore", auth, alertController.restoreAlert);

module.exports = router;
