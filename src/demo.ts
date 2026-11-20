// Made-up data for previewing on this Mac only (npm run dev, then /?demo).
// No real staff or hours; the live site never uses this.
import type { Backend, Filter, ListName, Row } from './backend';

const now = new Date();
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d; };
const row = (f: Record<string, any>, created = now): Row => ({ ...f, Key: f.Key, _created: iso(created), _modified: iso(created) });

let n = 0;
const punch = (who: string, kind: string, d: Date, extra: Record<string, any> = {}) =>
  row({ Key: `dp${n++}`, PersonEmail: who, Kind: kind, Day: day(d), JobKey: 'j1', LocationKey: 'l1', Inside: 1, Method: 'gps', ...extra }, d);

const data: Record<ListName, Row[]> = {
  Staff: [
    row({ Key: 's1', Title: 'Demo Admin', Email: 'admin@example.org', Role: 'admin', Active: 1, Color: '#e8697d' }),
    row({ Key: 's2', Title: 'Office Helper', Email: 'helper@example.org', Role: 'staff', Active: 1, Color: '#4f7cff' }),
    row({ Key: 's3', Title: 'Custodian', Email: 'custodian@example.org', Role: 'staff', Active: 1, Color: '#21a67a' }),
  ],
  Locations: [row({ Key: 'l1', Title: 'School building', Lat: 38.7795, Lng: -76.8902, Radius: 600, Mode: 'flag', Active: 1 })],
  Jobs: [row({ Key: 'j1', Title: 'Office', LocationKey: 'l1', Active: 1 }), row({ Key: 'j2', Title: 'Custodial', LocationKey: 'l1', Active: 1 })],
  Punches: [
    ...[3, 2, 1].flatMap((d) => [
      punch('helper@example.org', 'in', at(d, 8)), punch('helper@example.org', 'break_start', at(d, 12)),
      punch('helper@example.org', 'break_end', at(d, 12, 30)), punch('helper@example.org', 'out', at(d, 16, 15)),
    ]),
    punch('custodian@example.org', 'in', at(2, 15), { JobKey: 'j2', Inside: 0 }),
    punch('custodian@example.org', 'in', at(1, 15), { JobKey: 'j2' }), punch('custodian@example.org', 'out', at(1, 20, 45), { JobKey: 'j2' }),
    punch('helper@example.org', 'in', at(0, 7, 55)),
  ],
  Approvals: [],
  Settings: [row({ Key: 'main', Json: JSON.stringify({ periodDays: 14, anchor: '2026-11-08', requireLocation: false }) })],
};

const match = (r: Row, f?: Filter) =>
  Object.entries(f?.eq ?? {}).every(([k, v]) => r[k] === v) &&
  Object.entries(f?.ge ?? {}).every(([k, v]) => String(r[k] ?? '') >= v) &&
  Object.entries(f?.le ?? {}).every(([k, v]) => String(r[k] ?? '') <= v);

const who = new URLSearchParams(location.search).get('demo') === 'staff' ? data.Staff[1] : data.Staff[0];

export const demoBackend: Backend = {
  me: async () => ({ name: who.Title, email: who.Email }),
  rows: async (list, f) => data[list].filter((r) => match(r, f)).map((r) => ({ ...r })),
  create: async (list, fields) => { const r = row(fields); data[list].push(r); return { ...r }; },
  update: async (list, key, fields) => {
    const r = data[list].find((x) => x.Key === key);
    if (r) Object.assign(r, fields, { _modified: iso(new Date()) });
  },
  signOut: async () => { location.reload(); },
};
