const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Movie = require("../../models/Movie");
const City = require("../../models/City");

jest.mock("../../clients/districtClient", () => ({ getGroupedMovies: jest.fn() }));
const districtClient = require("../../clients/districtClient");

const {
  resolveMovieFilterOptions,
  extractScreenFormats,
  extractLanguages,
} = require("../../services/movieCatalogService");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDB());

const DISTRICT_MOVIE = {
  contentId: 194537,
  name: "Spider-Man: Brand New Day",
  allScreenFormats: ["3D", "2D", "4DX-3D"],
  languageGroups: [
    { language: "English", fmtGrpId: "a", screenFormats: [{ movieCode: "OBALAG", screenFormat: "4DX-3D" }] },
    { language: "Telugu", fmtGrpId: "b", screenFormats: [{ movieCode: "OB8RLR", screenFormat: "2D" }] },
  ],
};

describe("extractScreenFormats", () => {
  test("unions the top-level formats with the per-language ones", () => {
    expect(extractScreenFormats(DISTRICT_MOVIE).sort()).toEqual(["2D", "3D", "4DX-3D"]);
  });

  test("never returns District movie codes", () => {
    const formats = extractScreenFormats(DISTRICT_MOVIE);
    expect(formats).not.toContain("OBALAG");
    expect(formats).not.toContain("a");
  });

  test("collapses casing duplicates", () => {
    expect(extractScreenFormats({ allScreenFormats: ["imax", "IMAX", "2D"] })).toEqual(["IMAX", "2D"]);
  });

  test("returns an empty list for a movie with no format data", () => {
    expect(extractScreenFormats({})).toEqual([]);
  });
});

describe("extractLanguages", () => {
  test("reads languages off the language groups", () => {
    expect(extractLanguages(DISTRICT_MOVIE)).toEqual(["English", "Telugu"]);
  });

  test("collapses casing duplicates", () => {
    expect(extractLanguages({
      languageGroups: [{ language: "Telugu" }, { language: "TELUGU" }],
    })).toEqual(["Telugu"]);
  });
});

describe("resolveMovieFilterOptions", () => {
  test("uses the cached formats without calling District", async () => {
    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English"], screen_formats: ["2D", "IMAX 3D"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Hyderabad");

    expect(options.formats).toEqual(["2D", "IMAX 3D"]);
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("resolves from District when nothing is cached: the reported bug", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);

    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English", "Telugu"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Hyderabad");

    expect(options.formats.sort()).toEqual(["2D", "3D", "4DX-3D"]);
    expect(options.languages).toEqual(["English", "Telugu"]);
    expect(districtClient.getGroupedMovies).toHaveBeenCalledWith("Hyderabad");
  });

  test("persists what it resolved so the next call is a cache hit", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    const movie = await Movie.create({ contentId: 194537, name: "Spider-Man" });

    await resolveMovieFilterOptions(movie, "Hyderabad");

    const stored = await Movie.findOne({ contentId: 194537 }).lean();
    expect(stored.extras.screen_formats.sort()).toEqual(["2D", "3D", "4DX-3D"]);

    await resolveMovieFilterOptions(stored, "Hyderabad");
    expect(districtClient.getGroupedMovies).toHaveBeenCalledTimes(1);
  });

  test("backfills every movie in the city, not just the one asked for", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([
      DISTRICT_MOVIE,
      { contentId: 200, name: "Other", allScreenFormats: ["2D"], languageGroups: [] },
    ]);
    await Movie.create([
      { contentId: 194537, name: "Spider-Man" },
      { contentId: 200, name: "Other" },
    ]);

    await resolveMovieFilterOptions(await Movie.findOne({ contentId: 194537 }), "Hyderabad");

    const other = await Movie.findOne({ contentId: 200 }).lean();
    expect(other.extras.screen_formats).toEqual(["2D"]);
  });

  test("accepts a city slug as well as a name", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    const movie = await Movie.create({ contentId: 194537, name: "Spider-Man" });

    const options = await resolveMovieFilterOptions(movie, "hyderabad");

    expect(options.formats.length).toBeGreaterThan(0);
    expect(districtClient.getGroupedMovies).toHaveBeenCalledWith("Hyderabad");
  });

  test("offers no formats for a movie that is not playing in the chosen city", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    const movie = await Movie.create({
      contentId: 999,
      name: "Playing Elsewhere",
      extras: { language_variants: ["Marathi"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Hyderabad");

    expect(options.formats).toEqual([]);
    expect(options.languages).toEqual(["Marathi"]);
  });

  test("returns cached values untouched when no city is supplied", async () => {
    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English"] },
    });

    const options = await resolveMovieFilterOptions(movie, "");

    expect(options).toEqual({ formats: [], languages: ["English"] });
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("falls back to cached values when the city is unknown", async () => {
    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Atlantis");

    expect(options.languages).toEqual(["English"]);
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("degrades gracefully when District is down", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockRejectedValue(new Error("API down"));
    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Hyderabad");

    expect(options).toEqual({ formats: [], languages: ["English"] });
  });

  test("offers every language the movie has anywhere, not just the requested city's", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    const movie = await Movie.create({
      contentId: 194537,
      name: "Spider-Man",
      extras: { language_variants: ["English", "Telugu", "Hindi"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Hyderabad");

    expect(options.languages).toEqual(["English", "Telugu", "Hindi"]);
  });

  test("The Paradise: every city's languages and formats are offered in every city", async () => {
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    const movie = await Movie.create({
      contentId: 185027,
      name: "The Paradise",
      extras: { language_variants: ["Tamil", "Telugu", "Hindi"], screen_formats: ["2D", "4DX-2D"] },
    });

    const options = await resolveMovieFilterOptions(movie, "Bengaluru");

    expect(options).toEqual({ languages: ["Tamil", "Telugu", "Hindi"], formats: ["2D", "4DX-2D"] });
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("the backfill adds to what other cities recorded instead of replacing it", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    await Movie.create({ contentId: 194537, name: "Spider-Man", extras: { language_variants: ["Hindi"] } });

    const first = await resolveMovieFilterOptions(await Movie.findOne({ contentId: 194537 }), "Hyderabad");
    const stored = await Movie.findOne({ contentId: 194537 });
    const again = await resolveMovieFilterOptions(stored, "Hyderabad");

    expect(first.languages).toEqual(["Hindi", "English", "Telugu"]);
    expect(stored.extras.language_variants).toEqual(["Hindi", "English", "Telugu"]);
    expect(again).toEqual(first);
    expect(districtClient.getGroupedMovies).toHaveBeenCalledTimes(1);
  });

  test("the backfill also records the city's movieCodes so scans can tell each show's language", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    districtClient.getGroupedMovies.mockResolvedValue([DISTRICT_MOVIE]);
    await Movie.create({ contentId: 194537, name: "Spider-Man", language_format_map: { OLD1: "Tamil" } });

    await resolveMovieFilterOptions(await Movie.findOne({ contentId: 194537 }), "Hyderabad");

    const movie = await Movie.findOne({ contentId: 194537 });
    expect(Object.fromEntries(movie.language_format_map)).toEqual({ OLD1: "Tamil", OBALAG: "English", OB8RLR: "Telugu" });
  });

  test("a synced city that doesn't list the movie falls back to every city's options without calling District", async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad", movie_options_synced_at: new Date() });
    const movie = await Movie.create({
      contentId: 5,
      name: "Found via search",
      extras: { language_variants: ["Hindi"], screen_formats: ["2D"] },
    });

    expect(await resolveMovieFilterOptions(movie, "Hyderabad")).toEqual({ languages: ["Hindi"], formats: ["2D"] });
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });
});
