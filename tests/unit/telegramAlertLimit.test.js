const telegramBot = require("../../clients/telegramBot");
const conversation = require("../../services/telegramConversationStore");
const User = require("../../models/User");
const Alert = require("../../models/Alert");
const City = require("../../models/City");
const { handleMessage } = require("../../services/telegramConversationService");
const { MAX_ACTIVE_ALERTS_PER_USER } = require("../../constants/appConstants");

jest.mock("../../clients/telegramBot", () => ({
  sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
  editMessageText: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/telegramConversationStore", () => ({
  getConversation: jest.fn().mockResolvedValue(null),
  setConversation: jest.fn(),
  clearConversation: jest.fn(),
}));
jest.mock("../../models/User", () => ({ findOne: jest.fn() }));
jest.mock("../../models/Alert", () => ({ countDocuments: jest.fn() }));
jest.mock("../../models/City", () => ({ find: jest.fn() }));

const CHAT_ID = 42;
const newCommand = { chat: { id: CHAT_ID }, text: "/new" };

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockResolvedValue({ email: "fan@example.com" });
  City.find.mockReturnValue({ lean: () => Promise.resolve([]) });
});

test("the active-alert limit is 3", () => {
  expect(MAX_ACTIVE_ALERTS_PER_USER).toBe(3);
});

test("/new at the limit explains why and does not start the flow", async () => {
  Alert.countDocuments.mockResolvedValue(MAX_ACTIVE_ALERTS_PER_USER);

  await handleMessage(newCommand);

  expect(Alert.countDocuments).toHaveBeenCalledWith({ user_email: "fan@example.com", status: "ACTIVE" });
  expect(conversation.setConversation).not.toHaveBeenCalled();
  const [chatId, text] = telegramBot.sendMessage.mock.calls[0];
  expect(chatId).toBe(CHAT_ID);
  expect(text).toMatch(/already have 3 active alerts/);
  expect(text).toMatch(/\/alerts/);
});

test("/new below the limit starts at the city step", async () => {
  Alert.countDocuments.mockResolvedValue(MAX_ACTIVE_ALERTS_PER_USER - 1);

  await handleMessage(newCommand);

  expect(conversation.setConversation).toHaveBeenCalledWith(CHAT_ID, { step: "city", data: { user_email: "fan@example.com" } });
});
