import { useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../app-context';
import type { Role, Slot } from '../types';

function RoleChip({ role }: { role: Role }) {
  return <span className={role === 'Husband' ? 'chip husband' : 'chip wife'}>{role}</span>;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M5 12.5 9.2 17 19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MealRow({ slot, date, actorRole }: { slot: Slot; date: string; actorRole: Role }) {
  const { refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.check?.comment ?? '');
  const other = Boolean(slot.check && slot.check.role !== actorRole);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    await run(async () => {
      if (slot.check) await api.uncheck(date, slot.position);
      else await api.check(date, slot.position);
    });
  }

  async function saveNote() {
    await run(async () => {
      await api.comment(date, slot.position, draft);
      setEditing(false);
    });
  }

  const label = slot.check
    ? `${slot.time}, checked by ${slot.check.role} at ${slot.check.checkedTime}. Uncheck.`
    : `${slot.time}, ${slot.status}. Mark fed.`;

  return (
    <article className={`meal ${slot.status}${other ? ' other' : ''}`}>
      <div className="meal-main">
        <p className="time">{slot.time}</p>
        {slot.status === 'fed' && slot.check && other && (
          <p className="fed-line other">
            <RoleChip role={slot.check.role} />
            <span>already fed them</span>
            <span className="tap-time">{slot.check.checkedTime}</span>
          </p>
        )}
        {slot.status === 'fed' && slot.check && !other && (
          <p className="fed-line">
            <RoleChip role={slot.check.role} />
            <span className="tap-time">{slot.check.checkedTime}</span>
          </p>
        )}
        {slot.status === 'overdue' && <p className="state">Overdue</p>}
        {slot.status === 'upcoming' && <p className="state">Upcoming</p>}
        {slot.extra && <p className="extra">Extra feeding</p>}
        {slot.check?.comment && !editing && <p className="note-text">{slot.check.comment}</p>}
        {slot.check && !editing && (
          <button
            type="button"
            className="text-button"
            data-testid={`note-${slot.position}`}
            onClick={() => {
              setDraft(slot.check?.comment ?? '');
              setEditing(true);
            }}
          >
            {slot.check.comment ? 'Edit note' : 'Add a note'}
          </button>
        )}
        {slot.check && editing && (
          <form
            className="note-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            <input
              aria-label={`Note for ${slot.time}`}
              data-testid={`note-input-${slot.position}`}
              maxLength={140}
              value={draft}
              placeholder="Short note"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" data-testid={`save-note-${slot.position}`} disabled={busy}>
              Save
            </button>
          </form>
        )}
        {error && <p className="row-error">{error}</p>}
      </div>
      <button
        type="button"
        className="check"
        data-testid={`check-${date}-${slot.position}`}
        aria-pressed={Boolean(slot.check)}
        aria-label={label}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {slot.check ? <CheckIcon /> : null}
      </button>
    </article>
  );
}

export function MealList({ date, slots }: { date: string; slots: Slot[] }) {
  const { session } = useApp();
  if (!session.role) return null;
  return (
    <div className="meals">
      {slots.map((slot) => (
        <MealRow key={`${date}-${slot.position}`} slot={slot} date={date} actorRole={session.role} />
      ))}
    </div>
  );
}
