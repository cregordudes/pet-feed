import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import type { Session } from './types';

export type AppContextValue = {
  session: Session & { role: NonNullable<Session['role']>; timezone: string; today: string };
  revision: number;
  refresh: () => void;
  go: (href: string) => void;
  path: string;
  reloadSession: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ value, children }: { value: AppContextValue; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('Missing app context');
  return value;
}

export function Link({
  href,
  className,
  children,
  testId,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { go, path } = useApp();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(href);
  };
  return (
    <a href={href} className={className} data-testid={testId} aria-current={path === href ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  );
}
