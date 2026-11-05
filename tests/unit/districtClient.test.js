const { DistrictClient } = require("../../clients/districtClient");

describe("DistrictClient", () => {
  let client;

  beforeEach(() => {
    client = new DistrictClient();
  });

  describe("token generation", () => {
    test("generates a guest token with correct format", () => {
      const parts = client.guestToken.split("_");
      expect(parts.length).toBe(3);
      expect(Number(parts[0])).toBeGreaterThan(0);
      expect(parts[2].length).toBe(32);
    });

    test("generates unique guest tokens", () => {
      const client2 = new DistrictClient();
      expect(client.guestToken).not.toBe(client2.guestToken);
    });

    test("generates valid UUID device IDs", () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(client.deviceId).toMatch(uuidRegex);
    });

    test("generates unique device IDs", () => {
      const client2 = new DistrictClient();
      expect(client.deviceId).not.toBe(client2.deviceId);
    });
  });

  describe("http client setup", () => {
    test("sets correct base URL", () => {
      expect(client.http.defaults.baseURL).toBe("https://www.district.in");
    });

    test("sets required headers", () => {
      const headers = client.http.defaults.headers;
      expect(headers["x-guest-token"]).toBe(client.guestToken);
      expect(headers["api_source"]).toBe("district");
      expect(headers["x-app-type"]).toBe("ed_web");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("sets device ID cookie", () => {
      expect(client.http.defaults.headers.Cookie).toContain(client.deviceId);
    });
  });
});
