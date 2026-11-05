jest.mock("axios");

const { BOT_COMMANDS } = require("../../constants/appConstants");

const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let telegramBot;
let axios;

function loadBot(token) {
  jest.resetModules();
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  axios = require("axios");
  axios.post.mockReset();
  telegramBot = require("../../clients/telegramBot");
}

function mockOk(result = true) {
  axios.post.mockResolvedValue({ data: { ok: true, result } });
}

afterAll(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
});

describe("setMyCommands", () => {
  test("registers the documented command list over plain HTTP", async () => {
    loadBot("test-token");
    mockOk();
    telegramBot.initBot({ registerCommands: false });

    await telegramBot.setMyCommands();

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/setMyCommands");
    expect(body.commands).toEqual(BOT_COMMANDS);
  });

  test("registers every command the bot actually handles", () => {
    const names = BOT_COMMANDS.map((entry) => entry.command);
    expect(names).toEqual(expect.arrayContaining(["start", "new", "search", "alerts", "unlink", "help"]));
    for (const entry of BOT_COMMANDS) {
      expect(entry.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test("accepts an explicit command list", async () => {
    loadBot("test-token");
    mockOk();
    telegramBot.initBot({ registerCommands: false });

    const custom = [{ command: "ping", description: "Ping" }];
    await telegramBot.setMyCommands(custom);

    expect(axios.post.mock.calls[0][1].commands).toEqual(custom);
  });

  test("swallows API failures so boot is never blocked", async () => {
    loadBot("test-token");
    telegramBot.initBot({ registerCommands: false });
    axios.post.mockRejectedValue(new Error("network down"));

    await expect(telegramBot.setMyCommands()).resolves.toBeNull();
  });

  test("is a no-op when no bot token is configured", async () => {
    loadBot(undefined);
    telegramBot.initBot();

    await expect(telegramBot.setMyCommands()).resolves.toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("initBot", () => {
  test("publishes the command menu on boot", async () => {
    loadBot("test-token");
    mockOk();

    expect(telegramBot.initBot()).toBe(true);

    await Promise.resolve();
    expect(axios.post).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/setMyCommands",
      expect.objectContaining({ commands: BOT_COMMANDS }),
      expect.any(Object)
    );
  });

  test("can skip registration for secondary processes", async () => {
    loadBot("test-token");
    mockOk();

    telegramBot.initBot({ registerCommands: false });

    await Promise.resolve();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("returns null and stays disabled without a token", () => {
    loadBot(undefined);
    expect(telegramBot.initBot()).toBeNull();
  });

  test("treats the sample placeholder token as unconfigured", () => {
    loadBot("your_bot_token_here");
    expect(telegramBot.initBot()).toBeNull();
  });
});

describe("sendMessage", () => {
  test("passes through link preview suppression", async () => {
    loadBot("test-token");
    mockOk({ message_id: 7 });
    telegramBot.initBot({ registerCommands: false });

    await telegramBot.sendMessage(42, "hello", { disable_web_page_preview: true });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(body).toMatchObject({
      chat_id: 42,
      text: "hello",
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  });
});

describe("Markdown fallback", () => {
  test("resends as plain text when Telegram can't parse the Markdown", async () => {
    loadBot("test-token");
    telegramBot.initBot({ registerCommands: false });
    axios.post
      .mockRejectedValueOnce({ message: "Request failed", response: { data: { description: "Bad Request: can't parse entities: Can't find end of the entity" } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { message_id: 9 } } });

    const result = await telegramBot.sendMessage(42, "*Movie_Name*\n[Book now](https://x.test/a)");

    expect(result).toEqual({ message_id: 9 });
    const [, retry] = axios.post.mock.calls[1];
    expect(retry.parse_mode).toBeUndefined();
    expect(retry.text).toBe("Movie_Name\nBook now: https://x.test/a");
  });

  test("other errors are not retried and never leak the bot token", async () => {
    loadBot("test-token");
    telegramBot.initBot({ registerCommands: false });
    axios.post.mockRejectedValueOnce({ message: "Request failed with status code 403", response: { data: { description: "Forbidden: bot was blocked by the user" } } });

    await expect(telegramBot.sendMessage(42, "hi")).rejects.toThrow("bot was blocked by the user");
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test("unescapes Markdown escapes in the plain-text version", () => {
    loadBot("test-token");
    expect(telegramBot.toPlainText("*Fast \\& Furious\\_2*")).toBe("Fast \\& Furious_2");
  });
});
