const ConversationModel = require("../models/TelegramConversation");
const logger = require("../utils/logger");

const TAG = "TelegramConversation";
const { CONVERSATION_TTL_MS } = require("../constants/appConstants");

async function getConversation(chatId) {
  try {
    const doc = await ConversationModel.findOne({
      chat_id: String(chatId),
      expires_at: { $gt: new Date() },
    }).lean();

    if (!doc) return null;

    return {
      step: doc.step,
      data: doc.data || {},
    };
  } catch (err) {
    logger.error(TAG, `Failed to get conversation for ${chatId}`, err.message);
    return null;
  }
}

async function setConversation(chatId, state) {
  try {
    const expiresAt = new Date(Date.now() + CONVERSATION_TTL_MS);

    await ConversationModel.findOneAndUpdate(
      { chat_id: String(chatId) },
      {
        $set: {
          step: state.step,
          data: state.data || {},
          expires_at: expiresAt,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error(TAG, `Failed to set conversation for ${chatId}`, err.message);
  }
}

async function clearConversation(chatId) {
  try {
    await ConversationModel.deleteOne({ chat_id: String(chatId) });
  } catch (err) {
    logger.error(TAG, `Failed to clear conversation for ${chatId}`, err.message);
  }
}

module.exports = {
  getConversation,
  setConversation,
  clearConversation,
};
