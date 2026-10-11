import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Link, useApp } from '../app-context';
import { MealList } from '../components/MealList';
import type { HomeResponse } from '../types';

export function TodayPage() {
  const { revision } = useApp();
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .home()
      .then((next) => {
        if (!cancelled) {
          setHome(next);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load today.');
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  if (error) return <p className="message error">{error}</p>;
  if (!home) return <p className="status">Loading…</p>;

  return (
    <>
      <p className="dateline">{home.todayLabel}</p>
      {home.yesterday && (
        <section>
          <h2 className="section">Yesterday</h2>
          <p className="help">{home.yesterday.label}</p>
          <MealList date={home.yesterday.date} slots={home.yesterday.slots} />
        </section>
      )}
      <section>
        <h2 className="section">Today</h2>
        <MealList date={home.today} slots={home.slots} />
      </section>
      <Link href="/times" className="block-link" testId="change-times">
        Change times
      </Link>
    </>
  );
}
