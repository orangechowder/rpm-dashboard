import { describe, expect, it } from "vitest";
import { calculateBillableHours, calculateGrossPay, calculateLostTimeCost, calculateNetPayableHours, clearOfflineMutations, enqueueOfflineMutation, mergeRemoteRecords, readOfflineMutations, recordsEqual, remoteWins, resolvePmConfig, validateCompletion, withRetry, type StorageLike } from "./reliability";

const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe("withRetry", () => {
  it("retries transient failures with exponential delays", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await expect(withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw { status: 503 };
      return "saved";
    }, { baseDelayMs: 10, sleep: async (delay) => { delays.push(delay); } })).resolves.toBe("saved");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it("does not retry validation or authorization failures", async () => {
    let attempts = 0;
    await expect(withRetry(async () => {
      attempts += 1;
      throw { status: 400 };
    }, { sleep: async () => undefined })).rejects.toMatchObject({ status: 400 });
    expect(attempts).toBe(1);
  });
});

describe("remoteWins", () => {
  it("rejects an older cloud snapshot", () => {
    expect(remoteWins({ updatedAt: "2026-09-08T12:00:00Z" }, { updatedAt: "2026-09-08T11:59:00Z" })).toBe(false);
  });

  it("accepts a newer cloud snapshot and prefers explicit versions", () => {
    expect(remoteWins({ version: 2, updatedAt: "2026-09-08T12:00:00Z" }, { version: 3, updatedAt: "2026-09-08T11:00:00Z" })).toBe(true);
    expect(remoteWins({ version: 3 }, { version: 2, updatedAt: "2026-09-08T13:00:00Z" })).toBe(false);
  });

  it("accepts unversioned remote data only when the local record is also unversioned", () => {
    expect(remoteWins({}, {})).toBe(true);
    expect(remoteWins({ updatedAt: "2026-09-08T12:00:00Z" }, {})).toBe(false);
  });
});

describe("mergeRemoteRecords", () => {
  it("keeps newer local records and preserves local unsynced records", () => {
    const merged = mergeRemoteRecords(
      [{ id: "one", updatedAt: "2026-09-08T12:00:00Z", value: "local" }, { id: "two", value: "pending" }],
      [{ id: "one", updatedAt: "2026-09-08T11:00:00Z", value: "stale" }, { id: "three", updatedAt: "2026-09-08T13:00:00Z", value: "remote" }],
      (record) => record.id,
    );
    expect(merged).toEqual([{ id: "one", updatedAt: "2026-09-08T12:00:00Z", value: "local" }, { id: "three", updatedAt: "2026-09-08T13:00:00Z", value: "remote" }, { id: "two", value: "pending" }]);
  });
});

describe("recordsEqual", () => {
  it("returns true for identical content regardless of array identity", () => {
    expect(recordsEqual([{ id: "1" }], [{ id: "1" }])).toBe(true);
  });

  it("returns false when content differs", () => {
    expect(recordsEqual([{ id: "1" }], [{ id: "2" }])).toBe(false);
    expect(recordsEqual([{ id: "1" }], [])).toBe(false);
  });
});

describe("validateCompletion", () => {
  it("requires a valid reading and completed status", () => {
    expect(validateCompletion({ meterReading: "125000", unit: "TRK-1", status: "Completed" })).toEqual({ valid: true, errors: [] });
    expect(validateCompletion({ meterReading: "-1", unit: "TRK-1", status: "Completed" }).valid).toBe(false);
    expect(validateCompletion({ meterReading: "125000", unit: "TRK-1", status: "In Progress" }).valid).toBe(false);
  });
});

describe("resolvePmConfig", () => {
  it("gives technician overrides precedence over checklist and template defaults", () => {
    const resolved = resolvePmConfig(
      { interval: 25000, meterUnit: "KM", checklist: { brakes: "default" } },
      { interval: 20000, checklist: { brakes: "check" } },
      { interval: 15000, checklist: { brakes: "manual" } },
    );
    expect(resolved.interval).toBe(15000);
    expect(resolved.checklist).toEqual({ brakes: "manual" });
  });
});

describe("payroll calculations", () => {
  it("subtracts unpaid break minutes from gross hours for net payable hours", () => {
    expect(calculateNetPayableHours({ totalHours: 8, breakMinutes: 30 })).toBeCloseTo(7.5);
    expect(calculateNetPayableHours({ totalHours: null, breakMinutes: 30 })).toBe(0);
    expect(calculateNetPayableHours({ totalHours: 1, breakMinutes: 120 })).toBe(0);
  });

  it("further subtracts lost time minutes for billable hours, but not from net payable hours", () => {
    const entry = { totalHours: 8, breakMinutes: 30, lostTimeMinutes: 60 };
    expect(calculateNetPayableHours(entry)).toBeCloseTo(7.5);
    expect(calculateBillableHours(entry)).toBeCloseTo(6.5);
  });

  it("computes gross pay from net payable hours and hourly rate", () => {
    expect(calculateGrossPay({ totalHours: 8, breakMinutes: 30 }, 20)).toBeCloseTo(150);
    expect(calculateGrossPay({ totalHours: 8, breakMinutes: 30 }, null)).toBe(0);
  });

  it("calculates lost-time cost from minutes and hourly rate", () => {
    expect(calculateLostTimeCost(90, 30)).toBeCloseTo(45);
    expect(calculateLostTimeCost(0, 40)).toBe(0);
  });
});

describe("offline mutation queue", () => {
  it("persists, reads, and clears mutations safely", () => {
    const storage = memoryStorage();
    enqueueOfflineMutation(storage, "rpm-test-queue", { kind: "clock-in", jobId: "WO-1" }, "m-1");
    enqueueOfflineMutation(storage, "rpm-test-queue", { kind: "save-job", jobId: "WO-2" }, "m-2");
    expect(readOfflineMutations(storage, "rpm-test-queue")).toHaveLength(2);
    clearOfflineMutations(storage, "rpm-test-queue");
    expect(readOfflineMutations(storage, "rpm-test-queue")).toEqual([]);
  });

  it("ignores malformed cached data", () => {
    const storage = memoryStorage();
    storage.setItem("rpm-test-queue", "not-json");
    expect(readOfflineMutations(storage, "rpm-test-queue")).toEqual([]);
  });
});
