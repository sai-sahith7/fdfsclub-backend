const { sortByReleaseProximity } = require("../../services/movieQueries");

const NOW = new Date("2026-10-19T06:00:00Z").getTime();

describe("sortByReleaseProximity", () => {
  it("orders movies by how many days their release is from today, either side", () => {
    const movies = [
      { name: "A", release_date: "2026-09-01" },
      { name: "B", release_date: "2026-10-21" },
      { name: "C", release_date: "2026-10-16" },
      { name: "D", release_date: "2026-10-19" },
      { name: "E", release_date: "2026-11-30" },
    ];
    expect(sortByReleaseProximity(movies, NOW).map((m) => m.name)).toEqual(["D", "B", "C", "E", "A"]);
  });

  it("puts the upcoming movie first when two are equally far away", () => {
    const movies = [
      { name: "Past", release_date: "2026-10-16" },
      { name: "Upcoming", release_date: "2026-10-22" },
    ];
    expect(sortByReleaseProximity(movies, NOW).map((m) => m.name)).toEqual(["Upcoming", "Past"]);
  });

  it("keeps movies without a usable release date at the end in their original order", () => {
    const movies = [
      { name: "Alpha", release_date: null },
      { name: "Beta", release_date: "2026-10-25" },
      { name: "Gamma", release_date: "coming soon" },
    ];
    expect(sortByReleaseProximity(movies, NOW).map((m) => m.name)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("uses the India date for today", () => {
    const lateNightIst = new Date("2026-10-19T19:00:00Z").getTime();
    const movies = [
      { name: "Today", release_date: "2026-10-19" },
      { name: "Tomorrow", release_date: "2026-10-20" },
    ];
    expect(sortByReleaseProximity(movies, lateNightIst).map((m) => m.name)).toEqual(["Tomorrow", "Today"]);
  });
});
