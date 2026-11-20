import { useEffect, useState } from 'react';
import type { Row } from './backend';
import { adminMovePunch, adminPunch, approvalsFor, approve, punchesFor, unapprove, voidPunch, type Approval, type Boot, type Staff } from './store';
import { FLAG_TEXT, fmtDay, fmtHours, fmtTime, periodOf, punchTime, shiftsFrom, totals, ymd, type Kind, type Shift } from './time';

const KIND_TEXT: Record<string, string> = { in: 'Clock in', out: 'Clock out', break_start: 'Break start', break_end: 'Break end' };

/** One person's timesheet for a pay period. Admins (admin=true) can fix punches and approve. */
export function PersonTimesheet({ boot, person, admin = false, onBack, initialOffset = 0 }: {
  boot: Boot; person: Staff; admin?: boolean; onBack?: () => void; initialOffset?: number;
}) {
  const [offset, setOffset] = useState(initialOffset);
  const period = periodOf(ymd(new Date()), boot.settings, offset);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const [p, a] = await Promise.all([punchesFor(person.email, period), approvalsFor(period.start)]);
      setShifts(shiftsFrom(p));
      setApproval(a.find((x) => x.person === person.email) ?? null);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { setShifts(null); load(); }, [offset, person.email]);

  const t = shifts ? totals(shifts, period) : null;
  const jobName = (k: string) => boot.jobs.find((j) => j.key === k)?.name ?? '';
  const by = boot.self!.email;
  const locked = !!approval;

  return (
    <div className="sheet">
      <div className="sheet-head">
        {onBack && <button className="btn" onClick={onBack}>← All staff</button>}
        <h2>{admin ? person.name : 'My Time'}</h2>
        <div className="period-nav">
          <button className="btn" onClick={() => setOffset(offset - 1)}>‹</button>
          <span>{fmtDay(period.start, { month: 'short', day: 'numeric' })} – {fmtDay(period.end, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button className="btn" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}>›</button>
        </div>
      </div>
      {error && <div className="note error">{error}</div>}
      {!shifts ? <div className="card muted">Loading…</div> : (
        <>
          <div className="summary">
            <div><b>{fmtHours(t!.total)}</b><span>hours this period</span></div>
            {t!.weeks.map((w, i) => <div key={i} className={w > 40 * 3600000 ? 'over' : ''}><b>{fmtHours(w)}</b><span>week {i + 1}{w > 40 * 3600000 ? ' · over 40' : ''}</span></div>)}
            <div className={approval ? 'ok' : ''}><b>{approval ? 'Approved' : 'Not approved'}</b><span>{approval ? `by ${approval.by} ${new Date(approval.at).toLocaleDateString()}` : 'by an admin'}</span></div>
          </div>
          {admin && (
            <div className="row-actions">
              {approval
                ? <button className="btn" onClick={async () => { await unapprove(approval); load(); }}>Undo approval</button>
                : <button className="btn primary" onClick={async () => { await approve(person.email, period.start, by); load(); }}>Approve this period</button>}
              {!locked && <button className="btn" onClick={() => setAdding(true)}>+ Add a punch</button>}
            </div>
          )}
          {adding && <AddPunch boot={boot} person={person} period={period.days} onDone={() => { setAdding(false); load(); }} />}
          <div className="days">
            {period.days.map((d) => {
              const dayShifts = shifts.filter((s) => s.day === d);
              if (!dayShifts.length && !admin) return null;
              return (
                <div key={d} className={`day ${dayShifts.length ? '' : 'empty'}`}>
                  <div className="day-head"><span>{fmtDay(d)}</span><b>{t!.byDay[d] ? fmtHours(t!.byDay[d]) : '—'}</b></div>
                  {dayShifts.map((s) => (
                    <div key={s.key} className="shift">
                      <div className="shift-main">
                        <span className="times">{fmtTime(s.start)} – {s.end ? fmtTime(s.end) : s.flags.includes('missing-out') ? '??' : 'now'}</span>
                        {jobName(s.job) && <span className="job">{jobName(s.job)}</span>}
                        {s.breaks.length > 0 && <span className="muted small">break {fmtHours(s.breaks.reduce((x, b) => x + ((b.end ?? new Date()).getTime() - b.start.getTime()), 0))}</span>}
                        <b className="hrs">{fmtHours(s.worked)}</b>
                      </div>
                      {s.flags.length > 0 && <div className="flags">{s.flags.map((f) => <span key={f} className={`flag ${f}`}>{FLAG_TEXT[f]}</span>)}</div>}
                      {admin && !locked && <PunchList punches={s.punches} by={by} onChange={load} />}
                    </div>
                  ))}
                </div>
              );
            })}
            {!admin && shifts.length === 0 && <div className="card muted">No time recorded this period yet.</div>}
          </div>
          {!admin && <p className="fine">Something wrong? Tell your supervisor or Mr. Greene and they'll fix it.</p>}
        </>
      )}
    </div>
  );
}

function PunchList({ punches, by, onChange }: { punches: Row[]; by: string; onChange: () => void }) {
  return (
    <ul className="punches">
      {punches.map((p) => (
        <li key={p.Key}>
          <span>{KIND_TEXT[p.Kind] ?? p.Kind}</span>
          <input type="time" defaultValue={toTime(punchTime(p))} onBlur={async (e) => {
            if (!e.target.value || e.target.value === toTime(punchTime(p))) return;
            const [h, m] = e.target.value.split(':').map(Number);
            const d = punchTime(p); d.setHours(h, m, 0, 0);
            await adminMovePunch(p, d, by); onChange();
          }} />
          {typeof p.Lat === 'number' && <a className="small" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${p.Lat},${p.Lng}`}>map</a>}
          <button className="link danger small" onClick={async () => { if (confirm('Remove this punch? It stays in the record as removed.')) { await voidPunch(p, by); onChange(); } }}>remove</button>
        </li>
      ))}
    </ul>
  );
}
const toTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function AddPunch({ boot, person, period, onDone }: { boot: Boot; person: Staff; period: string[]; onDone: () => void }) {
  const [day, setDay] = useState(period.includes(ymd(new Date())) ? ymd(new Date()) : period[0]);
  const [kind, setKind] = useState<Kind>('out');
  const [time, setTime] = useState('16:00');
  const [job, setJob] = useState(person.defaultJob || boot.jobs[0]?.key || '');
  const [note, setNote] = useState('');
  return (
    <div className="card add-punch">
      <div className="grid4">
        <label>Day<select className="input" value={day} onChange={(e) => setDay(e.target.value)}>{period.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</select></label>
        <label>Punch<select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{Object.entries(KIND_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Time<input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label>Job<select className="input" value={job} onChange={(e) => setJob(e.target.value)}><option value="">—</option>{boot.jobs.map((j) => <option key={j.key} value={j.key}>{j.name}</option>)}</select></label>
      </div>
      <label>Reason<input className="input" value={note} placeholder="e.g. forgot to clock out" onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row-actions">
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" onClick={async () => {
          const [y, mo, d] = day.split('-').map(Number); const [h, m] = time.split(':').map(Number);
          await adminPunch(person.email, kind, new Date(y, mo - 1, d, h, m), job, boot.self!.email, note); onDone();
        }}>Save punch</button>
      </div>
    </div>
  );
}
