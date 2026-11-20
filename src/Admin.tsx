import { useEffect, useState, type ReactNode } from 'react';
import type { Row } from './backend';
import { approvalsFor, getLocation, punchesBetween, saveJob, saveLocation, saveSettings, saveStaff, type Approval, type Boot, type Job, type Location, type Staff } from './store';
import { PersonTimesheet } from './Timesheet';
import { addDays, FLAG_TEXT, fmtDay, fmtHours, fmtTime, periodOf, shiftsFrom, statusOf, totals, ymd, type Settings } from './time';

const byPerson = (rows: Row[]) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) { const k = (r.PersonEmail ?? '').toLowerCase(); m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
};

/** Who's on the clock right now. */
export function NowScreen({ boot }: { boot: Boot }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => punchesBetween(addDays(ymd(new Date()), -1), ymd(new Date())).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (error) return <div className="note error">{error}</div>;
  if (!rows) return <div className="card muted">Loading…</div>;
  const map = byPerson(rows);
  const list = boot.staff.filter((s) => s.active).map((s) => ({ s, ...statusOf(shiftsFrom(map.get(s.email) ?? [])) }));
  const on = list.filter((x) => x.state !== 'out');
  return (
    <div className="sheet">
      <div className="sheet-head"><h2>Who's In</h2><button className="btn" onClick={load}>Refresh</button></div>
      {on.length === 0 && <div className="card muted">Nobody is on the clock right now.</div>}
      <div className="people">
        {on.map(({ s, state, shift }) => (
          <div key={s.key} className="person">
            <span className="dot" style={{ background: s.color }} />
            <b>{s.name}</b>
            <span className={`pill ${state}`}>{state === 'break' ? 'On break' : 'Working'}</span>
            <span className="muted">since {fmtTime(shift!.start)} · {fmtHours(shift!.worked)}{boot.jobs.find((j) => j.key === shift!.job) ? ` · ${boot.jobs.find((j) => j.key === shift!.job)!.name}` : ''}</span>
            {shift!.flags.filter((f) => f !== 'admin').map((f) => <span key={f} className={`flag ${f}`}>{FLAG_TEXT[f]}</span>)}
          </div>
        ))}
      </div>
      <p className="fine">{list.length - on.length} other staff clocked out.</p>
    </div>
  );
}

