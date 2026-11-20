// Pay periods, turning punches into shifts, totals and flags.
import type { Row } from './backend';

export type Settings = {
  /** 7 = weekly, 14 = every two weeks */
  periodDays: number;
  /** First day of any one pay period (YYYY-MM-DD); later periods follow from it. */
  anchor: string;
  /** Refuse to clock in/out when the phone won't share its location. */
  requireLocation: boolean;
};
export const DEFAULT_SETTINGS: Settings = { periodDays: 14, anchor: '2026-11-08', requireLocation: false };

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };

export type Period = { start: string; end: string; days: string[] };
export function periodOf(date: string, s: Settings, offset = 0): Period {
  const diff = Math.round((parseDay(date).getTime() - parseDay(s.anchor).getTime()) / 86400000);
  const k = Math.floor(diff / s.periodDays) + offset;
  const start = addDays(s.anchor, k * s.periodDays);
  const days = Array.from({ length: s.periodDays }, (_, i) => addDays(start, i));
  return { start, end: days[days.length - 1], days };
}

/** When the punch happened: the time an admin set, otherwise SharePoint's own server time. */
export const punchTime = (p: Row) => new Date(p.At || p._created);
export type Kind = 'in' | 'out' | 'break_start' | 'break_end';

export type Flag = 'outside' | 'no-location' | 'missing-out' | 'open-break' | 'admin' | 'changed';
export const FLAG_TEXT: Record<Flag, string> = {
  outside: 'Clocked in or out outside the worksite',
  'no-location': 'No location shared',
  'missing-out': 'No clock-out',
  'open-break': 'Break never ended',
  admin: 'Entered or changed by an admin',
  changed: 'Edited by the staff member outside the app',
};

export type Shift = {
  key: string;
  person: string;
  day: string;
  job: string;
  start: Date;
  end: Date | null;
  breaks: { start: Date; end: Date | null }[];
  /** Worked time in ms, breaks taken out. Open shifts count up to now (or 0 if stale). */
  worked: number;
  punches: Row[];
  flags: Flag[];
};

const STALE_MS = 16 * 3600 * 1000;

/** Builds shifts from one person's punches (any order). */
export function shiftsFrom(punches: Row[], nowMs = Date.now()): Shift[] {
  const ps = punches.filter((p) => !p.Voided).sort((a, b) => punchTime(a).getTime() - punchTime(b).getTime());
  const out: Shift[] = [];
  let cur: Shift | null = null;
  const flagPunch = (s: Shift, p: Row) => {
    if (p.Inside === 0) s.flags.push('outside');
    if (p.Inside === -1 && (p.Kind === 'in' || p.Kind === 'out')) s.flags.push('no-location');
    // Staff punches are never edited by the app as that staff member, so a later change
    // is either an admin's fix (shown as 'admin') or someone editing their own punch
    // directly in SharePoint (shown as 'changed').
    const edited = new Date(p._modified).getTime() - new Date(p._created).getTime() > 60_000;
    const byOwner = p._modifiedBy && p._modifiedBy === String(p.PersonEmail).toLowerCase();
    if (p.Method === 'admin' || (edited && !byOwner && (p.EnteredBy || p.At || p.Voided))) s.flags.push('admin');
    else if (edited) s.flags.push('changed');
  };
  const close = (s: Shift, end: Date | null) => {
    s.end = end;
    const last = s.breaks[s.breaks.length - 1];
    if (last && !last.end) { last.end = end; if (end) s.flags.push('open-break'); }
    const stop = end ?? (nowMs - s.start.getTime() > STALE_MS ? null : new Date(nowMs));
    if (!end && !stop) s.flags.push('missing-out');
    const breakMs = s.breaks.reduce((t, b) => t + ((b.end ?? stop ?? b.start).getTime() - b.start.getTime()), 0);
    s.worked = stop ? Math.max(0, stop.getTime() - s.start.getTime() - breakMs) : 0;
    s.flags = [...new Set(s.flags)];
    out.push(s);
  };
  for (const p of ps) {
    const t = punchTime(p);
    if (p.Kind === 'in') {
      if (cur) { cur.flags.push('missing-out'); close(cur, null); }
      cur = { key: p.Key, person: p.PersonEmail, day: p.Day, job: p.JobKey ?? '', start: t, end: null, breaks: [], worked: 0, punches: [p], flags: [] };
      flagPunch(cur, p);
    } else if (cur) {
      cur.punches.push(p);
      flagPunch(cur, p);
      if (p.Kind === 'break_start') cur.breaks.push({ start: t, end: null });
      else if (p.Kind === 'break_end') { const b = cur.breaks[cur.breaks.length - 1]; if (b && !b.end) b.end = t; }
      else if (p.Kind === 'out') { close(cur, t); cur = null; }
    }
  }
  if (cur) close(cur, null);
  return out;
}

/** Where someone stands right now, from their latest shift. */
export function statusOf(shifts: Shift[]): { state: 'out' | 'in' | 'break'; shift?: Shift } {
  const s = shifts[shifts.length - 1];
  if (!s || s.end || s.flags.includes('missing-out')) return { state: 'out' };
  const last = s.punches[s.punches.length - 1]?.Kind as Kind;
  return { state: last === 'break_start' ? 'break' : 'in', shift: s };
}

export const hours = (ms: number) => ms / 3600000;
export const fmtHours = (ms: number) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
export const fmtTime = (d: Date | null) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDay = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  parseDay(s).toLocaleDateString('en-US', opts);

/** Total worked per day, and per 7-day week of the period (to spot overtime). */
export function totals(shifts: Shift[], period: Period) {
  const byDay: Record<string, number> = Object.fromEntries(period.days.map((d) => [d, 0]));
  for (const s of shifts) if (s.day in byDay) byDay[s.day] += s.worked;
  const weeks = [];
  for (let i = 0; i < period.days.length; i += 7) weeks.push(period.days.slice(i, i + 7).reduce((t, d) => t + byDay[d], 0));
  return { byDay, weeks, total: weeks.reduce((a, b) => a + b, 0) };
}

/** Distance in feet between two points (haversine). */
export function feetBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 20902231; // earth radius in feet
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
