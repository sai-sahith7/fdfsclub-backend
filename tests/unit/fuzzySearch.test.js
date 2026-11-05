const { fuzzySearchMovies, fuzzySearchByName, createFuzzySearcher } = require("../../utils/fuzzySearch");

const SAMPLE_MOVIES = [
  { name: "Avatar", contentId: 1, extras: { genres: ["Sci-Fi", "Action"] } },
  { name: "Avengers: Endgame", contentId: 2, extras: { genres: ["Action", "Adventure"] } },
  { name: "The Dark Knight", contentId: 3, extras: { genres: ["Action", "Thriller"] } },
  { name: "Interstellar", contentId: 4, extras: { genres: ["Sci-Fi", "Drama"] } },
  { name: "Pushpa 2: The Rule", contentId: 5, extras: { genres: ["Action", "Drama"] } },
  { name: "RRR", contentId: 6, extras: { genres: ["Action", "Drama"] } },
  { name: "Kantara", contentId: 7, extras: { genres: ["Action", "Thriller"] } },
  { name: "Bahubali: The Beginning", contentId: 8, extras: { genres: ["Action", "Fantasy"] } },
];

describe("fuzzySearchMovies", () => {
  test("returns all movies when query is empty", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "");
    expect(results).toEqual(SAMPLE_MOVIES);
  });

  test("returns all movies when query is null", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, null);
    expect(results).toEqual(SAMPLE_MOVIES);
  });

  test("returns all movies when query is whitespace", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "   ");
    expect(results).toEqual(SAMPLE_MOVIES);
  });

  test("exact match returns the movie first", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Avatar");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Avatar");
  });

  test("handles typos: 'Avtar' matches 'Avatar'", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Avtar");
    const names = results.map((movie) => movie.name);
    expect(names).toContain("Avatar");
  });

  test("handles typos: 'Avengrs' matches 'Avengers: Endgame'", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Avengrs");
    const names = results.map((movie) => movie.name);
    expect(names).toContain("Avengers: Endgame");
  });

  test("partial match works: 'Dark' matches 'The Dark Knight'", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Dark");
    const names = results.map((movie) => movie.name);
    expect(names).toContain("The Dark Knight");
  });

  test("case insensitive matching", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "avatar");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Avatar");
  });

  test("non-matching query returns empty array", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "zzzzxxx");
    expect(results).toEqual([]);
  });

  test("handles transpositions: 'Intersetllar' still matches", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Intersetllar");
    const names = results.map((movie) => movie.name);
    expect(names).toContain("Interstellar");
  });

  test("handles Indian movie names with typos: 'Puhspa' matches 'Pushpa 2: The Rule'", () => {
    const results = fuzzySearchMovies(SAMPLE_MOVIES, "Puhspa");
    const names = results.map((movie) => movie.name);
    expect(names).toContain("Pushpa 2: The Rule");
  });
});

describe("fuzzySearchByName", () => {
  const venues = [
    { name: "PVR IMAX Forum Mall", _id: 1 },
    { name: "INOX Garuda Mall", _id: 2 },
    { name: "Cinepolis Royal Meenakshi", _id: 3 },
    { name: "Raj Theatre", _id: 4 },
  ];

  test("returns all items when query is empty", () => {
    const results = fuzzySearchByName(venues, "");
    expect(results).toEqual(venues);
  });

  test("fuzzy matches venue names with typos", () => {
    const results = fuzzySearchByName(venues, "Garud");
    const names = results.map((venue) => venue.name);
    expect(names).toContain("INOX Garuda Mall");
  });

  test("exact match returns first", () => {
    const results = fuzzySearchByName(venues, "Raj Theatre");
    expect(results[0].name).toBe("Raj Theatre");
  });

  test("non-matching returns empty", () => {
    const results = fuzzySearchByName(venues, "zzzzzzz");
    expect(results).toEqual([]);
  });
});

describe("createFuzzySearcher", () => {
  test("creates a searcher that can search custom keys", () => {
    const items = [
      { title: "Alpha", code: "A1" },
      { title: "Beta", code: "B2" },
      { title: "Gamma", code: "G3" },
    ];
    const searcher = createFuzzySearcher(items, [{ name: "title", weight: 1 }]);
    const results = searcher.search("Alph");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.title).toBe("Alpha");
  });
});
