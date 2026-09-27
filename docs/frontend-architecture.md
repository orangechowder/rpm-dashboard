# RPM Diesel Frontend Architecture

Status: proposed implementation specification, 2026-09-27. Target: panel.rpm-diesel.ca.

## 1. Scope And Decisions

Build an operations console, not a dashboard landing page. The primary screen is an actionable job queue with compact fleet telemetry above it and a persistent inspector beside it. Visual quality comes from information hierarchy, alignment, legibility, and fast interaction, not large cards or decorative effects.

This document specifies the frontend rewrite; it does not change the running application or claim measured superiority over Jobber or Workiz. Performance values below are release targets. Existing workflows remain available through migration.

| Decision | Specification |
| --- | --- |
| Platform | Preserve Next.js App Router, React 19, TypeScript, Tailwind CSS v4, Supabase repository contracts |
| Shell | Persistent obsidian shell; `#07090E` canvas, `#0D111A` surfaces; RPM red brand accent, cyan selection, amber blockers |
| Typography | Inter for UI and prose; JetBrains Mono for IDs, timestamps, quantities, currency, percentages, and other metrics |
| Navigation | Route-backed navigation; collapsible rail; one application-wide command dialog |
| Operations | Scrollable table and independently scrolling inspector; hover previews never replace pinned edits |
| Server state | One TanStack Query cache, initially adapting the existing repository; no mirrored job arrays in a UI store |
| UI state | Local reducers for workflows; a small shell context for command state; URL for shareable queue state |
| Primitives | Radix Dialog/Tooltip/Dropdown Menu/Select; cmdk; Lucide icons; TanStack Table; conditional TanStack Virtual |
| Localization | English and French; America/Toronto operational dates; preserve stored identifiers and enums |
| Compatibility | Preserve PM meter precedence, completion validation, punch editing, payroll locks, and record-level sync |

### Existing Anchors

