const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const City = require("../../models/City");
const Movie = require("../../models/Movie");

jest.mock("../../clients/districtClient", () => ({
  getGroupedMovies: jest.fn(),
}));
const districtClient = require("../../clients/districtClient");

const syncMovies = require("../../services/syncMovies");
const { syncMoviesForCity } = require("../../services/syncMovies");

beforeAll(async () => await setupTestDB());
afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});
afterAll(async () => await teardownTestDB());

const MOCK_GROUPED_MOVIES = [
  {
    contentId: 100,
    name: "Test Movie",
    posterUrl: "https://example.com/poster.jpg",
    censor: "UA",
    duration: 142,
    genres: ["Action", "Thriller"],
    allScreenFormats: ["2D", "IMAX 2D"],
    bookingStatus: "NOW_SHOWING",
    releaseDate: "2024-07-25",
    languageGroups: [
      {
        language: "English",
        fmtGrpId: "fmt1",
        totalSessions: 10,
        screenFormats: [
          { movieCode: "mc1", screenFormat: "2D" },
          { movieCode: "mc2", screenFormat: "IMAX 2D" },
        ],
      },
      {
        language: "Hindi",
        fmtGrpId: "fmt2",
        totalSessions: 5,
        screenFormats: [{ movieCode: "mc3", screenFormat: "2D" }],
      },
    ],
  },
  {
    contentId: 200,
    name: "Another Movie",
    posterUrl: null,
    censor: "A",
    duration: 120,
    genres: ["Comedy"],
    allScreenFormats: ["2D"],
    bookingStatus: "COMING_SOON",
    releaseDate: "2024-08-01",
    languageGroups: [
      {
        language: "Telugu",
        fmtGrpId: "fmt3",
        totalSessions: 3,
        screenFormats: [{ movieCode: "mc4", screenFormat: "2D" }],
      },
    ],
  },
];

describe("syncMoviesForCity", () => {
  test("upserts movies and catalog entries for a city", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue(MOCK_GROUPED_MOVIES);

    const result = await syncMoviesForCity(city);

    expect(result.success).toBe(true);
    expect(result.movies).toBe(2);

    const movies = await Movie.find({});
    expect(movies.length).toBe(2);

    const movie1 = await Movie.findOne({ contentId: 100 });
    expect(movie1.name).toBe("Test Movie");
    expect(movie1.frmtids).toContain("fmt1");
    expect(movie1.frmtids).toContain("mc1");
    expect(movie1.frmtids).toContain("mc2");
    expect(movie1.extras.genres).toEqual(["Action", "Thriller"]);
    expect(movie1.booking_status).toBe("NOW_SHOWING");

    expect(movie1.last_seen_active_at).toBeInstanceOf(Date);
  });

  test("updates city last_movie_sync_at", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue(MOCK_GROUPED_MOVIES);

    await syncMoviesForCity(city);

    const updatedCity = await City.findById(1);
    expect(updatedCity.last_movie_sync_at).toBeInstanceOf(Date);
  });

  test("handles empty movies response", async () => {
    const city = await City.create({ _id: 1, name: "Empty City", slug: "empty" });
    districtClient.getGroupedMovies.mockResolvedValue([]);

    const result = await syncMoviesForCity(city);
    expect(result.success).toBe(true);
    expect(result.movies).toBe(0);
  });

  test("handles API failure", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockRejectedValue(new Error("API down"));

    const result = await syncMoviesForCity(city);
    expect(result.success).toBe(false);
    expect(result.error).toBe("API down");
  });

  test("updates existing movie data on re-sync", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });

    districtClient.getGroupedMovies.mockResolvedValue([{
      contentId: 100, name: "Old Name", posterUrl: null, censor: "U", duration: 100,
      genres: [], allScreenFormats: ["2D"], bookingStatus: "COMING_SOON", releaseDate: "2024-07-25",
      languageGroups: [{ language: "English", fmtGrpId: "f1", totalSessions: 1, screenFormats: [] }],
    }]);
    await syncMoviesForCity(city);

    districtClient.getGroupedMovies.mockResolvedValue([{
      contentId: 100, name: "New Name", posterUrl: "https://new.jpg", censor: "UA", duration: 142,
      genres: ["Action"], allScreenFormats: ["2D", "IMAX"], bookingStatus: "NOW_SHOWING",
      releaseDate: "2024-07-25",
      languageGroups: [{ language: "English", fmtGrpId: "f1", totalSessions: 5, screenFormats: [] }],
    }]);
    await syncMoviesForCity(city);

    const movies = await Movie.find({});
    expect(movies.length).toBe(1);
    expect(movies[0].name).toBe("New Name");
    expect(movies[0].booking_status).toBe("NOW_SHOWING");
  });
});

