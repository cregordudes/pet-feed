import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../app-context';

const FIVE = 'Starts at 09:00, 13:00, 16:00, 19:00, 23:00';
const THREE = 'Starts at 08:00, 14:00, 20:00';

export function TimesPage() {
  const { refresh } = useApp();
  const [times, setTimes] = useState<string[] | null>(null);
  const [mealCount, setMealCount] = useState<3 | 5>(5);
  const [choice, setChoice] = useState<3 | 5 | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .schedule()
      .then((next) => {
        if (cancelled) return;
        setTimes(next.times);
        setMealCount(next.mealCount);
        setChoice(null);
        setEffectiveDate(next.today);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load times.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTimes(scope: 'today' | 'forward') {
    if (!times) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await api.saveTimes(times, scope);
      setTimes(next.times);
      setMealCount(next.mealCount);
      setMessage(scope === 'today' ? 'Saved for today only. Other days stay the same.' : 'Saved from today on. Yesterday stays as it was.');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save times.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCount() {
    if (choice == null) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.saveCount(choice, effectiveDate);
      const next = await api.schedule();
      setTimes(next.times);
      setMealCount(next.mealCount);
      setChoice(null);
      setMessage('Saved from that date on. Earlier days stay as they were.');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the meals.');
    } finally {
      setBusy(false);
    }
  }

  if (!times && !error) return <p className="status">Loading…</p>;

  return (
    <>
      <h2 className="section">Times</h2>
      <p className="help">Today is {mealCount === 5 ? 'five meals' : 'three meals'}. Edits keep a check on the same meal.</p>
      {times?.map((time, index) => (
        <input
          key={index}
          className="time-field"
          type="time"
          step={60}
          aria-label={`Meal ${index + 1}`}
          value={time}
          onChange={(event) => {
            const next = times.slice();
            next[index] = event.target.value;
            setTimes(next);
          }}
        />
      ))}
      <div className="stack">
        <button type="button" data-testid="today-only" disabled={busy || !times} onClick={() => void saveTimes('today')}>
          Today only
        </button>
        <button type="button" className="solid" data-testid="from-now-on" disabled={busy || !times} onClick={() => void saveTimes('forward')}>
          From now on
        </button>
      </div>
      <h2 className="section">Five or three</h2>
      <p className="help">Days before the date stay as they were, including their checks.</p>
      <label className="option">
        <input type="radio" name="count" checked={choice === 5} onChange={() => setChoice(5)} />
        <span>
          <span className="option-title">5 meals</span>
          <span className="help">{FIVE}</span>
        </span>
      </label>
      <label className="option">
        <input type="radio" name="count" checked={choice === 3} onChange={() => setChoice(3)} />
        <span>
          <span className="option-title">3 meals</span>
          <span className="help">{THREE}</span>
        </span>
      </label>
      <label className="field">
        <span>Starting</span>
        <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
      </label>
      <div className="stack">
        <button type="button" className="solid" data-testid="count-from-now-on" disabled={busy || choice == null || choice === mealCount} onClick={() => void saveCount()}>
          From now on
        </button>
      </div>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {error && <p className="message error">{error}</p>}
    </>
  );
}
