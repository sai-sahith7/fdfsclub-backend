const Fuse = require("fuse.js");

const DEFAULT_OPTIONS = {
  threshold: 0.4,
  distance: 100,
  minMatchCharLength: 2,
  includeScore: true,
  shouldSort: true,
};

const createFuzzySearcher = (items, keys, customOptions = {}) => {
  const options = { ...DEFAULT_OPTIONS, keys, ...customOptions };
  return new Fuse(items, options);
};

const fuzzySearchMovies = (movies, query) => {
  if (!query || !query.trim()) return movies;

  const searcher = createFuzzySearcher(movies, [
    { name: "name", weight: 2 },
    { name: "extras.genres", weight: 0.5 },
  ]);

  return searcher.search(query.trim()).map((result) => result.item);
};

const fuzzySearchByName = (items, query) => {
  if (!query || !query.trim()) return items;

  const searcher = createFuzzySearcher(items, [{ name: "name", weight: 1 }]);
  return searcher.search(query.trim()).map((result) => result.item);
};

module.exports = {
  createFuzzySearcher,
  fuzzySearchMovies,
  fuzzySearchByName,
};
