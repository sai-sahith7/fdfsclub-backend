const fs   = require('fs');
const path = require('path');
const { getFrontendBaseUrl } = require('../utils/appLinks');
const { APP_NAME } = require('../constants/appConstants');

const COLOR_PALETTE = {
  available    : '#34d399',
  availBorder  : '#22c55e',
  booked       : '#1e1e28',
  bookedBorder : '#2a2a38',
  accent       : '#c9963a',
  accentLight  : '#e8c36a',
  cardBg       : '#121218',
  deepBg       : '#0e0e14',
  border       : '#1c1c28',
  textPrimary  : '#f0f0f5',
  textSecondary: '#b0b0be',
  textTertiary : '#7a7a8c',
  textMuted    : '#555566',
  textDim      : '#3a3a48',
  green        : '#34d399',
  greenBg      : '#1a2520',
  greenBorder  : '#264032',
};

const FONT_FAMILY = "'Inter', Arial, sans-serif";

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatShowtime(raw) {
  if (!raw) return '';
  try {
    let parseStr = raw;
    if (raw.includes('T') && !raw.endsWith('Z')) {
      parseStr += 'Z';
    }
    const date = new Date(parseStr);
    if (isNaN(date.getTime())) {
      const timePart = raw.includes('T') ? raw.split('T')[1] : raw;
      const [hours, minutes] = timePart.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
    }
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  } catch {
    return raw;
  }
}

function seatsLabel(count) {
  const seats = parseInt(count, 10) || 0;
  return `${seats} ${seats === 1 ? 'seat' : 'seats'} left`;
}

function generateSeatMapHTML(seatLayout, firstMatch) {
  if (!seatLayout || seatLayout.length === 0) return '';

  let headerHtml = '';
  if (firstMatch) {
    const showtime = formatShowtime(firstMatch.showtime);
    headerHtml = `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="padding-bottom: 12px; border-bottom: 1px solid ${COLOR_PALETTE.border};">
          <tr>
            <td style="padding-bottom: 4px;">
              <span style="font-family: ${FONT_FAMILY}; font-size: 10px; font-weight: 600;
                           color: ${COLOR_PALETTE.accent}; letter-spacing: 1.5px; text-transform: uppercase;">
                Seat Map
              </span>
            </td>
          </tr>
          <tr>
            <td>
              <span style="font-family: ${FONT_FAMILY}; font-size: 14px; font-weight: 600;
                           color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(firstMatch.venue)}</span>
              <span style="font-family: ${FONT_FAMILY}; font-size: 13px; color: ${COLOR_PALETTE.textMuted};
                           padding: 0 5px;">&bull;</span>
              <span style="font-family: ${FONT_FAMILY}; font-size: 13px; color: ${COLOR_PALETTE.textTertiary};">
                ${escapeHtml(firstMatch.screen)}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 2px;">
              <span style="font-family: ${FONT_FAMILY}; font-size: 12px; color: ${COLOR_PALETTE.textMuted};">
                ${escapeHtml(showtime)}${firstMatch.screen_format ? ` &bull; ${escapeHtml(firstMatch.screen_format)}` : ''}${firstMatch.language ? ` &bull; ${escapeHtml(firstMatch.language)}` : ''}
              </span>
            </td>
          </tr>
        </table>`;
  }

  const availabilityDivider = headerHtml
    ? 'padding-top: 14px;'
    : 'padding-bottom: 12px; border-bottom: 1px solid ' + COLOR_PALETTE.border + ';';

  let html = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="margin-bottom: 16px;">
    <tr>
      <td style="background-color: ${COLOR_PALETTE.deepBg}; border: 1px solid ${COLOR_PALETTE.border};
                 border-radius: 8px; padding: 16px;">
${headerHtml}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="${availabilityDivider}">
              <span style="font-family: ${FONT_FAMILY}; font-size: 10px; font-weight: 600;
                           color: ${COLOR_PALETTE.textMuted}; letter-spacing: 2px; text-transform: uppercase;">
                Seat Availability
              </span>
            </td>
          </tr>
        </table>`;

  for (const area of seatLayout) {
    const rows = area.rows || {};

    let computedAvailable = 0;
    let computedTotal = 0;
    for (const seats of Object.values(rows)) {
      for (const seat of seats) {
        computedTotal++;
        if (seat.status === '0') computedAvailable++;
      }
    }

    let priceHtml = '';
    if (firstMatch && firstMatch.areas) {
      const matchArea = firstMatch.areas.find(areaItem => areaItem.code === area.areaCode || areaItem.label === area.areaName);
      if (matchArea && matchArea.price) {
        priceHtml = `<span style="font-family: ${FONT_FAMILY}; font-size: 12px; color: ${COLOR_PALETTE.textTertiary}; margin-left: 8px;">₹${matchArea.price}</span>`;
      }
    }

    html += `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="margin-top: 14px;">
          <tr>
            <td style="padding-bottom: 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align: middle;">
                    <span style="font-family: ${FONT_FAMILY}; font-size: 13px; font-weight: 600;
                                 color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(area.areaName)}</span>
                    ${priceHtml}
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="font-family: ${FONT_FAMILY}; font-size: 11px; font-weight: 700;
                                 color: ${COLOR_PALETTE.green};">${computedAvailable}</span>
                    <span style="font-family: ${FONT_FAMILY}; font-size: 11px;
                                 color: ${COLOR_PALETTE.textMuted};">/ ${computedTotal}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="3" border="0">`;

    for (const [rowLabel, seats] of Object.entries(rows)) {
      html += `
                <tr>
                  <td style="font-family: ${FONT_FAMILY}; font-size: 9px; font-weight: 600; color: ${COLOR_PALETTE.textDim};
                             padding-right: 6px; text-align: right; width: 16px;
                             vertical-align: middle;">${escapeHtml(rowLabel)}</td>`;

      for (const seat of seats) {
        const isAvailable = seat.status === '0';
        const backgroundColor = isAvailable ? COLOR_PALETTE.available : COLOR_PALETTE.booked;
        const borderColor     = isAvailable ? COLOR_PALETTE.availBorder : COLOR_PALETTE.bookedBorder;
        html += `
                  <td class="seat-cell"
                      title="Seat ${escapeHtml(seat.displayNumber)}"
                      style="width: 12px; height: 12px; background-color: ${backgroundColor};
                             border: 1px solid ${borderColor}; border-radius: 2px;
                             font-size: 0; line-height: 0;">&nbsp;</td>`;
      }
      html += `
                </tr>`;
    }

    html += `
              </table>
            </td>
          </tr>
        </table>`;
  }

  html += `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"
               style="margin-top: 14px; border-top: 1px solid ${COLOR_PALETTE.border}; padding-top: 10px; width: 100%;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width: 10px; height: 10px; background-color: ${COLOR_PALETTE.available};
                             border-radius: 2px; font-size: 0;">&nbsp;</td>
                  <td style="font-family: ${FONT_FAMILY}; font-size: 11px; color: ${COLOR_PALETTE.textMuted};
                             padding-left: 5px; padding-right: 16px;">Available</td>
                  <td style="width: 10px; height: 10px; background-color: ${COLOR_PALETTE.booked};
                             border: 1px solid ${COLOR_PALETTE.bookedBorder}; border-radius: 2px;
                             font-size: 0;">&nbsp;</td>
                  <td style="font-family: ${FONT_FAMILY}; font-size: 11px; color: ${COLOR_PALETTE.textMuted};
                             padding-left: 5px;">Booked</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>`;

  return html;
}

