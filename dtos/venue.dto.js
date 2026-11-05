class VenueDTO {
  constructor(venue) {
    this._id = venue._id;
    this.name = venue.name;
    this.address = venue.address || null;
    this.city_name = venue.city_name;
    this.provider_id = venue.provider_id || null;
    this.cinema_id = venue.cinema_id || null;
    this.location = venue.location || { type: "Point", coordinates: [0, 0] };
    this.extras = venue.extras || { chain: null, amenities: [] };
    this.source = venue.source || "district";
  }

  static toResponse(venue) {
    if (!venue) return null;
    return new VenueDTO(venue);
  }

  static toCollectionResponse(venues) {
    if (!venues) return [];
    return venues.map(venue => VenueDTO.toResponse(venue));
  }
}

module.exports = VenueDTO;
