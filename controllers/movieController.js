const Movie = require("../models/Movie");
const MovieFormat = require("../models/MovieFormat");
const MovieLanguage = require("../models/MovieLanguage");
const MovieDTO = require("../dtos/movie.dto");
const { sendSuccess, sendPaginatedSuccess, sendError, sendServerError } = require("../utils/response");
const { findActiveMovies } = require("../services/movieQueries");
const movieSearchService = require("../services/movieSearchService");
const movieCatalogService = require("../services/movieCatalogService");
const { fuzzySearchMovies } = require("../utils/fuzzySearch");
const { dedupeIgnoreCase } = require("../utils/normalize");

const TAG = "MovieController";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const getMovies = async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const page = Math.max(1, parseInt(req.query.page, 10) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

    const activeMovies = await findActiveMovies();

    const filtered = search ? fuzzySearchMovies(activeMovies, search) : activeMovies;
    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const enriched = paginated.map(movie => MovieDTO.toEnrichedMovieResponse(movie, null));
    sendPaginatedSuccess(res, enriched, total, page, limit);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const getAllFormats = async (req, res) => {
  try {
    const formats = await MovieFormat.find({}).sort({ format_name: 1 }).lean();
    const formatNames = dedupeIgnoreCase(formats.map(formatItem => formatItem.format_name));
    sendSuccess(res, formatNames);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const getAllLanguages = async (req, res) => {
  try {
    const languages = await MovieLanguage.find({}).sort({ language_name: 1 }).lean();
    const languageNames = dedupeIgnoreCase(languages.map(languageItem => languageItem.language_name));
    sendSuccess(res, languageNames);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const getMovieFormats = async (req, res) => {
  try {
    const movieId = Number(req.params.movieId);
    if (!Number.isFinite(movieId)) return sendError(res, "We couldn't find that movie.", 404);

    const movie = await Movie.findOne({ contentId: movieId });
    if (!movie) return sendError(res, "We couldn't find that movie.", 404);

    const cityName = typeof req.query.city_name === "string" ? req.query.city_name.trim() : "";
    const options = await movieCatalogService.resolveMovieFilterOptions(movie, cityName);

    sendSuccess(res, MovieDTO.toFormatsResponse(movie, options));
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

const refreshCityMovies = async (req, res) => {
  try {
    const { city_name, city_id, keyword } = req.body || {};

    if (keyword != null) {
      const term = typeof keyword === "string" ? keyword.trim() : "";
      if (term.length < 2 || term.length > 100) {
        return sendError(res, "Please type at least 2 characters of the movie name.", 400);
      }
      const result = await movieSearchService.performUniversalSearch(term, typeof city_name === "string" ? city_name : city_id);
      return sendSuccess(
        res,
        { movies_added: result.added },
        result.added > 0 ? "Search finished. Matching movies are now in the list." : "We couldn't find that movie yet. Try a different spelling."
      );
    }

    if (!city_name && !city_id) {
      return sendError(res, "Please pick a city first.", 400);
    }

    const result = await movieSearchService.refreshMoviesForCity(city_name, city_id);
    if (!result.success) {
      return sendSuccess(res, { last_sync: result.lastSync }, result.message);
    }

    sendSuccess(res, { city_name: result.city }, result.message);
  } catch (error) {
    sendServerError(res, error, TAG);
  }
};

module.exports = { getMovies, getAllFormats, getAllLanguages, getMovieFormats, refreshCityMovies };
