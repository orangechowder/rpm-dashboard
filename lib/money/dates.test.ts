import { describe, expect, it } from "vitest";
import { formatDayMonthYear, readTypedDate } from "./dates";

const today = "2026-11-25";
const read = (text: string) => readTypedDate(text, today);

describe("readTypedDate (dd/mm/yyyy)", () => {
  it("reads numbers day first", () => {
    expect(read("25/11/2026")).toBe("2026-11-25");
    expect(read("05/11/2026")).toBe("2026-11-05");
    expect(read("5/11/26")).toBe("2026-11-05");
    expect(read("25-11-2026")).toBe("2026-11-25");
    expect(read("25.11.2026")).toBe("2026-11-25");
    expect(read("25112026")).toBe("2026-11-25");
    expect(read("11/25/2026")).toBeNull(); // no month 25
  });
  it("still reads ISO dates", () => {
    expect(read("2026-11-25")).toBe("2026-11-25");
    expect(read("20261125")).toBe("2026-11-25");
  });
  it("reads French and English month names", () => {
    expect(read("25 novembre 2026")).toBe("2026-11-25");
    expect(read("le 1er décembre 2025")).toBe("2025-12-01");
    expect(read("Nov 25, 2026")).toBe("2026-11-25");
    expect(read("3 févr 2026")).toBe("2026-02-03");
  });
  it("guesses the year when missing (never far in the future)", () => {
    expect(read("20/1")).toBe("2026-01-20");
    expect(read("15/12")).toBe("2026-12-15");
    expect(readTypedDate("20/03", "2026-01-10")).toBe("2025-03-20");
    expect(read("12")).toBe("2026-11-12");
  });
  it("understands words", () => {
    expect(read("hier")).toBe("2026-11-24");
    expect(read("today")).toBe("2026-11-25");
  });
  it("rejects nonsense", () => {
    expect(read("")).toBeNull();
    expect(read("31/02/2026")).toBeNull();
    expect(read("hello")).toBeNull();
    expect(read("2026")).toBeNull();
  });
  it("shows dd/mm/yyyy", () => {
    expect(formatDayMonthYear("2026-03-04")).toBe("04/03/2026");
  });
});
