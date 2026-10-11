import { useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../app-context';

export function SettingsPage() {
  const { session, reloadSession, refresh } = useApp();
  const [timezone, setTimezone] = useState(session.timezone);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveTimezone(next: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.setTimezone(next);
      await reloadSession();
      refresh();
      setMessage('Timezone saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the timezone.');
    } finally {
      setBusy(false);
    }
  }

  async function swap() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.swapRoles();
      await reloadSession();
      refresh();
      setMessage('Husband and Wife are swapped.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not swap roles.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section">Timezone</h2>
      <p className="help">Today and overdue follow this clock. It was saved from the browser the first time the list was opened.</p>
      <label className="field">
        <span>Household timezone</span>
        <input className="text" value={timezone} onChange={(event) => setTimezone(event.target.value)} spellCheck={false} />
      </label>
      <div className="stack">
        <button type="button" disabled={busy} onClick={() => void saveTimezone(timezone)}>
          Save timezone
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const next = Intl.DateTimeFormat().resolvedOptions().timeZone;
            setTimezone(next);
            void saveTimezone(next);
          }}
        >
          Use this phone’s timezone
        </button>
      </div>
      <h2 className="section">Roles</h2>
      {session.devMode ? (
        <p className="help">
          Local development uses the Husband / Wife switch at the top. That switch stays off when Cloudflare Access is configured.
        </p>
      ) : (
        <>
          <ul className="people">
            {session.people.map((person) => (
              <li key={person.email}>
                <span className={person.role === 'Husband' ? 'chip husband' : 'chip wife'}>{person.role}</span>
                <span>{person.email}</span>
              </li>
            ))}
          </ul>
          <p className="help">If the first pick was wrong, swap the two roles. Each role stays with its email.</p>
          <div className="stack">
            <button type="button" disabled={busy || session.people.length === 0} onClick={() => void swap()}>
              Swap Husband and Wife
            </button>
          </div>
        </>
      )}
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {error && <p className="message error">{error}</p>}
    </>
  );
}
