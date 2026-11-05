const mongoose = require("mongoose");

const movieFormatSchema = new mongoose.Schema({
  _id: { type: Number },
  format_name: { type: String, required: true, unique: true, trim: true },
  extras: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model("MovieFormat", movieFormatSchema);
