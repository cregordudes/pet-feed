export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100 || /[\r\n]/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function zoneParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  if (map.hour === '24') map.hour = '00';
  return map;
}

export function todayInZone(timeZone: string, now = new Date()): string {
  const map = zoneParts(now, timeZone);
  return `${map.year}-${map.month}-${map.day}`;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const map = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const corrected = utcGuess - zoneOffsetMs(new Date(utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone)), timeZone);
  return new Date(corrected);
}

export function formatTimeInZone(instant: Date, timeZone: string): string {
  const map = zoneParts(instant, timeZone);
  return `${map.hour.padStart(2, '0')}:${map.minute.padStart(2, '0')}`;
}

export function formatDayLabel(date: string, timeZone: string): string {
  const instant = zonedTimeToUtc(date, '12:00', timeZone);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(instant);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric' }).format(instant);
  const month = new Intl.DateTimeFormat('en-GB', { timeZone, month: 'long' }).format(instant);
  return `${weekday}, ${day} ${month}`;
}
