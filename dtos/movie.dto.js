const { dedupeIgnoreCase } = require("../utils/normalize");

class MovieDTO {
  constructor(movie) {
    this.contentId = movie.contentId;
    this.name = movie.name;
    this.image_url = movie.image_url || null;
    this.runtime_minutes = movie.runtime_minutes || null;
    this.censor = movie.censor || null;
    this.frmtids = movie.frmtids || [];
    this.release_date = movie.release_date || null;
    this.booking_status = movie.booking_status || null;
  }

  static toResponse(movie) {
    if (!movie) return null;
    return new MovieDTO(movie);
  }

  static toEnrichedMovieResponse(movie, catalog) {
    if (!movie) return null;
    return {
      contentId: movie.contentId,
      name: movie.name,
      image_url: movie.image_url || null,
      runtime_minutes: movie.runtime_minutes || null,
      censor: movie.censor || null,
      frmtids: catalog?.frmtids || movie.frmtids || [],
      languages: dedupeIgnoreCase(catalog?.languages || movie.extras?.language_variants || []),
      screen_formats: dedupeIgnoreCase(catalog?.screen_formats || movie.extras?.screen_formats || []),
      genres: movie.extras?.genres || [],
      release_date: movie.release_date || null,
      booking_status: movie.booking_status || null,
    };
  }

  static toCollectionEnrichedResponse(movies, catalogMap) {
    if (!movies) return [];
    return movies.map((movie) => {
      const catalog = catalogMap.get(movie.contentId);
      return MovieDTO.toEnrichedMovieResponse(movie, catalog);
    });
  }

  static toFormatsResponse(movie, options = {}) {
    return {
      movie_id: movie.contentId,
      movie_name: movie.name,
      release_date: movie.release_date || null,
      frmtids: movie.frmtids || [],
      languages: dedupeIgnoreCase(options.languages || movie.extras?.language_variants || []),
      format_names: dedupeIgnoreCase(options.formats || movie.extras?.screen_formats || []),
    };
  }
}

module.exports = MovieDTO;