- [Application controller](../app/page.tsx#L614) currently owns navigation, forms, queue state, session state, and sync.
- [Queue filtering and PM calculations](../app/page.tsx#L1558) decide active jobs, technician ordering, and meter precedence.
- [Telemetry](../app/page.tsx#L2297) derives work-order, fleet, and field-operation counts.
- [Queue table](../app/page.tsx#L2777) supports inline technician, priority, and status editing. These affordances must survive extraction.
- [Root layout](../app/layout.tsx) currently loads Geist and disables browser zoom; replace the fonts and remove zoom restrictions during implementation.
- [Global stylesheet](../app/globals.css) contains broad light-theme selectors and hover transforms. Do not append a second competing theme to its end.
- [Fleet repository](../lib/fleet-repository.ts) defines cloud records and Supabase operations; [reliability helpers](../lib/reliability.ts) define merge, retry, completion, offline, and payroll behavior.

Local architecture hypothesis: separating URL state, query-owned records, and inspector interaction state will prevent navigation and preview activity from triggering persistence or rebuilding the entire application. The first discriminating check is to hover through ten records, pin one, edit it, and receive a remote update: navigation must issue zero writes, the pinned record must not change, and unsaved fields must not be overwritten.

## 2. Design Tokens

Use semantic tokens, not page-specific hex values. Keep borders and surface changes subtle; controls, focus indicators, and critical states must have stronger contrast. Ordinary sections are unframed bands separated by rules. Reserve cards for repeated entities, dialogs, and genuinely framed tools; never nest cards.

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `#07090E` | Master shell and page background |
| Surface | `#0D111A` | Table, inspector, repeated item cards |
| Raised | `#151B26` | Dialogs, menus, sticky headers |
| Zebra | `#101620` | Alternate table row |
| Border | `#252E3D` | Decorative dividers, not the sole boundary of an input |
| Control border | `#657489` | Input boundary and resizer affordance |
| Text | `#EDF2F7` | Primary text |
| Muted | `#A3AFC2` | Secondary text |
| Subtle | `#8894A8` | Noncritical metadata; never lower text opacity |
| Brand | `#FF5C68` | RPM identity and primary action |
| Accent | `#55DCEC` | Navigation selection, focus, active work |
| Warning | `#FFC766` | Waiting, unassigned, attention required |
| Danger | `#FF7D88` | High priority, destructive feedback, failure |
| Success | `#5EE3A0` | Complete, healthy, acknowledged sync |

Spacing scale: 4, 8, 12, 16, 20, 24, 32px. Radii: 4px controls, 6px repeated cards, 8px dialogs. Status pills may be fully rounded. Icons: 16px in dense rows, 18px in toolbars, 20px in navigation, stroke width 1.75. Icon-only buttons require accessible names and hover/focus tooltips. No emoji or text glyph substitutes for icons.

### Tailwind v4 Foundation

The following is the replacement foundation, not an append-only override. During phased rollout, isolate legacy CSS under a legacy layout wrapper; migrate broad `button`, `table`, and form selectors before enabling the new tokens globally. Remove old negative letter-spacing, global button transforms, and white inset pill shadows from migrated surfaces.

```css
@import "tailwindcss";

@theme inline {
  --color-canvas: #07090E;
  --color-surface: #0D111A;
  --color-raised: #151B26;
  --color-zebra: #101620;
  --color-line: #252E3D;
  --color-control: #657489;
  --color-ink: #EDF2F7;
  --color-muted: #A3AFC2;
  --color-subtle: #8894A8;
  --color-brand: #FF5C68;
  --color-accent: #55DCEC;
  --color-warning: #FFC766;
  --color-danger: #FF7D88;
  --color-success: #5EE3A0;
  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains);
}

@layer base {
  :root { color-scheme: dark; }
  body { margin: 0; background: var(--color-canvas); color: var(--color-ink); }
  body, button, input, select, textarea { font-family: var(--font-sans); letter-spacing: 0; }
  :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  ::selection { background: var(--color-accent); color: var(--color-canvas); }
}

@utility numeric {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  letter-spacing: 0;
}

@utility nav-active {
  color: var(--color-accent);
  background: rgb(85 220 236 / 0.08);
  box-shadow: inset 2px 0 var(--color-accent);
}

@utility blocker-pulse {
  animation: blocker-attention 1.8s ease-in-out 3;
}

@keyframes blocker-attention {
  0%, 100% { box-shadow: 0 0 0 0 rgb(255 199 102 / 0); }
  50% { box-shadow: 0 0 0 3px rgb(255 199 102 / 0.22); }
}

@media (prefers-reduced-motion: reduce) {
  .blocker-pulse { animation: none; }
}
```

Pulse only a small amber indicator when a blocker first appears or increases, for three cycles; keep its label and count static and fully opaque. Existing persistent blockers remain amber without endlessly animating. User acknowledgement stops the effect, not the underlying condition. On reduced motion, use a static border and dot.

### Font Loading And Type Scale

Use `next/font` in the root layout. These calls replace the existing Geist imports; attach both variable classes to `html`. The installed Next.js guides for layouts, server/client components, and font optimization were consulted for this specification. If CI cannot fetch fonts at build time, vendor approved WOFF2 files and use `next/font/local`; never depend on runtime Google CSS.

```tsx
import { Inter, JetBrains_Mono } from "next/font/google";

export const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
```

| Role | Family | Size / line height | Weight |
| --- | --- | --- | --- |
| Page title | Inter | 20 / 28px | 600 |
| Inspector heading | Inter | 16 / 24px | 600 |
| UI / queue text | Inter | 13 / 20px | 400 or 500 |
| Labels / metadata | Inter | 12 / 16px | 500 |
| Telemetry value | JetBrains Mono | 28 / 32px | 600 |
| Queue ID / timestamp | JetBrains Mono | 12 / 16px | 400 or 500 |
| Micro-badge count | JetBrains Mono | 12 / 16px | 600 |
| Touch form input | Inter | 16 / 24px | 400 |

No viewport-scaled fonts or negative tracking. Align numeric columns right; keep identifiers left-aligned. Use `Intl.NumberFormat` for locale-aware decimal/currency output and `Intl.DateTimeFormat` with `America/Toronto` for operational timestamps. Store UTC instants, render `<time dateTime="...">`, expose absolute localized time on focus/hover. Never sort formatted date or currency strings. Use a fixed-width time cell; relative-age refreshes must not move columns. Long IDs retain full value via focus tooltip and a copy button in the inspector.

## 3. Persistent Shell And Navigation

```text
+------+-----------------------------------------------------------+
| RPM  | Section / context             Search actions    User       |
|      +-----------------------------------------------------------+
| Ops  | Work Orders       Fleet Health        Field Operations    |
| Jobs +-----------------------------------------------------------+
| Fleet| Queue filters / search / density / New work order         |
| Time +--------------------------------------+--------------------+
|      | Sticky queue column headers          | WO ID / close      |
|      |                                      | Unit / client      |
|      | Independently scrolling queue        | State / assignment |
|      |                                      | Detail tabs        |
|      |                                      | Scrolling detail   |
| Sync | Count / selection / pagination        | Action footer      |
+------+--------------------------------------+--------------------+
```

- Desktop rail: 64px collapsed, 216px expanded; header: 52px. Collapse toggle is a 32px button with `PanelLeftClose`/`PanelLeftOpen`, `aria-expanded`, and an accessible name. Use 44px touch targets on coarse pointers.
- Place the real RPM wordmark/brand asset at the top; use its existing verified asset path during implementation. No fabricated fleet photographs or decorative dashboard imagery. Real unit/part photos belong in their corresponding detail records.
- Rail is a full-height flex column. Navigation scrolls using `min-h-0 flex-1 overflow-y-auto`; telemetry and account controls use `mt-auto shrink-0`. Long navigation must never displace sync status offscreen.
- Expanded rail shows labels; collapsed icons retain names via accessible text and tooltips. Active link uses `aria-current="page"`, the `nav-active` utility, and a 2px cyan indicator with a restrained static glow. Never indicate selection by glow alone.
- Header contains breadcrumb/context, command trigger, sync warning when applicable, language control, and account menu. Keep RPM identity visible at first viewport, including mobile.
- Below 768px, remove the persistent rail. Use a 52px header with a 44px navigation button opening a modal navigation sheet; preserve the same links and active states.
- Shell fills `h-dvh overflow-hidden`; every scrolling child uses `min-h-0 min-w-0`. Use safe-area padding on mobile sheets and footers. Do not put an additional body scrollbar behind the workspace.
- Desktop z-index tiers: base 0, table sticky header/cell 10, shell header 20, nonmodal overlay inspector 30, modal backdrop 40, modal surface 50, popup/tooltip inside the active modal layer 60. Modal primitives own inertness and focus; z-index alone does not make a modal.

### Route And Capability Map

Proposed routes below are implementation targets, not existing files. Root redirects to `/operations` after session resolution. Use an authenticated route-group layout so the shell survives navigation; do not key providers by pathname.

| Route | Navigation label | Layout / capability |
| --- | --- | --- |
| `/operations` | Operations | Telemetry + active queue + inspector |
| `/jobs` | Work orders | Full-height queue; same filters, selection, and inspector contracts |
| `/units` | Fleet | Dense unit table + PM/service-history inspector; unit identity is `(unit, client)` |
| `/clients` | Clients | Client list + units/work orders/contact detail where data exists |
| `/punch` | Time clock | Current punch and history; retain manual entry, break, lost-time, edit/delete controls |
| `/payroll/my` | My payroll | Own date range, hours, and authorized compensation fields |
| `/payroll` | Payroll | Administrative periods, technician filters, classification, locking, export if supported |
| `/profitability` | Profitability | Authorized cost/revenue summaries with drill-down; missing rates stay unknown |
| `/admin/users` | Users | Administrative identity, access, and technician roster management |

Group Operations/Work orders/Fleet/Clients, then Time/Payroll, then Administration. Capability-filter the navigation, command results, columns, and mutation controls consistently. Define capabilities such as `jobs.read`, `jobs.manage`, `jobs.changeStatus`, `time.manage`, `payroll.readOwn`, `payroll.manage`, and `users.manage`; map them to current roles only after capturing existing permissions. Do not silently grant every mutation to every technician or remove existing technician status changes. Route guards and UI visibility are not authorization: trusted server/database policies must enforce the same permissions.

### Live System Telemetry

Pinned rail footer: connection icon, concise state, pending mutation count, and last successful synchronization time. Clicking it opens a sync detail popover containing failed items and retry controls, not a generic toast history.

| State | Label / visual | Rule |
| --- | --- | --- |
| Bootstrapping | Connecting / neutral | Initial authoritative read has not completed |
| Current | Synced / green | Successful read, subscribed channel, no pending failures |
| Synchronizing | Syncing / cyan | Active fetch or mutation; old data remains visible |
| Delayed | Reconnecting / amber | Online but subscription failed or authoritative freshness expired |
| Offline | Offline / amber | Network unavailable; show cached timestamp and pending count |
| Failed | Sync failed / red | Nonretryable failure or exhausted retry budget; actionable retry |

Track `lastSuccessfulReadAt`, subscription state, last write acknowledgement, and pending/failed count separately. A quiet realtime channel does not mean data is stale. Use a foreground reconciliation read every 60 seconds, plus refetch on reconnect/focus; mark stale after 120 seconds without a successful read. Suspend periodic work in a hidden tab. Browser `navigator.onLine` is a hint, not evidence that Supabase is healthy. Never show invented API latency or an unconditional green 'Live' dot.

## 4. Command Bar

Install one command dialog in the persistent shell. Trigger with Cmd+K on macOS and Ctrl+K elsewhere, plus a visible search-icon button in the header. Use an accessible Dialog containing a cmdk combobox/listbox; 640px maximum width, viewport minus 24px on mobile, maximum 70dvh height, scrollable results. Use a named dialog, Escape dismissal, focus trap, and focus restoration.

### Interaction And Ranking

1. Empty query: recent permitted destinations and common permitted actions; no fabricated or cross-account history.
2. Match order: exact work-order/unit ID, prefix match, permitted navigation/action, then fuzzy text match. Distinguish units by client.
3. Results grouped as Navigate, Work orders, Fleet, Filters, Actions. Limit initial visible results to 8; fetch larger result sets through an explicit continuation.
4. Local commands and cached IDs respond immediately. Debounce remote search by 150ms; cancel superseded requests and ignore stale responses. Key all requests by access scope and normalized query.
5. Arrow keys move the active option; Enter selects it; Escape closes the topmost overlay. Announce result counts politely after settling, not on every keypress.
6. Query submission is ignored during IME composition. Do not intercept unrelated modifier shortcuts. With another modal open, Cmd/Ctrl+K does not stack a competing focus trap; it is inactive until that modal closes.

### Natural-Language Contract

Natural language resolves to a typed intent, never directly to a database write. The first release can support a deterministic EN/FR vocabulary for queue navigation and explicit actions; unrestricted language understanding requires a separately approved server integration. Unknown or ambiguous language asks for clarification without guessing.

| Input example | Resolution |
| --- | --- |
| `show high priority jobs waiting on parts` | Set `priority=High` and `status=Waiting on Parts`; show resulting filter state |
| `open WO-178908` | Exact ID lookup; open and pin its inspector |
| `show unassigned units` | Distinct units referenced by unassigned active jobs; label this definition explicitly |
| `assign WO-178908 to Marc` | Resolve a unique active technician, show proposed change, require confirmation |
| `complete WO-178908` | Open completion workflow, including required meter input and validation; never bypass it |

```ts
type QueueIntent = {
  status?: "Scheduled" | "In Progress" | "Waiting on Parts" |
    "Waiting on Estimates" | "Ready for Invoicing" | "Completed";
  priority?: "High" | "Normal" | "Low";
  unassigned?: boolean;
};

type CommandIntent =
  | { kind: "navigate"; destination: "operations" | "jobs" | "units" | "punch" }
  | { kind: "filterJobs"; filters: QueueIntent }
  | { kind: "openJob"; jobId: string }
  | { kind: "proposeAssignment"; jobId: string; technicianId: string }
  | { kind: "requestCompletion"; jobId: string };
```

The registry must enumerate all permitted route destinations, labels, EN/FR aliases, capability requirements, icons, and handlers; the union above shows the interaction contract, not the exhaustive route registry. Validate resolved IDs against current records. The current work-order schema stores technician names, so the adapter must resolve the selected ID to an unambiguous name or reject the operation; stable assignment IDs are a backend migration, not an assumed field.

All mutating commands pass through the same authorized mutation gateway as buttons, with schema validation, current-record checks, audit metadata, and preview/confirmation. Do not execute SQL, JavaScript, URLs, or arbitrary tool calls from model output. Job notes are untrusted content, not instructions. If an LLM is added, keep credentials server-side, minimize sent data, exclude payroll and secrets, document retention, and preserve deterministic commands when the model is unavailable.

## 5. Split-Pane Operations Workspace

### Geometry

- Operations title and telemetry occupy at most 168px above the queue at 1440x900; the queue starts in the first viewport. Telemetry groups are adjacent sections with shared dividers, not nested metric cards.
- Full desktop queue has a useful minimum viewport of 640px; inspector is 400px by default, resizable between 360px and 560px. Allow side-by-side mode only when the workspace container is at least 1000px wide; clamp maximum inspector width to `containerWidth - 640px`. The table itself may scroll horizontally.
- Reserve the desktop inspector column, even with nothing selected. Render a quiet empty inspector with no instructional prose. Hover therefore changes content, not the queue width. User may collapse the inspector explicitly.
- In narrower workspaces, use a right overlay inspector with `width: min(440px, 100%)`; disable hover-open. Below 768px, selection opens a full-width modal detail sheet with a Back/close control and safe-area footer.
- In wide mode, inspector is an `aside` labelled by its work-order heading, not a modal: no focus trap or `aria-modal`. The narrow overlay uses Dialog semantics, traps focus, and makes the background inert.
- Use a keyboard-accessible resizer with `role="separator"`, vertical orientation, current/min/max values, an accessible name, and arrow-key adjustments of 16px. Persist clamped width per user; drag through requestAnimationFrame, save only on release.
- A container ResizeObserver selects wide versus overlay mode; SSR starts with deterministic CSS geometry. Do not mount duplicate inspectors or duplicate network subscriptions when switching layouts.

### Inspector State Machine

Maintain `pinnedJobId` in the URL, transient `previewJobId` locally, and drafts keyed by job ID. Display `pinnedJobId ?? previewJobId`. Preview is read-only. A selected row and a bulk-selected row are separate concepts and have different affordances.

| Event | Behavior |
| --- | --- |
| Fine-pointer row enter, no pin | After 100ms intent delay, show cached preview; prefetch only if required |
| Pointer crosses another row | Cancel previous intent; at most one pending preview; a late response cannot replace the current ID |
| Pointer leaves queue for inspector | Preserve preview while pointer is inside either region; delayed 150ms dismissal after leaving both |
| Row link focus, no pin | Preview without stealing focus; keyboard users get the same read-only access |
| Row click / Enter on its link | Pin immediately, write the job ID to the URL, expose editable controls |
| Pin exists, pointer moves | Ignore hover preview until the pin is closed; never replace the editor |
| Different row clicked with clean draft | Switch pin without queue reload; preserve scroll and sorting |
| Different row clicked with dirty draft | Offer Save / Discard / Cancel; Save must finish successfully before switching |
| Close or Escape | Close topmost popup first, then inspector; dirty drafts require resolution; focus returns to originating row link |
| Selected row moves outside filter | Keep inspector, show 'Outside current filter'; never silently broaden filters |
| Selected record deleted or access revoked | Stop editing, show unavailable/removed state, clear prohibited cached content; never resurrect by upsert |
| Cold detail fetch | Show selected record identity and dimensionally stable skeleton; preserve queue |
| Detail fetch fails | Inline error with retry; retain cached authorized detail with a stale indicator if available |

Ordinary pointer activation keeps queue focus for rapid selection; an explicit row 'Open details' action moves focus to the inspector heading. Narrow modal mode always focuses its heading/first meaningful control. Avoid programmatically moving focus on hover. Hover updates do not generate screen-reader announcements. Dirty drafts survive Back/Forward selection changes in memory, keyed by record; display a draft indicator on reopening. App-controlled navigation uses the Save/Discard/Cancel guard. Hard reload/closing the tab uses `beforeunload` only while dirty; browsers do not guarantee recovery. Do not promise reliable interception of browser history through undocumented router APIs.

### Inspector Anatomy

Sticky header: ID, priority, close, overflow menu. Identity band: unit, client, issue. Compact status/technician controls remain visible. Tabs: Overview, Labor & Parts, Notes, Activity; tab overflow becomes horizontally scrollable with visible focus. Tab bodies scroll independently of the action footer. Summary fields use a two-column definition list, not stacked cards. Real attachments appear only when supported by the data contract.

Footer contains contextual primary action, secondary save/cancel while editing, and mutation state. Completion always invokes the existing validated meter workflow; a command or inline status menu must use exactly the same path. Preserve notes editing/deletion, line items, unit service history, and return-to-job behavior. Render pending saves per record, not as a global disabled application.

## 6. Telemetry And Bottlenecks

Use three equal desktop columns with 16px internal padding and vertical dividers. Each group has a 12px label, a 28px primary number, and two compact secondary signals. At 768-1199px allow the third group to span the full width; below 768px use one-column compact rows and prioritize blockers before secondary figures. Do not shrink labels to fit French text.

Counts describe the authorized dataset, not the currently loaded page. A queue filter does not silently change global telemetry; expose its scope separately. Every actionable metric navigates to the corresponding filtered collection and preserves the other relevant context. Treat zero, unknown, loading, stale, and error as distinct states.

| Group / signal | Definition | Interaction / encoding |
| --- | --- | --- |
| Work Orders: Active | Jobs where trimmed status is not `Completed` | Opens active queue |
| In progress | Active jobs with `In Progress` status | Cyan count; exact-status filter |
| Waiting on parts | Jobs with `Waiting on Parts` status | Amber labelled badge; pulse on increase; exact-status filter |
| Waiting on estimates | Jobs with `Waiting on Estimates` status | Amber count; exact-status filter |
| Fleet Health: PM due | Units meeting the current `pmDueForUnit` meter predicate | Amber; PM-due filter |
| PM compliance | `100 * (eligibleUnits - dueUnits) / eligibleUnits` | Eligible means authoritative/fallback current meter, valid baseline and positive interval; show eligible/total denominator |
| Unknown PM | Units lacking enough valid meter data | Neutral 'Unknown'; never classify missing readings as healthy |
| Field Operations: Active technicians | Distinct user IDs with active time entries linked by work-order ID to active jobs | Green; active-technician filter; exclude active breaks, show on-break count separately |
| Unassigned work orders | Active jobs with empty/whitespace technician or canonical `Unassigned` | Amber; unassigned-job filter |
| Unassigned units | Distinct `(unit, client)` pairs referenced by those jobs | Separate amber count; not all fleet units without current work |

Changing PM compliance to exclude unknown units and linking technician activity by work-order ID are intentional metric corrections requiring product approval and fixture tests. Preserve current unit/current-meter and unit/last-PM overrides as authoritative; historical work-order readings are only fallbacks. Do not replace these decisions with the stored `overdue` boolean. A zero eligible denominator displays 'Unknown', not 0% or 100%.

Do not call punched-in technicians 'on the road': the current data contains time entries, not location. Response time, GPS/ETA, dispatch geography, parts inventory, wait duration, and SLA breach need additional trustworthy events or integrations. In particular, `updatedAt` is not a parts-wait start time. Omit unsupported metrics or show an explicit unavailable value, never a fabricated number. Multiple blockers can overlap: the aggregate 'Blocked jobs' is a unique union, not the sum of badges. Waiting on estimates/parts are workflow states, not proof of physical vehicle unavailability.

Critical signal order: failed saves/access problems, operational blockers, PM due, general workload. Avoid a screen full of warning banners: use one compact critical strip for action failures and small labelled count badges for operational conditions. No pulsing green connection lights.

## 7. High-Frequency Tables

### Column Contract

| Column | Default width | Content / behavior |
| --- | --- | --- |
| Selection | 40px, when bulk actions are authorized | Native checkbox; separate from inspector pin |
| Work order | 176px minimum | Mono ID link; Inter issue summary below in comfortable mode |
| Unit / client | 160px minimum | Mono unit identifier, Inter client name |
| Technician | 132px minimum | Text or authorized inline select; explicit Unassigned state |
| Priority | 96px | High / Normal / Low labelled pills |
| Status | 176px minimum | Labelled state or inline select; expand for French labels |
| Updated | 112px | Mono timestamp; sort by raw instant |
| Row actions | 40px | Ellipsis icon menu with accessible record-specific name |

Dense mode: fixed 40px rows, single-line summary; comfortable mode: 56px rows with two lines. Coarse-pointer mode: at least 48px rows and 44px hit targets. Header: 36px, toolbar: minimum 44px, footer: 36px. Persist density and column visibility per user. Never let loading, hover actions, timestamps, or translation change row geometry unexpectedly.

The queue viewport owns both scroll axes; table uses `table-fixed` with a colgroup and sufficient minimum width. Sticky column headers use opaque raised backgrounds and `sticky top-0 z-10`; pin the ID column if useful, with an opaque per-row background. Provide horizontal scrolling instead of squeezing all columns into unreadable text. Mobile renders a labelled compact list of work orders, units, priority, and status, not a seven-column table scaled down. Each mobile item opens the same inspector contract.

Use a semantic HTML table, `<caption>` (visually hidden permitted), `<th scope="col">`, sort buttons, and `aria-sort` on the active sort header. Do not add `role="grid"` or spreadsheet arrow handling unless full grid semantics are implemented. Each row has a real work-order link for keyboard activation and open-in-new-tab; row pointer activation is a convenience. Inline selects, checkboxes, and action menus stop row activation. Bulk selection uses checkbox state, not `aria-selected` on a plain table row.

### Utility Recipes

All variant classes must be statically enumerable for Tailwind scanning. No interpolated `bg-${tone}` construction. These recipes are base styles; component contracts supply localized labels, validation, event behavior, and ARIA attributes.

```ts
export const recipe = {
  toolbar: "flex min-h-11 min-w-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2",
  iconButton: "inline-flex size-8 shrink-0 items-center justify-center rounded border border-transparent text-muted hover:bg-white/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:size-11",
  primaryButton: "inline-flex min-h-8 items-center justify-center gap-2 rounded bg-brand px-3 text-[13px] font-semibold text-canvas hover:brightness-110 disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:min-h-11",
  input: "h-8 min-w-0 rounded border border-control bg-canvas px-2 text-[13px] text-ink placeholder:text-subtle aria-invalid:border-danger [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-base",
  head: "sticky top-0 z-10 h-9 border-b border-line bg-raised px-3 text-left text-xs font-medium text-muted",
  row: "h-10 border-b border-line odd:bg-surface even:bg-zebra hover:bg-white/[0.02] focus-within:bg-accent/10 data-[pinned=true]:bg-accent/10 data-[pinned=true]:shadow-[inset_2px_0_0_var(--color-accent)]",
  cell: "overflow-hidden px-3 py-1 text-[13px] leading-5 text-ink",
  numericCell: "numeric whitespace-nowrap px-3 py-1 text-right text-xs text-muted",
  badge: "inline-flex min-h-5 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4",
  blocker: "inline-flex min-h-6 items-center gap-1.5 rounded border border-warning/45 bg-warning/10 px-2 text-xs font-medium text-warning",
  section: "min-h-0 min-w-0 border-b border-line bg-surface",
  inspector: "flex h-full min-h-0 min-w-0 flex-col border-l border-line bg-surface",
};

export const priorityTone = {
  High: "border-danger/45 bg-danger/10 text-danger",
  Normal: "border-control bg-white/5 text-muted",
  Low: "border-accent/40 bg-accent/10 text-accent",
} as const;

export const statusTone = {
  Scheduled: "border-control bg-white/5 text-muted",
  "In Progress": "border-accent/40 bg-accent/10 text-accent",
  "Waiting on Parts": "border-warning/45 bg-warning/10 text-warning",
  "Waiting on Estimates": "border-warning/45 bg-warning/10 text-warning",
  "Ready for Invoicing": "border-success/40 bg-success/10 text-success",
  Completed: "border-control bg-white/5 text-muted",
} as const;
```

Pair tones with visible labels and Lucide icons where meaningful: `AlertTriangle`, `Clock3`, `Wrench`, `Package`, `FileCheck2`, `Check`. Never depend on red/green discrimination. High priority is not automatically overdue; priority and workflow status remain independent fields. Hover luminescence must not obscure the stronger pinned-row indicator; test the generated state precedence and use a compound pinned+hover variant if necessary.

### Sort, Selection, And Realtime Stability

- Preserve the existing operational default: administrators see latest punch activity first; technicians see their active work order first. Index latest punch per job once when time entries change instead of repeatedly scanning all entries inside a sort comparator. Stable tie-breaker: job ID. Expose alternate priority/updated/unit sorts without changing the default silently.
- Sorting must apply to the complete filtered dataset, not independently within pages. Server pagination requires server-side latest-punch sorting or an equivalent query/view; do not claim compatible ordering from a simple `updated_at` query.
- Realtime updates patch visible cells immediately, but defer row reordering while a pointer is interacting, a menu is open, or a user is editing. Show a compact 'Queue updated' action to apply buffered ordering. Selected row and scroll anchor remain stable.
- Bulk actions operate only on explicitly selected IDs. Header checkbox selects visible page rows; label the selection scope. Clear selection when filters or authorization scope change. 'Select all matching' is a separate future server-supported operation.
- Destructive bulk actions require a count and explicit confirmation. Report partial success by ID; do not pretend the entire batch succeeded. Disable operations not supported atomically/individually by the repository.
- Start with ordinary paginated rendering, 50 rows per page. Add virtualization only when measured DOM costs justify it; fixed density-specific heights, 8-row overscan, stable record keys, and no unmounting of the focused row. Offer nonvirtualized pagination for assistive technology; verify row counts and focus behavior with real screen readers.
- Distinguish no data, no filter results, query failure, cold loading, background refresh, and offline cache. Skeletons occupy the same row geometry; refetch never blanks a populated queue.

## 8. State Ownership And Data Flow

```text
URL (view/filter/sort/pinned ID)
              |
              v
Queue controller <----> query cache <----> repository <----> Supabase
       |                     ^                                  |
       v                     |                                  |
Inspector reducer      realtime reconciliation <----------------+
       |
Draft + mutation gateway ---> authorized writes + outbox

Shell preferences: versioned local preferences
Command dialog: shell-local open/query/active option
```

| State | Owner | Persistence |
| --- | --- | --- |
| Session and capabilities | Trusted session provider | Secure session mechanism; no passwords in frontend stores |
| Jobs, units, time entries, summaries | TanStack Query | In-memory cache; explicitly scoped offline cache only where required |
| Filters, text query, sort, page cursor, pinned ID, inspector tab | URL | Shareable, reloadable, Back/Forward aware |
| Preview ID, hover intent, resizing | Local UI controller | None |
| Inspector drafts and validation | Feature reducer keyed by record ID | Memory; clear on logout/scope change |
| Bulk-selected IDs | Queue-local reducer | Current filter scope only |
| Sidebar width, density, columns, language | Versioned preferences | Local storage keyed by signed-in user; SSR-safe defaults |
| Cmd+K dialog | Small shell context | None; recent IDs optional and account-scoped |
| Offline mutations | Existing outbox adapter initially | Explicit supported operations, user/access scoped; no credentials |
| Telemetry values | Derived query selectors / server aggregate endpoint | Never independent writable React state |

Avoid adding Zustand or Redux solely for the rewrite. Introduce an external selector store only if measured cross-feature UI coordination outgrows local reducers; it must still not mirror server records. Query provider, shell context, and realtime bridge live once under the authenticated layout. Pages and static shell framing can remain Server Components; interactive providers, queue, command dialog, and inspector are client islands. Browser-only repository/session code is not automatically a server data-access layer.

### URL Contract

Example: `/jobs?status=Waiting+on+Parts&priority=High&assignee=unassigned&sort=latest-punch&dir=desc&job=WO-178908&tab=notes`.

Centralize parse/serialize logic using `URLSearchParams` and an allowlisted schema. Trim search, validate enum values and ID lengths, discard invalid cursors, and use deterministic defaults. Store canonical status values, not translated labels. Never expose passwords, private notes, or full records in URLs. Reset pagination on filter/sort changes.

Explicit navigation/filter selection uses history push. Debounced query typing and within-record tab changes use replace. Hover never writes history. Inspector pin changes are client-only URL state: use the Next.js-supported native History integration so a row selection does not request a new server-rendered page or call `router.refresh`; subscribe through the router's supported search-parameter hooks. Check the installed navigation guide before implementing this adapter. Full route changes use Next Link/router navigation. Reloading a detail URL fetches the selected record even when it is outside the current queue page. Preserve scroll on detail selection; Back restores previous filters/pin. Do not maintain a second unsynchronized `selectedJob` object.

### Inspector Controller Contract

```ts
type JobDraft = {
  issue: string;
  tech: string;
  priority: "High" | "Normal" | "Low";
};

type DraftState = {
  baseUpdatedAt: string | null;
  values: JobDraft;
  dirty: boolean;
  saveState: "idle" | "saving" | "failed" | "conflict";
};

type InspectorState = {
  previewJobId: string | null;
  pendingTargetId: string | null;
  drafts: Record<string, DraftState>;
};

type InspectorEvent =
  | { type: "preview"; jobId: string | null }
  | { type: "requestPin"; jobId: string | null }
  | { type: "edit"; jobId: string; patch: Partial<JobDraft> }
  | { type: "saveStarted"; jobId: string }
  | { type: "saveSucceeded"; jobId: string; updatedAt: string }
  | { type: "saveFailed"; jobId: string; conflict: boolean }
  | { type: "discard"; jobId: string };
```

The reducer is pure; a controller performs URL changes, fetches, focus restoration, and writes. Record-level drafts never include passwords or payroll secrets. Completion, line items, notes, and time-entry edits have their own validated form contracts rather than a catch-all untyped patch. Cache-to-form hydration runs once per opened base record; a background refetch does not reset a dirty form.

### Query And Realtime Contract

```ts
type AccessScope = {
  cacheKey: string;
};

export const fleetKeys = {
  snapshot: (scope: AccessScope) => ["fleet", scope.cacheKey, "snapshot"] as const,
  jobs: (scope: AccessScope, canonicalFilters: string) =>
    ["fleet", scope.cacheKey, "jobs", canonicalFilters] as const,
  job: (scope: AccessScope, jobId: string) =>
    ["fleet", scope.cacheKey, "job", jobId] as const,
  telemetry: (scope: AccessScope) =>
    ["fleet", scope.cacheKey, "telemetry"] as const,
};
```

`cacheKey` is an opaque identifier for the authorized account/organization scope, not an authorization token. Do not assume the current schema already has tenancy. Never share a query cache between users; cancel reads, unsubscribe, and clear cached data/drafts/history on logout or access-scope change. Cache partitioning does not replace authorization.

Two explicit data modes prevent duplicate ownership:

1. Migration mode: wrap `loadFleetData()` once in the `snapshot` query. Derive rows, detail, and metrics from that one cache entry; do not also seed independently mutable per-record and per-page caches. The current loader fetches full records, including notes and line items. This mode preserves current behavior but is not a claim of large-fleet scalability.
2. Scale mode: add repository-backed summary projection, cursor pagination, detail-by-ID, and authoritative aggregate queries. Retire the snapshot owner when this mode is enabled. Summary rows exclude notes/line items; detail queries own those fields. Mutation/realtime handlers patch detail and relevant summaries, invalidate membership/order and aggregate keys, and refetch missing/incomplete payloads. Do not leave both modes active for a scope.

Initial client freshness: `staleTime` 15 seconds, inactive detail `gcTime` 5 minutes, plus foreground reconciliation above. Adapt these after profiling. Respect AbortSignal in new repository reads; the current loader needs an adapter change for true cancellation. Use cached summary as preview, clearly mark incomplete detail, and fetch authoritative detail when pinned. Hover-prefetch at most two concurrent detail requests and never download attachments on hover.

Realtime subscriptions are created once per authorized scope, with cleanup on logout/unmount. Batch bursts within a 50ms window; ignore stale record revisions, handle insert/update/delete distinctly, and reconcile after gaps/reconnects. Reuse existing merge policy during migration, but handle deletion explicitly: `mergeRemoteRecords` alone retains locally missing records and is not a deletion strategy. A full authoritative refresh must reconcile server absences without resurrecting deleted rows or discarding legitimate pending creates.

### Mutation Safety

All writes pass through one feature mutation layer, not persistence effects attached to arbitrary UI state. Save only changed records. Do not write entire job/unit collections after a preview, language change, or remote update. Preserve per-record `updatedAt` updates and existing meter/completion validation.

- On mutate: authorize intent, validate payload, cancel conflicting reads, snapshot only affected cache entries, mark the record pending, and optimistically update reversible fields only.
- On success: reconcile the server acknowledgement, clear that operation from pending state, update/invalidate related summaries and aggregates, and report success without moving focus.
- On failure: rollback only the failed operation's patch if it is still current; never restore a whole stale cache snapshot over later edits. Retain draft, show inline retry, and restore a consistent remote version.
- On remote change during edit: retain the draft, compare its base revision, and offer refresh/reapply on conflict. Client timestamps alone cannot prevent lost updates; production-grade concurrent editing requires server-generated versions and conditional updates returning conflicts. Do not advertise atomic conflict protection from the current unconditional upserts.
- On completion, clock events, payroll locks, and destructive changes: wait for authoritative success or use a separately supported idempotent pending workflow; never display financial finality optimistically.
- Audit successful changes with actor, entity, operation ID, and changed fields on a trusted backend. Existing client-side activity logging is not by itself a tamper-resistant audit trail.

Retain only currently supported offline operations until replay is hardened. A production outbox needs per-operation acknowledgement/removal, stable idempotency keys, record-order replay, retry classification, user scoping, and a visible failed/conflict state. The existing storage helpers do not establish all these guarantees; especially do not clear the entire queue after partial success. Nonidempotent clock events need backend deduplication before automatic replay can be called reliable. Offline payroll approval, user administration, and destructive bulk actions remain unavailable. Never replay one user's queued work under another user's session.

The current account model exposes a password field to the frontend. This specification must not perpetuate that design: secure session handling and authoritative permissions are release prerequisites for server-side data loading and privileged commands. Do not serialize account passwords into Server Component props, command results, analytics, browser cache, or the new query layer. Authentication migration is a separately scoped backend/security dependency, not completed by this visual rewrite.

## 9. Component And Module Manifest

The following are proposed module names, not files already implemented. Organize by feature; create a shared component only when more than one feature actually uses its contract.

| Module / component | Responsibility / input contract |
| --- | --- |
| Authenticated layout | Stable server framing; session boundary; mounts one provider tree |
| `AppProviders` | QueryClient lifetime, locale, scope; no page-owned provider recreation |
| `AppShell` | Slots for rail, header, main; does not own job data |
| `NavigationRail` | Permitted navigation items, pathname, collapsed preference |
| `SystemTelemetry` | Connection state, acknowledgement times, outbox counts |
| `CommandDialog` | Registry, allowed intents, query, resolver; no direct repository writes |
| `OperationsWorkspace` | Composes telemetry, queue, inspector; URL/controller boundary |
| `TelemetryStrip` / `TelemetryBlock` | Typed value, scope, freshness, severity, filter destination |
| `QueueToolbar` | Parsed filters, sort, density, create capability; emits typed changes |
| `JobQueueTable` / `JobQueueRow` | Stable rows, column configuration, selection, preview/pin callbacks |
| `PriorityPill` / `StatusPill` / `BlockerBadge` | Canonical enum, localized label, static style variants |
| `JobInspector` | Record ID + read-only/pinned mode; loading/error/unavailable state |
| `InspectorTabs` | URL-backed tab, lazy tab content; no duplicated selected-job state |
| `JobEditForm` / `CompletionForm` | Record-scoped draft and field errors; calls feature mutations |
| `TimeEntryEditor` / `PayrollPeriodToolbar` | Preserve existing punch and payroll domain behaviors |
| `InlineError` / `EmptyState` / `SkeletonRows` | Distinct failure, empty, and loading states with stable geometry |
| `fleetQueries` / `fleetMutations` | Query ownership, repository adaptation, optimistic reconciliation |
| `FleetRealtimeBridge` | One subscription lifecycle, scoped reconciliation, no visual UI |
| `queueUrl` / `queueSelectors` | Pure parsing, sorting, filtering, metric definitions; unit-testable |
| `inspectorReducer` | Preview/draft transitions; no storage, routing, or network effects |

### Composition Blueprint

This slot-based component specifies geometry only. Named slots above provide actual controls, semantics, and data; this is not a mocked working screen. `wide` is derived from workspace width, not assumed from viewport width, and `inspectorWidth` is clamped by the controller. The overlay inspector is rendered by its Dialog host outside this grid when `wide` is false.

```tsx
import type { CSSProperties, ReactNode } from "react";

type WorkspaceProps = {
  telemetry: ReactNode;
  toolbar: ReactNode;
  queue: ReactNode;
  footer: ReactNode;
  inspector: ReactNode;
  wide: boolean;
  inspectorWidth: number;
};

export function OperationsLayout({
  telemetry, toolbar, queue, footer, inspector, wide, inspectorWidth,
}: WorkspaceProps) {
  const columns: CSSProperties = {
    gridTemplateColumns: wide
      ? `minmax(640px, 1fr) ${inspectorWidth}px`
      : "minmax(0, 1fr)",
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-line">{telemetry}</div>
      <div className="grid min-h-0 min-w-0 flex-1" style={columns}>
        <section aria-labelledby="queue-heading" className="flex min-h-0 min-w-0 flex-col">
          <div className="shrink-0">{toolbar}</div>
          <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
            {queue}
          </div>
          <div className="shrink-0 border-t border-line">{footer}</div>
        </section>
        {wide ? inspector : null}
      </div>
    </div>
  );
}
```

The toolbar must supply `id="queue-heading"`; the inspector slot supplies its own labelled `aside`. In short or zoomed viewports, collapse secondary telemetry and let its containing region scroll so the queue remains reachable. The parent main region also supplies `min-h-0 flex-1`; omitting one height constraint in this chain breaks sticky headers.

### Dependency Manifest

Current repository does not yet include the libraries below. Add them during implementation, resolve compatible stable versions, commit the lockfile, and validate React 19 compatibility. Do not add them merely to publish this specification.

```sh
npm install @tanstack/react-query @tanstack/react-table cmdk lucide-react @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-select zod
```

Optional after profiling: `@tanstack/react-virtual`. Use existing Vitest for pure logic; add React Testing Library and Playwright/axe as implementation-test dependencies when component/browser coverage is introduced. No second CSS framework, global state library, animation framework, or chart package is required. A native progress element suffices for PM compliance when its data is known.

## 10. Accessibility, Localization, And Failure States

- Release target: WCAG 2.2 AA. Verify normal text at 4.5:1 and essential control/focus indicators at 3:1 on every actual composite background; decorative dividers may be subtler. Color labels and icons must remain meaningful without hue.
- Restore browser zoom by removing `maximumScale: 1` and `userScalable: false` from the viewport configuration. Test 200% text zoom and 400% browser zoom; switch to mobile/list patterns when necessary rather than shrinking text.
- Touch controls meet 44px targets; dense pointer controls have at least 24px target area, typically 32px. Keep gaps between destructive and routine actions. Tooltips cannot contain essential exclusive information.
- Provide skip-to-main navigation, ordered headings, named landmarks, visible keyboard focus, and proper dialog/menu focus restoration. Focus indicators must not be clipped by overflow; use inset focus treatment in tight cells where needed.
- EN/FR labels use message keys and plural rules. French text must wrap or expand controls without hiding the primary action. Set document `lang` to the selected locale; first render uses a server-readable preference where available to avoid hydration mismatches.
- Announce save completion/failure and connection state changes via a dedicated polite live region. Use assertive alerts only for blocking failures. Do not mark the whole queue or telemetry strip `aria-live`.
- Render loading placeholders of stable dimensions with `aria-busy` on the affected region. Errors identify retry scope; no '0 jobs' while a query failed. Disable repeated submission only for the affected operation and keep unrelated navigation usable.
- Long descriptions/notes wrap with `overflow-wrap:anywhere`; table summaries truncate but remain fully available in the inspector. Test long work-order IDs, duplicate unit numbers across clients, large currency values, missing timestamps, and French status labels.
- Background tabs and reduced-motion users do not receive decorative motion. Inspector entrance may animate transform/opacity for 120ms using motion-safe variants; cached content appears before animation completes. No animated width relayout on every preview.

## 11. Performance And Release Gates

Measure before making competitor comparisons. Collect a baseline on the current production-equivalent build using the same seeded fleet, device, network, viewport, and tasks. Log durations and counts without names, notes, credentials, or payroll values. Compare median and p95, not a best-case demo.

| Gate | Target / measurement |
| --- | --- |
| Cached pin-to-detail paint | p95 <= 100ms, from click to meaningful selected-record content |
| Hover preview | p95 <= 200ms including the 100ms intent delay; no writes and bounded prefetch |
| Command open | p95 <= 100ms; cached results <= 100ms after query input |
| Queue filter input | No keystroke blocked by remote work; local update p95 <= 100ms on migration dataset |
| User responsiveness | Production p75 INP <= 200ms, LCP <= 2.5s, CLS <= 0.1 |
| Realtime UI | p95 <= 150ms from received event to cell paint under a 20-event/second test burst |
| Cold detail | Render identity/skeleton immediately; p95 <= 1s under a controlled 150ms RTT, excluding acknowledged server outage |
| Rendering | <= 100 mounted data rows in paginated/virtualized mode; no application-wide rerender for a clock tick |
| Background activity | One realtime subscription owner per scope; no hover mutation requests; no hidden-tab reconciliation loop |
| Payload | Scale-mode default 50-row summary page <= 100KB uncompressed JSON; notes/line items/attachments fetched on demand |

Test migration mode with 1,000 jobs / 10,000 time entries; scale mode with 10,000 jobs, cursor pagination, and complete server-side aggregates. If existing full-snapshot loading misses the budget, add the specified repository endpoints before claiming high-volume readiness. Use deferred rendering for expensive search results and transitions for nonurgent route/filter updates; do not delay the controlled input itself. Profile before adding memoization; stabilize query-derived row references and isolate the live punch timer from the table.

### Required Acceptance Scenarios

1. Cmd/Ctrl+K opens from every authenticated route; Escape and focus restoration work. Permission-restricted commands cannot be searched or executed. Ambiguous natural-language mutations never execute.
2. Queue headers stay sticky inside the scrolling viewport; rail/header remain fixed; telemetry does not consume the whole short screen. Inspector and queue scroll independently.
3. Rapid hover A/B/C with responses C/A/B only displays C; no mutation or history write occurs. Hovering while B is pinned leaves B visible. Coarse pointers never trigger hover preview.
4. Row click pins without document reload or server refresh. Inline selects/checkboxes do not pin accidentally. Deep link, refresh, Back, Forward, out-of-filter detail, deleted record, and permission loss all behave as specified.
5. Unsaved job B cannot be replaced by clicking C without Save/Discard/Cancel. Save failure retains B's draft. Browser Back retains drafts by ID. Concurrent update flags conflict without overwriting edited fields.
6. A remote job update or language switch does not write the whole collection. Two users editing different records never overwrite each other. Stale remote echoes and delete events do not resurrect data.
7. Parts/unassigned metrics agree with the complete filtered dataset. Duplicate unit numbers across clients remain distinct. Unknown PM readings are not healthy. Active technicians are derived from linked time entries, not assumed GPS status.
8. Completion meter rules, unit meter precedence, note editing, labor/part totals, punch correction, breaks, paid lost time, and payroll locks pass existing regression fixtures.
9. Offline/reconnect: queued operations retain identity, replay only in the correct scope, do not duplicate punches, and preserve failed items after partial success. Where backend deduplication is unavailable, unsafe replay stays disabled.
10. Visual and keyboard tests at 390x844, 768x1024, 1280x800, and 1920x1080, both languages, both densities, sidebar expanded/collapsed, and reduced motion. Assert non-overlap and no document-level horizontal overflow; internal table overflow is allowed.
11. Verify palette contrast, 200% text scaling, 400% zoom reflow, screen-reader table semantics, modal focus traps, resizing controls, and virtualized fallback if enabled.
12. Run existing Vitest regression tests, new selector/reducer/URL tests, component interaction tests, production build/typecheck/lint, and browser performance/accessibility gates. Record pre-existing failures separately; do not remove a failing gate to make the rewrite pass.

## 12. Delivery Sequence

1. Capture current role permissions and regression fixtures; baseline performance; identify authentication, conditional-write, and pagination prerequisites. Keep backend requirements explicit.
2. Introduce tokens, fonts, accessible primitives, and authenticated shell behind a feature flag. Isolate old CSS and preserve all legacy routes/workflows during coexistence.
3. Extract snapshot query ownership and pure queue/PM selectors from the application controller. Remove the old write effects when the new mutation layer takes ownership; never run both writers simultaneously.
4. Ship the queue and read-only hover preview, then pinned inspector and guarded editing. Validate the local architecture hypothesis before migrating secondary modules.
5. Add command registry, deterministic EN/FR language intents, telemetry drill-downs, and real sync status. Mutating quick-actions only ship after shared authorization/validation is verified.
6. Migrate Fleet, Clients, Time, Payroll, Profitability, and Users to the same shell/primitives, preserving domain-specific controls. Retire legacy selectors route by route.
7. Introduce scale-mode endpoints, aggregate queries, conditional writes, and idempotent replay where needed; retire snapshot ownership for that mode. Enable virtualization only from measurements.
8. Roll out by user cohort, compare task time/error rate and p95 interaction timings, retain a feature-flag rollback, and remove the legacy implementation only after parity and release gates pass.

Definition of done: a dense, accessible EN/FR operations workspace with measured interaction budgets, a persistent shell, safe preview/edit behavior, accurate telemetry, one owner per state category, and no regression in fleet/time/payroll correctness. Obsidian styling alone is not completion.