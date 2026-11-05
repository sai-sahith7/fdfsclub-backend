const matchAlert = require("../../services/matchAlert");
const { parseShowTimeToMinutes, getMinAreaPrice } = require("../../services/matchAlert");

function makeSession(overrides = {}) {
  return {
    sessionId: "sess-1",
    providerId: 100,
    cinemaId: 500,
    movieCode: "m1",
    showTime: "2024-07-25T09:00:00",
    closeTime: "2024-07-25T17:00:00",
    screen: "Screen 1",
    screenFormat: "2D",
    language: "English",
    available: 50,
    total: 200,
    statusColor: "G",
    areas: [
      { label: "Executive", code: "EX", available: 30, total: 100, price: 250, statusColor: "G" },
      { label: "Premium", code: "PR", available: 20, total: 100, price: 400, statusColor: "G" },
    ],
    tags: [],
    ...overrides,
  };
}

function makeCinema(overrides = {}) {
  return {
    cinemaId: 500,
    name: "PVR Cinemas",
    address: "123 Main St",
    providerId: 100,
    latitude: 12.97,
    longitude: 77.59,
    distanceKm: 2.5,
    sessions: [makeSession()],
    ...overrides,
  };
}

function makeAlert(overrides = {}) {
  return {
    _id: "alert-1",
    filters: {},
    venues: [],
    ...overrides,
  };
}

