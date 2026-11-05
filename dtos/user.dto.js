class UserDTO {
  constructor(user) {
    this._id = user._id;
    this.email = user.email;
    this.name = user.name;
    this.image_url = user.image_url || null;
    this.default_city = user.default_city || { name: null, slug: null };
    this.favourite_city = user.favourite_city || { name: null, slug: null };
    this.telegram = user.telegram || { chat_id: null, username: null, connected: false };
    this.created_at = user.created_at;
    this.updated_at = user.updated_at;
  }

  static toResponse(user) {
    if (!user) return null;
    return new UserDTO(user);
  }

  static toLocationResponse(user, city, catalogLoading) {
    return {
      user: UserDTO.toResponse(user),
      city: {
        id: city._id,
        name: city.name,
        slug: city.slug,
      },
      city_added: catalogLoading,
      catalog_loading: catalogLoading,
    };
  }
}

module.exports = UserDTO;
