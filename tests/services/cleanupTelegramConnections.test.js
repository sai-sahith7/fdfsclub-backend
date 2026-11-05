const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const TelegramConnection = require("../../models/TelegramConnection");
const cleanupTelegramConnections = require("../../services/cleanupTelegramConnections");

beforeAll(async () => await setupTestDB());
afterEach(async () => await clearTestDB());
afterAll(async () => await teardownTestDB());

describe("TelegramConnection Cleanup Service", () => {
  test("deletes completed and expired connections but preserves active pending ones", async () => {
    const now = new Date();
    
    const futureDate = new Date(now.getTime() + 15 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 5 * 60 * 1000);

    await TelegramConnection.create({
      code: "111111",
      telegram_handle: "active_user",
      chat_id: "1",
      status: "PENDING",
      expires_at: futureDate
    });

    await TelegramConnection.create({
      code: "222222",
      telegram_handle: "expired_user",
      chat_id: "2",
      status: "PENDING",
      expires_at: pastDate
    });

    await TelegramConnection.create({
      code: "333333",
      telegram_handle: "completed_user",
      chat_id: "3",
      status: "COMPLETED",
      expires_at: futureDate
    });

    const result = await cleanupTelegramConnections();
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);

    const remaining = await TelegramConnection.find({});
    expect(remaining.length).toBe(1);
    expect(remaining[0].code).toBe("111111");
    expect(remaining[0].telegram_handle).toBe("active_user");
  });
});
