/**
 * Calendar-day arithmetic for the Diet week strip.
 *
 * A day is a plain "YYYY-MM-DD" string, never a Date at a time of day: adding days is done
 * on UTC midnight (which has no daylight-saving jump, so a 23- or 25-hour day can never
 * skip or repeat a date), and the only place a timezone matters is deciding which calendar
 * day "now" is in. That uses the signed-in user's own timezone (users.timezone), the same
 * one the server cuts weeks in, rather than whatever the device clock happens to say.
 * Weeks start on Monday, as on the Volume tab.
 */

export type CalendarDate = string;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

function format(date: Date): CalendarDate {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parse(date: CalendarDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** The calendar day `now` falls on in `timeZone`; the device's own zone if none is given or it is not valid. */
export function calendarDateIn(now: Date, timeZone?: string | null): CalendarDate {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      const year = pick("year");
      const month = pick("month");
      const day = pick("day");
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
      }
    } catch {
      // An unknown zone name: fall through to the device's own calendar day.
    }
  }
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole calendar days later (negative: earlier). Month, year and leap-day boundaries are handled by the calendar. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const moved = parse(date);
  moved.setUTCDate(moved.getUTCDate() + days);
  return format(moved);
}

/** 0 for Monday … 6 for Sunday. */
function weekdayIndex(date: CalendarDate): number {
  return (parse(date).getUTCDay() + 6) % 7;
}

export function startOfWeek(date: CalendarDate): CalendarDate {
  return addDays(date, -weekdayIndex(date));
}

export type WeekDay = {
  date: CalendarDate;
  /** "Mon" */
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  isFuture: boolean;
  /** "Monday, November 23, 2026" */
  longLabel: string;
};

/** Monday to Sunday of the week that contains `today`. */
export function weekContaining(today: CalendarDate): WeekDay[] {
  const monday = startOfWeek(today);
  return WEEKDAYS.map((name, index) => {
    const date = addDays(monday, index);
    return {
      date,
      weekday: name.slice(0, 3),
      dayOfMonth: parse(date).getUTCDate(),
      isToday: date === today,
      isFuture: date > today,
      longLabel: formatLong(date),
    };
  });
}

/** "Monday, November 23, 2026" */
export function formatLong(date: CalendarDate): string {
  const parsed = parse(date);
  return `${WEEKDAYS[weekdayIndex(date)]}, ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

/**
 * The line that says which day the meal section is about: "Today · Mon, Nov 23",
 * "Yesterday · …", "Tomorrow · …", otherwise "Sat, Nov 21"; the year is added when it is
 * not the current one.
 */
export function formatMealContext(date: CalendarDate, today: CalendarDate): string {
  const parsed = parse(date);
  const short = `${WEEKDAYS[weekdayIndex(date)].slice(0, 3)}, ${MONTHS[parsed.getUTCMonth()].slice(0, 3)} ${parsed.getUTCDate()}`;
  const withYear = parsed.getUTCFullYear() === parse(today).getUTCFullYear() ? short : `${short}, ${parsed.getUTCFullYear()}`;
  if (date === today) return `Today · ${withYear}`;
  if (date === addDays(today, -1)) return `Yesterday · ${withYear}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${withYear}`;
  return withYear;
}