describe("syncMovies (all cities)", () => {
  test("iterates all active cities", async () => {
    await City.create({ _id: 1, name: "Active", slug: "active", is_active: true });
    await City.create({ _id: 2, name: "Inactive", slug: "inactive", is_active: false });

    districtClient.getGroupedMovies.mockResolvedValue([]);

    await syncMovies();

    expect(districtClient.getGroupedMovies).toHaveBeenCalledTimes(1);
  });
});

describe("syncMoviesForCity: filter catalogue", () => {
  const MovieFormat = require("../../models/MovieFormat");
  const MovieLanguage = require("../../models/MovieLanguage");

  test("stores the movie's own screen formats, not District movie codes", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue([MOCK_GROUPED_MOVIES[0]]);

    await syncMoviesForCity(city);

    const movie = await Movie.findOne({ contentId: 100 });
    expect(movie.extras.screen_formats.sort()).toEqual(["2D", "IMAX 2D"]);
    expect(movie.extras.screen_formats).not.toContain("mc1");
    expect(movie.extras.screen_formats).not.toContain("fmt1");
  });

  test("unions top-level formats with the per-language ones", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue([{
      ...MOCK_GROUPED_MOVIES[0],
      allScreenFormats: ["4DX-3D"],
      languageGroups: [{
        language: "Telugu",
        fmtGrpId: "fmt9",
        screenFormats: [{ movieCode: "mc9", screenFormat: "2D" }],
      }],
    }]);

    await syncMoviesForCity(city);

    const movie = await Movie.findOne({ contentId: 100 });
    expect(movie.extras.screen_formats.sort()).toEqual(["2D", "4DX-3D"]);
  });

  test("collapses casing duplicates before storing", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue([{
      ...MOCK_GROUPED_MOVIES[0],
      allScreenFormats: ["imax", "IMAX"],
      languageGroups: [
        { language: "Telugu", fmtGrpId: "a", screenFormats: [] },
        { language: "TELUGU", fmtGrpId: "b", screenFormats: [] },
      ],
    }]);

    await syncMoviesForCity(city);

    const movie = await Movie.findOne({ contentId: 100 });
    expect(movie.extras.screen_formats).toEqual(["IMAX"]);
    expect(movie.extras.language_variants).toEqual(["Telugu"]);
  });

  test("does not create duplicate catalogue rows for casing variants", async () => {
    const city = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    districtClient.getGroupedMovies.mockResolvedValue([{
      ...MOCK_GROUPED_MOVIES[0],
      allScreenFormats: ["imax", "IMAX"],
      languageGroups: [
        { language: "Telugu", fmtGrpId: "a", screenFormats: [] },
        { language: "telugu", fmtGrpId: "b", screenFormats: [] },
      ],
    }]);

    await syncMoviesForCity(city);

    expect(await MovieFormat.countDocuments({})).toBe(1);
    expect(await MovieLanguage.countDocuments({})).toBe(1);
  });
});

describe("syncMoviesForCity: multiple cities", () => {
  test("keeps other cities' formats and movieCodes when a second city syncs", async () => {
    const bengaluru = await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });
    const mysuru = await City.create({ _id: 2, name: "Mysuru", slug: "mysuru" });

    districtClient.getGroupedMovies.mockResolvedValueOnce([{
      ...MOCK_GROUPED_MOVIES[0],
      allScreenFormats: ["IMAX 2D"],
      languageGroups: [{ language: "English", fmtGrpId: "g1", screenFormats: [{ movieCode: "IMX1", screenFormat: "IMAX 2D" }] }],
    }]);
    await syncMoviesForCity(bengaluru);

    districtClient.getGroupedMovies.mockResolvedValueOnce([{
      ...MOCK_GROUPED_MOVIES[0],
      allScreenFormats: ["2D"],
      languageGroups: [{ language: "Kannada", fmtGrpId: "g2", screenFormats: [{ movieCode: "KN2D", screenFormat: "2D" }] }],
    }]);
    await syncMoviesForCity(mysuru);

    const movie = await Movie.findOne({ contentId: MOCK_GROUPED_MOVIES[0].contentId });
    expect(movie.extras.screen_formats.sort()).toEqual(["2D", "IMAX 2D"]);
    expect(movie.extras.language_variants.sort()).toEqual(["English", "Kannada"]);
    expect(movie.language_format_map.get("IMX1")).toBe("English");
    expect(movie.language_format_map.get("KN2D")).toBe("Kannada");
  });
});
