const request = require("supertest");
const express = require("express");

jest.mock("../../services/telegramConversationService", () => ({
  handleMessage: jest.fn().mockResolvedValue(undefined),
  handleCallbackQuery: jest.fn().mockResolvedValue(undefined),
}));
const telegramConversationService = require("../../services/telegramConversationService");
const telegramRoutes = require("../../routes/telegram");

const app = express();
app.use(express.json());
app.use("/api/telegram", telegramRoutes);

const update = { message: { chat: { id: 1 }, text: "/unlink" } };

describe("POST /api/telegram/webhook", () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    jest.clearAllMocks();
  });

  test("rejects updates without the secret token when one is configured", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
    const res = await request(app).post("/api/telegram/webhook").send(update);
    expect(res.status).toBe(401);
    expect(telegramConversationService.handleMessage).not.toHaveBeenCalled();
  });

  test("rejects updates with the wrong secret token", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
    const res = await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "guess")
      .send(update);
    expect(res.status).toBe(401);
  });

  test("processes updates carrying the secret token", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
    const res = await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "s3cret")
      .send(update);
    expect(res.status).toBe(200);
    expect(telegramConversationService.handleMessage).toHaveBeenCalledWith(update.message);
  });

  test("rejects every update in production when no secret is configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/api/telegram/webhook").send(update);
      expect(res.status).toBe(401);
      expect(telegramConversationService.handleMessage).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("accepts updates when no secret is configured outside production", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await request(app).post("/api/telegram/webhook").send(update);
    expect(res.status).toBe(200);
  });
});
