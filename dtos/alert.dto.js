class AlertNotificationDTO {
  constructor(notification) {
    this._id = notification._id;
    this.alert_id = notification.alert_id;
    this.channel = notification.channel;
    this.payload = {
      movie: notification.payload?.movie ?? null,
      matches: (notification.payload?.matches || []).map((match) => ({
        venue: match.venue ?? null,
        showtime: match.showtime ?? null,
        screen: match.screen ?? null,
        screen_format: match.screen_format ?? null,
        language: match.language ?? null,
        seats_available: match.seats_available ?? null,
        price: match.price ?? null,
        source: match.source || "district",
      })),
      booking_url: notification.payload?.booking_url ?? null,
    };
    this.status = notification.status;
    this.retry_count = notification.retry_count;
    this.sent_at = notification.sent_at || null;
    this.created_at = notification.created_at;
    this.updated_at = notification.updated_at;
  }

  static toResponse(notification) {
    if (!notification) return null;
    return new AlertNotificationDTO(notification);
  }

  static toCollectionResponse(notifications) {
    if (!notifications) return [];
    return notifications.map((notification) => AlertNotificationDTO.toResponse(notification));
  }
}

class AlertDTO {
  constructor(alert) {
    this._id = alert._id;
    this.user_email = alert.user_email;
    this.movie = {
      id: alert.movie.id,
      name: alert.movie.name,
      image_url: alert.movie.image_url || null,
    };
    this.city = {
      name: alert.city.name,
    };
    this.venues = (alert.venues || []).map(v => ({
      id: v.id,
      name: v.name || null,
      source: v.source || "district",
    }));
    this.alert_date = alert.alert_date;
    this.status = alert.status;
    this.filters = {
      formats: alert.filters?.formats || [],
      languages: alert.filters?.languages || [],
      show_time_min: alert.filters?.show_time_min ?? null,
      show_time_max: alert.filters?.show_time_max ?? null,
      price_min: alert.filters?.price_min ?? null,
      price_max: alert.filters?.price_max ?? null,
    };
    this.last_scan_group_key = alert.last_scan_group_key || null;
    this.last_checked_at = alert.last_checked_at || null;
    this.notified_at = alert.notified_at || null;
    this.expires_at = alert.expires_at || null;
    this.created_at = alert.created_at;
    this.updated_at = alert.updated_at;
  }

  static toResponse(alert) {
    if (!alert) return null;
    return new AlertDTO(alert);
  }

  static toCollectionResponse(alerts) {
    if (!alerts) return [];
    return alerts.map((alert) => AlertDTO.toResponse(alert));
  }

  static toDetailResponse(alert, notifications) {
    if (!alert) return null;
    return {
      alert: AlertDTO.toResponse(alert),
      notifications: AlertNotificationDTO.toCollectionResponse(notifications),
    };
  }
}

module.exports = {
  AlertDTO,
  AlertNotificationDTO,
};
