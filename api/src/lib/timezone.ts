import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function dateOnlyDueDate(date: string, timeZone: string): Date {
  return fromZonedTime(`${date}T23:59:59.999`, timeZone);
}

export function dateStartInTimeZone(date: Date, timeZone: string): Date {
  const dateKey = formatInTimeZone(date, timeZone, "yyyy-MM-dd");
  return fromZonedTime(`${dateKey}T00:00:00`, timeZone);
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}
