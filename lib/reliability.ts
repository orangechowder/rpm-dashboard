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
