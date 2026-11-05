const { slugify, buildMovieUrl } = require("../../utils/districtLink");

describe("slugify", () => {
  test("lowercases and hyphenates a movie title", () => {
    expect(slugify("Spider-Man: Brand New Day")).toBe("spider-man-brand-new-day");
  });

  test("drops punctuation instead of encoding it", () => {
    expect(slugify("Pushpa 2: The Rule (Telugu)")).toBe("pushpa-2-the-rule-telugu");
  });

  test("expands ampersands so they survive as words", () => {
    expect(slugify("Fast & Furious")).toBe("fast-and-furious");
  });

  test("collapses runs of separators and trims the edges", () => {
    expect(slugify("  ---Kalki   2898   AD!!  ")).toBe("kalki-2898-ad");
  });

  test("strips accents", () => {
    expect(slugify("Amélie")).toBe("amelie");
  });

  test("returns empty string for missing input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

describe("buildMovieUrl", () => {
  test("builds the URL District actually serves", () => {
    expect(
      buildMovieUrl({
        movieName: "Spider-Man: Brand New Day",
        contentId: 194537,
        citySlug: "hyderabad",
      })
    ).toBe(
      "https://www.district.in/movies/spider-man-brand-new-day-movie-tickets-in-hyderabad-MV194537"
    );
  });

  test("never produces the bare /movies/<id> form that 404s", () => {
    const url = buildMovieUrl({ movieName: "Alpha", contentId: 175697, citySlug: "mumbai" });
    expect(url).not.toBe("https://www.district.in/movies/175697");
    expect(url).toContain("-MV175697");
  });

  test("slugifies a city name when no slug is stored", () => {
    expect(
      buildMovieUrl({ movieName: "Alpha", contentId: 1, cityName: "Delhi NCR" })
    ).toBe("https://www.district.in/movies/alpha-movie-tickets-in-delhi-ncr-MV1");
  });

  test("prefers the stored slug over the display name", () => {
    expect(
      buildMovieUrl({
        movieName: "Alpha",
        contentId: 1,
        citySlug: "delhi-ncr",
        cityName: "Delhi & NCR",
      })
    ).toContain("-in-delhi-ncr-MV1");
  });

  test("accepts a string content id", () => {
    expect(buildMovieUrl({ movieName: "Alpha", contentId: "42", citySlug: "pune" })).toContain(
      "-MV42"
    );
  });

  test("falls back to a city-less movie link when the city is unknown", () => {
    expect(buildMovieUrl({ movieName: "Alpha", contentId: 7 })).toBe(
      "https://www.district.in/movies/alpha-movie-tickets-MV7"
    );
  });

  test("uses a placeholder slug when the title has no Latin letters", () => {
    expect(buildMovieUrl({ movieName: "காதல்", contentId: 7, citySlug: "pune" })).toBe(
      "https://www.district.in/movies/movie-movie-tickets-in-pune-MV7"
    );
  });

  test("falls back to the movies index for a non-positive content id", () => {
    expect(buildMovieUrl({ movieName: "Alpha", contentId: 0, citySlug: "pune" })).toBe("https://www.district.in/movies");
  });

  test("falls back to the movies index without a content id", () => {
    expect(buildMovieUrl({ movieName: "Alpha", citySlug: "pune" })).toBe(
      "https://www.district.in/movies"
    );
  });
});
