const mongoose = require("mongoose");

const VENUE_SOURCES = ["district", "bookmyshow"];

const venueSchema = new mongoose.Schema({
  _id: { type: Number },
  name: { type: String, required: true, trim: true },
  address: { type: String, default: null },
  city_name: { type: String, required: true },
  provider_id: { type: Number, default: null },
  cinema_id: { type: String, unique: true, sparse: true, default: null },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] },
  },
  extras: {
    chain: { type: String, default: null },
    amenities: [{ type: String }],
  },
  source: { type: String, enum: VENUE_SOURCES, default: "district" },
  bms_venue_code: { type: String, default: null },
});

venueSchema.index({ city_name: 1 });
venueSchema.index({ city_name: 1, source: 1 });
venueSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Venue", venueSchema);
module.exports.VENUE_SOURCES = VENUE_SOURCES;
