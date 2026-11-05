const mongoose = require("mongoose");

const movieLanguageSchema = new mongoose.Schema({
  language_name: { type: String, required: true, unique: true, trim: true },
  extras: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model("MovieLanguage", movieLanguageSchema);
