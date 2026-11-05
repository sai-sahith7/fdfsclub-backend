const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

let appLinks;

function loadWithFrontendUrl(value) {
  jest.resetModules();
  if (value === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = value;
  appLinks = require("../../utils/appLinks");
}

afterAll(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
});

describe("buildTelegramLinkUrl", () => {
  test("points at the telegram page with the code pre-filled", () => {
    loadWithFrontendUrl("https://fdfsclub.app");
    expect(appLinks.buildTelegramLinkUrl("123456")).toBe(
      "https://fdfsclub.app/telegram?code=123456"
    );
  });

  test("does not double up slashes when the base URL has a trailing one", () => {
    loadWithFrontendUrl("https://fdfsclub.app/");
    expect(appLinks.buildTelegramLinkUrl("123456")).toBe(
      "https://fdfsclub.app/telegram?code=123456"
    );
  });

  test("omits the query string when there is no code", () => {
    loadWithFrontendUrl("https://fdfsclub.app");
    expect(appLinks.buildTelegramLinkUrl()).toBe("https://fdfsclub.app/telegram");
  });

  test("url-encodes the code", () => {
    loadWithFrontendUrl("https://fdfsclub.app");
    expect(appLinks.buildTelegramLinkUrl("12 34&56")).toBe(
      "https://fdfsclub.app/telegram?code=12%2034%2656"
    );
  });

  test("falls back to localhost when FRONTEND_URL is unset", () => {
    loadWithFrontendUrl(undefined);
    expect(appLinks.buildTelegramLinkUrl("111111")).toBe(
      "http://localhost:5173/telegram?code=111111"
    );
  });

  test("falls back to localhost when FRONTEND_URL is blank", () => {
    loadWithFrontendUrl("   ");
    expect(appLinks.getFrontendBaseUrl()).toBe("http://localhost:5173");
  });
});
