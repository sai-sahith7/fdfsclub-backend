function casingScore(value) {
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  if (hasLower && hasUpper) return 2;
  if (hasUpper) return 1;
  return 0;
}

function dedupeIgnoreCase(values) {
  if (!values) return [];

  const byKey = new Map();

  for (const raw of values) {
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;

    const key = value.toLowerCase();
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { value, order: byKey.size });
      continue;
    }

    const isBetter =
      casingScore(value) > casingScore(existing.value) ||
      (casingScore(value) === casingScore(existing.value) && value < existing.value);

    if (isBetter) existing.value = value;
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.value);
}

module.exports = { dedupeIgnoreCase, casingScore };
