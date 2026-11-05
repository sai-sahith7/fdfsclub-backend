const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const movieController = require("../controllers/movieController");
const { movieSearchLimiter } = require("../middleware/rateLimit");

router.get("/", movieController.getMovies);

router.get("/formats", movieController.getAllFormats);

router.get("/languages", movieController.getAllLanguages);

router.get("/:movieId/formats", movieController.getMovieFormats);

router.post("/refresh", auth, movieSearchLimiter, movieController.refreshCityMovies);

module.exports = router;
