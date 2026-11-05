const Movie = require("../models/Movie");
const { parseIsoDate, toIsoDate } = require("../utils/dateOptions");

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 30;

const LIST_PROJECTION = "contentId name image_url runtime_minutes censor frmtids release_date booking_status extras.genres extras.language_variants extras.screen_formats requested_by_user last_seen_active_at";

async function findActiveMovies({ now = Date.now() } = {}) {
  const windowStart = new Date(now - ACTIVE_WINDOW_DAYS * DAY_MS);
  const movies = await Movie.find({
    $or: [
      { requested_by_user: true },
      { last_seen_active_at: { $gt: windowStart } },
      { release_date: { $nin: [null, ""] } },
    ],
  })
    .select(LIST_PROJECTION)
    .sort({ name: 1 })
    .lean();

  const active = movies.filter((movie) => {
    if (!(movie.contentId > 0)) return false;
    if (movie.requested_by_user) return true;
    if (movie.last_seen_active_at && movie.last_seen_active_at > windowStart) return true;
    const releaseDate = movie.release_date ? new Date(movie.release_date) : null;
    return Boolean(releaseDate && !isNaN(releaseDate.getTime()) && releaseDate > windowStart);
  });

  return sortByReleaseProximity(active, now);
}

function sortByReleaseProximity(movies, now = Date.now()) {
  const today = parseIsoDate(toIsoDate(new Date(now)));
  const daysAway = (movie) => {
    const release = parseIsoDate(movie.release_date);
    return release ? Math.round((release - today) / DAY_MS) : null;
  };

  return movies
    .map((movie) => ({ movie, days: daysAway(movie) }))
    .sort((a, b) => {
      if (a.days === null || b.days === null) return (a.days === null) - (b.days === null);
      return Math.abs(a.days) - Math.abs(b.days) || b.days - a.days;
    })
    .map(({ movie }) => movie);
}

module.exports = { findActiveMovies, sortByReleaseProximity, LIST_PROJECTION };
