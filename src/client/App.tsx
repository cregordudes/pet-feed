import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { AppProvider, Link, useApp } from './app-context';
import { DayPage } from './pages/DayPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimesPage } from './pages/TimesPage';
import { TodayPage } from './pages/TodayPage';
import type { Role, Session } from './types';

function Title({ children }: { children?: ReactNode }) {
  return (
    <header className="top">
      <h1>Cats.</h1>
      {children}
    </header>
  );
}

function DevSwitch() {
  const { session, reloadSession, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  async function choose(role: Role) {
    if (role === session.role) return;
    setBusy(true);
    try {
      await api.setDevRole(role);
      await reloadSession();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-switch" role="group" aria-label="Act as">
      {(['Husband', 'Wife'] as const).map((role) => (
        <button
          key={role}
          type="button"
          className={`switch ${role === 'Husband' ? 'husband' : 'wife'}${session.role === role ? ' on' : ''}`}
          aria-pressed={session.role === role}
          data-testid={`dev-${role.toLowerCase()}`}
          disabled={busy}
          onClick={() => void choose(role)}
        >
          {role}
        </button>
      ))}
    </div>
  );
}

function YouAre() {
  const { session } = useApp();
  if (!session.role) return null;
  return (
    <p className={session.role === 'Husband' ? 'chip husband you' : 'chip wife you'} aria-label={`You are ${session.role}`}>
      {session.role}
    </p>
  );
}

function Shell() {
  const { path } = useApp();
  const { session } = useApp();
  let page;
  if (path === '/') page = <TodayPage />;
  else if (path === '/history') page = <HistoryPage />;
  else if (path.startsWith('/history/')) page = <DayPage date={decodeURIComponent(path.slice('/history/'.length))} />;
  else if (path === '/times') page = <TimesPage />;
  else if (path === '/settings') page = <SettingsPage />;
  else {
    page = (
      <>
        <p className="dateline">That page isn’t here.</p>
        <Link href="/" className="text-link">
          Today
        </Link>
      </>
    );
  }

  return (
    <div className="wrap">
      <Title>{session.devMode ? <DevSwitch /> : <YouAre />}</Title>
      <nav>
        <Link href="/">Today</Link>
        <Link href="/history" testId="nav-history">
          History
        </Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main>{page}</main>
    </div>
  );
}

function PickRole({
  session,
  onClaimed,
}: {
  session: Session;
  onClaimed: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function claim(role: Role) {
    setBusy(true);
    setError('');
    try {
      await api.claimRole(role);
      await onClaimed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that role.');
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <Title />
      <h2 className="section">Who is this?</h2>
      <p className="dateline">{session.email}</p>
      <p className="help">This choice stays with that email. The other role stays open for the other person.</p>
      <div className="stack">
        {session.availableRoles.map((role) => (
          <button key={role} type="button" className="solid" disabled={busy} onClick={() => void claim(role)}>
            {role}
          </button>
        ))}
      </div>
      {error && <p className="message error">{error}</p>}
    </div>
  );
}

function Blocked({ email }: { email: string | null }) {
  return (
    <div className="wrap">
      <Title />
      <p className="dateline">This email isn’t on the list.</p>
      <p className="help">
        {email ? `${email} isn’t` : 'This login isn’t'} one of the two people already named Husband and Wife.
      </p>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState('');
  const [path, setPath] = useState(() => window.location.pathname);
  const [revision, setRevision] = useState(0);

  const reloadSession = useCallback(async () => {
    let next = await api.session();
    if (!next.timezone && !next.blocked) {
      await api.setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      next = await api.session();
    }
    setSession(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    reloadSession().catch((error: unknown) => {
      if (!cancelled) setBootError(error instanceof Error ? error.message : 'Could not open the list.');
    });
    return () => {
      cancelled = true;
    };
  }, [reloadSession]);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((href: string) => {
    window.history.pushState({}, '', href);
    setPath(window.location.pathname);
  }, []);

  if (bootError) {
    return (
      <div className="wrap">
        <Title />
        <p className="message error">{bootError}</p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="wrap">
        <Title />
        <p className="status">Loading…</p>
      </div>
    );
  }
  if (session.blocked) return <Blocked email={session.email} />;
  if (session.needsRole) return <PickRole session={session} onClaimed={reloadSession} />;
  if (!session.role || !session.timezone || !session.today) {
    return (
      <div className="wrap">
        <Title />
        <p className="status">Loading…</p>
      </div>
    );
  }

  const ready = session as Session & { role: NonNullable<Session['role']>; timezone: string; today: string };

  return (
    <AppProvider
      value={{
        session: ready,
        revision,
        refresh: () => setRevision((value) => value + 1),
        go,
        path,
        reloadSession,
      }}
    >
      <Shell />
    </AppProvider>
  );
}
