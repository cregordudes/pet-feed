import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Link, useApp } from '../app-context';
import type { HistoryItem } from '../types';

function DayRow({ item, today }: { item: HistoryItem; today: string }) {
  const complete = item.fed === item.total;
  const pastOpen = item.date < today && !complete;
  const countClass = complete ? 'count done' : pastOpen ? 'count open' : 'count';
  return (
    <Link href={`/history/${item.date}`} className="day-link">
      <span>{item.label}</span>
      <span className={countClass}>
        {item.fed} of {item.total}
      </span>
    </Link>
  );
}

export function HistoryPage() {
  const { revision, session } = useApp();
  const [recent, setRecent] = useState<HistoryItem[] | null>(null);
  const [older, setOlder] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((next) => {
        if (!cancelled) {
          setRecent(next.recent);
          setOlder(next.older);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load history.');
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  if (error) return <p className="message error">{error}</p>;
  if (!recent) return <p className="status">Loading…</p>;

  return (
    <>
      <h2 className="section">Recent</h2>
      <div className="day-list">
        {recent.map((item) => (
          <DayRow key={item.date} item={item} today={session.today} />
        ))}
      </div>
      {older.length > 0 && (
        <>
          <h2 className="section">Older</h2>
          <div className="day-list">
            {older.map((item) => (
              <DayRow key={item.date} item={item} today={session.today} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
