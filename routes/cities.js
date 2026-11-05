const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const cityController = require("../controllers/cityController");
const { venueRefreshLimiter } = require("../middleware/rateLimit");

router.get("/", cityController.getCities);

router.get("/:cityId/venues", cityController.getCityVenues);

router.post("/:cityId/venues/refresh", auth, venueRefreshLimiter, cityController.refreshCityVenues);

module.exports = router;
