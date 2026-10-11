import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Link, useApp } from '../app-context';
import { MealList } from '../components/MealList';
import type { DayResponse } from '../types';

export function DayPage({ date }: { date: string }) {
  const { revision } = useApp();
  const [day, setDay] = useState<DayResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .day(date)
      .then((next) => {
        if (!cancelled) {
          setDay(next);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not open that day.');
      });
    return () => {
      cancelled = true;
    };
  }, [date, revision]);

  if (error) {
    return (
      <>
        <p className="message error">{error}</p>
        <Link href="/history" className="text-link">
          History
        </Link>
      </>
    );
  }
  if (!day) return <p className="status">Loading…</p>;

  return (
    <>
      <p className="dateline">{day.label}</p>
      <MealList date={day.date} slots={day.slots} />
      <Link href="/history" className="text-link">
        History
      </Link>
    </>
  );
}
