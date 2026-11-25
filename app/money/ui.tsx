"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2, Car, CircleHelp, Coins, Fuel, Hammer, Handshake, HardHat, Landmark, Megaphone, Package, Receipt, Scale, Settings,
  Shield, Smartphone, SprayCan, Truck, User, Wrench, X, Zap, type LucideIcon,
} from "lucide-react";
import { formatMoney, type Cents, type Lang } from "../../lib/money/cents";
import { help, mt, type HelpKey } from "./i18n";

const ICONS: Record<string, LucideIcon> = {
  wrench: Wrench, package: Package, truck: Truck, coins: Coins, "hard-hat": HardHat, user: User, fuel: Fuel, building: Building2,
  car: Car, shield: Shield, hammer: Hammer, settings: Settings, "spray-can": SprayCan, smartphone: Smartphone, megaphone: Megaphone,
  scale: Scale, zap: Zap, landmark: Landmark, handshake: Handshake, receipt: Receipt,
};

export function CategoryIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Receipt;
  return <Icon size={size} aria-hidden="true" />;
}

/** The (?) next to every number: one plain sentence, opens on tap (phone) or click. */
export function Help({ lang, topic, label }: { lang: Lang; topic: HelpKey; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="mn-help" ref={ref}>
      <button type="button" className="mn-help-button" aria-label={`${mt(lang, "why")} ${label ?? ""}`.trim()} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={(event) => { event.stopPropagation(); setOpen((v) => !v); }}>
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {open && <span role="tooltip" id={id} className="mn-help-pop">{help(lang, topic)}</span>}
    </span>
  );
}

/** Money with colour: green for in/profit, red for out/loss. */
export function Amount({ cents, lang, tone = "auto", sign = false, className = "" }: { cents: Cents; lang: Lang; tone?: "auto" | "in" | "out" | "plain"; sign?: boolean; className?: string }) {
  const resolved = tone === "auto" ? (cents < 0 ? "out" : cents > 0 ? "in" : "plain") : tone;
  return <span className={`mn-amount mn-${resolved} ${className}`}>{formatMoney(cents, lang, { sign })}</span>;
}

export function Skeleton({ height = 16, width = "100%", radius = 6 }: { height?: number; width?: number | string; radius?: number }) {
  return <span className="mn-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

/** Bottom sheet on phones, centred panel on desktop. */
export function Sheet({ title, onClose, children, wide = false, tone, className = "" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; tone?: "in" | "out"; className?: string }) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="mn-sheet-backdrop" />
        <Dialog.Content
          className={`mn-sheet ${wide ? "mn-sheet-wide" : ""} ${tone ? `mn-sheet-${tone}` : ""} ${className}`}
          aria-describedby={undefined}
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            // Focus the field marked data-autofocus (the amount) immediately, so no keystroke is lost.
            const target = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]");
            if (target) { event.preventDefault(); target.focus(); }
          }}
        >
          <div className="mn-sheet-head">
            <Dialog.Title className="mn-sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="mn-icon-button" aria-label="Close"><X size={18} /></Dialog.Close>
          </div>
          <div className="mn-sheet-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type Toast = { id: number; text: string; tone?: "ok" | "error"; action?: { label: string; run: () => void } };

export function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="mn-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`mn-toast ${toast.tone === "error" ? "mn-toast-error" : ""}`}>
          <span>{toast.text}</span>
          {toast.action && <button type="button" onClick={() => { toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
          <button type="button" className="mn-toast-x" aria-label="Close" onClick={() => dismiss(toast.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="mn-chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={`mn-chip ${value === option.value ? "mn-chip-on" : ""}`} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, help: helpNode }: { checked: boolean; onChange: (value: boolean) => void; label: string; help?: ReactNode }) {
  return (
    <label className="mn-toggle">
      <span className="mn-toggle-label">{label}{helpNode}</span>
      <button type="button" role="switch" aria-checked={checked} className={`mn-switch ${checked ? "mn-switch-on" : ""}`} onClick={() => onChange(!checked)}><span /></button>
    </label>
  );
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="mn-empty">
      <div className="mn-empty-art" aria-hidden="true"><Coins size={26} /></div>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
