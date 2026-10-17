/* P3 careers — typed REST client (game money only). */

export interface CareerRankInfo {
  title: string;
  payPerShift: number;
  minShifts: number;
  current: boolean;
}

export interface ScheduleDay {
  day: string;
  work: boolean;
}

export interface PendingEvent {
  id: string;
  title: string;
  flavor: string;
  choices: { id: string; label: string }[];
  expiresAt: number;
}

export interface CareerStatus {
  employed: boolean;
  careerId?: string;
  careerName?: string;
  careerIcon?: string;
  blurb?: string;
  rank?: number;
  rankOf?: number;
  rankTitle?: string;
  payPerShift?: number;
  energyCost?: number;
  workplaceId?: string;
  performance?: number | null;
  shiftsAtRank?: number;
  shiftsNeeded?: number;
  promotionReady?: boolean;
  nextRank?: { title: string; payPerShift: number; shiftsNeeded: number } | null;
  ladder?: CareerRankInfo[];
  schedule?: string;
  scheduleStrip?: ScheduleDay[];
  dayOffToday?: boolean;
  autoStart?: boolean;
  onShift?: boolean;
  shiftEndsAt?: number | null;
  shiftRoleId?: string;
  pendingEvent?: PendingEvent | null;
}

export interface CareerListing {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  path: string;
  energyCost: number;
  workplaceId: string;
  certRequired: boolean;
  skillLock: { skill: string; level: number } | null;
  schedule: string;
  scheduleStrip: ScheduleDay[];
  payBand: [number, number];
  ranks: { title: string; payPerShift: number; minShifts: number }[];
}

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function req<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...auth(token), ...(init?.headers ?? {}) },
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export const careersApi = {
  list: () => req<{ careers: CareerListing[] }>(`/api/careers`, ""),
  me: (token: string) => req<CareerStatus>(`/api/careers/me`, token),
  apply: (token: string, careerId: string) =>
    req<{ ok: true; switching: boolean; status: CareerStatus }>(`/api/careers/apply`, token, {
      method: "POST",
      body: JSON.stringify({ careerId }),
    }),
  quit: (token: string) =>
    req<{ ok: true; careerName: string }>(`/api/careers/quit`, token, { method: "POST" }),
  promote: (token: string) =>
    req<{ ok: true; newTitle: string; status: CareerStatus }>(`/api/careers/promote`, token, {
      method: "POST",
    }),
  auto: (token: string, on: boolean) =>
    req<{ ok: true; auto: boolean }>(`/api/careers/auto`, token, {
      method: "POST",
      body: JSON.stringify({ on }),
    }),
  respond: (token: string, eventId: string, choiceId: string) =>
    req<{ ok: true; performance: number; delta: number; timedOut: boolean }>(
      `/api/careers/respond`,
      token,
      { method: "POST", body: JSON.stringify({ eventId, choiceId }) },
    ),
};

export const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");
