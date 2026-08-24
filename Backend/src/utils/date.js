export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function pktDayBoundsUTC(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startOfDay = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - PKT_OFFSET_MS,
  );
  if (isNaN(startOfDay.getTime())) return null;

  return {
    startOfDay,
    endOfDay: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

export function todayPKT() {
  const shifted = new Date(Date.now() + PKT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysToISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
