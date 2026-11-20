import { useEffect, useState, type ReactNode } from 'react';
import { NowScreen, SettingsScreen, TimesheetsScreen } from './Admin';
import { ClockScreen } from './Clock';
import { PersonTimesheet } from './Timesheet';
import { bootstrap, signOut, type Boot } from './store';

type Tab = 'clock' | 'mytime' | 'now' | 'timesheets' | 'settings';
const tabFromHash = (): Tab => (location.hash.replace('#/', '') as Tab) || 'clock';

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const load = () => bootstrap().then(setBoot).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (error) return <Splash><p>{error}</p><button className="btn gold" onClick={() => signOut()}>Sign in as someone else</button></Splash>;
  if (!boot) return <Splash><p>Signing you in with your school Microsoft account…</p></Splash>;
  if (!boot.self || !boot.self.active) return (
    <Splash>
      <p>You're signed in as <b>{boot.me.email}</b>, but you're not set up on the time clock yet. Ask Mr. Greene to add you.</p>
      <button className="btn gold" onClick={() => signOut()}>Sign in as someone else</button>
    </Splash>
  );

  const admin = boot.self.role === 'admin';
  const tabs: [Tab, string][] = [['clock', 'Clock'], ['mytime', 'My Time'], ...(admin ? [['now', 'Who\'s In'], ['timesheets', 'Timesheets'], ['settings', 'Settings']] as [Tab, string][] : [])];
  const current = tabs.some(([t]) => t === tab) ? tab : 'clock';

  return (
    <div className="app">
      <header className="top">
        <img src="/kings-crest.png" alt="IBA Kings crest" />
        <div className="brand"><span>IBA <b>Time Clock</b></span><small>{boot.self.name}</small></div>
        <button className="btn ghost" onClick={() => signOut()}>Sign out</button>
      </header>
      <nav className="tabs">
        {tabs.map(([t, label]) => <a key={t} href={`#/${t}`} className={t === current ? 'active' : ''}>{label}</a>)}
      </nav>
      <main className="main">
        {current === 'clock' && <ClockScreen boot={boot} />}
        {current === 'mytime' && <PersonTimesheet boot={boot} person={boot.self} />}
        {current === 'now' && admin && <NowScreen boot={boot} />}
        {current === 'timesheets' && admin && <TimesheetsScreen boot={boot} />}
        {current === 'settings' && admin && <SettingsScreen boot={boot} onSaved={load} />}
      </main>
    </div>
  );
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <img src="/kings-crest.png" alt="IBA Kings crest" />
      <h1>IBA <b>Time Clock</b></h1>
      {children}
    </div>
  );
}
