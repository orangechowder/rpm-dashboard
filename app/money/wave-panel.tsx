"use client";
// Wave → Money sync: the Settings card (connect, dry run, mapping, approve, sync now) and the "Needs attention" lines.
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Link2, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { formatMoney, parseMoney, centsToInput, type Lang } from "../../lib/money/cents";
import { formatDate, monthLabel } from "../../lib/money/dates";
import type { MoneyCategory } from "../../lib/money/types";
import { supabase } from "../../lib/supabase";
import { decidePending } from "../../lib/clients/repository";
import { Help } from "./ui";

const L = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

// ---- data ----------------------------------------------------------------------------------------------
async function token() {
  const { data } = await supabase!.auth.getSession();
  return data.session?.access_token ?? "";
}
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || "error"), { code: body.error });
  return body as T;
}

type Run = { id: number; mode: string; trigger: string; started_by: string | null; started_at: string; finished_at: string | null; ok: boolean | null; added: number; updated: number; linked: number; trashed: number; flagged: number; error: string | null };
type ReviewItem = { ref: string; kind: "unmapped" | "closed-month" | "gap" | "unmatched" | "refund" | "fees"; title: string; details: Record<string, unknown>; amountCents: number | null };
type Summary = {
  mode: string; counts: { added: number; updated: number; linked: number; trashed: number; flagged: number; payments: number; waiting: number };
  months: Array<{ month: string; waveCents: number; moneyCents: number; waitingCents: number; gapCents: number }>; review: ReviewItem[];
  feeDeltaCents: number; feeBalanceCents: number | null; feeBaselineCents: number | null; syncFrom: string; csvUntil: string | null; newMappings: number;
  invoices: number; estimates: number; estimatesReadable?: boolean; failed: number; samples: Array<{ op: string; date: string; party: string; description: string; category: string; total: number; before?: number }>;
};
export type WaveStatus = {
  configured: boolean; configProblem?: string | null; emailAlerts: boolean;
  connection: null | { businessName: string; status: string; connectedBy: string | null; connectedAt: string; approvedAt: string | null; approvedBy: string | null; syncFrom: string | null; csvUntil: string | null; feeBaselineCents: number | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastErrorAt: string | null; scope: string };
  runs: Run[]; lastDryRun: { id: number; started_at: string; summary: Summary } | null;
};
export type WaveAttention = { ref: string; kind: ReviewItem["kind"] | "connection"; title: string; amountCents: number | null; details: Record<string, unknown> };
type MapRow = { wave_ref: string; kind: "item" | "tax"; label: string; suggested_category_id: string | null; category_id: string | null };

export const loadWaveStatus = () => api<WaveStatus>("/api/money/wave/status");

/** Open "To review" items + a line when the connection needs the person. Empty when Wave isn't connected. */
export async function loadWaveAttention(): Promise<WaveAttention[]> {
  const status = await loadWaveStatus().catch(() => null);
  if (!status?.connection) return [];
  const out: WaveAttention[] = [];
  const c = status.connection;
  const stale = c.approvedAt && (!c.lastSuccessAt || Date.now() - Date.parse(c.lastSuccessAt) > 26 * 3600_000);
  if (c.status === "expired" || c.status === "pro_expired" || stale) out.push({ ref: "connection", kind: "connection", title: c.status === "expired" || c.status === "pro_expired" ? c.status : "stale", amountCents: null, details: { lastError: c.lastError, lastSuccessAt: c.lastSuccessAt } });
  const { data } = await supabase!.from("money_wave_review").select("ref,kind,title,details,amount_cents").is("resolved_at", null).order("first_seen_at");
  for (const r of data ?? []) out.push({ ref: String(r.ref), kind: r.kind as ReviewItem["kind"], title: String(r.title ?? ""), amountCents: r.amount_cents === null ? null : Number(r.amount_cents), details: (r.details ?? {}) as Record<string, unknown> });
  return out;
}
export async function resolveWave(ref: string, resolution: "added" | "ignored") {
  const { error } = await supabase!.from("money_wave_review").update({ resolution, resolved_at: new Date().toISOString() }).eq("ref", ref);
  if (error) throw new Error(error.message);
}

