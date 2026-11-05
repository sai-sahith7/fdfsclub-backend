const BASE_URL = "https://www.district.in";

function slugify(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMovieUrl({ movieName, contentId, citySlug, cityName }) {
  const movieSlug = slugify(movieName);
  const city = slugify(citySlug || cityName);

  if (!(Number(contentId) > 0)) return `${BASE_URL}/movies`;
  const slug = movieSlug || "movie";
  if (!city) return `${BASE_URL}/movies/${slug}-movie-tickets-MV${contentId}`;

  return `${BASE_URL}/movies/${slug}-movie-tickets-in-${city}-MV${contentId}`;
}

module.exports = { slugify, buildMovieUrl, BASE_URL };
