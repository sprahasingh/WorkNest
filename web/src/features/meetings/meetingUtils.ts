import { useEffect, useState } from "react";
import type { Meeting, Rsvp } from "./api";

const MINUTE = 60_000;
export const SOON_WINDOW_MS = 15 * MINUTE;

export type MeetingPhase = "cancelled" | "live" | "soon" | "upcoming" | "ended";

export function meetingPhase(meeting: Meeting, now: number): MeetingPhase {
  if (meeting.cancelledAt) return "cancelled";
  const start = new Date(meeting.startsAt).getTime();
  const end = new Date(meeting.endsAt).getTime();
  if (now >= end) return "ended";
  if (now >= start) return "live";
  if (start - now <= SOON_WINDOW_MS) return "soon";
  return "upcoming";
}

// Re-renders on a timer so "Live now" and countdowns stay true.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${time(start)} – ${time(end)}`
    : `${time(start)} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time(end)}`;
}

export function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function dayHeading(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  const label = date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  if (diff === 0) return `Today · ${label}`;
  if (diff === 1) return `Tomorrow · ${label}`;
  if (diff === -1) return `Yesterday · ${label}`;
  return label;
}

export function describeTiming(meeting: Meeting, now: number): string {
  const phase = meetingPhase(meeting, now);
  const start = new Date(meeting.startsAt).getTime();
  const end = new Date(meeting.endsAt).getTime();
  if (phase === "cancelled") return "Cancelled";
  if (phase === "live") {
    const left = Math.max(1, Math.round((end - now) / MINUTE));
    return `Live now · ${left} min left`;
  }
  if (phase === "ended") return "Ended";
  const mins = Math.round((start - now) / MINUTE);
  if (mins < 1) return "Starting now";
  if (mins < 60) return `Starts in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return `Starts in ${hours} h${rest ? ` ${rest} min` : ""}`;
  }
  const days = Math.round(hours / 24);
  return `Starts in ${days} day${days > 1 ? "s" : ""}`;
}

export const RSVP_LABEL: Record<Rsvp, string> = {
  pending: "No reply",
  accepted: "Accepted",
  tentative: "Maybe",
  declined: "Declined",
};

export const timeZoneName = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Date inputs (local time) --------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromInputs(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

// The next half hour, so a new meeting starts at a sensible time.
export function nextHalfHour(from = new Date()): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60);
  return next;
}

export function generateJitsiLink(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join(
    "",
  );
  return `https://meet.jit.si/WorkNest-${suffix}`;
}

// --- Calendar file -------------------------------------------------------

const icsDate = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const icsEscape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

export function buildIcs(meeting: Meeting): string {
  const description = [
    meeting.agenda,
    meeting.joinUrl ? `Join: ${meeting.joinUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkNest//Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@worknest`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(meeting.startsAt)}`,
    `DTEND:${icsDate(meeting.endsAt)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : "",
    meeting.location ? `LOCATION:${icsEscape(meeting.location)}` : "",
    meeting.joinUrl ? `URL:${meeting.joinUrl}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export function downloadIcs(meeting: Meeting): void {
  const blob = new Blob([buildIcs(meeting)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${meeting.title.replace(/[^\w-]+/g, "-").slice(0, 40) || "meeting"}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- Calendar grid -------------------------------------------------------

// Monday-first grid of whole weeks covering the month.
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from(
    { length: total },
    (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
  );
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// --- Repeating meetings ---------------------------------------------------

export const MAX_REPEATS = 60;

export const REPEAT_LABEL = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
} as const;

// Each date of a repeat, worked out on the person's own calendar so the time
// of day holds steady across daylight saving changes. Monthly repeats keep the
// day of the month, and use the last day when a month is shorter.
export function repeatDates(
  first: Date,
  freq: "daily" | "weekly" | "monthly",
  end: { count: number } | { until: Date },
): Date[] {
  const dates: Date[] = [new Date(first)];
  const limit = "count" in end ? Math.min(end.count, MAX_REPEATS) : MAX_REPEATS;
  for (let step = 1; dates.length < limit; step += 1) {
    let next: Date;
    if (freq === "daily" || freq === "weekly") {
      next = new Date(first);
      next.setDate(first.getDate() + step * (freq === "weekly" ? 7 : 1));
    } else {
      const lastDay = new Date(
        first.getFullYear(),
        first.getMonth() + step + 1,
        0,
      ).getDate();
      next = new Date(first);
      next.setDate(1);
      next.setMonth(first.getMonth() + step);
      next.setDate(Math.min(first.getDate(), lastDay));
    }
    if ("until" in end && next > end.until) break;
    dates.push(next);
  }
  return dates;
}
