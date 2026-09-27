"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock3 } from "lucide-react";
import { formatIdleElapsed, getIdleSignals, type IdleWorkOrder } from "../lib/reliability";

export function IdleVelocityBanner<T extends IdleWorkOrder>({ jobs, language, thresholdHours, onThresholdChange, onOpen, compact = false }: {
  jobs: readonly T[];
  language: "en" | "fr";
  thresholdHours: number;
  onThresholdChange?: (hours: number) => void;
  onOpen?: (job: T) => void;
  compact?: boolean;
}) {
  const [now, setNow] = useState(0);
  const headingId = useId();
  const french = language === "fr";

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = () => {
      if (timer) clearInterval(timer);
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const signals = getIdleSignals(jobs, now, thresholdHours);
  const stale = signals.filter((signal) => signal.stale);
  const unassignedUnits = new Set(signals.filter((signal) => signal.unassigned).map((signal) => JSON.stringify([signal.job.unit, signal.job.client]))).size;
  const unknown = signals.filter((signal) => signal.elapsedMs == null).length;
  const severity = signals.some((signal) => signal.critical) ? "critical" : stale.length ? "warning" : "clear";

  return (
    <section className={`idle-banner idle-${severity} ${compact ? "idle-banner-compact" : ""}`} aria-labelledby={headingId}>
      <div className="idle-heading">
        <AlertTriangle size={19} className="idle-indicator" aria-hidden="true" />
        <div><h2 id={headingId}>{french ? "Inactivité et progression" : "Idle & velocity"}</h2><p>{french ? "Temps inactif = temps perdu" : "Idle time = lost time"}</p></div>
        {onThresholdChange && <label className="idle-threshold">{french ? "Seuil (h)" : "Alert after (h)"}<input type="number" min="1" max="168" step="1" value={thresholdHours} onChange={(event) => { const hours = event.target.valueAsNumber; if (Number.isFinite(hours) && hours >= 1 && hours <= 168) onThresholdChange(hours); }} /></label>}
      </div>
      <div className="idle-summary">
        <span aria-live="polite"><strong>{stale.length}</strong>{french ? "ordres stagnants" : "stagnant orders"}</span>
        <span><strong>{unassignedUnits}</strong>{french ? "unités non assignées" : "unassigned units"}</span>
        <span><Clock3 size={13} aria-hidden="true" />{french ? "Seuil" : "Threshold"}<strong>{thresholdHours} h</strong></span>
      </div>
      {signals.length > 0 ? <div className="idle-items">{signals.slice(0, compact ? 1 : 3).map((signal) => {
        const reason = signal.reason === "parts" ? (french ? "Pièces en attente" : "Waiting on parts") : signal.reason === "estimates" ? (french ? "Estimation en attente" : "Waiting on estimate") : (french ? "Non assigné" : "Unassigned");
        const content = <><span className="idle-item-copy"><strong>{signal.job.unit} · {signal.job.client}</strong><span>{reason}</span></span><span className="idle-clock" aria-live="off" title={signal.job.updatedAt}>{formatIdleElapsed(signal.elapsedMs)}</span>{onOpen && <ArrowUpRight size={14} aria-hidden="true" />}</>;
        const className = `idle-item ${signal.critical ? "idle-item-critical" : signal.stale ? "idle-item-warning" : ""}`;
        return onOpen ? <button type="button" className={className} key={signal.job.id} onClick={() => onOpen(signal.job)}>{content}</button> : <div className={className} key={signal.job.id}>{content}</div>;
      })}</div> : <p className="idle-clear-message">{french ? "Aucun blocage de pièces ou d'affectation." : "No parts or assignment blockers."}</p>}
      <div className="idle-footnote"><span>{french ? "Compteurs depuis la dernière mise à jour" : "Counters since last recorded update"}</span>{unknown > 0 && <span>{unknown} {french ? "horodatage(s) inconnu(s)" : "unknown timestamp(s)"}</span>}</div>
    </section>
  );
}