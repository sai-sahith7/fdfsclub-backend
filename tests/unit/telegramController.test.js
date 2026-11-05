const telegramController = require("../../controllers/telegramController");
const telegramBot = require("../../clients/telegramBot");
const conversation = require("../../services/telegramConversationStore");
const City = require("../../models/City");

jest.mock("../../clients/telegramBot", () => ({
  sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
  editMessageText: jest.fn().mockResolvedValue(true),
  answerCallbackQuery: jest.fn().mockResolvedValue(true),
  getBot: jest.fn().mockReturnValue({
    deleteMessage: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock("../../services/telegramConversationStore", () => ({
  getConversation: jest.fn(),
  setConversation: jest.fn(),
  clearConversation: jest.fn(),
}));

jest.mock("../../models/User", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../models/TelegramConnection", () => ({
  deleteMany: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock("../../models/TelegramConnection", () => {
  return class MockConnection {
    static deleteMany = jest.fn();
    static findOne = jest.fn();
    save = jest.fn();
  };
});

jest.mock("../../models/City", () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

describe("TelegramController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleMessage", () => {
    it("should handle /help command", async () => {
      const msg = { chat: { id: 100 }, text: "/help" };
      await telegramController.handleMessage(msg);
      expect(telegramBot.sendMessage).toHaveBeenCalledWith(
        100,
        expect.stringContaining("/new - set up a ticket alert")
      );
    });

    it("should fallback to prompt for unknown commands", async () => {
      const msg = { chat: { id: 100 }, text: "/unknown" };
      await telegramController.handleMessage(msg);
      expect(telegramBot.sendMessage).toHaveBeenCalledWith(
        100,
        "I don't know that command. Send /help to see what I can do."
      );
    });
  });

  describe("handleCallbackQuery", () => {
    it("should answer callback query and clear conversation on cancel_flow", async () => {
      const query = { id: "cq1", message: { chat: { id: 100 }, message_id: 200 }, data: "cancel_flow" };
      await telegramController.handleCallbackQuery(query);

      expect(telegramBot.answerCallbackQuery).toHaveBeenCalledWith("cq1");
      expect(conversation.clearConversation).toHaveBeenCalledWith(100);
      expect(telegramBot.editMessageText).toHaveBeenCalledWith(
        "Okay, cancelled. Send /new whenever you want to start again.",
        { chat_id: 100, message_id: 200 }
      );
    });

    it("should handle filter toggle correctly", async () => {
      const query = { id: "cq2", message: { chat: { id: 100 }, message_id: 200 }, data: "filter_toggle:language" };
      
      conversation.getConversation.mockReturnValue({
        step: "filters",
        data: { filters: { language: "Any", format: "Any", price: "Any" } }
      });

      await telegramController.handleCallbackQuery(query);

      expect(conversation.setConversation).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          data: expect.objectContaining({
            filters: expect.objectContaining({ language: "English" })
          })
        })
      );
      expect(telegramBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("*Filters (optional)*"),
        expect.objectContaining({ chat_id: 100, message_id: 200 })
      );
    });
    
    it("should go back to city selection when back:city is pressed", async () => {
      City.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([ { name: "Mumbai", slug: "mumbai" } ])
      });
      conversation.getConversation.mockReturnValue({
        step: "movie",
        data: {}
      });

      const query = { id: "cq3", message: { chat: { id: 100 }, message_id: 200 }, data: "back:city" };
      await telegramController.handleCallbackQuery(query);

      expect(conversation.setConversation).toHaveBeenCalledWith(100, expect.objectContaining({ step: "city" }));
      expect(telegramBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("*Pick a city*"),
        expect.objectContaining({ chat_id: 100, message_id: 200 })
      );
    });
  });
});
