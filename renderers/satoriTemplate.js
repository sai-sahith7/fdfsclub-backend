const { html } = require('satori-html');

const escapeHtml = (value) =>
  value == null ? '' : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COLOR_PALETTE = {
  available   : '#34d399',
  availBorder : '#22c55e',
  booked      : '#1e1e28',
  bookedBorder: '#2a2a38',
  accent      : '#c9963a',
  deepBg      : '#0e0e14',
  cardBg      : '#121218',
  border      : '#1c1c28',
  textPrimary : '#f0f0f5',
  textTertiary: '#7a7a8c',
  textMuted   : '#555566',
  textDim     : '#3a3a48',
};

function formatShowtime(raw) {
  if (!raw) return '';
  try {
    let parseStr = raw;
    if (raw.includes('T') && !raw.endsWith('Z')) parseStr += 'Z';
    const date = new Date(parseStr);
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  } catch {
    return raw;
  }
}

function renderSatoriSeatMap(payload) {
  const { matches, seat_layout } = payload;
  if (!seat_layout || seat_layout.length === 0) return null;

  const firstMatch = matches && matches.length > 0 ? matches[0] : null;
  const showtime = firstMatch ? formatShowtime(firstMatch.showtime) : '';

  const areasHtml = seat_layout.map((area) => {
    let areaHtml = `
      <div style="display: flex; flex-direction: column; margin-top: 16px; width: 100%;">
        <div style="display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; flex-direction: row; align-items: center;">
            <div style="display: flex; font-size: 14px; font-weight: 600; color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(area.areaName)}</div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
    `;

    for (const [rowLabel, seats] of Object.entries(area.rows || {})) {
      areaHtml += `
          <div style="display: flex; flex-direction: row; align-items: center;">
            <div style="font-size: 10px; font-weight: 600; color: ${COLOR_PALETTE.textDim}; width: 16px; text-align: right; margin-right: 6px; display: flex; justify-content: flex-end;">${escapeHtml(rowLabel)}</div>
            <div style="display: flex; flex-direction: row; gap: 4px;">
      `;
      for (const seat of seats) {
        const isAvailable    = seat.status === '0';
        const backgroundColor = isAvailable ? COLOR_PALETTE.available : COLOR_PALETTE.booked;
        const borderColor     = isAvailable ? COLOR_PALETTE.availBorder : COLOR_PALETTE.bookedBorder;
        areaHtml += `<div style="display: flex; width: 14px; height: 14px; background-color: ${backgroundColor}; border: 1px solid ${borderColor}; border-radius: 2px;"></div>`;
      }
      areaHtml += `</div></div>`;
    }

    areaHtml += `</div></div>`;
    return areaHtml;
  }).join('');

  const sessionMeta = [showtime, firstMatch?.screen_format, firstMatch?.language]
    .filter(Boolean)
    .join(' • ');

  const fullHtml = `
    <div style="display: flex; flex-direction: column; background-color: ${COLOR_PALETTE.deepBg}; padding: 24px; width: 100%; height: 100%; box-sizing: border-box; font-family: 'Roboto';">
      <div style="display: flex; flex-direction: column; border: 1px solid ${COLOR_PALETTE.border}; border-radius: 8px; padding: 16px; background-color: ${COLOR_PALETTE.deepBg};">
        <div style="display: flex; flex-direction: column; border-bottom: 1px solid ${COLOR_PALETTE.border}; padding-bottom: 12px;">
          <div style="display: flex; font-size: 10px; font-weight: 600; color: ${COLOR_PALETTE.accent}; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px;">SEAT MAP</div>
          <div style="display: flex; flex-direction: row; align-items: center;">
            <div style="display: flex; font-size: 16px; font-weight: 600; color: ${COLOR_PALETTE.textPrimary};">${escapeHtml(firstMatch?.venue)}</div>
            <div style="display: flex; font-size: 16px; color: ${COLOR_PALETTE.textMuted}; margin: 0 6px;">•</div>
            <div style="display: flex; font-size: 14px; color: ${COLOR_PALETTE.textTertiary};">${escapeHtml(firstMatch?.screen)}</div>
          </div>
          <div style="display: flex; font-size: 13px; color: ${COLOR_PALETTE.textMuted}; margin-top: 4px;">${escapeHtml(sessionMeta)}</div>
        </div>
        <div style="display: flex; font-size: 10px; font-weight: 600; color: ${COLOR_PALETTE.textMuted}; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 14px;">SEAT AVAILABILITY</div>
        ${areasHtml}
      </div>

      <div style="display: flex; flex-direction: row; justify-content: center; align-items: center; margin-top: 16px; border-top: 1px solid ${COLOR_PALETTE.border}; padding-top: 16px;">
        <div style="display: flex; width: 12px; height: 12px; background-color: ${COLOR_PALETTE.available}; border-radius: 2px;"></div>
        <div style="display: flex; font-size: 12px; color: ${COLOR_PALETTE.textMuted}; margin-left: 6px; margin-right: 24px;">Available</div>
        <div style="display: flex; width: 12px; height: 12px; background-color: ${COLOR_PALETTE.booked}; border: 1px solid ${COLOR_PALETTE.bookedBorder}; border-radius: 2px;"></div>
        <div style="display: flex; font-size: 12px; color: ${COLOR_PALETTE.textMuted}; margin-left: 6px;">Booked</div>
      </div>
    </div>
  `;

  return html(fullHtml);
}

module.exports = { renderSatoriSeatMap };