describe("parseShowTimeToMinutes", () => {
  test("parses ISO datetime format", () => {
    expect(parseShowTimeToMinutes("2024-07-25T09:00:00")).toBe(870);
  });

  test("parses time-only format", () => {
    expect(parseShowTimeToMinutes("09:15")).toBe(555);
  });

  test("parses midnight", () => {
    expect(parseShowTimeToMinutes("00:00:00")).toBe(0);
  });

  test("parses end of day", () => {
    expect(parseShowTimeToMinutes("23:59:00")).toBe(1439);
  });

  test("returns null for null input", () => {
    expect(parseShowTimeToMinutes(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseShowTimeToMinutes("")).toBeNull();
  });

  test("returns null for garbage input", () => {
    expect(parseShowTimeToMinutes("not-a-time")).toBeNull();
  });
});

describe("getMinAreaPrice", () => {
  test("returns minimum price from areas", () => {
    const session = makeSession();
    expect(getMinAreaPrice(session)).toBe(250);
  });

  test("returns null for empty areas", () => {
    expect(getMinAreaPrice({ areas: [] })).toBeNull();
  });

  test("returns null for no areas key", () => {
    expect(getMinAreaPrice({})).toBeNull();
  });

  test("ignores zero prices", () => {
    const session = makeSession({
      areas: [
        { price: 0 },
        { price: 300 },
      ],
    });
    expect(getMinAreaPrice(session)).toBe(300);
  });

  test("ignores negative prices", () => {
    const session = makeSession({
      areas: [
        { price: -100 },
        { price: 200 },
      ],
    });
    expect(getMinAreaPrice(session)).toBe(200);
  });

  test("returns single price when only one area", () => {
    const session = makeSession({
      areas: [{ price: 500 }],
    });
    expect(getMinAreaPrice(session)).toBe(500);
  });
});

describe("matchAlert", () => {

  describe("no filters", () => {
    test("matches the first available session", () => {
      const alert = makeAlert();
      const cinemas = [makeCinema()];
      const result = matchAlert(alert, cinemas);

      expect(result).not.toEqual([]);
      expect(result[0].cinema.name).toBe("PVR Cinemas");
      expect(result[0].session.sessionId).toBe("sess-1");
    });

    test("returns null for empty cinemas array", () => {
      const alert = makeAlert();
      expect(matchAlert(alert, [])).toEqual([]);
    });

    test("returns null for cinemas with no sessions", () => {
      const alert = makeAlert();
      const cinema = makeCinema({ sessions: [] });
      expect(matchAlert(alert, [cinema])).toEqual([]);
    });
  });

  describe("venue filter", () => {
    test("matches only the specified venue", () => {
      const alert = makeAlert({ venues: [{ id: 600 }] });
      const cinemas = [
        makeCinema({ cinemaId: 500, name: "PVR" }),
        makeCinema({ cinemaId: 600, name: "Cinepolis" }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].cinema.name).toBe("Cinepolis");
    });

    test("matches any of multiple specified venues (OR logic)", () => {
      const alert = makeAlert({ venues: [{ id: 500 }, { id: 700 }] });
      const cinemas = [
        makeCinema({ cinemaId: 500, name: "PVR" }),
        makeCinema({ cinemaId: 600, name: "Cinepolis" }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].cinema.name).toBe("PVR");
    });

    test("returns null when none of the venues are in cinemas list", () => {
      const alert = makeAlert({ venues: [{ id: 999 }, { id: 888 }] });
      const cinemas = [makeCinema({ cinemaId: 500 })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("matches any cinema when venues is empty array", () => {
      const alert = makeAlert({ venues: [] });
      const cinemas = [makeCinema()];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("matches any cinema when venues is undefined", () => {
      const alert = makeAlert({ venues: undefined });
      const cinemas = [makeCinema()];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });
  });

  describe("format filter", () => {
    test("matches session with matching format", () => {
      const alert = makeAlert({ filters: { formats: ["IMAX 2D"] } });
      const cinemas = [
        makeCinema({
          sessions: [
            makeSession({ screenFormat: "2D", sessionId: "s1" }),
            makeSession({ screenFormat: "IMAX 2D", sessionId: "s2" }),
          ],
        }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].session.sessionId).toBe("s2");
    });

    test("format matching is case-insensitive", () => {
      const alert = makeAlert({ filters: { formats: ["imax 2d"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ screenFormat: "IMAX 2D" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("returns null when no format matches", () => {
      const alert = makeAlert({ filters: { formats: ["4DX"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ screenFormat: "2D" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("matches any of multiple specified formats", () => {
      const alert = makeAlert({ filters: { formats: ["4DX", "IMAX 2D", "70mm"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ screenFormat: "IMAX 2D" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("empty formats array matches all", () => {
      const alert = makeAlert({ filters: { formats: [] } });
      const cinemas = [makeCinema()];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });
  });

  describe("language filter", () => {
    test("matches session with matching language", () => {
      const alert = makeAlert({ filters: { languages: ["Hindi"] } });
      const cinemas = [
        makeCinema({
          sessions: [
            makeSession({ language: "English", sessionId: "s1" }),
            makeSession({ language: "Hindi", sessionId: "s2" }),
          ],
        }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].session.sessionId).toBe("s2");
    });

    test("language matching is case-insensitive", () => {
      const alert = makeAlert({ filters: { languages: ["english"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ language: "English" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("returns null when no language matches", () => {
      const alert = makeAlert({ filters: { languages: ["Tamil"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ language: "English" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("empty languages array matches all", () => {
      const alert = makeAlert({ filters: { languages: [] } });
      const cinemas = [makeCinema()];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("handles missing language on session", () => {
      const alert = makeAlert({ filters: { languages: ["English"] } });
      const cinemas = [makeCinema({ sessions: [makeSession({ language: "" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });
  });

  describe("time filter", () => {
    test("matches session within time range", () => {
      const alert = makeAlert({ filters: { show_time_min: 720, show_time_max: 960 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("rejects session before min time", () => {
      const alert = makeAlert({ filters: { show_time_min: 960 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("rejects session after max time", () => {
      const alert = makeAlert({ filters: { show_time_max: 720 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("only min time set: no upper bound", () => {
      const alert = makeAlert({ filters: { show_time_min: 600 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T17:30:00" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("only max time set: no lower bound", () => {
      const alert = makeAlert({ filters: { show_time_max: 720 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T03:30:00" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("exact boundary: min equals showtime", () => {
      const alert = makeAlert({ filters: { show_time_min: 870 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("exact boundary: max equals showtime", () => {
      const alert = makeAlert({ filters: { show_time_max: 870 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("skips session with unparseable showtime", () => {
      const alert = makeAlert({ filters: { show_time_min: 0 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ showTime: "invalid" })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });
  });

  describe("price filter", () => {
    test("matches session within price range", () => {
      const alert = makeAlert({ filters: { price_min: 200, price_max: 300 } });
      const cinemas = [makeCinema({ sessions: [makeSession()] })];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("rejects session below min price", () => {
      const alert = makeAlert({ filters: { price_min: 300 } });
      const cinemas = [
        makeCinema({
          sessions: [makeSession({ areas: [{ price: 200 }] })],
        }),
      ];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("rejects session above max price", () => {
      const alert = makeAlert({ filters: { price_max: 150 } });
      const cinemas = [
        makeCinema({
          sessions: [makeSession({ areas: [{ price: 200 }] })],
        }),
      ];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("only price_min set", () => {
      const alert = makeAlert({ filters: { price_min: 100 } });
      const cinemas = [makeCinema()];

      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("skips session with no price info", () => {
      const alert = makeAlert({ filters: { price_min: 100 } });
      const cinemas = [makeCinema({ sessions: [makeSession({ areas: [] })] })];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });
  });

  describe("availability filter", () => {
    test("matches GREEN status (available)", () => {
      const cinemas = [makeCinema({ sessions: [makeSession({ statusColor: "G" })] })];
      expect(matchAlert(makeAlert(), cinemas)).not.toEqual([]);
    });

    test("matches YELLOW status (filling fast)", () => {
      const cinemas = [makeCinema({ sessions: [makeSession({ statusColor: "Y" })] })];
      expect(matchAlert(makeAlert(), cinemas)).not.toEqual([]);
    });

    test("rejects RED status (sold out)", () => {
      const cinemas = [makeCinema({ sessions: [makeSession({ statusColor: "R" })] })];
      expect(matchAlert(makeAlert(), cinemas)).toEqual([]);
    });

    test("matches unknown status color", () => {
      const cinemas = [makeCinema({ sessions: [makeSession({ statusColor: "X" })] })];
      expect(matchAlert(makeAlert(), cinemas)).not.toEqual([]);
    });

    test("matches empty status color", () => {
      const cinemas = [makeCinema({ sessions: [makeSession({ statusColor: "" })] })];
      expect(matchAlert(makeAlert(), cinemas)).not.toEqual([]);
    });
  });

  describe("combined filters", () => {
    test("all filters applied together: match found", () => {
      const alert = makeAlert({
        venues: [{ id: 500 }],
        filters: {
          formats: ["2D"],
          languages: ["English"],
          show_time_min: 720,
          show_time_max: 960,
          price_min: 200,
          price_max: 300,
        },
      });
      const cinemas = [
        makeCinema({
          cinemaId: 500,
          sessions: [makeSession({ showTime: "2024-07-25T09:00:00" })],
        }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
    });

    test("all filters applied: one filter fails", () => {
      const alert = makeAlert({
        venues: [{ id: 500 }],
        filters: {
          formats: ["IMAX 3D"],
          languages: ["English"],
          show_time_min: 720,
          show_time_max: 960,
        },
      });
      const cinemas = [
        makeCinema({
          cinemaId: 500,
          sessions: [makeSession({ screenFormat: "2D" })],
        }),
      ];

      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("first match wins across multiple cinemas", () => {
      const alert = makeAlert({ filters: { formats: ["2D"] } });
      const cinemas = [
        makeCinema({
          cinemaId: 500,
          name: "Cinema A",
          sessions: [makeSession({ statusColor: "R" })],
        }),
        makeCinema({
          cinemaId: 600,
          name: "Cinema B",
          sessions: [makeSession({ statusColor: "G", sessionId: "winner" })],
        }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].cinema.name).toBe("Cinema B");
      expect(result[0].session.sessionId).toBe("winner");
    });

    test("first match wins across multiple sessions in same cinema", () => {
      const alert = makeAlert({ filters: { languages: ["Hindi"] } });
      const cinemas = [
        makeCinema({
          sessions: [
            makeSession({ language: "English", sessionId: "s1" }),
            makeSession({ language: "Hindi", sessionId: "s2" }),
            makeSession({ language: "Hindi", sessionId: "s3" }),
          ],
        }),
      ];

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].session.sessionId).toBe("s2");
    });
  });

  describe("edge cases", () => {
    test("alert with null filters", () => {
      const alert = { _id: "a1", filters: null, venues: [] };
      const cinemas = [makeCinema()];
      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("alert with undefined filters", () => {
      const alert = { _id: "a1", venues: [] };
      const cinemas = [makeCinema()];
      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("cinema with null sessions array", () => {
      const alert = makeAlert();
      const cinemas = [{ ...makeCinema(), sessions: null }];
      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("session with all possible fields missing", () => {
      const alert = makeAlert();
      const cinemas = [
        makeCinema({
          sessions: [{
            sessionId: "bare",
            statusColor: "G",
          }],
        }),
      ];
      expect(matchAlert(alert, cinemas)).not.toEqual([]);
    });

    test("handles very large number of cinemas and sessions", () => {
      const alert = makeAlert({ filters: { formats: ["4DX"] } });
      const cinemas = [];
      for (let i = 0; i < 100; i++) {
        cinemas.push(
          makeCinema({
            cinemaId: i,
            sessions: Array.from({ length: 20 }, (_, j) =>
              makeSession({ sessionId: `s-${i}-${j}`, screenFormat: "2D" })
            ),
          })
        );
      }
      expect(matchAlert(alert, cinemas)).toEqual([]);
    });

    test("returns first match even in large dataset", () => {
      const alert = makeAlert({ filters: { formats: ["4DX"] } });
      const cinemas = [];
      for (let i = 0; i < 50; i++) {
        cinemas.push(
          makeCinema({
            cinemaId: i,
            name: `Cinema ${i}`,
            sessions: [makeSession({ screenFormat: "2D", sessionId: `s-${i}` })],
          })
        );
      }
      cinemas[25] = makeCinema({
        cinemaId: 25,
        name: "Cinema 25",
        sessions: [makeSession({ screenFormat: "4DX", sessionId: "the-one" })],
      });

      const result = matchAlert(alert, cinemas);
      expect(result).not.toEqual([]);
      expect(result[0].session.sessionId).toBe("the-one");
    });
  });
});