const ago = (iso: string | null, lang: Lang) => {
  if (!iso) return L(lang, "never", "jamais");
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 1) return L(lang, "just now", "à l'instant");
  if (min < 60) return L(lang, `${min} min ago`, `il y a ${min} min`);
  const h = Math.round(min / 60);
  if (h < 36) return L(lang, `${h} h ago`, `il y a ${h} h`);
  return L(lang, `${Math.round(h / 24)} days ago`, `il y a ${Math.round(h / 24)} jours`);
};
const monthName = (m: string, lang: Lang) => `${monthLabel(Number(m.slice(5, 7)), lang)} ${m.slice(0, 4)}`;

// ---- "Needs attention" lines ---------------------------------------------------------------------------
export function waveAttentionText(item: WaveAttention, lang: Lang, categoryName: (id: string) => string): { title: string; detail: string } {
  const $ = (c: number | null) => (c === null ? "" : formatMoney(c, lang));
  switch (item.kind) {
    case "connection": return item.title === "pro_expired"
      ? { title: L(lang, "Wave Pro has expired", "Wave Pro est expiré"), detail: L(lang, "Wave stopped sharing data. Renew Wave Pro, then connect Wave again in Settings. The nightly sync is paused until then.", "Wave ne partage plus les données. Renouvelez Wave Pro, puis reconnectez Wave dans Réglages. La synchro de nuit est en pause d'ici là.") }
      : item.title === "expired"
      ? { title: L(lang, "Wave connection expired", "Connexion Wave expirée"), detail: L(lang, "Connect Wave again in Settings.", "Reconnectez Wave dans Réglages.") }
      : { title: L(lang, "Wave hasn't synced for over a day", "Wave n'a pas synchronisé depuis plus d'un jour"), detail: String(item.details.lastError ?? L(lang, "Open Settings → Wave.", "Ouvrez Réglages → Wave.")) };
    case "unmapped": return { title: L(lang, `Wave item “${item.title}” needs a category`, `Article Wave « ${item.title} » : choisir une catégorie`), detail: L(lang, `${item.details.payments ?? "?"} payment(s) waiting · ${$(item.amountCents)}`, `${item.details.payments ?? "?"} paiement(s) en attente · ${$(item.amountCents)}`) };
    case "unmatched": return { title: L(lang, `Wave payment not found in the CSV: ${item.title}`, `Paiement Wave absent du CSV : ${item.title}`), detail: `${item.details.date ?? ""} · ${item.details.account ?? ""} · ${$(item.amountCents)}` };
    case "closed-month": {
      const a = item.details.after as { date?: string; total?: number; category?: string } | null;
      const b = item.details.before as { date?: string; total?: number; category?: string } | null;
      const what = item.details.change === "add" ? L(lang, "new", "nouveau") : item.details.change === "remove" ? L(lang, "removed in Wave", "retiré dans Wave") : L(lang, "changed in Wave", "modifié dans Wave");
      return { title: L(lang, `Closed month: ${item.title} (${what})`, `Mois fermé : ${item.title} (${what})`), detail: [b && `${b.date} ${$(b.total ?? null)} ${categoryName(b.category ?? "")}`, a && `→ ${a.date} ${$(a.total ?? null)} ${categoryName(a.category ?? "")}`].filter(Boolean).join(" ") };
    }
    case "gap": return { title: L(lang, `Wave and Money differ in ${monthName(item.title, lang)}`, `Wave et Argent diffèrent en ${monthName(item.title, lang)}`), detail: L(lang, `Wave ${$(Number(item.details.wave))} · Money ${$(Number(item.details.money))} · gap ${$(item.amountCents)}`, `Wave ${$(Number(item.details.wave))} · Argent ${$(Number(item.details.money))} · écart ${$(item.amountCents)}`) };
    case "fees": return { title: L(lang, "Card fees went down in Wave", "Les frais de carte ont baissé dans Wave"), detail: $(item.amountCents) };
    default: return { title: item.title, detail: $(item.amountCents) };
  }
}

