export type Role = 'Husband' | 'Wife';

export type Session = {
  devMode: boolean;
  email: string | null;
  role: Role | null;
  needsRole: boolean;
  blocked: boolean;
  availableRoles: Role[];
  timezone: string | null;
  today: string | null;
  startedOn: string | null;
  todayLabel: string | null;
  people: { role: Role; email: string }[];
};

export type Slot = {
  position: number;
  time: string;
  extra: boolean;
  status: 'fed' | 'overdue' | 'upcoming';
  check: null | {
    role: Role;
    checkedAt: string;
    checkedTime: string;
    comment: string;
  };
};

export type HomeResponse = {
  today: string;
  todayLabel: string;
  timezone: string;
  mealCount: number;
  yesterday: null | { date: string; label: string; slots: Slot[] };
  slots: Slot[];
};

export type HistoryItem = {
  date: string;
  label: string;
  fed: number;
  total: number;
};

export type DayResponse = {
  date: string;
  label: string;
  mealCount: number;
  isToday: boolean;
  slots: Slot[];
};

export type ScheduleResponse = {
  today: string;
  mealCount: 3 | 5;
  times: string[];
};
