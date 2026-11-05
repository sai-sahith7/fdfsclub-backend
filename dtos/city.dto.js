class CityDTO {
  constructor(city) {
    this._id = city._id;
    this.name = city.name;
    this.state_key = city.state_key || null;
    this.slug = city.slug;
    this.latitude = city.latitude || null;
    this.longitude = city.longitude || null;
    this.image_url = city.image_url || null;
    this.is_active = city.is_active;
    this.last_movie_sync_at = city.last_movie_sync_at || null;
  }

  static toResponse(city) {
    if (!city) return null;
    return new CityDTO(city);
  }

  static toCollectionResponse(cities) {
    if (!cities) return [];
    return cities.map(city => CityDTO.toResponse(city));
  }
}

module.exports = CityDTO;