// ---- Settings card -------------------------------------------------------------------------------------
export function WaveCard({ lang, categories, waveResult, onSynced }: { lang: Lang; categories: MoneyCategory[]; waveResult: string | null; onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<WaveStatus | null>(null);
  const [map, setMap] = useState<MapRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [baseline, setBaseline] = useState("");
  const name = (id: string) => { const c = categories.find((x) => x.id === id); return c ? (lang === "fr" ? c.fr : c.en) : id; };

  const refresh = useCallback(async () => {
    try {
      const s = await loadWaveStatus();
      setStatus(s);
      if (s.lastDryRun && !s.connection?.approvedAt) setPreview((p) => p ?? s.lastDryRun!.summary);
      const base = s.connection?.feeBaselineCents ?? s.lastDryRun?.summary.feeBaselineCents ?? null;
      setBaseline((b) => b || (base !== null ? centsToInput(base) : ""));
      const { data } = await supabase!.from("money_wave_map").select("wave_ref,kind,label,suggested_category_id,category_id").order("kind").order("label");
      setMap((data ?? []) as MapRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { const t = setTimeout(() => void refresh(), 0); return () => clearTimeout(t); }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); await refresh(); }
  };
  const connect = () => run("connect", async () => { const { url } = await api<{ url: string }>("/api/money/wave/connect", { method: "POST" }); window.location.assign(url); });
  const dryRun = () => run("dry", async () => { const { summary } = await api<{ summary: Summary }>("/api/money/wave/sync", { method: "POST", body: JSON.stringify({ mode: "dry-run" }) }); setPreview(summary); });
  const syncNow = () => run("sync", async () => { const { summary } = await api<{ summary: Summary }>("/api/money/wave/sync", { method: "POST", body: JSON.stringify({ mode: "sync" }) }); setPreview(null); if (summary.counts.added + summary.counts.updated + summary.counts.trashed + summary.counts.linked) await onSynced(); });
  const approve = () => run("approve", async () => {
    const cents = baseline.trim() ? parseMoney(baseline) : null;
    await api("/api/money/wave/sync", { method: "POST", body: JSON.stringify({ mode: "approve", feeBaselineCents: cents }) });
    setPreview(null);
    await onSynced();
  });
  const disconnect = () => { if (window.confirm(L(lang, "Disconnect Wave? Entries already synced stay in Money.", "Déconnecter Wave? Les entrées déjà synchronisées restent dans Argent."))) void run("disconnect", async () => { await api("/api/money/wave/disconnect", { method: "POST" }); setPreview(null); }); };
  const setCategory = (ref: string, categoryId: string | null) => run("map", async () => {
    const { error: e } = await supabase!.from("money_wave_map").update({ category_id: categoryId }).eq("wave_ref", ref);
    if (e) throw new Error(e.message);
  });
  const acceptSuggestions = () => run("map", async () => {
    for (const m of map.filter((x) => !x.category_id && x.suggested_category_id)) {
      const { error: e } = await supabase!.from("money_wave_map").update({ category_id: m.suggested_category_id }).eq("wave_ref", m.wave_ref);
      if (e) throw new Error(e.message);
    }
  });

  const c = status?.connection ?? null;
  const unmapped = map.filter((m) => !m.category_id).length;
  const lastSync = status?.runs.find((r) => r.mode === "sync");
  const incomeCats = categories.filter((x) => x.kind === "in" && x.active);
  const $ = (v: number) => formatMoney(v, lang);

  return (
    <section className="mn-card mn-wave" aria-live="polite">
      <h3><Link2 size={17} aria-hidden="true" /> {L(lang, "Wave → Money (automatic)", "Wave → Argent (automatique)")} <Help lang={lang} topic="waveSync" /></h3>
      {waveResult && waveResult !== "connected" && <p className="mn-banner mn-banner-error" role="alert">{L(lang, "Wave didn't connect", "Wave ne s'est pas connecté")} ({waveResult}). {L(lang, "Try again.", "Réessayez.")}</p>}
      {waveResult === "connected" && c && !c.approvedAt && <p className="mn-banner mn-banner-ok">{L(lang, `Connected to ${c.businessName}. Next: preview the first sync.`, `Connecté à ${c.businessName}. Ensuite : aperçu de la première synchronisation.`)}</p>}
      {error && <p className="mn-banner mn-banner-error" role="alert">{error}</p>}
      {!status ? <p className="mn-muted">{L(lang, "One moment…", "Un instant…")}</p> : !status.configured ? (
        <p className="mn-muted">{L(lang, "Not set up on the server yet: WAVE_CLIENT_ID, WAVE_CLIENT_SECRET and MONEY_TOKEN_KEY must be added in Vercel.", "Pas encore configuré sur le serveur : WAVE_CLIENT_ID, WAVE_CLIENT_SECRET et MONEY_TOKEN_KEY doivent être ajoutés dans Vercel.")}{status.configProblem ? ` (${status.configProblem})` : ""}</p>
      ) : !c ? (
        <div className="mn-wave-connect">
          <p className="mn-muted">{L(lang, "Your Wave invoices and payments arrive in Money by themselves every night, exactly once. Read-only: Money never changes anything in Wave. Expenses still come from your bank CSV.", "Vos factures et paiements Wave arrivent seuls dans Argent chaque nuit, une seule fois. Lecture seule : Argent ne change jamais rien dans Wave. Les dépenses viennent encore de votre CSV bancaire.")}</p>
          <button type="button" className="mn-primary" disabled={busy !== null} onClick={() => void connect()}>{busy === "connect" ? L(lang, "Opening Wave…", "Ouverture de Wave…") : L(lang, "Connect Wave", "Connecter Wave")}</button>
        </div>
      ) : (
        <>
          <p className="mn-wave-status">
            <span className={`mn-pill ${c.status === "connected" ? "mn-pill-ok" : "mn-pill-bad"}`}>{c.status === "connected" ? L(lang, "Connected", "Connecté") : c.status === "pro_expired" ? L(lang, "Wave Pro expired", "Wave Pro expiré") : c.status === "expired" ? L(lang, "Expired", "Expiré") : L(lang, "Error", "Erreur")}</span>
            <b>{c.businessName}</b>
            <span className="mn-muted">{c.approvedAt ? L(lang, `Last synced ${ago(c.lastSuccessAt, lang)}`, `Dernière synchro ${ago(c.lastSuccessAt, lang)}`) : L(lang, "Not syncing yet: preview first", "Pas encore de synchro : aperçu d'abord")}</span>
            {lastSync && lastSync.ok && <span className="mn-muted">· {L(lang, `${lastSync.added} added, ${lastSync.updated} updated`, `${lastSync.added} ajoutées, ${lastSync.updated} modifiées`)}</span>}
          </p>
          {c.status === "pro_expired"
            ? <p className="mn-banner mn-banner-error" role="alert"><TriangleAlert size={15} aria-hidden="true" /> {L(lang, "Wave Pro has expired, so Wave stopped sharing data. Renew Wave Pro in Wave, then click “Connect Wave again”. The nightly sync is paused until then; nothing in Money was changed.", "Wave Pro est expiré, alors Wave ne partage plus les données. Renouvelez Wave Pro dans Wave, puis cliquez « Reconnecter Wave ». La synchro de nuit est en pause d'ici là; rien n'a changé dans Argent.")}</p>
            : c.lastError && <p className="mn-banner mn-banner-warn"><TriangleAlert size={15} aria-hidden="true" /> {c.lastError}</p>}
          {(c.status === "expired" || c.status === "pro_expired") && <button type="button" className="mn-primary" onClick={() => void connect()}>{L(lang, "Connect Wave again", "Reconnecter Wave")}</button>}
          <div className="mn-inline-actions">
            {c.approvedAt && <button type="button" className="mn-primary" disabled={busy !== null} onClick={() => void syncNow()}><RefreshCw size={15} aria-hidden="true" />{busy === "sync" ? L(lang, "Syncing…", "Synchronisation…") : L(lang, "Sync now", "Synchroniser")}</button>}
            <button type="button" className={c.approvedAt ? "mn-ghost" : "mn-primary"} disabled={busy !== null} onClick={() => void dryRun()}>{busy === "dry" ? L(lang, "Checking Wave…", "Vérification de Wave…") : L(lang, "Preview (dry run)", "Aperçu (essai à blanc)")}</button>
            <button type="button" className="mn-ghost" disabled={busy !== null} onClick={disconnect}><Unplug size={15} aria-hidden="true" />{L(lang, "Disconnect", "Déconnecter")}</button>
          </div>
          <small className="mn-muted">{L(lang, "Syncs every night by itself.", "Se synchronise seul chaque nuit.")} {status.emailAlerts ? L(lang, "If it stops working for more than a day, you get an email.", "S'il arrête de fonctionner plus d'un jour, vous recevez un courriel.") : L(lang, "Email alerts aren't set up (RESEND_API_KEY, MONEY_ALERT_EMAIL).", "Alertes courriel non configurées (RESEND_API_KEY, MONEY_ALERT_EMAIL).")}</small>

          {map.length > 0 && (
            <div className="mn-account-map mn-wave-map">
              <b>{L(lang, "Wave items → your categories", "Articles Wave → vos catégories")} {unmapped > 0 && <span className="mn-count">{unmapped}</span>}</b>
              <small className="mn-muted">{L(lang, "Payments for an item without a category wait in “Needs attention”; nothing is guessed.", "Les paiements d'un article sans catégorie attendent dans « À vérifier »; rien n'est deviné.")}</small>
              {map.map((m) => (
                <label key={m.wave_ref} className="mn-account-row"><span>{m.label}{m.kind === "tax" ? ` (${L(lang, "added to invoices", "ajouté aux factures")})` : ""}</span>
                  <select value={m.category_id ?? ""} onChange={(e) => void setCategory(m.wave_ref, e.target.value || null)}>
                    <option value="">{L(lang, "— choose —", "— choisir —")}{m.suggested_category_id ? ` (${L(lang, "suggested", "suggéré")}: ${name(m.suggested_category_id)})` : ""}</option>
                    {incomeCats.map((x) => <option key={x.id} value={x.id}>{lang === "fr" ? x.fr : x.en}</option>)}
                  </select>
                </label>
              ))}
              {unmapped > 0 && map.some((m) => !m.category_id && m.suggested_category_id) && <button type="button" className="mn-ghost" disabled={busy !== null} onClick={() => void acceptSuggestions()}><CircleCheck size={15} aria-hidden="true" />{L(lang, "Use the suggestions", "Utiliser les suggestions")}</button>}
            </div>
          )}

          {preview && (
            <div className="mn-wave-preview">
              <b>{L(lang, "Dry run: what the sync would do (nothing was saved)", "Essai à blanc : ce que la synchro ferait (rien n'a été enregistré)")}</b>
              <p className="mn-review-sum">
                <span><b>{preview.counts.linked}</b> {L(lang, "CSV entries recognized (linked, not added again)", "entrées du CSV reconnues (liées, pas ajoutées)")}</span>
                <span><b>{preview.counts.added}</b> {L(lang, "to add", "à ajouter")}</span>
                <span><b>{preview.counts.updated}</b> {L(lang, "to change", "à modifier")}</span>
                <span><b>{preview.counts.trashed}</b> {L(lang, "to remove", "à retirer")}</span>
                <span><b>{preview.counts.waiting}</b> {L(lang, "payments waiting for a category", "paiements en attente de catégorie")}</span>
                <span><b>{preview.review.length}</b> {L(lang, "to review", "à vérifier")}</span>
              </p>
              <small className="mn-muted">{L(lang, `Read from Wave: ${preview.invoices} invoices, ${preview.estimates} estimates. Payments from ${formatDate(preview.syncFrom, lang, { year: true })}; up to ${preview.csvUntil ? formatDate(preview.csvUntil, lang, { year: true }) : "—"} they must match your CSV import.`, `Lu dans Wave : ${preview.invoices} factures, ${preview.estimates} estimations. Paiements depuis le ${formatDate(preview.syncFrom, lang, { year: true })}; jusqu'au ${preview.csvUntil ? formatDate(preview.csvUntil, lang, { year: true }) : "—"} ils doivent correspondre à votre import CSV.`)}</small>
              <div className="mn-st-scroll">
                <table className="mn-mini-table">
                  <thead><tr><th scope="col">{L(lang, "Month", "Mois")}</th><th scope="col">{L(lang, "Received in Wave", "Reçu dans Wave")}</th><th scope="col">{L(lang, "In Money after sync", "Dans Argent après synchro")}</th><th scope="col">{L(lang, "Waiting", "En attente")}</th><th scope="col">{L(lang, "Gap", "Écart")}</th></tr></thead>
                  <tbody>{preview.months.map((m) => <tr key={m.month}><th scope="row">{monthName(m.month, lang)}</th><td>{$(m.waveCents)}</td><td>{$(m.moneyCents)}</td><td>{$(m.waitingCents)}</td><td className={m.gapCents ? "mn-out" : "mn-in"}>{m.gapCents ? $(m.gapCents) : "✓"}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="mn-muted">{L(lang, "Card fees in Wave now:", "Frais de carte dans Wave maintenant :")} <b>{preview.feeBalanceCents === null ? "—" : $(preview.feeBalanceCents)}</b>. {preview.feeBaselineCents === null ? L(lang, "Choose the amount already in Money (the card-fee balance when you exported the CSV); only fees above it are added.", "Indiquez le montant déjà dans Argent (le solde des frais de carte à l'export du CSV); seuls les frais au-delà sont ajoutés.") : L(lang, `Already counted: ${$(preview.feeBaselineCents)}; ${$(Math.max(0, preview.feeDeltaCents))} new.`, `Déjà compté : ${$(preview.feeBaselineCents)}; ${$(Math.max(0, preview.feeDeltaCents))} nouveaux.`)}</p>
              {!c.approvedAt && <label className="mn-field mn-wave-baseline">{L(lang, "Card fees already in Money (Wave balance at CSV export)", "Frais de carte déjà dans Argent (solde Wave à l'export du CSV)")}<input inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} placeholder="0.00" /></label>}
              {preview.review.length > 0 && (
                <details className="mn-review-list"><summary>{L(lang, "To review", "À vérifier")} ({preview.review.length})</summary>
                  <ul className="mn-plain-list">{preview.review.map((r) => { const t = waveAttentionText(r, lang, name); return <li key={r.ref} className="mn-review-row"><span className="mn-review-desc"><b>{t.title}</b> · {t.detail}</span></li>; })}</ul>
                </details>
              )}
              {preview.samples.length > 0 && (
                <details className="mn-review-list"><summary>{L(lang, "See the changes", "Voir les changements")} ({preview.samples.length}{preview.samples.length === 300 ? "+" : ""})</summary>
                  <ul className="mn-plain-list">{preview.samples.map((s, i) => (
                    <li key={i} className="mn-review-row"><span className="mn-review-date">{s.date}</span>
                      <span className="mn-review-desc">{s.op === "insert" ? L(lang, "Add", "Ajouter") : s.op === "update" ? L(lang, "Change", "Modifier") : L(lang, "Remove", "Retirer")} · {s.party || "—"} · {name(s.category)} · {s.description}</span>
                      <span className="mn-amount">{s.before !== undefined && s.op === "update" ? `${$(s.before)} → ` : ""}{$(s.total)}</span></li>
                  ))}</ul>
                </details>
              )}
              {!c.approvedAt && (
                <div className="mn-form-actions mn-inline-actions">
                  <button type="button" className="mn-primary mn-primary-in" disabled={busy !== null || preview.counts.waiting > 0 || !baseline.trim() || parseMoney(baseline) === null} onClick={() => void approve()}>
                    {busy === "approve" ? L(lang, "Syncing…", "Synchronisation…") : L(lang, "Looks right: start syncing", "C'est bon : commencer la synchro")}
                  </button>
                  {preview.counts.waiting > 0 && <small className="mn-muted">{L(lang, "Choose a category for every Wave item above, then preview again.", "Choisissez une catégorie pour chaque article Wave ci-dessus, puis refaites l'aperçu.")}</small>}
                </div>
              )}
            </div>
          )}

          <WaveClientsCard lang={lang} />

          {status.runs.length > 0 && (
            <details className="mn-review-list"><summary>{L(lang, "Recent runs", "Dernières exécutions")}</summary>
              <ul className="mn-plain-list">{status.runs.map((r) => (
                <li key={r.id} className="mn-review-row"><span className="mn-review-date">{new Date(r.started_at).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="mn-review-desc">{r.mode === "dry-run" ? L(lang, "Dry run", "Essai à blanc") : r.trigger === "cron" ? L(lang, "Nightly sync", "Synchro de nuit") : L(lang, "Sync", "Synchro")}{r.started_by && r.trigger !== "cron" ? ` · ${r.started_by}` : ""} · {r.ok ? L(lang, `+${r.added} · ~${r.updated} · −${r.trashed} · ${r.linked} linked · ${r.flagged} to review`, `+${r.added} · ~${r.updated} · −${r.trashed} · ${r.linked} liées · ${r.flagged} à vérifier`) : r.error ?? "…"}</span>
                  <span className={r.ok ? "mn-in" : "mn-out"}>{r.ok ? "✓" : r.ok === false ? "✗" : "…"}</span></li>
              ))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ---- Wave customers → shared client list (add only) ----------------------------------------------------
type ClientSummary = { mode: string; applied: boolean; at: string; counts: { wave: number; archived: number; alreadyThere: number; add: number; check: number }; add: Array<{ waveId: string; name: string }>; check: Array<{ waveId: string; waveName: string; similar: string[] }>; added: number; linked: number };
type ClientState = { approved_at: string | null; approved_by: string | null; last_run_at: string | null; last_summary: ClientSummary | null; last_error: string | null };

function WaveClientsCard({ lang }: { lang: Lang }) {
  const [state, setState] = useState<ClientState | null>(null);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Array<{ id: string; name: string; by: string | null }>>([]);
  const refresh = useCallback(async () => {
    try {
      const { data: waiting } = await supabase!.from("clients").select("id,name,created_by").eq("pending", true).is("removed_at", null).order("created_at");
      setProposed((waiting ?? []).map((w) => ({ id: String(w.id), name: String(w.name), by: w.created_by ? String(w.created_by) : null })));
      const r = await api<{ state: ClientState | null }>("/api/clients/wave");
      setState(r.state);
      setSummary((s) => s ?? r.state?.last_summary ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void refresh(), 0); return () => clearTimeout(t); }, [refresh]);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const post = (mode: "preview" | "approve") => run(mode, async () => {
    const { summary: s } = await api<{ summary: ClientSummary }>("/api/clients/wave", { method: "POST", body: JSON.stringify({ mode }) });
    setSummary(s); setDone(new Set());
    await refresh();
  });
  const decide = (item: ClientSummary["check"][number], how: "add" | "same") => run(item.waveId, async () => {
    const { error: e } = how === "add"
      ? await supabase!.from("clients").insert({ name: item.waveName, source: "wave", wave_customer_id: item.waveId })
      : await supabase!.from("client_wave_skip").insert({ wave_customer_id: item.waveId, wave_name: item.waveName, same_as: item.similar.join(", ") });
    if (e) throw new Error(e.message);
    setDone((d) => new Set(d).add(item.waveId));
  });
  const decideProposed = (id: string, approve: boolean) => run(id, async () => { await decidePending(id, approve); setProposed((p) => p.filter((x) => x.id !== id)); });
  const approved = Boolean(state?.approved_at);
  const check = (summary?.check ?? []).filter((c) => !done.has(c.waveId));

  return (
    <div className="mn-wave-preview">
      <b>{L(lang, "Wave customers → client list", "Clients Wave → liste des clients")}</b>
      <small className="mn-muted">{approved
        ? L(lang, "Missing Wave customers are added to Client Management every night and with “Sync now”. Nothing is ever renamed, merged or removed.", "Les clients Wave manquants sont ajoutés à Gestion des clients chaque nuit et avec « Synchroniser ». Rien n'est jamais renommé, fusionné ou retiré.")
        : L(lang, "Preview first: see which Wave customers are missing from your client list. Nothing is added until you approve.", "Aperçu d'abord : voyez quels clients Wave manquent à votre liste. Rien n'est ajouté avant votre accord.")}</small>
      {error && <p className="mn-banner mn-banner-error" role="alert">{error}</p>}
      {state?.last_error && <p className="mn-banner mn-banner-warn"><TriangleAlert size={15} aria-hidden="true" /> {state.last_error}</p>}
      <div className="mn-inline-actions">
        <button type="button" className={approved ? "mn-ghost" : "mn-primary"} disabled={busy !== null} onClick={() => void post("preview")}>{busy === "preview" ? L(lang, "Checking Wave…", "Vérification de Wave…") : L(lang, "Preview clients (dry run)", "Aperçu des clients (essai à blanc)")}</button>
      </div>
      {proposed.length > 0 && (
        <details className="mn-review-list" open><summary>{L(lang, "Check these: added by a technician", "À vérifier : ajoutés par un technicien")} ({proposed.length})</summary>
          <ul className="mn-plain-list">{proposed.map((p) => (
            <li key={p.id} className="mn-review-row">
              <span className="mn-review-desc"><b>{p.name}</b>{p.by ? ` · ${p.by}` : ""}</span>
              <span className="mn-inline-actions">
                <button type="button" className="mn-ghost" disabled={busy !== null} onClick={() => void decideProposed(p.id, true)}>{L(lang, "Add to the list", "Ajouter à la liste")}</button>
                <button type="button" className="mn-ghost" disabled={busy !== null} onClick={() => void decideProposed(p.id, false)}>{L(lang, "Leave out", "Ne pas ajouter")}</button>
              </span>
            </li>
          ))}</ul>
        </details>
      )}
      {summary && (
        <>
          <p className="mn-review-sum">
            <span><b>{summary.counts.wave - summary.counts.archived}</b> {L(lang, "Wave customers", "clients Wave")}</span>
            <span><b>{summary.counts.alreadyThere}</b> {L(lang, "already in the list", "déjà dans la liste")}</span>
            <span><b>{summary.applied ? summary.added : summary.counts.add}</b> {summary.applied ? L(lang, "added", "ajoutés") : L(lang, "would be added", "seraient ajoutés")}</span>
            <span><b>{check.length}</b> {L(lang, "to check", "à vérifier")}</span>
          </p>
          <small className="mn-muted">{summary.applied ? L(lang, "Last sync", "Dernière synchro") : L(lang, "Preview, nothing was saved", "Aperçu, rien n'a été enregistré")} · {new Date(summary.at).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "short", timeStyle: "short" })}</small>
          {summary.add.length > 0 && (
            <details className="mn-review-list" open={!approved}><summary>{summary.applied ? L(lang, "Added", "Ajoutés") : L(lang, "Missing names it would add", "Noms manquants à ajouter")} ({summary.add.length})</summary>
              <ul className="mn-plain-list">{summary.add.map((a) => <li key={a.waveId} className="mn-review-row"><span className="mn-review-desc">{a.name}</span></li>)}</ul>
            </details>
          )}
          {check.length > 0 && (
            <details className="mn-review-list" open><summary>{L(lang, "Check these (close to a client you already have, not added)", "À vérifier (proche d'un client existant, pas ajouté)")} ({check.length})</summary>
              <ul className="mn-plain-list">{check.map((c) => (
                <li key={c.waveId} className="mn-review-row">
                  <span className="mn-review-desc"><b>{c.waveName}</b> · {L(lang, "you have", "vous avez")} {c.similar.join(", ")}</span>
                  <span className="mn-inline-actions">
                    <button type="button" className="mn-ghost" disabled={busy !== null} onClick={() => void decide(c, "same")}>{L(lang, "Same client", "Même client")}</button>
                    <button type="button" className="mn-ghost" disabled={busy !== null} onClick={() => void decide(c, "add")}>{L(lang, "Add as new", "Ajouter comme nouveau")}</button>
                  </span>
                </li>
              ))}</ul>
            </details>
          )}
          {!approved && (
            <div className="mn-form-actions mn-inline-actions">
              <button type="button" className="mn-primary mn-primary-in" disabled={busy !== null} onClick={() => void post("approve")}>{busy === "approve" ? L(lang, "Adding…", "Ajout…") : L(lang, `Looks right: add ${summary.counts.add} and keep adding`, `C'est bon : ajouter ${summary.counts.add} et continuer`)}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