/** Everyone's hours for a pay period, with approval status and a payroll export. */
export function TimesheetsScreen({ boot }: { boot: Boot }) {
  const [offset, setOffset] = useState(0);
  const [person, setPerson] = useState<Staff | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const period = periodOf(ymd(new Date()), boot.settings, offset);
  useEffect(() => {
    if (person) return;
    setRows(null);
    Promise.all([punchesBetween(period.start, period.end), approvalsFor(period.start)])
      .then(([r, a]) => { setRows(r); setApprovals(a); }).catch((e) => setError(e.message));
  }, [offset, person]);

  if (person) return <PersonTimesheet boot={boot} person={person} admin initialOffset={offset} onBack={() => setPerson(null)} />;
  if (error) return <div className="note error">{error}</div>;

  const map = rows ? byPerson(rows) : new Map();
  const staff = boot.staff.filter((s) => s.active || map.has(s.email));
  const data = staff.map((s) => {
    const shifts = shiftsFrom(map.get(s.email) ?? []);
    return { s, shifts, t: totals(shifts, period), flags: shifts.reduce((n, x) => n + x.flags.filter((f) => f !== 'admin').length, 0),
      approved: approvals.some((a) => a.person === s.email) };
  });

  const exportCsv = () => {
    const lines = [['Name', 'Email', 'Date', 'Job', 'In', 'Out', 'Break (h:mm)', 'Hours (h:mm)', 'Hours (decimal)', 'Flags', 'Approved']];
    for (const { s, shifts, approved } of data) for (const x of shifts) {
      const br = x.breaks.reduce((t, b) => t + ((b.end ?? new Date()).getTime() - b.start.getTime()), 0);
      lines.push([s.name, s.email, x.day, boot.jobs.find((j) => j.key === x.job)?.name ?? '', fmtTime(x.start), x.end ? fmtTime(x.end) : '',
        fmtHours(br), fmtHours(x.worked), (x.worked / 3600000).toFixed(2), x.flags.map((f) => FLAG_TEXT[f]).join('; '), approved ? 'yes' : 'no']);
    }
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `timesheets-${period.start}-to-${period.end}.csv`;
    a.click();
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Timesheets</h2>
        <div className="period-nav">
          <button className="btn" onClick={() => setOffset(offset - 1)}>‹</button>
          <span>{fmtDay(period.start, { month: 'short', day: 'numeric' })} – {fmtDay(period.end, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button className="btn" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}>›</button>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!rows}>Export for payroll (CSV)</button>
      </div>
      {!rows ? <div className="card muted">Loading…</div> : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr><th>Staff</th>{period.days.map((d) => <th key={d}>{fmtDay(d, { weekday: 'short' })}<br /><small>{fmtDay(d, { month: 'numeric', day: 'numeric' })}</small></th>)}<th>Total</th><th>Issues</th><th>Approved</th></tr>
            </thead>
            <tbody>
              {data.map(({ s, t, flags, approved }) => (
                <tr key={s.key} onClick={() => setPerson(s)}>
                  <td className="name"><span className="dot" style={{ background: s.color }} />{s.name}</td>
                  {period.days.map((d) => <td key={d} className={t.byDay[d] ? 'has' : ''}>{t.byDay[d] ? fmtHours(t.byDay[d]) : '–'}</td>)}
                  <td className={`total ${t.weeks.some((w) => w > 40 * 3600000) ? 'over' : ''}`}>{fmtHours(t.total)}</td>
                  <td>{flags ? <span className="flag outside">{flags}</span> : ''}</td>
                  <td>{approved ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine">Click a name to see each shift, fix punches and approve. Over 40 hours in a week shows in red.</p>
    </div>
  );
}

// ---------- Settings ----------
export function SettingsScreen({ boot, onSaved }: { boot: Boot; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(boot.settings);
  const [saved, setSaved] = useState('');
  const run = async (fn: () => Promise<unknown>, text = 'Saved') => {
    try { await fn(); setSaved(text); onSaved(); setTimeout(() => setSaved(''), 2500); } catch (e: any) { alert(e.message); }
  };
  return (
    <div className="sheet settings">
      <div className="sheet-head"><h2>Settings</h2>{saved && <span className="note ok inline">{saved}</span>}</div>

      <section className="card">
        <h3>Pay period</h3>
        <div className="grid4">
          <label>Length<select className="input" value={s.periodDays} onChange={(e) => setS({ ...s, periodDays: Number(e.target.value) })}>
            <option value={7}>Weekly</option><option value={14}>Every two weeks</option></select></label>
          <label>A period starts on<input className="input" type="date" value={s.anchor} onChange={(e) => setS({ ...s, anchor: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={s.requireLocation} onChange={(e) => setS({ ...s, requireLocation: e.target.checked })} /> Require location to clock in/out</label>
        </div>
        <button className="btn primary" onClick={() => run(() => saveSettings(s))}>Save</button>
      </section>

      <Editor<Location> title="Worksites" hint="Clock-ins are checked against these. Stand at the site and tap “Use my location”, or type the coordinates."
        items={boot.locations} blank={{ key: '', name: '', lat: NaN, lng: NaN, radius: 600, mode: 'flag', active: true }}
        render={(l, set) => (
          <>
            <input className="input" placeholder="Name (e.g. School)" value={l.name} onChange={(e) => set({ ...l, name: e.target.value })} />
            <input className="input num" placeholder="Latitude" value={isNaN(l.lat) ? '' : l.lat} onChange={(e) => set({ ...l, lat: parseFloat(e.target.value) })} />
            <input className="input num" placeholder="Longitude" value={isNaN(l.lng) ? '' : l.lng} onChange={(e) => set({ ...l, lng: parseFloat(e.target.value) })} />
            <button className="btn" onClick={async () => { const f = await getLocation(); if (f) set({ ...l, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6) }); else alert('Location not available'); }}>Use my location</button>
            <label className="inline-label">Radius<input className="input num" type="number" value={l.radius} onChange={(e) => set({ ...l, radius: Number(e.target.value) })} /> ft</label>
            <select className="input" value={l.mode} onChange={(e) => set({ ...l, mode: e.target.value as 'flag' | 'block' })}>
              <option value="flag">Outside: allow, flag for review</option><option value="block">Outside: don't allow</option></select>
            <label className="check"><input type="checkbox" checked={l.active} onChange={(e) => set({ ...l, active: e.target.checked })} /> Active</label>
          </>
        )}
        save={(l, isNew) => run(() => saveLocation(l, isNew))} valid={(l) => !!l.name && !isNaN(l.lat) && !isNaN(l.lng)} />

      <Editor<Job> title="Jobs" hint="What people clock in for (e.g. Office, Custodial, Nursery). Each can belong to a worksite."
        items={boot.jobs} blank={{ key: '', name: '', location: '', active: true }}
        render={(j, set) => (
          <>
            <input className="input" placeholder="Job name" value={j.name} onChange={(e) => set({ ...j, name: e.target.value })} />
            <select className="input" value={j.location} onChange={(e) => set({ ...j, location: e.target.value })}>
              <option value="">Any worksite (nearest)</option>{boot.locations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select>
            <label className="check"><input type="checkbox" checked={j.active} onChange={(e) => set({ ...j, active: e.target.checked })} /> Active</label>
          </>
        )}
        save={(j, isNew) => run(() => saveJob(j, isNew))} valid={(j) => !!j.name} />

      <Editor<Staff> title="Staff" hint="Each person signs in with this school Microsoft email. New people also need to be added to the “IBA Time Clock” group (ask Claude or use the Microsoft 365 admin center). Admins must also be group owners."
        items={boot.staff} blank={{ key: '', name: '', email: '', role: 'staff', active: true, defaultJob: '', color: '' }}
        render={(p, set) => (
          <>
            <input className="input" placeholder="Name" value={p.name} onChange={(e) => set({ ...p, name: e.target.value })} />
            <input className="input" placeholder="school Microsoft email" value={p.email} onChange={(e) => set({ ...p, email: e.target.value })} />
            <select className="input" value={p.role} onChange={(e) => set({ ...p, role: e.target.value as 'admin' | 'staff' })}><option value="staff">Staff</option><option value="admin">Admin</option></select>
            <select className="input" value={p.defaultJob} onChange={(e) => set({ ...p, defaultJob: e.target.value })}>
              <option value="">Default job: none</option>{boot.jobs.map((j) => <option key={j.key} value={j.key}>{j.name}</option>)}</select>
            <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => set({ ...p, active: e.target.checked })} /> Active</label>
          </>
        )}
        save={(p, isNew) => run(() => saveStaff(p, isNew, boot.staff.length))} valid={(p) => !!p.name && p.email.includes('@')} />
    </div>
  );
}

function Editor<T extends { key: string }>({ title, hint, items, blank, render, save, valid }: {
  title: string; hint: string; items: T[]; blank: T;
  render: (item: T, set: (t: T) => void) => ReactNode; save: (item: T, isNew: boolean) => void; valid: (t: T) => boolean;
}) {
  const [edit, setEdit] = useState<Record<string, T>>({});
  const [draft, setDraft] = useState<T | null>(null);
  return (
    <section className="card">
      <h3>{title}</h3>
      <p className="fine">{hint}</p>
      {items.map((it) => {
        const cur = edit[it.key] ?? it;
        const dirty = !!edit[it.key];
        return (
          <div key={it.key} className="edit-row">
            {render(cur, (t) => setEdit({ ...edit, [it.key]: t }))}
            {dirty && <button className="btn primary" disabled={!valid(cur)} onClick={() => { save(cur, false); const e = { ...edit }; delete e[it.key]; setEdit(e); }}>Save</button>}
          </div>
        );
      })}
      {draft ? (
        <div className="edit-row new">
          {render(draft, setDraft)}
          <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
          <button className="btn primary" disabled={!valid(draft)} onClick={() => { save(draft, true); setDraft(null); }}>Add</button>
        </div>
      ) : <button className="btn" onClick={() => setDraft({ ...blank })}>+ Add</button>}
    </section>
  );
}