exports.generateSeatMapHTML = generateSeatMapHTML;

exports.renderAlertEmail = (data) => {
  const { movie, matches, seat_layout, booking_url } = data;

  let matchesHtml = '';

  if (matches && matches.length > 0) {
    const grouped = {};
    matches.forEach(match => {
      if (!grouped[match.venue]) grouped[match.venue] = [];
      grouped[match.venue].push(match);
    });

    Object.entries(grouped).forEach(([venue, venueMatches], venueIndex, arr) => {
      const isLast     = venueIndex === arr.length - 1;
      const totalSeats = venueMatches.reduce((sum, match) => sum + (parseInt(match.seats_available) || 0), 0);
      const bmsUrl     = venueMatches[0].source === 'bookmyshow' ? venueMatches[0].booking_url : null;
      const pillText   = bmsUrl
        ? `<a href="${escapeHtml(bmsUrl)}" target="_blank" style="color: ${COLOR_PALETTE.green}; text-decoration: none;">Book on BookMyShow &rarr;</a>`
        : seatsLabel(totalSeats);

      matchesHtml += `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="margin-bottom: ${isLast ? '6px' : '10px'};
                    border: 1px solid ${COLOR_PALETTE.border}; border-radius: 8px; overflow: hidden;">

        <tr>
          <td style="background-color: ${COLOR_PALETTE.deepBg}; padding: 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td class="venue-name" style="padding: 11px 14px; vertical-align: middle;">
                  <span style="font-family: ${FONT_FAMILY}; font-size: 14px; font-weight: 600;
                               color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(venue)}</span>
                </td>
                <td align="right" style="padding: 11px 14px; vertical-align: middle; white-space: nowrap;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display: inline-table;">
                    <tr>
                      <td style="background-color: ${COLOR_PALETTE.greenBg}; border: 1px solid ${COLOR_PALETTE.greenBorder};
                                 border-radius: 999px; padding: 3px 10px; vertical-align: middle;">
                        <span style="font-family: ${FONT_FAMILY}; font-size: 11px; font-weight: 700;
                                     color: ${COLOR_PALETTE.green}; letter-spacing: 0.3px;">
                          ${pillText}
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

      venueMatches.forEach((match, matchIndex) => {
        const isLastMatch  = matchIndex === venueMatches.length - 1;
        const rowBorderBot = isLastMatch ? 'none' : `1px solid ${COLOR_PALETTE.border}`;
        const showtime     = formatShowtime(match.showtime);

        matchesHtml += `
        <tr>
          <td style="background-color: ${COLOR_PALETTE.cardBg}; border-bottom: ${rowBorderBot}; padding: 0 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="width: 3px; background-color: ${COLOR_PALETTE.accent}; border-radius: 0;
                           vertical-align: stretch; padding: 0; font-size: 0;">&nbsp;</td>
                <td style="padding: 10px 0 10px 10px; vertical-align: middle;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td>
                        <span class="show-time" style="font-family: ${FONT_FAMILY}; font-size: 14px; font-weight: 600;
                                     color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(showtime)}</span>
                        <span style="font-family: ${FONT_FAMILY}; font-size: 13px; color: ${COLOR_PALETTE.textDim};
                                     padding: 0 4px;">&bull;</span>
                        <span style="font-family: ${FONT_FAMILY}; font-size: 13px; color: ${COLOR_PALETTE.textTertiary};">
                          ${escapeHtml(match.screen)}
                        </span>
                      </td>
                      <td align="right">
                        ${match.seats_available == null ? '' : `<span style="font-family: ${FONT_FAMILY}; font-size: 12px; font-weight: 700;
                                     color: ${COLOR_PALETTE.green};">${seatsLabel(match.seats_available)}</span>`}
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding-top: 2px;">
                        <span style="font-family: ${FONT_FAMILY}; font-size: 11px; color: ${COLOR_PALETTE.textMuted};">
                          ${[match.screen_format, match.language].filter(Boolean).map(escapeHtml).join('&nbsp;&bull;&nbsp;')}
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
      });

      matchesHtml += `
      </table>`;
    });
  }

  const firstMatch = matches && matches.length > 0 ? matches[0] : null;
  const seatMapHtml = generateSeatMapHTML(seat_layout, firstMatch);

  const templatePath = path.join(__dirname, '../templates/alertEmailTemplate.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const bookingUrl = booking_url || (matches && matches.length > 0 ? matches[0].booking_url : '') || '#';
  const currentYear = new Date().getFullYear().toString();

  const allBms = matches && matches.length > 0 && matches.every((match) => match.source === 'bookmyshow');
  const replacements = {
    app_name: escapeHtml(APP_NAME),
    cta_label: allBms ? 'Book on BookMyShow' : 'Book tickets',
    movie: escapeHtml(movie),
    matchesHtml,
    seatMapHtml,
    booking_url: escapeHtml(bookingUrl),
    unsubscribe_url: escapeHtml(getFrontendBaseUrl() + '/dashboard'),
    year: currentYear,
  };

  return html.replace(/{{(\w+)}}/g, (placeholder, key) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : placeholder
  );
};

