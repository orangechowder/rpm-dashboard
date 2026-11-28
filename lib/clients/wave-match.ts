// Wave customers → shared client list. ADD ONLY: never renames, merges or removes a client.
//   • same name (ignoring case, accents, spaces, punctuation) → already there (its Wave ID gets attached if it has none)
//   • only slightly different ("Transport Brunet" vs "Transport Brunet Inc.") → "Check these", never added by itself
//   • otherwise → added

export type ListClient = { id: string; name: string; waveId: string | null; removed: boolean };
export type WaveCustomer = { id: string; name: string; archived?: boolean };
export type CheckItem = { waveId: string; waveName: string; similar: string[] };
export type ClientPlan = {
  add: Array<{ waveId: string; name: string }>;
  link: Array<{ clientId: string; clientName: string; waveId: string }>;
  check: CheckItem[];
  counts: { wave: number; archived: number; alreadyThere: number; add: number; check: number };
};

/** "Transport Brunet Inc." → "transportbrunetinc"; "Québec" → "quebec". */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Words that don't make a different company.
const NOISE = new Set(["inc", "incorporated", "ltee", "limitee", "ltd", "limited", "enr", "senc", "sec", "corp", "corporation", "co", "cie", "llc", "the", "le", "la", "les"]);
function coreKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w)).join("");
}

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Different spelling, probably the same client. (Exact same key is handled before this.) */
export function looksSimilar(a: string, b: string): boolean {
  const ca = coreKey(a), cb = coreKey(b);
  if (ca && ca === cb) return true;
  const ka = nameKey(a), kb = nameKey(b);
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length >= 5 && long.includes(short)) return true;
  if (short.length >= 5) return distance(ka, kb, 2) <= (short.length >= 8 ? 2 : 1);
  return false;
}

export function planClientSync(list: ListClient[], customers: WaveCustomer[], skipped: Set<string> = new Set()): ClientPlan {
  const byWaveId = new Set(list.map((c) => c.waveId).filter(Boolean) as string[]);
  const byKey = new Map<string, ListClient>();
  for (const c of list) if (!byKey.has(nameKey(c.name))) byKey.set(nameKey(c.name), c);
  const plan: ClientPlan = { add: [], link: [], check: [], counts: { wave: 0, archived: 0, alreadyThere: 0, add: 0, check: 0 } };
  const pending = new Map<string, string>(); // key → name of a Wave customer being added in this run
  const seen = new Set<string>();
  const linkedClients = new Set<string>();

  for (const w of [...customers].sort((a, b) => a.name.localeCompare(b.name))) {
    const name = w.name.trim();
    if (!w.id || !name || seen.has(w.id)) continue;
    seen.add(w.id);
    plan.counts.wave += 1;
    if (w.archived) { plan.counts.archived += 1; continue; }
    if (byWaveId.has(w.id) || skipped.has(w.id)) { plan.counts.alreadyThere += 1; continue; }
    const key = nameKey(name);
    const same = byKey.get(key);
    if (same) {
      plan.counts.alreadyThere += 1;
      if (!same.waveId && !linkedClients.has(same.id)) { linkedClients.add(same.id); plan.link.push({ clientId: same.id, clientName: same.name, waveId: w.id }); }
      continue;
    }
    if (pending.has(key)) { plan.counts.alreadyThere += 1; continue; }
    const similar = [...list.filter((c) => looksSimilar(name, c.name)).map((c) => c.name), ...[...pending.values()].filter((n) => looksSimilar(name, n))];
    if (similar.length) { plan.check.push({ waveId: w.id, waveName: name, similar: [...new Set(similar)].slice(0, 5) }); continue; }
    pending.set(key, name);
    plan.add.push({ waveId: w.id, name: name.slice(0, 120) });
  }
  plan.counts.add = plan.add.length;
  plan.counts.check = plan.check.length;
  return plan;
}
