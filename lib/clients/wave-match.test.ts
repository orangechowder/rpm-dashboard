import { describe, expect, it } from "vitest";
import { looksSimilar, nameKey, planClientSync, type ListClient } from "./wave-match";

const list: ListClient[] = [
  { id: "c1", name: "Transport Brunet", waveId: null, removed: false },
  { id: "c2", name: "Acier Jean-Guy Robert", waveId: null, removed: false },
  { id: "c3", name: "9056-8288 QC INC", waveId: "W-OLD", removed: false },
  { id: "c4", name: "Old Client Gone", waveId: null, removed: true },
];

describe("nameKey", () => {
  it("ignores case, accents, spaces and punctuation", () => {
    expect(nameKey("  ACIER Jean-Guy  Robert ")).toBe(nameKey("acier jean guy robert"));
    expect(nameKey("9567-0006 Québec inc.")).toBe(nameKey("9567 0006 QUEBEC INC"));
  });
});

describe("looksSimilar", () => {
  it("flags small differences", () => {
    expect(looksSimilar("Transport Brunet Inc.", "Transport Brunet")).toBe(true);
    expect(looksSimilar("Transports Brunet", "Transport Brunet")).toBe(true);
    expect(looksSimilar("9056-8289 QC INC", "9056-8288 QC INC")).toBe(true);
  });
  it("leaves different clients alone", () => {
    expect(looksSimilar("Bilodeau Transport", "Transport Brunet")).toBe(false);
    expect(looksSimilar("ABC", "ABD")).toBe(false);
  });
});

describe("planClientSync", () => {
  const plan = planClientSync(list, [
    { id: "W1", name: "TRANSPORT BRUNET" },                // same name → already there, Wave ID attached
    { id: "W2", name: "Transport Brunet Inc." },           // slightly different → check
    { id: "W3", name: "Ferme Tremblay" },                  // new → add
    { id: "W-OLD", name: "9056-8288 Québec inc. (renamed)" }, // known Wave ID → never re-added under its new name
    { id: "W4", name: "old client gone" },                 // removed in the dashboard → never comes back
    { id: "W5", name: "Archived Co", archived: true },
    { id: "W3", name: "Ferme Tremblay" },                  // duplicate page row
    { id: "W6", name: "Ferme Tremblay Inc" },              // near a name added in this same run → check
  ]);
  it("adds only names that are really missing", () => {
    expect(plan.add).toEqual([{ waveId: "W3", name: "Ferme Tremblay" }]);
  });
  it("puts near matches in 'Check these', never adds them", () => {
    expect(plan.check.map((c) => [c.waveId, c.similar])).toEqual([["W6", ["Ferme Tremblay"]], ["W2", ["Transport Brunet"]]]);
  });
  it("only attaches Wave IDs to exact matches that have none; never renames", () => {
    expect(plan.link).toEqual([{ clientId: "c4", clientName: "Old Client Gone", waveId: "W4" }, { clientId: "c1", clientName: "Transport Brunet", waveId: "W1" }]);
  });
  it("counts", () => {
    expect(plan.counts).toEqual({ wave: 7, archived: 1, alreadyThere: 3, add: 1, check: 2 });
  });
  it("honours 'same client' decisions", () => {
    expect(planClientSync(list, [{ id: "W2", name: "Transport Brunet Inc." }], new Set(["W2"])).check).toEqual([]);
  });
});
