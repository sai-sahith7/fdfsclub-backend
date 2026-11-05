const { buildBmsVenueUrl } = require("../../services/bmsShowtimes");

describe("buildBmsVenueUrl", () => {
  test("builds the theatre page for the alert date", () => {
    expect(buildBmsVenueUrl({ regionSlug: "hyderabad", venueName: "Prasads Multiplex: Hyderabad", venueCode: "PRHN", dateCode: "20261102" })).toBe(
      "https://in.bookmyshow.com/cinemas/hyderabad/prasads-multiplex-hyderabad/buytickets/PRHN/20261102"
    );
  });

  test("drops dots the way BookMyShow does, so 7.1 becomes 71", () => {
    expect(buildBmsVenueUrl({ regionSlug: "bengaluru", venueName: "Maruthi Cinemas 4K AC Dolby 7.1: RajgopalNagar", venueCode: "SMRN", dateCode: "20261102" })).toBe(
      "https://in.bookmyshow.com/cinemas/bengaluru/maruthi-cinemas-4k-ac-dolby-71-rajgopalnagar/buytickets/SMRN/20261102"
    );
  });
});
