import { useEffect, useState } from 'react';
import { checkSite, getLocation, punch, recentPunches, type Boot } from './store';
import { fmtHours, fmtTime, shiftsFrom, statusOf, type Kind, type Shift } from './time';

/** The staff screen: one big button. */
export function ClockScreen({ boot }: { boot: Boot }) {
  const me = boot.self!;
  const jobs = boot.jobs.filter((j) => j.active);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [job, setJob] = useState(me.defaultJob || jobs[0]?.key || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [, tick] = useState(0);

  const load = () => recentPunches(me.email).then((p) => setShifts(shiftsFrom(p))).catch((e) => setMsg({ kind: 'error', text: e.message }));
  useEffect(() => { load(); const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  if (!shifts) return <div className="card muted">Loading…</div>;
  const { state, shift } = statusOf(shifts);

  const doPunch = async (kind: Kind) => {
    setMsg(null);
    try {
      let fix = null, check = null;
      if (kind === 'in' || kind === 'out') {
        setBusy('Getting your location…');
        fix = await getLocation();
        const jobObj = boot.jobs.find((j) => j.key === (kind === 'out' ? shift?.job : job));
        check = checkSite(fix, jobObj, boot.locations);
        if (!fix && boot.settings.requireLocation) {
          setMsg({ kind: 'error', text: 'Your phone didn\'t share its location. Turn on Location for your browser (Settings → Privacy → Location Services) and try again.' });
          setBusy(null); return;
        }
        if (check.inside === 0 && check.site?.mode === 'block') {
          setMsg({ kind: 'error', text: `You're about ${check.feet} ft from ${check.site.name}. You need to be at the worksite to clock ${kind}.` });
          setBusy(null); return;
        }
      }
      setBusy('Saving…');
      await punch(me.email, kind, kind === 'in' ? job : shift?.job ?? job, fix, check);
      const done = { in: 'Clocked in', out: 'Clocked out', break_start: 'Break started', break_end: 'Back from break' }[kind];
      if (check?.inside === 0) setMsg({ kind: 'warn', text: `${done}. You were about ${check.feet} ft from ${check.site?.name}, so this will be checked by an admin.` });
      else if (check?.inside === -1 && (kind === 'in' || kind === 'out')) setMsg({ kind: 'warn', text: `${done}, without a location. An admin may ask about it.` });
      else setMsg({ kind: 'ok', text: `${done} at ${fmtTime(new Date())}.` });
      await load();
    } catch (e: any) { setMsg({ kind: 'error', text: e.message }); }
    setBusy(null);
  };

  const jobName = (k: string) => boot.jobs.find((j) => j.key === k)?.name;
  return (
    <div className="clock">
      <div className={`status-card ${state}`}>
        <div className="status-label">{state === 'out' ? 'Clocked out' : state === 'break' ? 'On break' : 'On the clock'}</div>
        {shift && (
          <>
            <div className="status-big">{fmtHours(shift.worked)}</div>
            <div className="status-sub">since {fmtTime(shift.start)}{jobName(shift.job) ? ` · ${jobName(shift.job)}` : ''}</div>
          </>
        )}
        {!shift && <div className="status-sub">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>}
      </div>

      {state === 'out' && jobs.length > 1 && (
        <label className="field">Job
          <select className="input" value={job} onChange={(e) => setJob(e.target.value)}>
            {jobs.map((j) => <option key={j.key} value={j.key}>{j.name}</option>)}
          </select>
        </label>
      )}

      <div className="actions">
        {state === 'out' && <button className="big-btn in" disabled={!!busy} onClick={() => doPunch('in')}>Clock In</button>}
        {state === 'in' && <>
          <button className="big-btn out" disabled={!!busy} onClick={() => doPunch('out')}>Clock Out</button>
          <button className="btn wide" disabled={!!busy} onClick={() => doPunch('break_start')}>Start Break</button>
        </>}
        {state === 'break' && <button className="big-btn in" disabled={!!busy} onClick={() => doPunch('break_end')}>End Break</button>}
      </div>
      {busy && <div className="note">{busy}</div>}
      {msg && <div className={`note ${msg.kind}`}>{msg.text}</div>}
      <p className="fine">Your location is checked only when you clock in or out, never in between.</p>
    </div>
  );
}
