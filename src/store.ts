import { backend, type Row } from './backend';
import { DEFAULT_SETTINGS, feetBetween, ymd, type Kind, type Period, type Settings } from './time';

export type Staff = { key: string; name: string; email: string; role: 'admin' | 'staff'; active: boolean; defaultJob: string; color: string };
export type Location = { key: string; name: string; lat: number; lng: number; radius: number; mode: 'block' | 'flag'; active: boolean };
export type Job = { key: string; name: string; location: string; active: boolean };
export type Approval = { key: string; person: string; periodStart: string; by: string; at: string };

const newKey = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
const COLORS = ['#4f7cff', '#e8697d', '#21a67a', '#c2410c', '#7c3aed', '#0e7490'];

const staffOf = (r: Row): Staff => ({ key: r.Key, name: r.Title, email: (r.Email ?? '').toLowerCase(), role: r.Role === 'admin' ? 'admin' : 'staff',
  active: r.Active !== 0, defaultJob: r.DefaultJob ?? '', color: r.Color || COLORS[0] });
const locationOf = (r: Row): Location => ({ key: r.Key, name: r.Title, lat: r.Lat, lng: r.Lng, radius: r.Radius ?? 600, mode: r.Mode === 'block' ? 'block' : 'flag', active: r.Active !== 0 });
const jobOf = (r: Row): Job => ({ key: r.Key, name: r.Title, location: r.LocationKey ?? '', active: r.Active !== 0 });

export async function bootstrap() {
  const [me, staff, locations, jobs, settingsRows] = await Promise.all([
    backend.me(), backend.rows('Staff'), backend.rows('Locations'), backend.rows('Jobs'), backend.rows('Settings', { eq: { Key: 'main' } }),
  ]);
  let settings = DEFAULT_SETTINGS;
  try { if (settingsRows[0]?.Json) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRows[0].Json) }; } catch { /* keep defaults */ }
  const all = staff.map(staffOf).sort((a, b) => a.name.localeCompare(b.name));
  return { me, self: all.find((s) => s.email === me.email) ?? null, staff: all,
    locations: locations.map(locationOf), jobs: jobs.map(jobOf).sort((a, b) => a.name.localeCompare(b.name)), settings };
}
export type Boot = Awaited<ReturnType<typeof bootstrap>>;

// ---------- Punches ----------
export const punchesFor = (email: string, p: Period) => backend.rows('Punches', { eq: { PersonEmail: email }, ge: { Day: p.start }, le: { Day: p.end } });
/** Everyone's punches in a range (admins: SharePoint only returns other people's rows to owners). */
export const punchesBetween = (start: string, end: string) => backend.rows('Punches', { ge: { Day: start }, le: { Day: end } });
/** Last few days of my punches, enough to know if I'm on the clock. */
export const recentPunches = (email: string) => {
  const d = new Date(); d.setDate(d.getDate() - 2);
  return backend.rows('Punches', { eq: { PersonEmail: email }, ge: { Day: ymd(d) } });
};

export type Fix = { lat: number; lng: number; accuracy: number } | null;
export function getLocation(): Promise<Fix> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy * 3.281) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** Checks a location against the job's worksite (or the nearest one). */
export function checkSite(fix: Fix, job: Job | undefined, locations: Location[]) {
  const sites = locations.filter((l) => l.active && typeof l.lat === 'number' && typeof l.lng === 'number');
  if (!fix || !sites.length) return { site: sites.find((l) => l.key === job?.location), inside: fix ? null : -1, feet: null as number | null };
  const site = sites.find((l) => l.key === job?.location)
    ?? sites.map((l) => ({ l, d: feetBetween(fix, l) })).sort((a, b) => a.d - b.d)[0].l;
  const feet = Math.round(feetBetween(fix, site));
  return { site, inside: feet <= site.radius ? 1 : 0, feet };
}

/** Records a punch. The punch time is SharePoint's own clock, not the phone's. */
export async function punch(email: string, kind: Kind, job: string, fix: Fix, check: ReturnType<typeof checkSite> | null, note = '') {
  return backend.create('Punches', {
    Key: newKey(), Title: kind, PersonEmail: email, Kind: kind, Day: ymd(new Date()), ClientTime: new Date().toISOString(),
    JobKey: job, LocationKey: check?.site?.key ?? '', Inside: check?.inside ?? -1, Method: 'gps',
    ...(fix ? { Lat: fix.lat, Lng: fix.lng, Accuracy: fix.accuracy } : {}), Note: note,
  });
}

/** An admin adding a punch for someone (forgot to clock out, etc.). */
export function adminPunch(email: string, kind: Kind, when: Date, job: string, by: string, note: string) {
  return backend.create('Punches', {
    Key: newKey(), Title: kind, PersonEmail: email, Kind: kind, Day: ymd(when), At: when.toISOString(), ClientTime: new Date().toISOString(),
    JobKey: job, Inside: 1, Method: 'admin', EnteredBy: by, Note: note,
  });
}
export const adminMovePunch = (p: Row, when: Date, by: string) =>
  backend.update('Punches', p.Key, { At: when.toISOString(), Day: p.Kind === 'in' ? ymd(when) : p.Day, EnteredBy: by });
export const voidPunch = (p: Row, by: string) => backend.update('Punches', p.Key, { Voided: 1, EnteredBy: by });

// ---------- Approvals ----------
export async function approvalsFor(periodStart: string) {
  return (await backend.rows('Approvals', { eq: { PeriodStart: periodStart } }))
    .map((r): Approval => ({ key: r.Key, person: (r.PersonEmail ?? '').toLowerCase(), periodStart: r.PeriodStart, by: r.ApprovedBy, at: r.ApprovedAt }));
}
export const approve = (person: string, periodStart: string, by: string) =>
  backend.create('Approvals', { Key: newKey(), Title: `${person} ${periodStart}`, PersonEmail: person, PeriodStart: periodStart, ApprovedBy: by, ApprovedAt: new Date().toISOString() });
export const unapprove = (a: Approval) => backend.update('Approvals', a.key, { PeriodStart: `undone:${a.periodStart}` });

// ---------- Admin settings ----------
export async function saveSettings(s: Settings) {
  const rows = await backend.rows('Settings', { eq: { Key: 'main' } });
  if (rows[0]) await backend.update('Settings', 'main', { Json: JSON.stringify(s) });
  else await backend.create('Settings', { Key: 'main', Title: 'Settings', Json: JSON.stringify(s) });
}
export const saveLocation = (l: Location, isNew: boolean) => {
  const f = { Title: l.name, Lat: l.lat, Lng: l.lng, Radius: l.radius, Mode: l.mode, Active: l.active ? 1 : 0 };
  return isNew ? backend.create('Locations', { Key: newKey(), ...f }) : backend.update('Locations', l.key, f);
};
export const saveJob = (j: Job, isNew: boolean) => {
  const f = { Title: j.name, LocationKey: j.location, Active: j.active ? 1 : 0 };
  return isNew ? backend.create('Jobs', { Key: newKey(), ...f }) : backend.update('Jobs', j.key, f);
};
export const saveStaff = (s: Staff, isNew: boolean, count: number) => {
  const f = { Title: s.name, Email: s.email.trim().toLowerCase(), Role: s.role, Active: s.active ? 1 : 0, DefaultJob: s.defaultJob,
    Color: s.color || COLORS[count % COLORS.length] };
  return isNew ? backend.create('Staff', { Key: newKey(), ...f }) : backend.update('Staff', s.key, f);
};
export const signOut = () => backend.signOut();
