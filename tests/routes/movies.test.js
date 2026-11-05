const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Movie = require("../../models/Movie");
const City = require("../../models/City");
const MovieFormat = require("../../models/MovieFormat");
const MovieLanguage = require("../../models/MovieLanguage");

jest.mock("../../middleware/auth", () => {
  return (req, res, next) => {
    req.user = { email: "test@example.com" };
    next();
  };
});

jest.mock("../../clients/districtClient", () => ({
  getGroupedMovies: jest.fn().mockResolvedValue([]),
}));
const districtClient = require("../../clients/districtClient");

const movieRoutes = require("../../routes/movies");

let app;

beforeAll(async () => {
  await setupTestDB();
  app = express();
  app.use(bodyParser.json());
  app.use("/api/movies", movieRoutes);
});
afterEach(async () => { await clearTestDB(); jest.clearAllMocks(); });
afterAll(async () => await teardownTestDB());

describe("GET /api/movies: pagination", () => {
  beforeEach(async () => {
    const now = new Date();
    for (let i = 1; i <= 35; i++) {
      await Movie.create({
        contentId: i,
        name: `Movie ${String(i).padStart(2, "0")}`,
        last_seen_active_at: now,
      });
    }
  });

  test("returns paginated response shape by default", async () => {
    const res = await request(app).get("/api/movies");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(35);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.data.length).toBe(20);
  });

  test("returns page 2 with remaining items", async () => {
    const res = await request(app).get("/api/movies?page=2&limit=20");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(15);
    expect(res.body.pagination.page).toBe(2);
  });

  test("respects custom limit", async () => {
    const res = await request(app).get("/api/movies?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
    expect(res.body.pagination.totalPages).toBe(7);
  });

  test("caps limit at MAX_LIMIT (100)", async () => {
    const res = await request(app).get("/api/movies?limit=200");
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  test("defaults to page 1 if invalid page given", async () => {
    const res = await request(app).get("/api/movies?page=-1");
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });
});

describe("GET /api/movies: fuzzy search", () => {
  beforeEach(async () => {
    const now = new Date();
    await Movie.create([
      { contentId: 100, name: "Avatar", last_seen_active_at: now },
      { contentId: 101, name: "Avengers: Endgame", last_seen_active_at: now },
      { contentId: 102, name: "The Dark Knight", last_seen_active_at: now },
      { contentId: 103, name: "Interstellar", last_seen_active_at: now },
      { contentId: 104, name: "Pushpa 2: The Rule", last_seen_active_at: now },
    ]);
  });

  test("search with exact name returns the movie", async () => {
    const res = await request(app).get("/api/movies?search=Avatar");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].name).toBe("Avatar");
  });

  test("search with typo returns fuzzy match: 'Avtar' finds 'Avatar'", async () => {
    const res = await request(app).get("/api/movies?search=Avtar");
    expect(res.status).toBe(200);
    const names = res.body.data.map((movie) => movie.name);
    expect(names).toContain("Avatar");
  });

  test("search with partial name works: 'Dark' finds 'The Dark Knight'", async () => {
    const res = await request(app).get("/api/movies?search=Dark");
    expect(res.status).toBe(200);
    const names = res.body.data.map((movie) => movie.name);
    expect(names).toContain("The Dark Knight");
  });

  test("search with no results returns empty with pagination", async () => {
    const res = await request(app).get("/api/movies?search=zzzzxxx");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
    expect(res.body.pagination.total).toBe(0);
  });

  test("search combined with pagination works", async () => {
    const res = await request(app).get("/api/movies?search=Av&limit=1&page=1");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  test("empty search returns all active movies paginated", async () => {
    const res = await request(app).get("/api/movies?search=");
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5);
  });
});

describe("GET /api/movies/:movieId/formats", () => {
  test("returns aggregated formats and languages", async () => {
    await Movie.create({
      contentId: 100,
      name: "Test Movie",
      frmtids: ["f1", "f3"],
      extras: { language_variants: ["English", "Hindi"], screen_formats: ["2D", "IMAX 3D"] },
    });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.status).toBe(200);
    expect(res.body.data.frmtids).toContain("f1");
    expect(res.body.data.frmtids).toContain("f3");
    expect(res.body.data.languages).toContain("English");
    expect(res.body.data.languages).toContain("Hindi");
    expect(res.body.data.format_names).toEqual(["2D", "IMAX 3D"]);
  });

  test("returns only this movie's formats, never the whole catalogue", async () => {
    await MovieFormat.create([{ _id: 1, format_name: "4DX" }, { _id: 2, format_name: "IMAX 3D" }]);
    await MovieLanguage.create([{ language_name: "Tamil" }, { language_name: "English" }]);

    await Movie.create({
      contentId: 100,
      name: "Only 2D English",
      extras: { language_variants: ["English"], screen_formats: ["2D"] },
    });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.status).toBe(200);
    expect(res.body.data.format_names).toEqual(["2D"]);
    expect(res.body.data.format_names).not.toContain("4DX");
    expect(res.body.data.languages).toEqual(["English"]);
    expect(res.body.data.languages).not.toContain("Tamil");
  });

  test("never exposes District movie codes as format names", async () => {
    await Movie.create({
      contentId: 100,
      name: "Test Movie",
      frmtids: ["OBALAG", "rrfdpndypd"],
      extras: { screen_formats: ["3D"] },
    });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.body.data.format_names).toEqual(["3D"]);
  });

  test("collapses casing duplicates in formats and languages", async () => {
    await Movie.create({
      contentId: 100,
      name: "Test Movie",
      extras: {
        language_variants: ["Telugu", "TELUGU", "telugu", "Hindi"],
        screen_formats: ["IMAX", "imax", "2D"],
      },
    });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.body.data.languages).toEqual(["Telugu", "Hindi"]);
    expect(res.body.data.format_names).toEqual(["IMAX", "2D"]);
  });

  test("returns the release date so the date picker can start there", async () => {
    await Movie.create({ contentId: 100, name: "Test Movie", release_date: "2026-08-14" });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.body.data.release_date).toBe("2026-08-14");
  });

  test("returns empty option lists for a movie with no catalogue data", async () => {
    await Movie.create({ contentId: 100, name: "Bare Movie" });

    const res = await request(app).get("/api/movies/100/formats");
    expect(res.status).toBe(200);
    expect(res.body.data.format_names).toEqual([]);
    expect(res.body.data.languages).toEqual([]);
  });

  test("returns 404 for non-existent movie", async () => {
    const res = await request(app).get("/api/movies/999/formats");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/movies/:movieId/formats: movies catalogued before screen formats existed", () => {
  beforeEach(async () => {
    await City.create({ _id: 1, name: "Hyderabad", slug: "hyderabad" });
    await Movie.create({
      contentId: 194537,
      name: "Spider-Man: Brand New Day",
      extras: { language_variants: ["English", "Telugu"] },
    });
    districtClient.getGroupedMovies.mockResolvedValue([
      {
        contentId: 194537,
        name: "Spider-Man: Brand New Day",
        allScreenFormats: ["3D", "2D", "4DX-3D"],
        languageGroups: [
          { language: "English", fmtGrpId: "a", screenFormats: [{ movieCode: "OBALAG", screenFormat: "4DX-3D" }] },
        ],
      },
    ]);
  });

  test("still returns format options for the movie", async () => {
    const res = await request(app)
      .get("/api/movies/194537/formats")
      .query({ city_name: "Hyderabad" });

    expect(res.status).toBe(200);
    expect(res.body.data.format_names.sort()).toEqual(["2D", "3D", "4DX-3D"]);
    expect(res.body.data.languages).toEqual(["English", "Telugu"]);
  });

  test("caches the result so repeat requests skip District", async () => {
    await request(app).get("/api/movies/194537/formats").query({ city_name: "Hyderabad" });
    await request(app).get("/api/movies/194537/formats").query({ city_name: "Hyderabad" });

    expect(districtClient.getGroupedMovies).toHaveBeenCalledTimes(1);
  });

  test("returns no format options when no city is given and nothing is cached", async () => {
    const res = await request(app).get("/api/movies/194537/formats");

    expect(res.status).toBe(200);
    expect(res.body.data.format_names).toEqual([]);
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("still answers when District is unreachable", async () => {
    districtClient.getGroupedMovies.mockRejectedValue(new Error("API down"));

    const res = await request(app)
      .get("/api/movies/194537/formats")
      .query({ city_name: "Hyderabad" });

    expect(res.status).toBe(200);
    expect(res.body.data.languages).toEqual(["English", "Telugu"]);
  });
});

describe("GET /api/movies/formats and /languages", () => {
  test("collapses catalogue entries that differ only by case", async () => {
    await MovieFormat.create([
      { _id: 1, format_name: "IMAX" },
      { _id: 2, format_name: "imax" },
      { _id: 3, format_name: "2D" },
    ]);
    await MovieLanguage.create([
      { language_name: "Telugu" },
      { language_name: "TELUGU" },
      { language_name: "Hindi" },
    ]);

    const formats = await request(app).get("/api/movies/formats");
    expect(formats.status).toBe(200);
    expect(formats.body.data).toEqual(["2D", "IMAX"]);

    const languages = await request(app).get("/api/movies/languages");
    expect(languages.status).toBe(200);
    expect(languages.body.data).toEqual(["Hindi", "Telugu"]);
  });
});

describe("GET /api/movies: filter metadata", () => {
  test("exposes deduped per-movie screen formats and languages", async () => {
    await Movie.create({
      contentId: 100,
      name: "Test Movie",
      last_seen_active_at: new Date(),
      extras: {
        language_variants: ["English", "ENGLISH"],
        screen_formats: ["2D", "2d", "IMAX 3D"],
      },
    });

    const res = await request(app).get("/api/movies");
    expect(res.status).toBe(200);
    expect(res.body.data[0].languages).toEqual(["English"]);
    expect(res.body.data[0].screen_formats).toEqual(["2D", "IMAX 3D"]);
  });

  test("exposes the release date for the date picker", async () => {
    await Movie.create({
      contentId: 100,
      name: "Test Movie",
      release_date: "2026-08-14",
      last_seen_active_at: new Date(),
    });

    const res = await request(app).get("/api/movies");
    expect(res.body.data[0].release_date).toBe("2026-08-14");
  });
});

describe("POST /api/movies/refresh", () => {
  test("triggers sync for a city using city_name", async () => {
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });

    const res = await request(app).post("/api/movies/refresh").send({ city_name: "Bengaluru" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("refreshing the movie list");
    expect((await City.findById(1)).movie_sync_requested_at).toBeInstanceOf(Date);
    expect(districtClient.getGroupedMovies).not.toHaveBeenCalled();
  });

  test("triggers sync for a city using city_id", async () => {
    await City.create({ _id: 1, name: "Bengaluru", slug: "bengaluru" });

    const res = await request(app).post("/api/movies/refresh").send({ city_id: 1 });
    expect(res.status).toBe(200);
    expect((await City.findById(1)).movie_sync_requested_at).toBeInstanceOf(Date);
  });

  test("returns 400 without city_name or city_id", async () => {
    const res = await request(app).post("/api/movies/refresh").send({});
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent city", async () => {
    const res = await request(app).post("/api/movies/refresh").send({ city_name: "Nonexistent" });
    expect(res.status).toBe(404);
  });

  test("rate-limits when recently synced", async () => {
    await City.create({ _id: 1, name: "Test", slug: "test", last_movie_sync_at: new Date() });

    const res = await request(app).post("/api/movies/refresh").send({ city_name: "Test" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("already up to date");
    expect((await City.findById(1)).movie_sync_requested_at).toBeNull();
  });
});