exports.renderAlertText = (data) => {
  const { movie, matches = [], booking_url } = data;
  const lines = [`Tickets are open for ${movie}!`, ''];
  const grouped = new Map();
  for (const match of matches) {
    if (!grouped.has(match.venue)) grouped.set(match.venue, []);
    grouped.get(match.venue).push(match);
  }
  for (const [venue, venueMatches] of grouped) {
    lines.push(venue);
    for (const match of venueMatches) {
      const details = [formatShowtime(match.showtime), match.screen, match.screen_format, match.language].filter(Boolean).join(' · ');
      lines.push(`  ${details}`);
    }
    if (venueMatches[0].source === 'bookmyshow' && venueMatches[0].booking_url) lines.push(`  Book on BookMyShow: ${venueMatches[0].booking_url}`);
    lines.push('');
  }
  const bookingUrl = booking_url || matches[0]?.booking_url;
  if (bookingUrl) lines.push(`Book tickets: ${bookingUrl}`, '');
  lines.push(`You're getting this email because you set up this alert on ${APP_NAME}.`);
  lines.push(`Manage your alerts: ${getFrontendBaseUrl()}/dashboard`);
  return lines.join('\n');
};

exports.buildAlertSubject = (data) => {
  const count = (data.matches || []).length;
  return `Tickets are open: ${data.movie} (${count} ${count === 1 ? 'show' : 'shows'})`;
};
