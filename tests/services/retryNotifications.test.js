const { setupTestDB, clearTestDB, teardownTestDB } = require("../setup");
const Alert = require("../../models/Alert");
const AlertNotification = require("../../models/AlertNotification");
const User = require("../../models/User");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue(true),
  }),
}));

const retryFailedNotifications = require("../../services/retryNotifications");

beforeAll(async () => await setupTestDB());
afterEach(async () => await clearTestDB());
afterAll(async () => await teardownTestDB());

describe("retryFailedNotifications", () => {
  test("retries failed notifications and marks them as sent", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { id: 1, name: "Test" },
      alert_date: new Date(),
      status: "ALERTED",
    });

    await AlertNotification.create({
      alert_id: alert._id,
      channel: "email",
      status: "failed",
      retry_count: 0,
      payload: { movie: "Test" },
    });

    const result = await retryFailedNotifications();

    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);

    const notification = await AlertNotification.findOne({ alert_id: alert._id });
    expect(notification.status).toBe("sent");
    expect(notification.sent_at).toBeInstanceOf(Date);
  });

  test("does not retry notifications with retry_count >= 3", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { id: 1, name: "Test" },
      alert_date: new Date(),
      status: "ALERTED",
    });

    await AlertNotification.create({
      alert_id: alert._id,
      channel: "email",
      status: "failed",
      retry_count: 3,
      payload: { movie: "Test" },
    });

    const result = await retryFailedNotifications();
    expect(result.retried).toBe(0);
  });

  test("marks notifications as dead when alert is missing", async () => {
    await AlertNotification.create({
      alert_id: "nonexistent-alert-id",
      channel: "email",
      status: "failed",
      retry_count: 0,
      payload: { movie: "Test" },
    });

    const result = await retryFailedNotifications();
    expect(result.deadLettered).toBe(1);

    const notification = await AlertNotification.findOne({});
    expect(notification.status).toBe("dead");
  });

  test("marks notifications as dead when user is missing", async () => {
    const alert = await Alert.create({
      user_email: "ghost@example.com",
      movie: { id: 100, name: "Test" },
      city: { id: 1, name: "Test" },
      alert_date: new Date(),
      status: "ALERTED",
    });

    await AlertNotification.create({
      alert_id: alert._id,
      channel: "email",
      status: "failed",
      retry_count: 0,
      payload: { movie: "Test" },
    });

    const result = await retryFailedNotifications();
    expect(result.deadLettered).toBe(1);
  });

  test("does not retry notifications older than 24 hours", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { id: 1, name: "Test" },
      alert_date: new Date(),
      status: "ALERTED",
    });

    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const notification = await AlertNotification.create({
      alert_id: alert._id,
      channel: "email",
      status: "failed",
      retry_count: 0,
      payload: { movie: "Test" },
    });
    await AlertNotification.collection.updateOne(
      { _id: notification._id },
      { $set: { created_at: oldDate } }
    );

    const result = await retryFailedNotifications();
    expect(result.retried).toBe(0);
  });

  test("retries notifications stuck in pending for over 10 minutes", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" }, city: { name: "Test" },
      alert_date: new Date(), status: "ALERTED",
    });
    const stuck = await AlertNotification.create({ alert_id: alert._id, channel: "email", status: "pending", payload: { movie: "Test" } });
    await AlertNotification.collection.updateOne(
      { _id: stuck._id },
      { $set: { updated_at: new Date(Date.now() - 11 * 60 * 1000) } }
    );

    const result = await retryFailedNotifications();

    expect(result.succeeded).toBe(1);
    expect((await AlertNotification.findById(stuck._id)).status).toBe("sent");
  });

  test("leaves recently created pending notifications to the sender", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com", movie: { id: 100, name: "Test" }, city: { name: "Test" },
      alert_date: new Date(), status: "ALERTED",
    });
    await AlertNotification.create({ alert_id: alert._id, channel: "email", status: "pending", payload: { movie: "Test" } });

    expect((await retryFailedNotifications()).retried).toBe(0);
  });

  test("returns zero counts when no failed notifications exist", async () => {
    const result = await retryFailedNotifications();
    expect(result.success).toBe(true);
    expect(result.retried).toBe(0);
  });

  test("does not retry sent or dead notifications", async () => {
    await User.create({ email: "test@example.com", name: "Test" });
    const alert = await Alert.create({
      user_email: "test@example.com",
      movie: { id: 100, name: "Test" },
      city: { id: 1, name: "Test" },
      alert_date: new Date(),
      status: "ALERTED",
    });

    await AlertNotification.create({
      alert_id: alert._id, channel: "email", status: "sent", retry_count: 0, payload: { movie: "Test" },
    });
    await AlertNotification.create({
      alert_id: alert._id, channel: "telegram", status: "dead", retry_count: 3, payload: { movie: "Test" },
    });

    const result = await retryFailedNotifications();
    expect(result.retried).toBe(0);
  });
});
