export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
};

export type VersionedRecord = {
  updatedAt?: string | null;
  version?: number | null;
};

export function formatRelativeUpdateTime(updatedAt: string | null | undefined, now: number, language: "en" | "fr"): string | null {
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || now <= 0) return null;
  const seconds = (timestamp - now) / 1000;
  const magnitude = Math.abs(seconds);
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] = magnitude >= 86400 ? [86400, "day"] : magnitude >= 3600 ? [3600, "hour"] : magnitude >= 60 ? [60, "minute"] : [1, "second"];
  return new Intl.RelativeTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { numeric: "always" }).format(Math.trunc(seconds / divisor), unit);
}

export type CompletionInput = {
  meterReading: unknown;
  unit: string;
  status: string;
};

export type CompletionValidation = {
  valid: boolean;
  errors: string[];
};

export type PmConfig = {
  interval: number;
  meterUnit: "KM" | "HRS";
  checklist?: Record<string, unknown>;
  [key: string]: unknown;
};

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type IdleWorkOrder = {
  id: string;
  unit: string;
  client: string;
  tech: string;
  status: string;
  updatedAt?: string;
};

export function getIdleSignals<T extends IdleWorkOrder>(jobs: readonly T[], now: number, thresholdHours = 4) {
  const threshold = (Number.isFinite(thresholdHours) && thresholdHours > 0 ? thresholdHours : 4) * 3_600_000;
  return jobs.filter((job) => job.status.trim() !== "Completed").flatMap((job) => {
    const status = job.status.trim();
    const unassigned = !job.tech.trim() || job.tech.trim().toLowerCase() === "unassigned";
    const reason = status === "Waiting on Parts" ? "parts" : status === "Waiting on Estimates" ? "estimates" : unassigned ? "unassigned" : null;
    if (!reason) return [];
    const updated = job.updatedAt ? Date.parse(job.updatedAt) : NaN;
    const elapsedMs = Number.isFinite(now) && Number.isFinite(updated) && updated <= now ? now - updated : null;
    return [{ job, reason, unassigned, elapsedMs, stale: elapsedMs != null && elapsedMs >= threshold, critical: elapsedMs != null && elapsedMs >= threshold * 2 }];
  }).sort((left, right) => (right.elapsedMs ?? -1) - (left.elapsedMs ?? -1));
}

export function formatIdleElapsed(elapsedMs: number | null): string {
  if (elapsedMs == null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return "--:--:--";
  const seconds = Math.floor(elapsedMs / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}

export type OfflineMutation<T> = {
  id: string;
  createdAt: string;
  payload: T;
};

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const candidate = error as { code?: string; status?: number; statusCode?: number };
  const status = candidate.status ?? candidate.statusCode;
  if (status != null) return status === 408 || status === 429 || status >= 500;
  return ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "FETCH_ERROR"].includes(candidate.code ?? "");
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = Math.max(0, options.retries ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

export function remoteWins<T extends VersionedRecord>(local: T, remote: T): boolean {
  if (local.version != null && remote.version != null && local.version !== remote.version) {
    return remote.version > local.version;
  }
  if (!remote.updatedAt) return !local.updatedAt;
  if (!local.updatedAt) return true;
  const remoteTime = Date.parse(remote.updatedAt);
  const localTime = Date.parse(local.updatedAt);
  if (!Number.isFinite(remoteTime)) return false;
  if (!Number.isFinite(localTime)) return true;
  return remoteTime > localTime;
}

export function mergeRemoteRecords<T extends VersionedRecord>(local: T[], remote: T[], getId: (record: T) => string): T[] {
  const localById = new Map(local.map((record) => [getId(record), record]));
  const merged = remote.map((record) => {
    const localRecord = localById.get(getId(record));
    return localRecord && !remoteWins(localRecord, record) ? localRecord : record;
  });
  const remoteIds = new Set(remote.map(getId));
  return [...merged, ...local.filter((record) => !remoteIds.has(getId(record)))];
}

// Cheap identity check so a poll tick with no real changes can return the same array reference and let React bail out of re-rendering the whole tree.
export function recordsEqual<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateCompletion(input: CompletionInput): CompletionValidation {
  const errors: string[] = [];
  const reading = Number(input.meterReading);
  if (!input.unit.trim()) errors.push("A unit is required.");
  if (!Number.isFinite(reading) || reading < 0) errors.push("A valid non-negative meter reading is required.");
  if (input.status === "Completed" && errors.length === 0) return { valid: true, errors: [] };
  if (input.status !== "Completed") errors.push("The work order must be completed before finalizing the reading.");
  return { valid: errors.length === 0, errors };
}

export function resolvePmConfig(template: PmConfig, checklist?: Partial<PmConfig>, technicianOverride?: Partial<PmConfig>): PmConfig {
  return {
    ...template,
    ...(checklist ?? {}),
    ...(technicianOverride ?? {}),
  };
}

export type PayrollTimeEntry = {
  totalHours: number | null;
  breakMinutes?: number | null;
  lostTimeMinutes?: number | null;
};

// Unpaid meal breaks reduce net payable hours; lost time (waiting on parts, shop downtime, etc.)
// is still paid, so it's tracked separately and only subtracted when computing billable hours.
export function calculateNetPayableHours(entry: PayrollTimeEntry): number {
  if (entry.totalHours == null) return 0;
  return Math.max(0, entry.totalHours - (entry.breakMinutes ?? 0) / 60);
}

export function calculateBillableHours(entry: PayrollTimeEntry): number {
  return Math.max(0, calculateNetPayableHours(entry) - (entry.lostTimeMinutes ?? 0) / 60);
}

export function calculateGrossPay(entry: PayrollTimeEntry, hourlyRate: number | null | undefined): number {
  if (!hourlyRate) return 0;
  return calculateNetPayableHours(entry) * hourlyRate;
}

export function calculateLostTimeCost(lostTimeMinutes: number | null | undefined, hourlyRate: number | null | undefined): number {
  const minutes = Number(lostTimeMinutes ?? 0);
  const rate = Number(hourlyRate ?? 0);
  if (!Number.isFinite(minutes) || !Number.isFinite(rate) || minutes <= 0 || rate <= 0) return 0;
  return (minutes / 60) * rate;
}

export function enqueueOfflineMutation<T>(storage: StorageLike, key: string, payload: T, id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`): OfflineMutation<T>[] {
  const existing = readOfflineMutations<T>(storage, key);
  const next = [...existing, { id, createdAt: new Date().toISOString(), payload }];
  storage.setItem(key, JSON.stringify(next));
  return next;
}

export function readOfflineMutations<T>(storage: StorageLike, key: string): OfflineMutation<T>[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OfflineMutation<T> => Boolean(item) && typeof item === "object" && typeof (item as OfflineMutation<T>).id === "string" && "payload" in item);
  } catch {
    return [];
  }
}

export function clearOfflineMutations(storage: StorageLike, key: string): void {
  storage.removeItem(key);
}
