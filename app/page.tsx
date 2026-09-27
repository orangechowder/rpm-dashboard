"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react";
import Image from "next/image";
import { Activity, ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, Clock3, FileText, Gauge, LayoutDashboard, ListFilter, ListTodo, Menu, MoreHorizontal, Plus, Search, Truck, Users, Wallet, Wrench, X, type LucideIcon } from "lucide-react";
import { clearOfflineMutations, enqueueOfflineMutation, formatRelativeUpdateTime, mergeRemoteRecords, readOfflineMutations, recordsEqual, remoteWins, validateCompletion } from "../lib/reliability";
import { completeTimeEntry, createManualTimeEntry, createTimeEntry, hasSupabaseConfig, loadDailyTimesheetSummary, loadFleetData, loadPayrollLocks, loadTimeEntries, loadUnitNotes, loadUsers, loadWeeklyTimesheetSummary, removeJob, removeTimeEntry, removeUnit, removeUserAccount, saveJobs, saveUnits, saveUsers, subscribeToFleet, updateTimeEntry, upsertPayrollLock, writeActivityLog, type CloudJob, type CloudTimeEntry, type CloudUnit, type CloudUser, type DailyTimesheetSummaryRow, type PayrollPeriodLock, type RealtimeChange, type UnitNote, type WeeklyTimesheetSummaryRow } from "../lib/fleet-repository";
import { supabase } from "../lib/supabase";
import { ThemeToggle } from "./theme-provider";
import { ModalFrame } from "./modal-frame";
import { ResponsiveTable } from "./responsive-table";

type Section = "overview" | "jobs" | "units" | "users" | "clients" | "punch" | "payroll" | "profitability" | "technicianPayroll";
type Language = "en" | "fr";
type UserAccount = { id: string; name: string; role: "Admin" | "Technician"; password: string; active: boolean; isTechnician: boolean; hourlyRate?: number | null };
type JobStatus =
  "Scheduled" | "In Progress" | "Waiting on Parts" | "Waiting on Estimates" | "Ready for Invoicing" | "Completed";
type Note = { id: string; text: string; author: string; createdAt: string };
type LineItem = {
  id: string;
  kind: "Labor" | "Part";
  partNumber: string;
  description: string;
  quantity: number;
  amount: number;
};
type Job = {
  id: string;
  unit: string;
  client: string;
  tech: string;
  priority: "High" | "Normal" | "Low";
  status: JobStatus;
  issue: string;
  updated: string;
  usage: string;
  meterReading?: number | null;
  notes?: Note[];
  lineItems?: LineItem[];
  updatedAt?: string;
};
type Unit = {
  unit: string;
  vin: string;
  client: string;
  type: string;
  service: string;
  due: string;
  overdue: boolean;
  usage: string;
  currentMeter?: number | null;
  lastPmMeter?: number | null;
  pmInterval?: number;
  meterUnit?: "KM" | "HRS";
  updatedAt?: string;
};
type OfflinePayload =
  | { kind: "jobs"; jobs: Job[] }
  | { kind: "units"; units: Unit[] }
  | { kind: "clock-in"; entry: { userId: string; userName: string; workOrderId: string; clockIn: string } }
  | { kind: "clock-out"; entry: { id: string; clockOut: string; totalHours: number } };

const jobs: Job[] = [
  {
    id: "WO-2418",
    unit: "TRK-482",
    client: "Northstar Logistics",
    tech: "Marcus T.",
    priority: "High",
    status: "In Progress",
    issue: "Hydraulic leak inspection",
    updated: "12 min ago",
    usage: "184,220 KM",
  },
  {
    id: "WO-2417",
    unit: "VAN-091",
    client: "Apex Site Services",
    tech: "Jamie R.",
    priority: "Normal",
    status: "Waiting on Parts",
    issue: "Brake pad replacement",
    updated: "38 min ago",
    usage: "92,840 KM",
  },
  {
    id: "WO-2416",
    unit: "TRK-219",
    client: "Harbor Freight Co.",
    tech: "Unassigned",
    priority: "High",
    status: "Waiting on Estimates",
    issue: "Engine diagnostic",
    updated: "1 hr ago",
    usage: "238,100 KM",
  },
  {
    id: "WO-2415",
    unit: "EXC-044",
    client: "Pioneer Earthworks",
    tech: "Devin L.",
    priority: "Normal",
    status: "In Progress",
    issue: "Preventative maintenance",
    updated: "2 hrs ago",
    usage: "4,280 Hrs",
  },
  {
    id: "WO-2414",
    unit: "TRK-118",
    client: "Redwood Construction",
    tech: "Sam K.",
    priority: "Low",
    status: "Completed",
    issue: "Annual safety inspection",
    updated: "Yesterday",
    usage: "146,700 KM",
  },
];
const units: Unit[] = [
  {
    unit: "TRK-482",
    vin: "1HTWGAHT9PH47321",
    client: "Northstar Logistics",
    type: "Freightliner M2",
    service: "Mar 14, 2024",
    due: "Apr 14, 2024",
    overdue: true,
    usage: "184,220 KM",
  },
  {
    unit: "VAN-091",
    vin: "1FTBR1C89PKA09142",
    client: "Apex Site Services",
    type: "Ford Transit",
    service: "Apr 02, 2024",
    due: "Jul 02, 2024",
    overdue: false,
    usage: "92,840 KM",
  },
  {
    unit: "TRK-219",
    vin: "3ALACWDT7NDNJ2198",
    client: "Harbor Freight Co.",
    type: "Kenworth T680",
    service: "Feb 28, 2024",
    due: "May 28, 2024",
    overdue: true,
    usage: "238,100 KM",
  },
  {
    unit: "EXC-044",
    vin: "CAT0C44B7KXG04418",
    client: "Pioneer Earthworks",
    type: "CAT 320 Excavator",
    service: "Apr 09, 2024",
    due: "Oct 09, 2024",
    overdue: false,
    usage: "4,280 Hrs",
  },
  {
    unit: "TRK-118",
    vin: "1M2AX04Y7DM011835",
    client: "Redwood Construction",
    type: "Mack Granite",
    service: "Mar 26, 2024",
    due: "Jun 26, 2024",
    overdue: false,
    usage: "146,700 KM",
  },
];
const navItems: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "dashboardOverview", icon: <LayoutDashboard size={18} /> },
  { id: "jobs", label: "activeJobQueue", icon: <ListTodo size={18} /> },
  { id: "punch", label: "punchClock", icon: <Clock3 size={18} /> },
  { id: "units", label: "unitManagement", icon: <Truck size={18} /> },
  { id: "clients", label: "clientManagement", icon: <Users size={18} /> },
];

function formatDurationHours(value: number | null | undefined): string {
  const totalMinutes = Math.max(0, Number(value ?? 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}`;
}

const torontoTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto",
  hour: "numeric",
  minute: "2-digit",
});

function formatTorontoTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : torontoTimeFormatter.format(date);
}

const torontoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const torontoHourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" });

function torontoDateKey(value: string): string {
  return torontoDateFormatter.format(new Date(value));
}

function formatTorontoDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${torontoDateFormatter.format(date)} · ${torontoTimeFormatter.format(date)}`;
}

type AutoLunchProposal = { key: string; userId: string; workDate: string; previousEntryId: string; nextEntryId: string; minutes: number };

function autoLunchProposals(entries: CloudTimeEntry[]): AutoLunchProposal[] {
  const byDay = new Map<string, CloudTimeEntry[]>();
  for (const entry of entries.filter((candidate) => candidate.status === "completed" && candidate.clockOut)) {
    const key = `${entry.userId}:${torontoDateKey(entry.clockIn)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  return Array.from(byDay.entries()).flatMap(([dayKey, dayEntries]) => {
    const ordered = dayEntries.sort((left, right) => new Date(left.clockIn).getTime() - new Date(right.clockIn).getTime());
    const candidates = ordered.slice(0, -1).flatMap((entry, index) => {
      const next = ordered[index + 1];
      const gapStart = new Date(entry.clockOut as string);
      const gapEnd = new Date(next.clockIn);
      const minutes = Math.round((gapEnd.getTime() - gapStart.getTime()) / 60000);
      const startHour = Number(torontoHourFormatter.format(gapStart));
      const endHour = Number(torontoHourFormatter.format(gapEnd));
      return minutes >= 20 && minutes <= 90 && startHour < 15 && endHour >= 11 ? [{ key: `${dayKey}:${entry.id}:${next.id}`, userId: entry.userId, workDate: torontoDateKey(entry.clockIn), previousEntryId: entry.id, nextEntryId: next.id, minutes }] : [];
    });
    if (!candidates.length) return [];
    return [candidates.sort((left, right) => right.minutes - left.minutes)[0]];
  });
}

function dailySpanHours(summary: Record<string, any>): number {
  const start = new Date(String(summary.day_start ?? "")).getTime();
  const end = new Date(String(summary.day_end ?? "")).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 3600000) : 0;
}

function dailyMetrics(summary: Record<string, any>, proposals: AutoLunchProposal[], entries: CloudTimeEntry[] = []): { rawHours: number; breakMinutes: number; lostTimeMinutes: number; netPayableHours: number; billableHours: number } {
  const userId = String(summary.user_id ?? summary.userId ?? "");
  const workDate = String(summary.work_date ?? summary.workDate ?? "");
  const key = `${userId}:${workDate}`;
  const proposedLunch = proposals.find((proposal) => `${proposal.userId}:${proposal.workDate}` === key)?.minutes ?? 0;
  const dayEntries = entries.filter((entry) => entry.userId === userId && torontoDateKey(entry.clockIn) === workDate);
  const storedBreak = dayEntries.length ? dayEntries.reduce((sum, entry) => sum + Number(entry.breakMinutes ?? 0), 0) : Number(summary.break_minutes ?? summary.breakMinutes ?? 0);
  const breakMinutes = storedBreak >= proposedLunch ? storedBreak : storedBreak + proposedLunch;
  const recordedLostTimeMinutes = dayEntries.length ? dayEntries.reduce((sum, entry) => sum + Number(entry.lostTimeMinutes ?? 0), 0) : Number(summary.lost_time_minutes ?? summary.lostTimeMinutes ?? 0);
  const automaticLostMinutes = automaticLostTimeMinutesFor(entries, [summary], proposals).get(key) ?? 0;
  const lostTimeMinutes = recordedLostTimeMinutes + automaticLostMinutes;
  const rawHours = dailySpanHours({ ...summary, day_start: summary.day_start ?? summary.dayStart, day_end: summary.day_end ?? summary.dayEnd });
  return { rawHours, breakMinutes, lostTimeMinutes, netPayableHours: Math.max(rawHours - breakMinutes / 60, 0), billableHours: Math.max(rawHours - breakMinutes / 60 - lostTimeMinutes / 60, 0) };
}

function automaticLostTimeMinutesFor(entries: CloudTimeEntry[], summaries: Array<Record<string, any>>, proposals: AutoLunchProposal[] = []): Map<string, number> {
  const entriesByDay = new Map<string, CloudTimeEntry[]>();
  for (const entry of entries) {
    const rawEntry = entry as CloudTimeEntry & Record<string, any>;
    const userId = String(rawEntry.userId ?? rawEntry.user_id ?? "");
    const clockIn = String(rawEntry.clockIn ?? rawEntry.clock_in ?? "");
    const key = `${userId}:${torontoDateKey(clockIn)}`;
    const dayEntries = entriesByDay.get(key) ?? [];
    dayEntries.push(entry);
    entriesByDay.set(key, dayEntries);
  }
  return new Map(summaries.map((summary) => {
    const key = `${summary.user_id}:${summary.work_date}`;
    const dayEntries = entriesByDay.get(key) ?? [];
    const dayStart = new Date(String(summary.day_start ?? "")).getTime();
    const dayEnd = new Date(String(summary.day_end ?? "")).getTime();
    const envelopeMinutes = Number.isFinite(dayStart) && Number.isFinite(dayEnd) ? Math.max(0, (dayEnd - dayStart) / 60000) : 0;
    const accountedMinutes = dayEntries.reduce((total, entry) => {
      const rawEntry = entry as CloudTimeEntry & Record<string, any>;
      return total + Number(rawEntry.totalHours ?? rawEntry.total_hours ?? 0) * 60 + Number(rawEntry.breakMinutes ?? rawEntry.break_minutes ?? 0) + Number(rawEntry.lostTimeMinutes ?? rawEntry.lost_time_minutes ?? 0);
    }, 0);
    const detectedLunchMinutes = proposals.find((proposal) => `${proposal.userId}:${proposal.workDate}` === key)?.minutes ?? 0;
    return [key, Math.max(0, Math.round(envelopeMinutes - accountedMinutes - detectedLunchMinutes))];
  }));
}

function formatMinutes(value: number | null | undefined): string {
  const totalMinutes = Math.max(0, Number(value ?? 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}`;
}

function isoDate(when: Date): string {
  return new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function weekStart(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type PayrollPeriodPreset = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

function payrollPeriodRange(preset: PayrollPeriodPreset, reference = new Date()): { start: string; end: string } {
  const currentWeek = weekStart(reference);
  if (preset === "lastWeek") {
    const start = addDays(currentWeek, -7);
    return { start: isoDate(start), end: isoDate(addDays(start, 6)) };
  }
  if (preset === "thisMonth" || preset === "lastMonth") {
    const month = new Date(reference.getFullYear(), reference.getMonth() + (preset === "lastMonth" ? -1 : 0), 1);
    return { start: isoDate(month), end: isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0)) };
  }
  return { start: isoDate(currentWeek), end: isoDate(addDays(currentWeek, 6)) };
}

function PayrollPeriodSelect({ value, onChange, language }: { value: PayrollPeriodPreset; onChange: (value: PayrollPeriodPreset) => void; language: Language }) {
  return <CustomSelect className="payroll-period-preset" value={value} onChange={(next) => onChange(next as PayrollPeriodPreset)} ariaLabel={language === "fr" ? "Période de paie" : "Payroll period"} options={[{ value: "thisWeek", label: language === "fr" ? "Cette semaine" : "This week" }, { value: "lastWeek", label: language === "fr" ? "Semaine dernière" : "Last week" }, { value: "thisMonth", label: language === "fr" ? "Ce mois-ci" : "This month" }, { value: "lastMonth", label: language === "fr" ? "Mois dernier" : "Last month" }]} />;
}

function sameDay(dateA: string | Date, dateB: string | Date): boolean {
  const left = new Date(dateA);
  const right = new Date(dateB);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
const defaultClients = [
  "9056-8288 QC INC", "9173-9417 QC INC", "92186758 QC INC", "9418-8877 QC INC", "9567-0006 Québec inc.", "Acier Jean-Guy Robert", "Albert Fortier", "Annypier Maltais", "Aventura Construction", "Bilodeau Transport", "Bistro Tôt ou Tard", "Bruce Hodgins excavation", "Bryan Desloge", "Calmont Leasing", "Carolyne Lepage", "Cgm Boily Transport", "Clean water works", "Construction GFL Inc", "Crescent Moving and Storage", "Danny Jean", "Denis Houde", "Docteur Pavé", "Entretiens Prime Cuts", "Enviroimpact", "Expoland Exibition", "Fastco Canada", "Fritolay", "George", "Gestion TBL inc", "GFL ENVIRONMENT", "Groupe FP Excavation", "Groupe TruStone Inc", "Habitation Nieka INC", "Inox Milton", "International Equestrian Academy", "Jacques", "Js margins", "Justin", "Justin Courtemanche", "Lauren Moyer", "Les entreprises 3gd inc", "Les entreprises JF", "Les Jardins Lamoureux Gardens", "Les transports à nos trois inc.", "Lm.landry", "Mancini Construction", "Mario Cote INC", "Mon P’tit Rozon", "Normand Masson", "Northern Mat & Bridge", "Pavage Bolduc Inc.", "Pavage Milan", "Pavé Morissette Inc.", "Piscines Boisseau", "Pro-BJ Construction", "Purolator", "Real Bombardier", "Richard Phaneuf", "Shawn Chapman", "Solarium Solutions Rénovations", "Stephane Aston", "Terra solution", "TRANSPORT ANT-PASS LTEE", "Transport Bourassa", "Transport LGR", "Transport Martin Lefebvre", "Transport métropolitain Roy", "Transport OSI", "Transport Somavrac Inc", "Transport Sylvester Et Forget", "Transport TFI / Transport JCG", "Transports Roger léger", "Vert le Futur", "Ville de L'Île-Perrot", "VOLOD Transport INC", "Volvo Action Service", "WBM TRANSPORT", "Xavier Trépanier St-Onge", "Élagage O Max INC", "Élodie Lapensée",
];
const defaultUsers: UserAccount[] = [
  { id: "user-andree-anne", name: "Andrée-Anne", role: "Technician", password: "12345678", active: true, isTechnician: true },
  { id: "user-marc", name: "Marc", role: "Admin", password: "12345678", active: true, isTechnician: true },
  { id: "user-dannick", name: "Dannick", role: "Technician", password: "12345678", active: true, isTechnician: true },
];

const translations: Record<Language, Record<string, string>> = {
  en: {
    dashboardOverview: "Dashboard Overview", activeJobQueue: "Active Job Queue", unitManagement: "Unit Management", clientManagement: "Client Management", punchClock: "Punch Clock", punchSubtitle: "Track your working time and connect it to a work order.", userManagement: "User Management", usersSubtitle: "Manage dashboard access, roles, and active profiles.", clientsSubtitle: "Browse and manage every fleet client.", workspace: "WORKSPACE", partsOnly: "Parts only", total: "Total", amountPerItem: "$ / item", section: "Section", chooseSection: "Choose section", entries: "entries", items: "items", clients: "clients", history: "History", edit: "Edit", save: "Save", searchClients: "Search clients...", newClientName: "New client name", addClient: "Add client", fleetClient: "Fleet client", allFleetRecords: "All fleet records up to date", unitsOverduePm: "Units overdue for PM", requiresAttention: "Requires immediate attention", assignedClientLabel: "ASSIGNED CLIENT", lastServiceLabel: "LAST SERVICE", lastUsageLabel: "LAST SERVICE USAGE", describeIssue: "Describe the issue", usageExample: "e.g. 184220 KM or 4280 Hrs", unitExample: "e.g. TRK-506", vinExample: "17-character VIN", typeExample: "e.g. Volvo VNL", cloudNotConfigured: "Cloud sync is not configured. Add your Supabase environment variables to .env.local.", exportReady: "Work orders exported", serviceHistory: "SERVICE HISTORY", completedWorkOrders: "Completed work orders", cloudTimeMissing: "Punch Clock is not installed in Supabase yet. Run the database schema first.", fleetRecordsDetail: "Fleet inventory", week: "Week", month: "Month", today: "Today", noPunchesInPeriod: "No punches in this period.", periodStart: "Showing from", previousPeriod: "Previous period", nextPeriod: "Next period", chooseDate: "Choose date", currentPeriod: "Current period",
    goodMorning: "Good morning", overviewSubtitle: "Here's what's happening across your fleet today.", jobsSubtitle: "Monitor and coordinate every active service request.", unitsSubtitle: "Keep your fleet records current and service-ready.", systemOperational: "System operational", lastSynced: "Last synced just now", emergency: "Emergency", reviewUnits: "Review units →",
    workOrders: "WORK ORDERS", activeJobs: "Active Jobs", totalInProgress: "Total in progress", waitingParts: "Waiting on parts", waitingEstimates: "Waiting on estimates", fleetHealth: "FLEET HEALTH", unitStatus: "Unit Status", totalUnits: "Total units repertoried", fleetRecords: "All fleet records up to date", pmCompliance: "PM compliance", overduePm: "units overdue for PM", fieldOperations: "FIELD OPERATIONS", fieldService: "Field Service", techsOnRoad: "Technicians on road", unassignedCalls: "Unassigned calls", responseTime: "Avg response time", recentActivity: "RECENT ACTIVITY", latestUpdates: "Latest updates", viewAll: "View all →", quickActions: "QUICK ACTIONS", quickQuestion: "What would you like to do?", createWorkOrder: "Create work order", startService: "Start a new service request", addUnit: "Add a unit", registerAsset: "Register a vehicle or asset", serviceOperations: "SERVICE OPERATIONS", workOrderQueue: "Work order queue", newWorkOrder: "+ New work order", export: "Export ↓", assetDatabase: "ASSET DATABASE", fleetDirectory: "Fleet directory", addNewUnit: "+ Add unit", filters: "Filters ≡", assignedClient: "ASSIGNED CLIENT", lastService: "LAST SERVICE", lastUsage: "LAST SERVICE USAGE", pmNeeded: "PM needed", pmClear: "PM clear", workOrder: "Work order", unitClient: "Unit / client", technician: "Technician", priority: "Priority", status: "Status", updated: "Updated", fleetUnit: "Fleet unit", selectUnit: "Select a unit from the repertory", addNewUnitOption: "+ Add New Unit to Repertory", serviceRequest: "Service request", lastServiceUsage: "Last service mileage / hours", unitNumber: "Unit number", vin: "VIN", clientName: "Client name", lastServiceDate: "Last service", unitType: "Unit type", saveUnit: "Save unit", cancel: "Cancel", deleteUnit: "Delete unit", close: "Close modal", workOrderDetails: "WORK ORDER", notes: "Technician notes", addNotePlaceholder: "Add a timestamped note...", addNote: "Add note", parts: "Parts", description: "Description", amount: "Amount", add: "Add", delete: "Delete", deleteWorkOrder: "Delete work order", done: "Done", createTitle: "Create work order", addUnitTitle: "Add fleet unit", editUnitTitle: "Edit fleet unit", addToRepertory: "Add unit to repertory", part: "Part", labor: "Labor", loginTitle: "RPM Diesel Dashboard", loginSubtitle: "Sign in to manage fleet operations", name: "Name", password: "Password", signIn: "Sign in", invalidLogin: "Enter a valid name and password.", signedInAs: "Signed in as", signOut: "Sign out", language: "Switch language",
    userDirectory: "USER DIRECTORY", manageProfiles: "Manage dashboard access and roles", addTechnician: "+ Add technician", role: "Role", active: "Active", disabled: "Disabled", admin: "Admin", removeUser: "Remove user", changePassword: "Change password", adminChangePassword: "Set password", currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm new password", updatePassword: "Update password", technicianList: "Technician list", punchHistory: "Punch history", punchedBy: "Punched by", clockIn: "Clock in", clockOut: "Clock out", totalHours: "Total hours", totalWorked: "Total worked hours", activePunch: "Active", noPunches: "No punches recorded yet.", noData: "—", "In Progress": "In Progress", "Waiting on Parts": "Waiting on Parts", "Waiting on Estimates": "Waiting on Estimates", Completed: "Completed", High: "High", Normal: "Normal", Low: "Low",
  },
  fr: {
    dashboardOverview: "Vue d'ensemble", activeJobQueue: "File des travaux actifs", unitManagement: "Gestion des unités", clientManagement: "Gestion des clients", punchClock: "Poinçonneuse", punchSubtitle: "Suivez votre temps de travail et associez-le à un ordre de travail.", userManagement: "Gestion des utilisateurs", usersSubtitle: "Gérez les accès, les rôles et les profils actifs.", clientsSubtitle: "Consultez et gérez tous les clients de la flotte.", workspace: "ESPACE DE TRAVAIL", partsOnly: "Pièces seulement", total: "Total", amountPerItem: "$ / pièce", section: "Section", chooseSection: "Choisir une section", entries: "entrées", items: "articles", clients: "clients", history: "Historique", edit: "Modifier", save: "Enregistrer", searchClients: "Rechercher des clients...", newClientName: "Nom du nouveau client", addClient: "Ajouter le client", fleetClient: "Client de flotte", allFleetRecords: "Tous les dossiers de flotte sont à jour", unitsOverduePm: "Unités en retard de PM", requiresAttention: "Attention immédiate requise", assignedClientLabel: "CLIENT ASSIGNÉ", lastServiceLabel: "DERNIER SERVICE", lastUsageLabel: "DERNIÈRE UTILISATION", describeIssue: "Décrire le problème", usageExample: "ex. 184220 KM ou 4280 Hrs", unitExample: "ex. TRK-506", vinExample: "NIV de 17 caractères", typeExample: "ex. Volvo VNL", cloudNotConfigured: "La synchronisation infonuagique n'est pas configurée. Ajoutez vos variables Supabase dans .env.local.", exportReady: "Ordres de travail exportés", serviceHistory: "HISTORIQUE DE SERVICE", completedWorkOrders: "Ordres de travail complétés", cloudTimeMissing: "La poinçonneuse n'est pas encore installée dans Supabase. Exécutez d'abord le schéma de base de données.", fleetRecordsDetail: "Inventaire de la flotte", week: "Semaine", month: "Mois", today: "Aujourd'hui", noPunchesInPeriod: "Aucun poinçon dans cette période.", periodStart: "Affichage à partir du", previousPeriod: "Période précédente", nextPeriod: "Période suivante", chooseDate: "Choisir une date", currentPeriod: "Période actuelle",
    goodMorning: "Bonjour", overviewSubtitle: "Voici ce qui se passe dans votre flotte aujourd'hui.", jobsSubtitle: "Surveillez et coordonnez chaque demande de service active.", unitsSubtitle: "Gardez les dossiers de votre flotte à jour et prête pour le service.", systemOperational: "Système opérationnel", lastSynced: "Synchronisé à l'instant", emergency: "Urgence", reviewUnits: "Réviser les unités →",
    workOrders: "ORDRES DE TRAVAIL", activeJobs: "Travaux actifs", totalInProgress: "Total en cours", waitingParts: "En attente de pièces", waitingEstimates: "En attente d'estimations", fleetHealth: "ÉTAT DE LA FLOTTE", unitStatus: "État des unités", totalUnits: "Total des unités répertoriées", fleetRecords: "Tous les dossiers sont à jour", pmCompliance: "Conformité PM", overduePm: "unités en retard de PM", fieldOperations: "OPÉRATIONS TERRAIN", fieldService: "Service sur le terrain", techsOnRoad: "Techniciens sur la route", unassignedCalls: "Appels non assignés", responseTime: "Temps de réponse moyen", recentActivity: "ACTIVITÉ RÉCENTE", latestUpdates: "Dernières mises à jour", viewAll: "Voir tout →", quickActions: "ACTIONS RAPIDES", quickQuestion: "Que voulez-vous faire?", createWorkOrder: "Créer un ordre de travail", startService: "Démarrer une demande de service", addUnit: "Ajouter une unité", registerAsset: "Enregistrer un véhicule ou un actif", serviceOperations: "OPÉRATIONS DE SERVICE", workOrderQueue: "File des ordres de travail", newWorkOrder: "+ Nouvel ordre de travail", export: "Exporter ↓", assetDatabase: "BASE DES ACTIFS", fleetDirectory: "Répertoire de la flotte", addNewUnit: "+ Ajouter une unité", filters: "Filtres ≡", assignedClient: "CLIENT ASSIGNÉ", lastService: "DERNIER SERVICE", lastUsage: "DERNIÈRE UTILISATION", pmNeeded: "PM requis", pmClear: "PM à jour", workOrder: "Ordre de travail", unitClient: "Unité / client", technician: "Technicien", priority: "Priorité", status: "Statut", updated: "Mis à jour", fleetUnit: "Unité de la flotte", selectUnit: "Sélectionner une unité du répertoire", addNewUnitOption: "+ Ajouter une unité au répertoire", serviceRequest: "Demande de service", lastServiceUsage: "Kilométrage / heures depuis le dernier service", unitNumber: "Numéro d'unité", vin: "NIV", clientName: "Nom du client", lastServiceDate: "Dernier service", unitType: "Type d'unité", saveUnit: "Enregistrer l'unité", cancel: "Annuler", deleteUnit: "Supprimer l'unité", close: "Fermer la fenêtre", workOrderDetails: "ORDRE DE TRAVAIL", notes: "Notes du technicien", addNotePlaceholder: "Ajouter une note horodatée...", addNote: "Ajouter la note", parts: "Pièces", description: "Description", amount: "Montant", add: "Ajouter", delete: "Supprimer", deleteWorkOrder: "Supprimer l'ordre de travail", done: "Terminé", createTitle: "Créer un ordre de travail", addUnitTitle: "Ajouter une unité", editUnitTitle: "Modifier l'unité", addToRepertory: "Ajouter au répertoire", part: "Pièce", labor: "Main-d'œuvre", loginTitle: "Tableau de bord RPM Diesel", loginSubtitle: "Connectez-vous pour gérer les opérations de flotte", name: "Nom", password: "Mot de passe", signIn: "Se connecter", invalidLogin: "Entrez un nom et un mot de passe valides.", signedInAs: "Session de", signOut: "Se déconnecter", language: "Changer de langue",
    userDirectory: "RÉPERTOIRE DES UTILISATEURS", manageProfiles: "Gérez les accès et les rôles du tableau de bord", addTechnician: "+ Ajouter un technicien", role: "Rôle", active: "Actif", disabled: "Désactivé", admin: "Administrateur", removeUser: "Supprimer l'utilisateur", changePassword: "Changer le mot de passe", adminChangePassword: "Définir le mot de passe", currentPassword: "Mot de passe actuel", newPassword: "Nouveau mot de passe", confirmPassword: "Confirmer le nouveau mot de passe", updatePassword: "Mettre à jour le mot de passe", technicianList: "Liste des techniciens", punchHistory: "Historique des poinçons", punchedBy: "Pointé par", clockIn: "Début", clockOut: "Fin", totalHours: "Heures totales", totalWorked: "Heures travaillées totales", activePunch: "Actif", noPunches: "Aucun poinçon enregistré.", noData: "—", "In Progress": "En cours", "Waiting on Parts": "En attente de pièces", "Waiting on Estimates": "En attente d'estimations", Completed: "Terminé", High: "Élevée", Normal: "Normale", Low: "Faible",
  },
};

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getDeviceLanguage(): Language {
  if (typeof navigator === "undefined") return "en";
  const preferredLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferredLanguages.some((language) => language.toLowerCase().startsWith("fr")) ? "fr" : "en";
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function StatusPill({ status, language }: { status: JobStatus; language: Language }) {
  const styles = {
    "Scheduled": "status-teal",
    "In Progress": "status-blue",
    "Waiting on Parts": "status-amber",
    "Waiting on Estimates": "status-purple",
    "Ready for Invoicing": "status-indigo",
    Completed: "status-green",
  };
  return (
    <span className={`status-pill ${styles[status]}`}>
      <span className="status-dot" />
      {translations[language][status]}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "red",
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  icon: string;
}) {
  const Icon = icon === "unit" ? Truck : tone === "green" ? Gauge : Activity;
  return (
    <div className={`metric-card metric-summary metric-summary-${tone}`}>
      <div className="metric-top">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="metric-number">{value}</p>
        </div>
        <span className={`metric-icon metric-${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
      </div>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function TelemetryBlock({ title, label, value, icon: Icon, tone, onOpen, children }: {
  title: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "cyan" | "green" | "amber";
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <article className={`telemetry-block telemetry-${tone}`}>
      <header className="telemetry-header">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={onOpen} aria-label={title} title={title}><ArrowUpRight size={16} /></button>
      </header>
      <button type="button" className="telemetry-value" onClick={onOpen}>
        <strong>{value}</strong><span>{label}</span>
      </button>
      <div className="telemetry-signals">{children}</div>
    </article>
  );
}

function TelemetrySignal({ label, value, warning = false, onClick }: {
  label: string;
  value: number | string;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`telemetry-signal ${warning ? "telemetry-warning" : ""}`} onClick={onClick}>
      <span className="telemetry-signal-label"><span className="signal-dot" aria-hidden="true" />{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function PunchClock({ activeEntry, jobs, language, onClockIn, onClockOut, onStartBreak, onEndBreak }: { activeEntry?: CloudTimeEntry; jobs: Job[]; language: Language; onClockIn: (workOrderId: string | null) => void; onClockOut: () => void; onStartBreak: () => void; onEndBreak: () => void }) {
  const [workOrderId, setWorkOrderId] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!activeEntry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeEntry]);
  const elapsed = activeEntry ? Math.max(0, now - new Date(activeEntry.clockIn).getTime()) : 0;
  const elapsedLabel = `${String(Math.floor(elapsed / 3600000)).padStart(2, "0")}:${String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`;
  return (
        <div className={`punch-clock ${activeEntry ? "punch-active" : ""}`}>
      <span className="punch-indicator" />
      <div className="punch-copy">
        <strong>
          {activeEntry
            ? language === "en"
              ? "On the clock"
              : "Pointé"
            : language === "en"
            ? "Off the clock"
            : "Non pointé"}
        </strong>
        <small>
          {activeEntry
            ? elapsedLabel
            : language === "en"
            ? "Select a work order first"
            : "Sélectionnez d'abord un ordre"}
        </small>
      </div>
      {!activeEntry ? (
        <>
          <CustomSelect
            className="w-auto"
            value={workOrderId}
            onChange={setWorkOrderId}
            ariaLabel={
              language === "en"
                ? "Assign work order"
                : "Assigner un ordre de travail"
            }
            placeholder={
              language === "en"
                ? "Select work order"
                : "Sélectionner un ordre"
            }
            options={jobs
              .filter((job) => job.status !== "Completed")
              .map((job) => ({
                value: job.id,
                label: `${job.unit} · ${job.client} · ${job.issue}`,
              }))}
          />
          <button
            disabled={!workOrderId}
            className="punch-button punch-in"
            onClick={() => onClockIn(workOrderId)}
          >
            {language === "en" ? "Clock In" : "Pointer"}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="punch-button punch-out" onClick={onClockOut}>
              {language === "en" ? "Clock Out" : "Dépointer"}
            </button>
            {!activeEntry.breakStartedAt ? (
              <button
                className="outline-button"
                disabled={false}
                onClick={onStartBreak}
              >
                {language === "en" ? "Start Break" : "Commencer une pause"}
              </button>
            ) : (
              <button className="outline-button" onClick={onEndBreak}>
                {language === "en" ? "End Break" : "Finir la pause"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type SelectOption = { value: string; label: string };
// Unit numbers are only unique per client, so identity/lookup keys must combine both fields.
function unitKey(unit: { unit: string; client: string }): string {
  return JSON.stringify([unit.unit, unit.client]);
}
// <input type="datetime-local"> reads/writes local wall-clock time with no timezone info, but stored
// timestamps are UTC ISO strings; slicing the ISO string directly (as if it were already local) shows
// the wrong time by the viewer's UTC offset. Shift by that offset before formatting for the input.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
// The reverse of toDatetimeLocalValue: the browser already gives us a local wall-clock string with no
// timezone, so the Date constructor correctly interprets it as local time before converting to UTC ISO.
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
// Native <select> triggers an OS-level picker on iOS/Android; a stray dismissal event from that overlay can bubble up and close parent modals. This component never renders a real <select>.
function CustomSelect({ value, onChange, options, ariaLabel, placeholder, className, disabled, id, onSelect }: { value: string | undefined; onChange: (value: string) => void; options: SelectOption[]; ariaLabel?: string; placeholder?: string; className?: string; disabled?: boolean; id?: string; onSelect?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => document.removeEventListener("pointerdown", closeOnOutside, true);
  }, [open]);
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);
  const suppressGhostClick = useRef(false);
  const selectOption = (optionValue: string) => {
    onChange(optionValue);
    suppressGhostClick.current = true;
    onSelect?.();
    // iOS can synthesize a "ghost click" on whatever is revealed once the tapped element is removed mid-gesture; keep the popover mounted one tick longer so that never lands on the form's submit button underneath.
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 0);
  };
  const selected = options.find((option) => option.value === value);
  return (
    <div
      ref={wrapRef}
      className={`custom-select-root relative inline-block w-full align-middle ${className ?? ""}`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchEnd={(event) => {
        // If the tapped option was already removed from the DOM, iOS retargets its touchend to this
        // still-mounted wrapper; preventDefault here (not just on the option) is what actually suppresses the ghost click.
        if (suppressGhostClick.current) {
          event.preventDefault();
          suppressGhostClick.current = false;
        }
      }}
    >
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="custom-select-trigger flex w-full items-center justify-between gap-2 rounded border border-line bg-surface px-3 py-2 text-left text-sm font-medium text-inherit transition disabled:cursor-not-allowed disabled:opacity-50"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span className="truncate">{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={13} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="custom-select-menu absolute left-0 top-full z-50 mt-1 max-h-60 w-full min-w-max overflow-auto rounded border border-line bg-raised p-1 shadow-xl">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`block w-full whitespace-nowrap rounded px-3 py-2 text-left text-sm ${option.value === value ? "bg-accent/10 font-semibold text-accent" : "text-foreground hover:bg-foreground/5"}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectOption(option.value);
              }}
              onTouchEnd={(event) => {
                // iOS only suppresses its synthetic ghost click if preventDefault is called on the touch event itself, not just the pointer event.
                event.preventDefault();
                event.stopPropagation();
                suppressGhostClick.current = false;
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchField(props: ComponentPropsWithoutRef<"input">) {
  return <span className="queue-search"><Search size={16} aria-hidden="true" /><input type="search" {...props} /></span>;
}

function ActivityTimestamp({ updatedAt, language, compact = false }: { updatedAt?: string; language: Language; compact?: boolean }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = () => {
      if (timer) clearInterval(timer);
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), compact ? 15_000 : 1000);
      }
    };
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [compact]);

  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return <span>{language === "fr" ? "Heure de mise à jour inconnue" : "Update time unavailable"}</span>;
  const absolute = `${formatTorontoDateTime(updatedAt)} (Toronto)`;
  const relative = formatRelativeUpdateTime(updatedAt, now, language);
  return <time className={`activity-timestamp${compact ? " timestamp-compact" : ""}`} dateTime={updatedAt} title={absolute} aria-live="off">{compact ? relative ?? absolute : relative ? `${relative} · ${absolute}` : absolute}</time>;
}

export default function Home() {
  const clientReady = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [language, setLanguage] = useState<Language>(() => loadStored("rpm-diesel-language", getDeviceLanguage()));
  const [activeUser, setActiveUser] = useState<string | null>(() => {
    const stored = loadStored<string | { name?: string } | null>("rpm-diesel-session", null);
    return typeof stored === "string" ? stored : stored?.name ?? null;
  });
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>(() => loadStored<UserAccount[]>("rpm-diesel-users", defaultUsers).map((account) => ({ ...account, isTechnician: account.isTechnician ?? (account.role === "Technician" || account.name === "Marc") })));
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("12345678");
  const [newUserIsTechnician, setNewUserIsTechnician] = useState(true);
  const [passwordTargetId, setPasswordTargetId] = useState<string | null>(null);
  const [managedPassword, setManagedPassword] = useState("12345678");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // Dismissed dashboard alerts: cleared on every fresh login, so they reappear next time someone signs in.
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  // Long-punch (>7h) dismissals persist across logins, keyed by entry id, so only a genuinely new
  // over-7h punch (not previously dismissed) brings the banner back.
  const [dismissedLongPunchIds, setDismissedLongPunchIds] = useState<string[]>(() => loadStored("rpm-diesel-dismissed-long-punches", []));
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loginName, setLoginName] = useState("Andrée-Anne");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobFilter, setJobFilter] = useState<"All" | JobStatus>("All");
  const [jobQueueSearch, setJobQueueSearch] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [pmDueOnly, setPmDueOnly] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [unitClientSearch, setUnitClientSearch] = useState("");
  const [unitClientPickerOpen, setUnitClientPickerOpen] = useState(false);
  const [workOrderUnitSearch, setWorkOrderUnitSearch] = useState("");
  const [workOrderUnitPickerOpen, setWorkOrderUnitPickerOpen] = useState(false);
  const [clientData, setClientData] = useState<string[]>(() => loadStored("rpm-diesel-clients", defaultClients));
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [editingClientName, setEditingClientName] = useState("");
  const [modal, setModal] = useState<"job" | "unit" | "detail" | "history" | null>(null);
  const [completionPrompt, setCompletionPrompt] = useState<{ job: Job; reading: string } | null>(null);
  const [historyUnit, setHistoryUnit] = useState<Unit | null>(null);
  const [unitNotes, setUnitNotes] = useState<Record<string, UnitNote[]>>({});
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [showAllWorkOrderPunches, setShowAllWorkOrderPunches] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [returnToJob, setReturnToJob] = useState(false);
  const [form, setForm] = useState({
    unit: "",
    client: "",
    vin: "",
    type: "",
    issue: "",
    service: "",
    usage: "",
    meterReading: "",
    currentMeter: "",
    lastPmMeter: "",
    pmInterval: "25000",
    meterUnit: "KM" as Unit["meterUnit"],
    tech: "Unassigned",
    priority: "Normal" as Job["priority"],
    status: "In Progress" as JobStatus,
  });
  const [noteText, setNoteText] = useState("");
  const [unitNoteText, setUnitNoteText] = useState("");
  const [editingWorkOrderTitle, setEditingWorkOrderTitle] = useState(false);
  const [workOrderTitleDraft, setWorkOrderTitleDraft] = useState("");
  const [lineItem, setLineItem] = useState({
    kind: "Part" as LineItem["kind"],
    partNumber: "",
    description: "",
    quantity: "1",
    amount: "",
  });
  const [manualTimeUser, setManualTimeUser] = useState("");
  const [manualTimeJob, setManualTimeJob] = useState("");
  const [manualTimeHours, setManualTimeHours] = useState("");
  const [adminPunchUser, setAdminPunchUser] = useState("");
  const [adminPunchJob, setAdminPunchJob] = useState("");
  const [dailyTimesheetSummary, setDailyTimesheetSummary] = useState<DailyTimesheetSummaryRow[]>([]);
  const [weeklyTimesheetSummary, setWeeklyTimesheetSummary] = useState<WeeklyTimesheetSummaryRow[]>([]);
  const [payrollRows, setPayrollRows] = useState<Array<Record<string, any>>>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [profitabilityRows, setProfitabilityRows] = useState<Array<Record<string, any>>>([]);
  const [profitabilitySummaryRows, setProfitabilitySummaryRows] = useState<Array<Record<string, any>>>([]);
  const [profitabilityLoading, setProfitabilityLoading] = useState(false);
  const [payrollLocks, setPayrollLocks] = useState<PayrollPeriodLock[]>([]);
  const [classifyingDay, setClassifyingDay] = useState<{ userId: string; workDate: string } | null>(null);
  const [classificationBreakMinutes, setClassificationBreakMinutes] = useState("");
  const [classificationLostMinutes, setClassificationLostMinutes] = useState("");
  const [classificationReason, setClassificationReason] = useState("Parts wait");
  const [editingTimeEntryId, setEditingTimeEntryId] = useState<string | null>(null);
  const [editingTimeEntry, setEditingTimeEntry] = useState<CloudTimeEntry | null>(null);
  const [autoLunchKeys, setAutoLunchKeys] = useState<string[]>(() => loadStored("rpm-diesel-auto-lunches", []));
  const [punchPeriod, setPunchPeriod] = useState<"day" | "week" | "month">("week");
  const [punchAnchorDate, setPunchAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [adminSeeAllPunches, setAdminSeeAllPunches] = useState(false);
  const [adminPunchFilter, setAdminPunchFilter] = useState("all");
  const [payrollPeriodStart, setPayrollPeriodStart] = useState(() => isoDate(weekStart(new Date())));
  const [payrollPeriodEnd, setPayrollPeriodEnd] = useState(() => isoDate(addDays(weekStart(new Date()), 6)));
  const [payrollPeriodPreset, setPayrollPeriodPreset] = useState<PayrollPeriodPreset>("thisWeek");
  const [payrollTechFilter, setPayrollTechFilter] = useState<string[]>([]);
  const [myPayrollUser, setMyPayrollUser] = useState("");
  const [payrollSortBy, setPayrollSortBy] = useState("day");
  const [showPayrollCost, setShowPayrollCost] = useState(true);
  useEffect(() => {
    if (punchPeriod !== "day") return;
    const handleDayNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest(".period-nav-button");
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = new Date(`${punchAnchorDate}T12:00:00`);
      next.setDate(next.getDate() + (button.textContent?.includes("‹") ? -1 : 1));
    };
    return () => document.removeEventListener("click", handleDayNavigation, true);
  }, [punchPeriod, punchAnchorDate]);
  useEffect(() => {
    if (!unitClientPickerOpen) return;
    const closeUnitClientPicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".unit-client-picker, .unit-form-picker-label")) {
        setUnitClientPickerOpen(false);
        setUnitClientSearch("");
      }
    };
    document.addEventListener("pointerdown", closeUnitClientPicker, true);
    return () => document.removeEventListener("pointerdown", closeUnitClientPicker, true);
  }, [unitClientPickerOpen]);
  useEffect(() => {
    if (!workOrderUnitPickerOpen) return;
    const closeWorkOrderUnitPicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".unit-form-picker-label")) {
        setWorkOrderUnitPickerOpen(false);
        setWorkOrderUnitSearch("");
      }
    };
    document.addEventListener("pointerdown", closeWorkOrderUnitPicker, true);
    return () => document.removeEventListener("pointerdown", closeWorkOrderUnitPicker, true);
  }, [workOrderUnitPickerOpen]);
  // Demo seed data must only be used offline; otherwise a stale local record with no cloud match is "preserved" forever by mergeRemoteRecords.
  const [unitData, setUnitData] = useState<Unit[]>(hasSupabaseConfig ? [] : units);
  const [meterOverrides, setMeterOverrides] = useState<Record<string, Pick<Unit, "currentMeter" | "lastPmMeter" | "pmInterval" | "meterUnit">>>(() => loadStored("rpm-diesel-meter-overrides", {}));
  const [jobMeterOverrides, setJobMeterOverrides] = useState<Record<string, number>>(() => loadStored("rpm-diesel-job-meter-overrides", {}));
  const [jobData, setJobData] = useState<Job[]>(hasSupabaseConfig ? [] : jobs);
  const [timeEntries, setTimeEntries] = useState<CloudTimeEntry[]>([]);
  const [cloudReady, setCloudReady] = useState(!hasSupabaseConfig);
  const [cloudLoading, setCloudLoading] = useState(hasSupabaseConfig);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const remoteJobsUpdate = useRef(false);
  const remoteUnitsUpdate = useRef(false);
  const remoteUsersUpdate = useRef(false);
  const cloudPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudRefreshInFlight = useRef(false);
  // Baselines of last-known-persisted records, keyed by id. Only records whose reference
  // differs from their baseline are re-saved, so an unrelated state update never re-upserts
  // (and potentially clobbers) sibling records that this client's copy may be stale on.
  const jobsSyncBaselineRef = useRef<Map<string, Job>>(new Map());
  const unitsSyncBaselineRef = useRef<Map<string, Unit>>(new Map());
  const usersSyncBaselineRef = useRef<Map<string, UserAccount>>(new Map());
  const unitDataRef = useRef(unitData);
  const meterOverridesRef = useRef(meterOverrides);
  const modalSwitchTimer = useRef<number | null>(null);
  const submitArmedRef = useRef(false);
  // Timestamp of the last CustomSelect option selection (technician/priority), fed by the onSelect prop;
  // used as a time-based backstop against an iOS ghost click landing on the submit/close buttons right after.
  const pickerActivityRef = useRef(0);
  useEffect(() => () => { if (modalSwitchTimer.current) window.clearTimeout(modalSwitchTimer.current); }, []);
  const jobMeterOverridesRef = useRef(jobMeterOverrides);
  const actionErrorTimer = useRef<number | null>(null);
  // iOS Safari can fire a stray backdrop mousedown when its native <select> picker dismisses; only close if press and release both land on the backdrop itself.
  const backdropPressedSelf = useRef(false);
  const armBackdropDismiss = (event: React.MouseEvent<HTMLDivElement>) => {
    backdropPressedSelf.current = event.target === event.currentTarget;
  };
  const releaseBackdropDismiss = (event: React.MouseEvent<HTMLDivElement>) => {
    if (backdropPressedSelf.current && event.target === event.currentTarget) closeModal();
    backdropPressedSelf.current = false;
  };
  // Same ghost-click hazard as the submit button: a picker option removed mid-gesture can leave a synthetic
  // click landing on the × button with no real press ever having hit it.
  const modalCloseArmedRef = useRef(false);
  const armModalClose = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    modalCloseArmedRef.current = true;
  };
  const handleModalCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!modalCloseArmedRef.current) return;
    modalCloseArmedRef.current = false;
    // eslint-disable-next-line react-hooks/purity -- runs only inside a real click handler, never during render
    const elapsedSincePickerSelection = Date.now() - pickerActivityRef.current;
    if (elapsedSincePickerSelection < 400) return;
    closeModal();
  };
  const t = (key: string) => translations[language][key] ?? ({
    day: language === "en" ? "Day" : "Jour",
    partNumber: language === "en" ? "Part number" : "Numéro de pièce",
    adminPendingEstimates: language === "en" ? "Pending estimates require review." : "Des estimations en attente doivent être vérifiées.",
    adminPendingParts: language === "en" ? "Check the reception of pending parts." : "Vérifiez la réception des pièces en attente.",
    reviewEstimates: language === "en" ? "Review estimates →" : "Vérifier les estimations →",
    reviewParts: language === "en" ? "Review parts →" : "Vérifier les pièces →",
    "Scheduled": language === "en" ? "Scheduled" : "Planifié",
    "Ready for Invoicing": language === "en" ? "Ready for Invoicing" : "Prêt pour facturation",
    adminReadyForInvoicing: language === "en" ? "Work orders are ready for invoicing." : "Des ordres de travail sont prêts pour facturation.",
    reviewInvoicing: language === "en" ? "Review invoicing →" : "Vérifier la facturation →",
    scheduledJobsNotice: language === "en" ? "Scheduled work orders need to be completed." : "Des ordres de travail planifiés doivent être complétés.",
    reviewScheduled: language === "en" ? "Review scheduled →" : "Vérifier les planifiés →",
    dismiss: language === "en" ? "Dismiss" : "Ignorer",
    onTheClock: language === "en" ? "On the clock" : "Pointé",
    offTheClock: language === "en" ? "Off the clock" : "Non pointé",
    selectWorkOrderFirst: language === "en" ? "Select a work order first" : "Sélectionnez d'abord un ordre",
    selectWorkOrder: language === "en" ? "Select work order" : "Sélectionner un ordre",
    clockIn: language === "en" ? "Clock In" : "Pointer",
    clockOut: language === "en" ? "Clock Out" : "Dépointer",
    clockInThisWorkOrder: language === "en" ? "Clock In on this work order" : "Pointer sur cet ordre",
    addTechnicianTime: language === "en" ? "Add technician time manually" : "Ajouter du temps technicien manuellement",
    hoursDecimal: language === "en" ? "Hours (decimal)" : "Heures (décimal)",
    myPayroll: language === "en" ? "My Payroll" : "Mes Paies",
    closingMeterReading: language === "en" ? "Closing meter reading" : "Lecture du compteur de fermeture",
    enterCurrentMeter: language === "en" ? "Enter the current meter before completing this work order." : "Entrez le compteur actuel avant de compléter cet ordre.",
    finalMeterReading: language === "en" ? "Final meter reading" : "Lecture finale du compteur",
    completeWorkOrder: language === "en" ? "Complete work order" : "Compléter l'ordre",
    meterType: language === "en" ? "Meter type" : "Type de compteur",
    currentMileageHours: language === "en" ? "Current mileage / hours" : "Kilométrage / heures actuels",
    pmIntervalLabel: language === "en" ? "PM interval" : "Intervalle PM",
    lastServiceMeter: language === "en" ? "Last service meter" : "Compteur du dernier service",
    seeAllPunches: language === "en" ? "See all punches" : "Voir tous les poinçons",
    seeMyPunches: language === "en" ? "See my punches" : "Voir mes poinçons",
    filterTechnician: language === "en" ? "Filter technician" : "Filtrer le technicien",
    pmIntervalExceeded: language === "en" ? "PM interval exceeded" : "Intervalle PM dépassé",
    sinceLastPm: language === "en" ? "since last PM" : "depuis le dernier PM",
    quantity: language === "en" ? "Qty" : "Qté",
    addAnItem: language === "en" ? "Add an item" : "Ajouter un article",
    manageLivePunches: language === "en" ? "Manage technician live punches" : "Gérer les poinçons actifs des techniciens",
    clockInTechnician: language === "en" ? "Clock in technician" : "Pointer le technicien",
    activeTechnicianPunches: language === "en" ? "Active technician punches" : "Poinçons actifs des techniciens",
    pmDue: language === "en" ? "PM Due" : "PM requis",
    addPmService: language === "en" ? "Add PM service" : "Ajouter le service PM",
    pmDueOnly: language === "en" ? "PM due only" : "PM requis seulement",
    pmRemaining: language === "en" ? "remaining" : "restant",
    pmOverdueBy: language === "en" ? "overdue" : "en retard",
  }[key] ?? key);
  const reportActionError = (message: string) => {
    setActionError(message);
    if (actionErrorTimer.current) window.clearTimeout(actionErrorTimer.current);
    actionErrorTimer.current = window.setTimeout(() => {
      setActionError(null);
      actionErrorTimer.current = null;
    }, 8000);
  };
  const offlineMutationKey = "rpm-diesel-offline-mutations";
  const queueOfflineMutation = (payload: OfflinePayload) => {
    if (typeof window === "undefined") return;
    enqueueOfflineMutation(window.localStorage, offlineMutationKey, payload);
  };
  const todayLabel = new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium" }).format(new Date());
  const formatCurrency = (amount: number) => new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
  const greeting = new Date().getHours() < 12
    ? language === "en" ? "Good morning" : "Bonjour"
    : language === "en" ? "Good afternoon" : "Bon après-midi";
  const workloadAlert = language === "en"
    ? { assigned: "in-progress job(s) assigned to you.", continue: "Continue these jobs from the active queue.", view: "View jobs →" }
    : { assigned: "travail(aux) en cours vous est assigné.", continue: "Continuez ces travaux depuis la file active.", view: "Voir les travaux →" };
  const accounts = userAccounts.filter((account) => account.active);
  const signIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizeName = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const account = accounts.find((candidate) => normalizeName(candidate.name) === normalizeName(loginName) && candidate.password === loginPassword.trim());
    if (account) {
      setActiveUser(account.name);
      setLoginError(false);
      setProfileMenuOpen(false);
      setPasswordEditorOpen(false);
      setDismissedAlerts(new Set());
      window.localStorage.setItem("rpm-diesel-session", JSON.stringify(account));
    } else {
      setLoginError(true);
    }
  };
  const signOut = () => {
    setActiveUser(null);
    window.localStorage.removeItem("rpm-diesel-session");
  };
  const toggleLanguage = () => {
    const next = language === "en" ? "fr" : "en";
    setLanguage(next);
    window.localStorage.setItem("rpm-diesel-language", JSON.stringify(next));
  };
  const activeTimeEntry = timeEntries.find((entry) => entry.userId === activeUser && entry.status === "active");
  const lunchProposals = autoLunchProposals(timeEntries);
  useEffect(() => {
    if (userAccounts.find((account) => account.name === activeUser)?.role !== "Admin" || (section !== "payroll" && section !== "profitability")) return;
    const pending = lunchProposals.filter((proposal) => !autoLunchKeys.includes(proposal.key));
    if (!pending.length) return;
    let cancelled = false;
    const applyLunchProposals = async () => {
      const applied: string[] = [];
      for (const proposal of pending) {
        const entry = timeEntries.find((candidate) => candidate.id === proposal.previousEntryId);
        if (!entry) continue;
        if ((entry.breakMinutes ?? 0) < proposal.minutes) {
          await updateTimeEntry({ ...entry, breakMinutes: (entry.breakMinutes ?? 0) + proposal.minutes });
          if (!cancelled) setTimeEntries((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, breakMinutes: (candidate.breakMinutes ?? 0) + proposal.minutes } : candidate));
          await writeActivityLog("System", "auto_lunch_proposed", "time_entry", entry.id, { field: "break_minutes", old_value: entry.breakMinutes ?? 0, new_value: (entry.breakMinutes ?? 0) + proposal.minutes, proposed: true });
        }
        applied.push(proposal.key);
      }
      if (!cancelled && applied.length) {
        setAutoLunchKeys((current) => Array.from(new Set([...current, ...applied])));
        window.localStorage.setItem("rpm-diesel-auto-lunches", JSON.stringify(Array.from(new Set([...autoLunchKeys, ...applied]))));
      }
    };
    void applyLunchProposals().catch((error) => reportActionError(`Auto lunch update failed: ${(error as Error).message}`));
    return () => { cancelled = true; };
  }, [activeUser, userAccounts, section, lunchProposals, autoLunchKeys, timeEntries]);
  const todaySummary = dailyTimesheetSummary.find((row) => row.userId === activeUser && sameDay(row.workDate, new Date()));
  const currentWeekSummary = weeklyTimesheetSummary.find((row) => row.userId === activeUser && row.weekStart === isoDate(weekStart(new Date())));
  const startBreak = async () => {
    if (!activeTimeEntry) return;
    const nextEntry = { ...activeTimeEntry, breakStartedAt: new Date().toISOString() };
    try {
      await updateTimeEntry(nextEntry);
      setTimeEntries((current) => current.map((entry) => entry.id === nextEntry.id ? nextEntry : entry));
    } catch (error) {
      reportActionError(`Break start failed: ${(error as Error).message}`);
    }
  };
  const endBreak = async () => {
    if (!activeTimeEntry || !activeTimeEntry.breakStartedAt) return;
    const breakStarted = new Date(activeTimeEntry.breakStartedAt);
    const endedAt = new Date();
    const breakMinutes = Math.max(0, Math.round((endedAt.getTime() - breakStarted.getTime()) / 60000));
    const nextEntry = { ...activeTimeEntry, breakMinutes: (activeTimeEntry.breakMinutes ?? 0) + breakMinutes, breakStartedAt: null };
    try {
      await updateTimeEntry(nextEntry);
      setTimeEntries((current) => current.map((entry) => entry.id === nextEntry.id ? nextEntry : entry));
    } catch (error) {
      reportActionError(`Break end failed: ${(error as Error).message}`);
    }
  };
  const clockIn = async (workOrderId: string | null) => {
    if (!activeUser || !workOrderId) return;
    if (activeTimeEntry) {
      reportActionError(language === "en" ? "You're already punched in on another work order. Clock out first." : "Vous êtes déjà pointé sur un autre ordre de travail. Dépointez d'abord.");
      return;
    }
    const newClockIn = new Date();
    try {
      const created = await createTimeEntry({ userId: activeUser, userName: activeUser, workOrderId, clockIn: newClockIn.toISOString() });
      if (created) {
        setTimeEntries((current) => [created, ...current]);
        const job = jobData.find((item) => item.id === workOrderId);
        if (job && job.status !== "In Progress") setStatus(job.id, "In Progress");
      }
      else setCloudError(t("cloudTimeMissing"));
    } catch (error) {
      queueOfflineMutation({ kind: "clock-in", entry: { userId: activeUser, userName: activeUser, workOrderId, clockIn: newClockIn.toISOString() } });
      reportActionError(`Clock in failed; punch queued for retry: ${(error as Error).message}`);
    }
  };
  const clockOut = async () => {
    if (!activeTimeEntry) return;
    const clockOutTime = new Date();
    let nextEntry = { ...activeTimeEntry };
    if (nextEntry.breakStartedAt) {
      const breakStarted = new Date(nextEntry.breakStartedAt);
      const breakMinutes = Math.max(0, Math.round((clockOutTime.getTime() - breakStarted.getTime()) / 60000));
      nextEntry = { ...nextEntry, breakMinutes: (nextEntry.breakMinutes ?? 0) + breakMinutes, breakStartedAt: null, status: "completed" };
    }
    const totalHours = (clockOutTime.getTime() - new Date(activeTimeEntry.clockIn).getTime()) / 3600000;
    try {
      await completeTimeEntry(activeTimeEntry.id, clockOutTime.toISOString(), Number(totalHours.toFixed(2)));
      await updateTimeEntry({ ...nextEntry, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)), status: "completed" });
      setTimeEntries((current) => current.map((entry) => entry.id === activeTimeEntry.id ? { ...entry, ...nextEntry, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)), status: "completed" } : entry));
    } catch (error) {
      queueOfflineMutation({ kind: "clock-out", entry: { id: activeTimeEntry.id, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)) } });
      reportActionError(`Clock out failed; punch queued for retry: ${(error as Error).message}`);
    }
  };
  const adminClockIn = async () => {
    if (!isAdmin || !adminPunchUser || !adminPunchJob) return;
    if (timeEntries.some((entry) => entry.userId === adminPunchUser && entry.status === "active")) {
      reportActionError(language === "en" ? `${adminPunchUser} is already punched in on another work order.` : `${adminPunchUser} est déjà pointé sur un autre ordre de travail.`);
      return;
    }
    try {
      const created = await createTimeEntry({ userId: adminPunchUser, userName: adminPunchUser, workOrderId: adminPunchJob, clockIn: new Date().toISOString() });
      if (created) {
        setTimeEntries((current) => [created, ...current]);
        const job = jobData.find((item) => item.id === adminPunchJob);
        if (job && job.status !== "In Progress") setStatus(job.id, "In Progress");
      }
    } catch (error) {
      queueOfflineMutation({ kind: "clock-in", entry: { userId: adminPunchUser, userName: adminPunchUser, workOrderId: adminPunchJob, clockIn: new Date().toISOString() } });
      reportActionError(`Technician clock in failed; punch queued for retry: ${(error as Error).message}`);
    }
  };
  const adminClockOut = async (entry: CloudTimeEntry) => {
    if (!isAdmin || entry.status !== "active") return;
    const clockOutTime = new Date();
    const totalHours = (clockOutTime.getTime() - new Date(entry.clockIn).getTime()) / 3600000;
    try {
      await completeTimeEntry(entry.id, clockOutTime.toISOString(), Number(totalHours.toFixed(2)));
      setTimeEntries((current) => current.map((item) => item.id === entry.id ? { ...item, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)), status: "completed" } : item));
    } catch (error) {
      queueOfflineMutation({ kind: "clock-out", entry: { id: entry.id, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)) } });
      reportActionError(`Technician clock out failed; punch queued for retry: ${(error as Error).message}`);
    }
  };
  const addManualTime = async () => {
    const user = userAccounts.find((account) => account.name === manualTimeUser);
    const hours = Number(manualTimeHours);
    if (!user || !hours || hours <= 0) return;
    const clockOutAt = new Date();
    const clockInAt = new Date(clockOutAt.getTime() - hours * 3600000);
    try {
      const created = await createManualTimeEntry({ userId: user.name, userName: user.name, workOrderId: manualTimeJob || null, clockIn: clockInAt.toISOString(), clockOut: clockOutAt.toISOString(), totalHours: Number(hours.toFixed(2)) });
      if (created) setTimeEntries((current) => [created, ...current]);
      setManualTimeHours("");
    } catch (error) { reportActionError(`Manual time entry failed: ${(error as Error).message}`); }
  };
  const openDayClassification = (userId: string, workDate: string) => {
    setClassifyingDay({ userId, workDate });
    setClassificationBreakMinutes("");
    setClassificationLostMinutes("");
    setClassificationReason("Parts wait");
  };
  const saveDayClassification = async () => {
    if (!classifyingDay || !activeUser) return;
    const summary = [...payrollRows, ...profitabilitySummaryRows].find((row) => row.user_id === classifyingDay.userId && row.work_date === classifyingDay.workDate) ?? (() => {
      const dayEntries = timeEntries.filter((entry) => entry.userId === classifyingDay.userId && entry.status === "completed" && torontoDateKey(entry.clockIn) === classifyingDay.workDate);
      if (!dayEntries.length) return null;
      const starts = dayEntries.map((entry) => new Date(entry.clockIn).getTime());
      const ends = dayEntries.map((entry) => new Date(entry.clockOut ?? entry.clockIn).getTime());
      return { user_id: classifyingDay.userId, user_name: dayEntries[0].userName, work_date: classifyingDay.workDate, day_start: new Date(Math.min(...starts)).toISOString(), day_end: new Date(Math.max(...ends)).toISOString(), raw_hours: 0, break_minutes: 0, lost_time_minutes: 0 };
    })();
    if (!summary) {
      reportActionError("No completed time entries were found for this technician and day.");
      return;
    }
    const breakMinutes = Math.max(0, Number(classificationBreakMinutes || 0));
    const lostMinutes = Math.max(0, Number(classificationLostMinutes || 0));
    const remaining = automaticLostTimeMinutesFor(timeEntries, [summary], lunchProposals).get(`${classifyingDay.userId}:${classifyingDay.workDate}`) ?? 0;
    if (breakMinutes + lostMinutes > remaining || (lostMinutes > 0 && !classificationReason)) {
      reportActionError(`Classification must be no more than ${remaining} unclassified minutes.`);
      return;
    }
    const targets = timeEntries.filter((entry) => entry.userId === classifyingDay.userId && entry.status === "completed" && torontoDateKey(entry.clockIn) === classifyingDay.workDate).sort((left, right) => new Date(right.clockOut ?? right.clockIn).getTime() - new Date(left.clockOut ?? left.clockIn).getTime());
    const target = targets[0];
    if (!target) return;
    const nextEntry = { ...target, breakMinutes: (target.breakMinutes ?? 0) + breakMinutes, lostTimeMinutes: (target.lostTimeMinutes ?? 0) + lostMinutes, lostTimeReason: lostMinutes > 0 ? classificationReason : target.lostTimeReason ?? null };
    try {
      await updateTimeEntry(nextEntry);
      setTimeEntries((current) => current.map((entry) => entry.id === target.id ? nextEntry : entry));
      if (breakMinutes > 0) await writeActivityLog(activeUser, "time_entry_classified", "time_entry", target.id, { field: "break_minutes", old_value: target.breakMinutes ?? 0, new_value: nextEntry.breakMinutes });
      if (lostMinutes > 0) await writeActivityLog(activeUser, "time_entry_classified", "time_entry", target.id, { field: "lost_time_minutes", old_value: target.lostTimeMinutes ?? 0, new_value: nextEntry.lostTimeMinutes, reason: classificationReason });
      setClassifyingDay(null);
    } catch (error) {
      reportActionError(`Day classification failed: ${(error as Error).message}`);
    }
  };
  const currentAccount = userAccounts.find((account) => account.name === activeUser);
  const isAdmin = currentAccount?.role === "Admin";
  const changePayrollPeriod = (preset: PayrollPeriodPreset) => {
    const range = payrollPeriodRange(preset);
    setPayrollPeriodPreset(preset);
    setPayrollPeriodStart(range.start);
    setPayrollPeriodEnd(range.end);
  };
  const confirmDeletion = (kind: "workOrder" | "unit" | "client" | "punch" | "user") => {
    const labels = language === "fr"
      ? { workOrder: "cet ordre de travail", unit: "cette unité", client: "ce client", punch: "ce poinçon", user: "cet utilisateur" }
      : { workOrder: "this work order", unit: "this unit", client: "this client", punch: "this punch entry", user: "this user" };
    return window.confirm(language === "fr" ? `Voulez-vous vraiment supprimer ${labels[kind]} ?` : `Are you sure you want to delete ${labels[kind]}?`);
  };
  const startTimeEntryEdit = (entry: CloudTimeEntry) => {
    setEditingTimeEntryId(entry.id);
    setEditingTimeEntry({ ...entry });
  };
  const cancelTimeEntryEdit = () => {
    setEditingTimeEntryId(null);
    setEditingTimeEntry(null);
  };
  const saveTimeEntryEdit = async () => {
    if (!editingTimeEntry || !activeUser) return;
    const previous = timeEntries.find((entry) => entry.id === editingTimeEntry.id);
    if (!previous) { cancelTimeEntryEdit(); return; }
    try {
      await updateTimeEntry(editingTimeEntry);
      setTimeEntries((current) => current.map((entry) => entry.id === editingTimeEntry.id ? editingTimeEntry : entry));
      const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [
        { field: "clock_in", oldValue: previous.clockIn, newValue: editingTimeEntry.clockIn },
        { field: "clock_out", oldValue: previous.clockOut, newValue: editingTimeEntry.clockOut },
        { field: "break_minutes", oldValue: previous.breakMinutes ?? 0, newValue: editingTimeEntry.breakMinutes ?? 0 },
        { field: "lost_time_minutes", oldValue: previous.lostTimeMinutes ?? 0, newValue: editingTimeEntry.lostTimeMinutes ?? 0 },
        { field: "lost_time_reason", oldValue: previous.lostTimeReason ?? null, newValue: editingTimeEntry.lostTimeReason ?? null },
      ].filter((change) => JSON.stringify(change.oldValue) !== JSON.stringify(change.newValue));
      for (const change of changes) {
        await writeActivityLog(activeUser, "time_entry_edited", "time_entry", editingTimeEntry.id, change);
      }
      cancelTimeEntryEdit();
    } catch (error) {
      reportActionError(`Punch update failed: ${(error as Error).message}`);
    }
  };
  const deleteTimeEntryRow = async (entryId: string) => {
    if (!isAdmin || !confirmDeletion("punch")) return;
    try {
      await removeTimeEntry(entryId);
      setTimeEntries((current) => current.filter((entry) => entry.id !== entryId));
      if (editingTimeEntryId === entryId) cancelTimeEntryEdit();
    } catch (error) {
      reportActionError(`Punch deletion failed: ${(error as Error).message}`);
    }
  };
  const visibleNavItems = isAdmin ? [...navItems, { id: "users" as Section, label: "userManagement", icon: <Users size={18} /> }, { id: "payroll" as Section, label: "Payroll", icon: <Wallet size={18} /> }, { id: "profitability" as Section, label: language === "fr" ? "Rentabilité" : "Profitability", icon: <ChartNoAxesCombined size={18} /> }] : [...navItems, { id: "technicianPayroll" as Section, label: "myPayroll", icon: <FileText size={18} /> }];
  const canManageWorkOrders = isAdmin;
  const isMissingUnit = (unitId: string, client: string) => !unitData.some((unit) => unit.unit === unitId && unit.client === client);
  const unitLabelForJob = (unitId: string, client: string) => !isMissingUnit(unitId, client)
    ? unitId
    : language === "en" ? `Archived Unit [${unitId}]` : `Unité archivée [${unitId}]`;
  const technicianOptions = ["Unassigned", ...userAccounts.filter((account) => account.active && account.isTechnician).map((account) => account.name)];
  const addUser = () => {
    const name = newUserName.trim();
    if (!name || userAccounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) return;
    setUserAccounts((current) => [...current, { id: `user-${createId()}`, name, role: "Technician", password: newUserPassword || "12345678", active: true, isTechnician: newUserIsTechnician }]);
    setNewUserName("");
    setNewUserPassword("12345678");
    setNewUserIsTechnician(true);
  };
  const toggleUser = (id: string) => setUserAccounts((current) => current.map((account) => account.id === id && account.name !== activeUser ? { ...account, active: !account.active } : account));
  const toggleTechnician = (id: string) => setUserAccounts((current) => current.map((account) => account.id === id ? { ...account, isTechnician: !account.isTechnician } : account));
  const toggleAdminRole = (id: string) => {
    if (!isAdmin) return;
    const nextUsers: UserAccount[] = userAccounts.map((account) => account.id === id && account.name !== "Marc" && account.name !== activeUser
      ? { ...account, role: (account.role === "Admin" ? "Technician" : "Admin") as UserAccount["role"], isTechnician: true }
      : account);
    setUserAccounts(nextUsers);
    void saveUsers(nextUsers).catch((error: Error) => setCloudError(`User role update failed: ${error.message}`));
  };
  const saveManagedPassword = () => {
    if (!passwordTargetId || managedPassword.length < 8) return;
    setUserAccounts((current) => current.map((account) => account.id === passwordTargetId ? { ...account, password: managedPassword } : account));
    setPasswordTargetId(null);
    setManagedPassword("12345678");
  };
  const removeUser = async (id: string) => {
    if (!isAdmin) return;
    const account = userAccounts.find((candidate) => candidate.id === id);
    if (!account || account.name === "Marc" || account.name === activeUser || !confirmDeletion("user")) return;
    // Upsert-only saves can't delete a cloud row, so the removed user must be deleted remotely first or it reappears on the next sync.
    try {
      await removeUserAccount(id);
    } catch (error) {
      reportActionError(`User deletion failed: ${(error as Error).message}`);
      return;
    }
    setUserAccounts((current) => current.filter((candidate) => candidate.id !== id));
  };
  const saveClientEdit = () => {
    if (!isAdmin) return;
    const nextName = editingClientName.trim();
    if (!editingClient || !nextName) return;
    setClientData((current) => current.map((client) => client === editingClient ? nextName : client));
    setEditingClient(null);
    setEditingClientName("");
  };
  const removeClient = (client: string) => {
    if (!isAdmin || !confirmDeletion("client")) return;
    setClientData((current) => current.filter((item) => item !== client));
  };
  const addClientName = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (!clientData.includes(name)) setClientData((current) => [name, ...current]);
    setForm((current) => ({ ...current, client: name }));
    setUnitClientSearch("");
    setUnitClientPickerOpen(false);
  };
  const addClient = (input: HTMLInputElement) => {
    addClientName(input.value);
    input.value = "";
  };
  const changeOwnPassword = () => {
    const account = userAccounts.find((candidate) => candidate.name === activeUser);
    if (!account || currentPassword !== account.password) { setPasswordError("Current password is incorrect."); return; }
    if (nextPassword.length < 8) { setPasswordError("New password must be at least 8 characters."); return; }
    if (nextPassword !== confirmPassword) { setPasswordError("New passwords do not match."); return; }
    setUserAccounts((current) => current.map((candidate) => candidate.name === activeUser ? { ...candidate, password: nextPassword } : candidate));
    setCurrentPassword(""); setNextPassword(""); setConfirmPassword(""); setPasswordError(""); setPasswordEditorOpen(false); setProfileMenuOpen(false);
  };
  useEffect(() => {
    unitDataRef.current = unitData;
  }, [unitData]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-users", JSON.stringify(userAccounts));
  }, [userAccounts]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-clients", JSON.stringify(clientData));
  }, [clientData]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-meter-overrides", JSON.stringify(meterOverrides));
  }, [meterOverrides]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-job-meter-overrides", JSON.stringify(jobMeterOverrides));
  }, [jobMeterOverrides]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-dismissed-long-punches", JSON.stringify(dismissedLongPunchIds));
  }, [dismissedLongPunchIds]);
  useEffect(() => {
    const flushOfflineMutations = async () => {
      const pending = readOfflineMutations<OfflinePayload>(window.localStorage, offlineMutationKey);
      if (!pending.length) return;
      const remaining = [] as typeof pending;
      for (const mutation of pending) {
        try {
          if (mutation.payload.kind === "jobs") {
            const persistableJobs = mutation.payload.jobs.filter((job) => unitDataRef.current.some((unit) => unit.unit === job.unit && unit.client === job.client));
            if (persistableJobs.length) await saveJobs(persistableJobs);
          }
          if (mutation.payload.kind === "units") await saveUnits(mutation.payload.units);
          if (mutation.payload.kind === "clock-in") await createTimeEntry(mutation.payload.entry);
          if (mutation.payload.kind === "clock-out") await completeTimeEntry(mutation.payload.entry.id, mutation.payload.entry.clockOut, mutation.payload.entry.totalHours);
        } catch {
          remaining.push(mutation);
        }
      }
      if (remaining.length) window.localStorage.setItem(offlineMutationKey, JSON.stringify(remaining));
      else clearOfflineMutations(window.localStorage, offlineMutationKey);
    };
    window.addEventListener("online", flushOfflineMutations);
    void flushOfflineMutations();
    return () => window.removeEventListener("online", flushOfflineMutations);
  }, [activeUser]);
  useEffect(() => {
    meterOverridesRef.current = meterOverrides;
  }, [meterOverrides]);
  useEffect(() => {
    jobMeterOverridesRef.current = jobMeterOverrides;
  }, [jobMeterOverrides]);
  useEffect(() => {
    let cancelled = false;
    if (!hasSupabaseConfig) return;
    Promise.all([loadFleetData(), loadUsers(), loadTimeEntries(), loadUnitNotes()]).then(([data, cloudUsers, cloudTimeEntries, cloudUnitNotes]) => {
      if (cancelled) return;
      if (data) {
        const remoteJobs = (data.jobs as Job[]).map((job) => jobMeterOverridesRef.current[job.id] == null ? job : { ...job, meterReading: jobMeterOverridesRef.current[job.id] });
        const remoteUnits = (data.units as Unit[]).map((unit) => ({ ...unit, ...(meterOverridesRef.current[unitKey(unit)] ?? {}) }));
        setJobData((current) => {
          const merged = mergeRemoteRecords(current, remoteJobs, (job) => job.id);
          if (recordsEqual(current, merged)) return current;
          remoteJobsUpdate.current = true;
          return merged;
        });
        setUnitData((current) => {
          const merged = mergeRemoteRecords(current, remoteUnits, (unit) => unitKey(unit));
          if (recordsEqual(current, merged)) return current;
          remoteUnitsUpdate.current = true;
          return merged;
        });
      }
      if (cloudUsers?.length) { remoteUsersUpdate.current = true; setUserAccounts(cloudUsers as UserAccount[]); }
      if (cloudTimeEntries) setTimeEntries(cloudTimeEntries);
      if (cloudUnitNotes) setUnitNotes(cloudUnitNotes.reduce<Record<string, UnitNote[]>>((groups, note) => { const current = groups[note.unitId] ?? []; groups[note.unitId] = [...current, note]; return groups; }, {}));
      setCloudError(null);
      setCloudReady(true);
      setCloudLoading(false);
    }).catch((error: Error) => {
      setCloudError(error.message);
      setCloudReady(true);
      setCloudLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser) return;
    const refreshTimeSummaries = async () => {
      try {
        const [daily, weekly] = await Promise.all([
          loadDailyTimesheetSummary(activeUser),
          loadWeeklyTimesheetSummary(activeUser),
        ]);
        if (daily) setDailyTimesheetSummary(daily);
        if (weekly) setWeeklyTimesheetSummary(weekly);
      } catch (error) {
        console.warn("Summary refresh failed", error);
      }
    };
    void refreshTimeSummaries();
  }, [activeUser, cloudReady]);
  useEffect(() => {
    if (!isAdmin) return;
    const refreshPayrollLocks = async () => {
      try {
        const locks = await loadPayrollLocks();
        if (locks) setPayrollLocks(locks);
      } catch (error) {
        console.warn("Payroll lock refresh failed", error);
      }
    };
    void refreshPayrollLocks();
  }, [isAdmin, cloudReady, section]);
  useEffect(() => {
    if (!isAdmin || !hasSupabaseConfig || section !== "payroll") return;
    let active = true;
    const selectedTechs = payrollTechFilter.length
      ? payrollTechFilter
      : userAccounts.filter((account) => account.active && account.isTechnician).map((account) => account.name);
    const loadPayrollSummary = async () => {
      setPayrollLoading(true);
      try {
        const { data, error } = await supabase!
          .from("daily_timesheet_summary")
          .select("user_id,user_name,work_date,day_start,day_end,raw_hours,break_minutes,lost_time_minutes,net_payable_hours,billable_hours")
          .gte("work_date", payrollPeriodStart)
          .lte("work_date", payrollPeriodEnd)
          .in("user_id", selectedTechs)
          .order("user_id", { ascending: true })
          .order("work_date", { ascending: true });
        if (!active) return;
        if (error) throw error;
        setPayrollRows((data ?? []) as Array<Record<string, any>>);
      } catch (error) {
        if (active) {
          console.warn("Payroll summary query failed", error);
          setPayrollRows([]);
        }
      } finally {
        if (active) setPayrollLoading(false);
      }
    };
    void loadPayrollSummary();
    return () => { active = false; };
  }, [isAdmin, section, payrollPeriodStart, payrollPeriodEnd, payrollTechFilter, userAccounts]);
  useEffect(() => {
    if (!isAdmin || !hasSupabaseConfig || section !== "profitability") return;
    let active = true;
    const selectedTechs = payrollTechFilter.length
      ? payrollTechFilter
      : userAccounts.filter((account) => account.active && account.isTechnician).map((account) => account.name);
    const startIso = `${payrollPeriodStart}T00:00:00.000Z`;
    const endIso = `${payrollPeriodEnd}T23:59:59.999Z`;
    const loadProfitability = async () => {
      setProfitabilityLoading(true);
      try {
        const [timeEntriesResponse, accountsResponse, summaryResponse] = await Promise.all([
          supabase!.from("time_entries").select("*").gte("clock_in", startIso).lte("clock_in", endIso).in("user_id", selectedTechs),
          supabase!.from("user_accounts").select("name,hourly_rate"),
          supabase!.from("daily_timesheet_summary").select("user_id,user_name,work_date,day_start,day_end,raw_hours,billable_hours").gte("work_date", payrollPeriodStart).lte("work_date", payrollPeriodEnd).in("user_id", selectedTechs),
        ]);
        if (!active) return;
        if (timeEntriesResponse.error) throw timeEntriesResponse.error;
        const rateMap = Object.fromEntries((accountsResponse.data ?? []).map((account: any) => [String(account.name), Number(account.hourly_rate ?? 0)]));
        const rows = (timeEntriesResponse.data ?? []).map((entry: any) => {
          const hourlyRate = Number(rateMap[String(entry.user_id)] ?? 0);
          return { ...entry, hourly_rate: hourlyRate };
        });
        setProfitabilityRows(rows);
        setProfitabilitySummaryRows(summaryResponse.error ? [] : (summaryResponse.data ?? []));
      } catch (error) {
        if (active) {
          console.warn("Lost-time summary query failed", error);
          setProfitabilityRows([]);
        }
      } finally {
        if (active) setProfitabilityLoading(false);
      }
    };
    void loadProfitability();
    return () => { active = false; };
  }, [isAdmin, section, payrollPeriodStart, payrollPeriodEnd, payrollTechFilter, userAccounts]);
  useEffect(() => {
    if (!cloudReady) return;
    if (remoteUsersUpdate.current) {
      remoteUsersUpdate.current = false;
      userAccounts.forEach((account) => usersSyncBaselineRef.current.set(account.id, account));
      return;
    }
    const changedUsers = userAccounts.filter((account) => usersSyncBaselineRef.current.get(account.id) !== account);
    if (!changedUsers.length) return;
    void saveUsers(changedUsers).then(() => {
      changedUsers.forEach((account) => usersSyncBaselineRef.current.set(account.id, account));
    }).catch((error: Error) => reportActionError(`User data save failed: ${error.message}`));
  }, [userAccounts, cloudReady]);
  useEffect(() => {
    if (!cloudReady) return;
    if (remoteJobsUpdate.current) {
      remoteJobsUpdate.current = false;
      jobData.forEach((job) => jobsSyncBaselineRef.current.set(job.id, job));
      return;
    }
    const changedJobs = jobData.filter((job) => unitDataRef.current.some((unit) => unit.unit === job.unit && unit.client === job.client) && jobsSyncBaselineRef.current.get(job.id) !== job);
    if (!changedJobs.length) return;
    void saveJobs(changedJobs).then(() => {
      changedJobs.forEach((job) => jobsSyncBaselineRef.current.set(job.id, job));
    }).catch((error: Error) => { queueOfflineMutation({ kind: "jobs", jobs: changedJobs }); reportActionError(`Work order data save failed; changes queued for retry: ${error.message}`); });
  }, [jobData, cloudReady]);
  useEffect(() => {
    if (!cloudReady) return;
    if (remoteUnitsUpdate.current) {
      remoteUnitsUpdate.current = false;
      unitData.forEach((unit) => unitsSyncBaselineRef.current.set(unitKey(unit), unit));
      return;
    }
    const changedUnits = unitData.filter((unit) => unitsSyncBaselineRef.current.get(unitKey(unit)) !== unit);
    if (!changedUnits.length) return;
    void saveUnits(changedUnits).then(() => {
      changedUnits.forEach((unit) => unitsSyncBaselineRef.current.set(unitKey(unit), unit));
    }).catch((error: Error) => { queueOfflineMutation({ kind: "units", units: changedUnits }); reportActionError(`Unit data save failed; changes queued for retry: ${error.message}`); });
  }, [unitData, cloudReady]);
  useEffect(() => {
    if (!cloudReady || !hasSupabaseConfig) return;
    const applyUnitChange = (change: RealtimeChange<CloudUnit>) => {
      remoteUnitsUpdate.current = true;
      setUnitData((current) => {
        const unitId = change.record?.unit ?? change.oldRecord?.unit;
        const clientId = change.record?.client ?? change.oldRecord?.client;
        if (!unitId || clientId == null) return current;
        if (change.eventType === "DELETE") return current.filter((unit) => !(unit.unit === unitId && unit.client === clientId));
        if (!change.record) return current;
        const nextUnit = { ...change.record, ...(meterOverridesRef.current[unitKey(change.record)] ?? {}) } as Unit;
        const existing = current.some((unit) => unit.unit === nextUnit.unit && unit.client === nextUnit.client);
        return existing ? current.map((unit) => unit.unit === nextUnit.unit && unit.client === nextUnit.client && remoteWins(unit, nextUnit) ? nextUnit : unit) : [nextUnit, ...current];
      });
    };
    const applyJobChange = (change: RealtimeChange<CloudJob>) => {
      remoteJobsUpdate.current = true;
      setJobData((current) => {
        const jobId = change.record?.id ?? change.oldRecord?.id;
        if (!jobId) return current;
        if (change.eventType === "DELETE") return current.filter((job) => job.id !== jobId);
        if (!change.record) return current;
        const nextJob = change.record as Job;
        const resolvedJob = jobMeterOverridesRef.current[nextJob.id] == null ? nextJob : { ...nextJob, meterReading: jobMeterOverridesRef.current[nextJob.id] };
        const existing = current.some((job) => job.id === nextJob.id);
        return existing ? current.map((job) => job.id === resolvedJob.id && remoteWins(job, resolvedJob) ? resolvedJob : job) : [resolvedJob, ...current];
      });
    };
    const refreshFromCloud = () => {
      if (cloudRefreshInFlight.current) return;
      cloudRefreshInFlight.current = true;
      void Promise.all([loadFleetData(), loadUsers(), loadTimeEntries()]).then(([data, cloudUsers, cloudTimeEntries]) => {
        if (!data) return;
        const remoteJobs = (data.jobs as Job[]).map((job) => jobMeterOverridesRef.current[job.id] == null ? job : { ...job, meterReading: jobMeterOverridesRef.current[job.id] });
        const remoteUnits = (data.units as Unit[]).map((unit) => ({ ...unit, ...(meterOverridesRef.current[unitKey(unit)] ?? {}) }));
        setJobData((current) => {
          const merged = mergeRemoteRecords(current, remoteJobs, (job) => job.id);
          if (recordsEqual(current, merged)) return current;
          remoteJobsUpdate.current = true;
          return merged;
        });
        setUnitData((current) => {
          const merged = mergeRemoteRecords(current, remoteUnits, (unit) => unitKey(unit));
          if (recordsEqual(current, merged)) return current;
          remoteUnitsUpdate.current = true;
          return merged;
        });
        if (cloudUsers?.length) {
          setUserAccounts((current) => {
            if (recordsEqual(current, cloudUsers)) return current;
            remoteUsersUpdate.current = true;
            return cloudUsers as UserAccount[];
          });
        }
        if (cloudTimeEntries) setTimeEntries(cloudTimeEntries);
        setCloudError(null);
      }).catch((error: Error) => setCloudError(`Cloud sync retrying: ${error.message}`)).finally(() => {
        cloudRefreshInFlight.current = false;
      });
    };
    refreshFromCloud();
    cloudPollTimer.current = setInterval(refreshFromCloud, 30000);
    const applyUserChange = (change: RealtimeChange<CloudUser>) => {
      remoteUsersUpdate.current = true;
      setUserAccounts((current) => {
        const userId = change.record?.id ?? change.oldRecord?.id;
        if (!userId) return current;
        if (change.eventType === "DELETE") return current.filter((account) => account.id !== userId);
        if (!change.record) return current;
        const nextUser = change.record as UserAccount;
        return current.some((account) => account.id === nextUser.id) ? current.map((account) => account.id === nextUser.id ? nextUser : account) : [...current, nextUser];
      });
    };
    const applyTimeEntryChange = (change: RealtimeChange<CloudTimeEntry>) => {
      setTimeEntries((current) => {
        const entryId = change.record?.id ?? change.oldRecord?.id;
        if (!entryId) return current;
        if (change.eventType === "DELETE") return current.filter((entry) => entry.id !== entryId);
        if (!change.record) return current;
        return current.some((entry) => entry.id === entryId) ? current.map((entry) => entry.id === entryId ? change.record as CloudTimeEntry : entry) : [change.record as CloudTimeEntry, ...current];
      });
    };
    const unsubscribe = subscribeToFleet(applyUnitChange, applyJobChange, (message) => {
      setCloudError("Realtime transport unavailable; cloud polling is active.");
      refreshFromCloud();
      console.warn("Supabase realtime transport:", message);
    }, applyUserChange, applyTimeEntryChange);
    return () => {
      unsubscribe();
      if (cloudPollTimer.current) clearInterval(cloudPollTimer.current);
      cloudPollTimer.current = null;
    };
  }, [cloudReady, activeUser]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      try {
        if (event.key === "rpm-diesel-session") {
          const stored = event.newValue ? JSON.parse(event.newValue) as string | { name?: string } : null;
          setActiveUser(typeof stored === "string" ? stored : stored?.name ?? null);
        }
        if (event.key === "rpm-diesel-language" && event.newValue) {
          const nextLanguage = JSON.parse(event.newValue);
          if (nextLanguage === "en" || nextLanguage === "fr") setLanguage(nextLanguage);
        }
        if (event.key === "rpm-diesel-users" && event.newValue) {
          const nextUsers = JSON.parse(event.newValue);
          if (Array.isArray(nextUsers)) setUserAccounts(nextUsers as UserAccount[]);
        }
        if (event.key === "rpm-diesel-clients" && event.newValue) {
          const nextClients = JSON.parse(event.newValue);
          if (Array.isArray(nextClients)) setClientData(nextClients as string[]);
        }
      } catch {
        reportActionError(language === "en" ? "A shared browser update could not be applied." : "Une mise à jour partagée du navigateur n'a pas pu être appliquée.");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [language]);
  // Most recent punch (clock-out if closed, otherwise clock-in) recorded against a work order; 0 if none.
  const latestPunchTimeFor = (jobId: string) => timeEntries.filter((entry) => entry.workOrderId === jobId).reduce((latest, entry) => Math.max(latest, new Date(entry.clockOut ?? entry.clockIn).getTime()), 0);
  const filteredJobs = (jobFilter === "All"
    ? jobData.filter((job) => job.status.trim() !== "Completed")
    : jobData.filter((job) => job.status.trim() === jobFilter)
  ).filter((job) => `${job.id} ${job.unit} ${job.client} ${job.tech} ${job.issue}`.toLocaleLowerCase().includes(jobQueueSearch.trim().toLocaleLowerCase())).sort((a, b) => isAdmin
    ? latestPunchTimeFor(b.id) - latestPunchTimeFor(a.id)
    : (activeTimeEntry?.workOrderId === b.id ? 1 : 0) - (activeTimeEntry?.workOrderId === a.id ? 1 : 0));
  const openJobsQueue = () => {
    setJobFilter("All");
    setJobQueueSearch("");
    setSection("jobs");
  };
  const openFilteredQueue = (status: "All" | JobStatus, search = "") => {
    setJobFilter(status);
    setJobQueueSearch(search);
    setSection("jobs");
  };
  const meterSummaryForUnit = (unit: Unit) => {
    const override = meterOverrides[unitKey(unit)];
    const jobMeters = jobData.filter((job) => job.unit === unit.unit && job.client === unit.client).map((job) => jobMeterOverrides[job.id] ?? job.meterReading ?? Number.parseFloat(job.usage)).filter((meter): meter is number => meter != null && Number.isFinite(Number(meter))).map(Number).sort((left, right) => right - left);
    const explicitCurrentMeter = override?.currentMeter ?? unit.currentMeter ?? null;
    const currentMeter = explicitCurrentMeter ?? jobMeters[0] ?? null;
    const previousJobMeter = jobMeters[1];
    const baseline = override?.lastPmMeter ?? unit.lastPmMeter ?? previousJobMeter ?? currentMeter ?? 0;
    const pmInterval = override?.pmInterval ?? unit.pmInterval ?? 25000;
    const meterUnit = override?.meterUnit ?? unit.meterUnit ?? "KM";
    const delta = currentMeter == null ? null : currentMeter - baseline;
    const remaining = delta == null ? null : Math.max(0, pmInterval - delta);
    const overdueBy = delta == null ? null : Math.max(0, delta - pmInterval);
    return { currentMeter, baseline, pmInterval, meterUnit, remaining, overdueBy };
  };
  const pmDueForUnit = (unit: Unit) => {
    const summary = meterSummaryForUnit(unit);
    return summary.currentMeter != null && summary.currentMeter - summary.baseline >= summary.pmInterval;
  };
  const filteredUnits = unitData.filter((unit) =>
    (!pmDueOnly || pmDueForUnit(unit)) && `${unit.unit} ${unit.vin} ${unit.client}`
      .toLowerCase()
      .includes(unitSearch.toLowerCase()),
  );
  const filteredClients = useMemo(() => clientData.filter((client) => client.toLowerCase().includes(clientSearch.toLowerCase())), [clientData, clientSearch]);
  if (!clientReady) {
    return <main className="login-shell" aria-label="Loading RPM Diesel dashboard" />;
  }
  if (!activeUser) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <Image className="login-logo" src="/logo3.png" alt="RPM Diesel logo" width={96} height={72} priority />
          <p className="card-kicker">RPM DIESEL</p>
          <h1>{t("loginTitle")}</h1>
          <p className="login-subtitle">{t("loginSubtitle")}</p>
          <form onSubmit={signIn} className="login-form">
            <label>{t("name")}<CustomSelect value={loginName} onChange={setLoginName} options={accounts.map((account) => ({ value: account.name, label: account.name }))} /></label>
            <label>{t("password")}<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" /></label>
            {loginError && <div className="login-error" role="alert"><strong>{language === "en" ? "Invalid password" : "Mot de passe invalide"}</strong><span>{t("invalidLogin")}</span></div>}
            <button className="primary-button" type="submit">{t("signIn")}</button>
          </form>
          <button className="language-button login-language" onClick={toggleLanguage}>{language === "en" ? "FR" : "EN"}</button>
        </div>
      </main>
    );
  }
  const activeJob = detailJobId
    ? jobData.find((job) => job.id === detailJobId)
    : undefined;
  const activeJobPunches = timeEntries.filter((entry) => entry.workOrderId === activeJob?.id)
    .sort((left, right) => new Date(right.clockIn).getTime() - new Date(left.clockIn).getTime());
  const visibleWorkOrderPunches = showAllWorkOrderPunches ? activeJobPunches : activeJobPunches.slice(0, 4);
  const recentJobs = [...jobData].sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0)).slice(0, 3);
  const workedHoursFor = (workOrderId: string) => timeEntries.filter((entry) => entry.workOrderId === workOrderId).reduce((total, entry) => total + (entry.totalHours ?? Math.max(0, (Date.now() - new Date(entry.clockIn).getTime()) / 3600000)), 0).toFixed(2);
  const punchDayKey = (iso: string) => {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const periodStart = new Date(`${punchAnchorDate}T12:00:00`);
  periodStart.setHours(0, 0, 0, 0);
  if (punchPeriod === "week") {
    const day = periodStart.getDay();
    periodStart.setDate(periodStart.getDate() - (day === 0 ? 6 : day - 1));
  } else if (punchPeriod === "month") {
    periodStart.setDate(1);
  }
  const periodEnd = new Date(periodStart);
  if (punchPeriod === "day") periodEnd.setDate(periodEnd.getDate() + 1);
  else if (punchPeriod === "week") periodEnd.setDate(periodEnd.getDate() + 7);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);
  const scopedTimeEntries = currentAccount?.role === "Admin" && adminSeeAllPunches
    ? timeEntries.filter((entry) => adminPunchFilter === "all" || entry.userId === adminPunchFilter)
    : timeEntries.filter((entry) => entry.userId === activeUser);
  const periodTimeEntries = scopedTimeEntries
    .filter((entry) => {
      const timestamp = new Date(entry.clockIn).getTime();
      return timestamp >= periodStart.getTime() && timestamp < periodEnd.getTime();
    })
    .sort((left, right) => new Date(right.clockIn).getTime() - new Date(left.clockIn).getTime());
  const visibleTimeEntries = periodTimeEntries;
  const punchGroups = Array.from(new Set(periodTimeEntries.map((entry) => punchDayKey(entry.clockIn)))).map((dayKey) => ({
    dayKey,
    entries: periodTimeEntries.filter((entry) => punchDayKey(entry.clockIn) === dayKey),
  }));
  const longPunchEntries = timeEntries.filter((entry) => entry.userId === activeUser && entry.workOrderId && entry.totalHours != null && entry.totalHours >= 7);
  const visibleLongPunchEntries = longPunchEntries.filter((entry) => !dismissedLongPunchIds.includes(entry.id));
  const dismissLongPunchAlert = () => setDismissedLongPunchIds((current) => Array.from(new Set([...current, ...longPunchEntries.map((entry) => entry.id)])));
  const isAlertDismissed = (key: string) => dismissedAlerts.has(key);
  const dismissAlert = (key: string) => setDismissedAlerts((current) => new Set(current).add(key));
  const syncUnitFromJob = (
    job: Job,
    status: JobStatus = job.status,
    usage = job.usage,
  ) => {
    setUnitData((current) =>
      current.map((unit) =>
        unit.unit === job.unit && unit.client === job.client
          ? {
              ...unit,
              client: job.client,
              usage,
              updatedAt: new Date().toISOString(),
              ...(status === "Completed"
                ? {
                    service: new Date().toISOString().slice(0, 10),
                    overdue: false,
                  }
                : {}),
            }
          : unit,
      ),
    );
  };
  const setStatus = (id: string, status: JobStatus) => {
    const job = jobData.find((item) => item.id === id);
    if (job && status === "Completed" && job.status !== "Completed") {
      setDetailJobId(id);
      setCompletionPrompt({ job, reading: job.meterReading == null ? "" : String(job.meterReading) });
      return;
    }
    if (job) syncUnitFromJob(job, status);
    if (job) void writeActivityLog(activeUser ?? "Unknown", "status_changed", "work_order", id, { status });
    if (!job) return;
    const updatedJob = { ...job, status, updated: "Just now", updatedAt: new Date().toISOString() };
    setJobData((current) => current.map((item) => item.id === id ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => reportActionError(`Work order update failed: ${error.message}`));
  };
  const updateJobRecord = (job: Job, field: "tech" | "priority" | "status" | "usage" | "issue", value: string) => {
    if (isMissingUnit(job.unit, job.client)) {
      reportActionError(language === "en"
        ? `Work order ${job.id} cannot be edited until unit ${job.unit} is restored or relinked.`
        : `L'ordre ${job.id} ne peut pas être modifié tant que l'unité ${job.unit} n'est pas restaurée ou reliée.`);
      return job;
    }
    const updatedJob = { ...job, [field]: value, updated: "Just now", updatedAt: new Date().toISOString() } as Job;
    setJobData((current) => current.map((item) => item.id === job.id ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => reportActionError(`Work order update failed: ${error.message}`));
    return updatedJob;
  };
  const openModal = (kind: "job" | "unit") => {
    setWorkOrderUnitSearch("");
    setWorkOrderUnitPickerOpen(false);
    setForm({
      unit: "",
      client: "",
      vin: "",
      type: "",
      issue: "",
      service: "",
      usage: "",
      meterReading: "",
      currentMeter: "",
      lastPmMeter: "",
      pmInterval: "25000",
      meterUnit: "KM",
      tech: "Unassigned",
      priority: "Normal",
      status: "In Progress",
    });
    setEditingUnitId(null);
    setReturnToJob(false);
    setModal(kind);
  };
  const openJobDetails = (job: Job) => {
    setDetailJobId(job.id);
    setShowAllWorkOrderPunches(false);
    setNoteText("");
    setEditingWorkOrderTitle(false);
    setWorkOrderTitleDraft(job.issue);
    setLineItem({ kind: "Part", partNumber: "", description: "", quantity: "1", amount: "" });
    setModal("detail");
  };
  const openUnitEditor = (unit: Unit) => {
    if (modal === "history") return;
    const storedMeter = meterOverrides[unitKey(unit)];
    setEditingUnitId(unitKey(unit));
    setUnitNoteText("");
    setForm({
      unit: unit.unit,
      client: unit.client,
      vin: unit.vin,
      type: unit.type,
      issue: "",
      service: unit.service,
      usage: unit.usage,
      meterReading: "",
      currentMeter: (storedMeter?.currentMeter ?? unit.currentMeter) == null ? "" : String(storedMeter?.currentMeter ?? unit.currentMeter),
      lastPmMeter: (storedMeter?.lastPmMeter ?? unit.lastPmMeter) == null ? "" : String(storedMeter?.lastPmMeter ?? unit.lastPmMeter),
      pmInterval: String(storedMeter?.pmInterval ?? unit.pmInterval ?? 25000),
      meterUnit: storedMeter?.meterUnit ?? unit.meterUnit,
      tech: "Unassigned",
      priority: "Normal",
      status: "In Progress",
    });
    setModal("unit");
  };
  const saveUnitNote = async (unit: Unit) => {
    const text = unitNoteText.trim();
    if (!text || !activeUser) return;
    try {
      const noteId = await writeActivityLog(activeUser, "unit_note_added", "unit", unitKey(unit), { text });
      const note: UnitNote = { id: noteId ?? `note-${createId()}`, text, author: activeUser, createdAt: new Date().toISOString() };
      setUnitNotes((current) => ({ ...current, [unitKey(unit)]: [...(current[unitKey(unit)] ?? []), note] }));
      setUnitNoteText("");
    } catch (error) {
      reportActionError(`Unit note was not saved: ${(error as Error).message}`);
    }
  };
  const saveUnitNoteForKey = async (key: string) => {
    const unit = unitData.find((candidate) => unitKey(candidate) === key);
    if (unit) await saveUnitNote(unit);
  };
  const updateUnitNoteForKey = (key: string, noteId: string, text: string) => {
    if (!isAdmin) return;
    setUnitNotes((current) => ({ ...current, [key]: (current[key] ?? []).map((note) => (note.id === noteId ? { ...note, text } : note)) }));
  };
  const commitUnitNoteEdit = async (key: string, noteId: string, text: string) => {
    if (!isAdmin || !activeUser) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await writeActivityLog(activeUser, "unit_note_updated", "unit", key, { noteId, text: trimmed });
    } catch (error) {
      reportActionError(`Unit note edit was not saved: ${(error as Error).message}`);
    }
  };
  const deleteUnitNoteForKey = async (key: string, noteId: string) => {
    if (!isAdmin || !activeUser) return;
    setUnitNotes((current) => ({ ...current, [key]: (current[key] ?? []).filter((note) => note.id !== noteId) }));
    try {
      await writeActivityLog(activeUser, "unit_note_deleted", "unit", key, { noteId });
    } catch (error) {
      reportActionError(`Unit note delete was not saved: ${(error as Error).message}`);
    }
  };
  const openUnitHistory = (unit: Unit) => { setHistoryUnit(unit); setEditingUnitId(null); setModal("history"); };
  const closeModal = () => setModal(null);
  const updateForm = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const beginAddUnitInline = () => {
    // Defer the modal swap so an iOS ghost-click can't land on whatever is revealed underneath mid-gesture.
    if (modalSwitchTimer.current) window.clearTimeout(modalSwitchTimer.current);
    modalSwitchTimer.current = window.setTimeout(() => {
      setReturnToJob(true);
      setModal("unit");
    }, 0);
  };
  const selectUnit = (value: string) => {
    if (value === "__add_new_unit__") {
      beginAddUnitInline();
      return;
    }
    const normalizedValue = value.trim().toLowerCase();
    const selectedUnit = unitData.find((unit) =>
      unit.unit.toLowerCase() === normalizedValue
      || unit.client.toLowerCase() === normalizedValue
      || `${unit.unit} · ${unit.client}`.toLowerCase() === normalizedValue,
    );
    setForm((current) => ({
      ...current,
      unit: selectedUnit?.unit ?? value,
      client: selectedUnit?.client ?? "",
      usage: selectedUnit?.usage ?? "",
      meterReading: selectedUnit?.currentMeter == null ? "" : String(selectedUnit.currentMeter),
      meterUnit: selectedUnit?.meterUnit ?? current.meterUnit,
    }));
  };
  const saveNote = () => {
    if (!detailJobId || !noteText.trim()) return;
    const job = jobData.find((item) => item.id === detailJobId);
    if (!job) return;
    const note: Note = {
      id: createId(),
      text: noteText.trim(),
      author: activeUser ?? "RPM Diesel",
      createdAt: new Date().toISOString(),
    };
    const updatedJob = { ...job, notes: [...(job.notes ?? []), note], updated: "Just now", updatedAt: new Date().toISOString() };
    setJobData((current) => current.map((item) => item.id === detailJobId ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => reportActionError(`Note was not saved: ${error.message}`));
    setNoteText("");
  };
  const canManageNote = (note?: Note) => canManageWorkOrders || note?.author === activeUser;
  const updateNote = (noteId: string, text: string) => {
    const job = jobData.find((item) => item.id === detailJobId);
    if (!job) return;
    const updatedJob = { ...job, notes: (job.notes ?? []).map((note) => note.id === noteId && canManageNote(note) ? { ...note, text } : note), updatedAt: new Date().toISOString() };
    setJobData((current) => current.map((item) => item.id === detailJobId ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => reportActionError(`Note update failed: ${error.message}`));
  };
  const deleteNote = (noteId: string) => {
    const job = jobData.find((item) => item.id === detailJobId);
    if (!job) return;
    const updatedJob = { ...job, notes: (job.notes ?? []).filter((note) => note.id !== noteId || !canManageNote(note)), updatedAt: new Date().toISOString() };
    setJobData((current) => current.map((item) => item.id === detailJobId ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => reportActionError(`Note delete failed: ${error.message}`));
  };
  const saveLineItem = () => {
    if (!detailJobId || !lineItem.description.trim())
      return;
    const item: LineItem = {
      id: createId(),
      kind: "Part",
      partNumber: lineItem.partNumber.trim(),
      description: lineItem.description.trim(),
      quantity: Number(lineItem.quantity) || 1,
      amount: Number(lineItem.amount) || 0,
    };
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              lineItems: [...(job.lineItems ?? []), item],
              updated: "Just now",
            }
          : job,
      ),
    );
    setLineItem({ kind: "Part", partNumber: "", description: "", quantity: "1", amount: "" });
  };
  const updateLineItem = (
    itemId: string,
    field: keyof LineItem,
    value: string,
  ) =>
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              lineItems: (job.lineItems ?? []).map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      [field]:
                        field === "quantity" || field === "amount"
                          ? Number(value) || 0
                          : value,
                    }
                  : item,
              ),
            }
          : job,
      ),
    );
  const deleteLineItem = (itemId: string) =>
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              lineItems: (job.lineItems ?? []).filter(
                (item) => item.id !== itemId,
              ),
            }
          : job,
      ),
    );
  const updateJob = async (
    field: "tech" | "priority" | "status" | "usage" | "issue",
    value: string,
  ) => {
    if (!detailJobId) return;
    const job = jobData.find((item) => item.id === detailJobId);
    if (!job) return;
    if (field === "status" && value === "Completed" && job.status !== "Completed") {
      setCompletionPrompt({ job, reading: job.meterReading == null ? "" : String(job.meterReading) });
      return;
    }
    if (field === "status" || field === "usage")
      syncUnitFromJob(
        job,
        field === "status" ? (value as JobStatus) : job.status,
        field === "usage" ? value : job.usage,
      );
    updateJobRecord(job, field, value);
  };
  const completeJobWithMeter = async () => {
    if (!completionPrompt) return;
    const validation = validateCompletion({ meterReading: completionPrompt.reading, unit: completionPrompt.job.unit, status: "Completed" });
    if (!validation.valid) {
      reportActionError(validation.errors.join(" "));
      return;
    }
    const reading = Number(completionPrompt.reading);
    const updatedJob = { ...completionPrompt.job, status: "Completed" as JobStatus, meterReading: reading, updated: "Just now", updatedAt: new Date().toISOString() };
    const unit = unitData.find((item) => item.unit === updatedJob.unit && item.client === updatedJob.client);
    try {
      await saveJobs([updatedJob]);
    } catch (error) {
      reportActionError(`Work order completion failed: ${(error as Error).message}`);
      return;
    }
    setJobMeterOverrides((current) => ({ ...current, [updatedJob.id]: reading }));
    setJobData((current) => current.map((item) => item.id === updatedJob.id ? updatedJob : item));
    if (unit) setUnitData((current) => current.map((item) => item.unit === unit.unit && item.client === unit.client ? { ...item, currentMeter: reading, overdue: reading - (item.lastPmMeter ?? item.currentMeter ?? reading) >= (item.pmInterval ?? 25000) } : item));
    setCompletionPrompt(null);
  };
  const deleteJob = async (id: string) => {
    if (!canManageWorkOrders || !confirmDeletion("workOrder")) return;
    try {
      await removeJob(id);
    } catch (error) {
      reportActionError(`Work order deletion failed: ${(error as Error).message}`);
      return;
    }
    setJobData((current) => current.filter((job) => job.id !== id));
    void writeActivityLog(activeUser ?? "Unknown", "deleted", "work_order", id).catch((error: Error) => reportActionError(`Activity log failed: ${error.message}`));
    setModal(null);
    setDetailJobId(null);
  };
  const deleteUnit = async (unitId: string) => {
    if (!isAdmin || !confirmDeletion("unit")) return;
    const unit = unitData.find((item) => unitKey(item) === unitId);
    if (!unit) return;
    const linkedWorkOrder = jobData.find((job) => job.unit === unit.unit && job.client === unit.client);
    if (linkedWorkOrder) {
      reportActionError(language === "en"
        ? `This unit cannot be deleted because it is referenced by work order ${linkedWorkOrder.id}. Archive it instead.`
        : `Cette unité ne peut pas être supprimée car elle est liée à l'ordre ${linkedWorkOrder.id}. Archivez-la plutôt.`);
      return;
    }
    try {
      await removeUnit(unit.unit, unit.client);
    } catch (error) {
      reportActionError(`Unit deletion failed: ${(error as Error).message}`);
      return;
    }
    setUnitData((current) => current.filter((item) => unitKey(item) !== unitId));
    void writeActivityLog(activeUser ?? "Unknown", "deleted", "unit", unit.unit).catch((error: Error) => reportActionError(`Activity log failed: ${error.message}`));
    setModal(null);
    setEditingUnitId(null);
  };
  const togglePm = (target: Unit) =>
    setUnitData((current) =>
      current.map((unit) =>
        unit.unit === target.unit && unit.client === target.client ? { ...unit, overdue: !unit.overdue } : unit,
      ),
    );
  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const armed = submitArmedRef.current;
    submitArmedRef.current = false;
    // Reject a submit that wasn't preceded by a real pointerdown/Enter on the submit control: an iOS ghost click can fire a synthetic click on the submit button once a picker option underneath it is removed mid-gesture.
    if (!armed) return;
    // Belt-and-suspenders: iOS can dispatch a fully-formed synthetic pointerdown/click pair as part of the
    // same ghost-click sequence, which would satisfy the check above too. A real user needs noticeably longer
    // than this to move their finger off a picker and deliberately tap submit.
    if (Date.now() - pickerActivityRef.current < 400) return;
    if (submitting) return;
    setSubmitting(true);
    try {
    if (modal === "job") {
      const openingMeter = Number(form.meterReading);
      if (!form.unit.trim() || !workOrderUnitSearch.trim()) {
        reportActionError(language === "en" ? "Select a fleet unit before creating the work order." : "Sélectionnez une unité avant de créer l'ordre de travail.");
        return;
      }
      if (!unitData.some((unit) => unit.unit === form.unit && unit.client === form.client)) {
        // No DB-level FK enforces this anymore (unit numbers repeat across clients), so a real, unambiguous unit must be re-validated here.
        reportActionError(language === "en" ? "That unit/client combination could not be found. Re-select the fleet unit." : "Cette combinaison d'unité et de client est introuvable. Resélectionnez l'unité.");
        return;
      }
      if (!form.meterReading.trim() || !Number.isFinite(openingMeter) || openingMeter < 0) {
        reportActionError(language === "en" ? "Enter a valid opening meter reading." : "Entrez une lecture de compteur valide à l'ouverture.");
        return;
      }
      if (!form.issue.trim()) {
        reportActionError(language === "en" ? "Enter a service request before creating the work order." : "Entrez une demande de service avant de créer l'ordre de travail.");
        return;
      }
      const newJob: Job = {
        id: `WO-${Date.now()}-${createId().slice(0, 8)}`,
        unit: form.unit,
        client: form.client,
        tech: form.tech,
        priority: form.priority,
        status: form.status,
        issue: form.issue,
        updated: "Just now",
        usage: form.usage,
        meterReading: openingMeter,
        notes: [],
        lineItems: [],
        updatedAt: new Date().toISOString(),
      };
      try {
        await saveJobs([newJob]);
      } catch (error) {
        reportActionError(`Work order was not saved: ${(error as Error).message}`);
        return;
      }
      setJobData((current) => [newJob, ...current]);
      setJobMeterOverrides((current) => ({ ...current, [newJob.id]: newJob.meterReading ?? Number(form.meterReading) }));
      const linkedUnit = unitData.find((unit) => unit.unit === newJob.unit && unit.client === newJob.client);
      if (linkedUnit && Number.isFinite(openingMeter)) {
        const pmBaseline = linkedUnit.lastPmMeter ?? linkedUnit.currentMeter ?? openingMeter;
        const pmOverdue = openingMeter - pmBaseline >= (linkedUnit.pmInterval ?? 25000);
        const updatedUnit = { ...linkedUnit, currentMeter: openingMeter, overdue: pmOverdue };
        setUnitData((current) => current.map((unit) => unit.unit === updatedUnit.unit && unit.client === updatedUnit.client ? updatedUnit : unit));
        setMeterOverrides((current) => ({ ...current, [unitKey(updatedUnit)]: { currentMeter: updatedUnit.currentMeter, lastPmMeter: updatedUnit.lastPmMeter, pmInterval: updatedUnit.pmInterval, meterUnit: updatedUnit.meterUnit } }));
        void saveUnits([updatedUnit]).catch((error: Error) => reportActionError(`Unit meter update failed: ${error.message}`));
      }
      syncUnitFromJob(newJob, newJob.status, newJob.usage);
      void writeActivityLog(activeUser ?? "Unknown", "created", "work_order", newJob.id, { unit: newJob.unit });
      setSection("jobs");
    }
    if (modal === "unit") {
      const trimmedUnitId = form.unit.trim();
      const trimmedClient = form.client.trim();
      if (!editingUnitId && unitData.some((unit) => unit.unit === trimmedUnitId && unit.client === trimmedClient)) {
        reportActionError(language === "en"
          ? `Unit "${trimmedUnitId}" already exists for ${trimmedClient || "this client"}. Edit that unit directly instead of adding it again.`
          : `L'unité « ${trimmedUnitId} » existe déjà pour ${trimmedClient || "ce client"}. Modifiez cette unité au lieu de l'ajouter à nouveau.`);
        return;
      }
      const existingUnit = editingUnitId ? unitData.find((unit) => unitKey(unit) === editingUnitId) : undefined;
      const currentMeter = form.currentMeter ? Number(form.currentMeter) : null;
      const pmInterval = Number(form.pmInterval) || 25000;
      const lastPmMeter = editingUnitId
        ? (form.lastPmMeter ? Number(form.lastPmMeter) : existingUnit?.lastPmMeter ?? currentMeter)
        : currentMeter;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const lastServiceMeterChanged = Boolean(editingUnitId && form.lastPmMeter && Number(form.lastPmMeter) !== existingUnit?.lastPmMeter);
      const newUnit = {
        unit: form.unit,
        vin: form.vin,
        client: form.client,
        type: form.type || "Fleet unit",
        service: lastServiceMeterChanged ? today : (form.service || "Not serviced yet"),
        due: "Schedule PM",
        overdue: currentMeter != null && lastPmMeter != null ? currentMeter - lastPmMeter >= pmInterval : false,
        usage: form.currentMeter ? `${form.currentMeter} ${form.meterUnit}` : "Not recorded",
        currentMeter,
        lastPmMeter,
        pmInterval,
        meterUnit: form.meterUnit,
        updatedAt: new Date().toISOString(),
      };
      setMeterOverrides((current) => ({ ...current, [unitKey(newUnit)]: { currentMeter: newUnit.currentMeter, lastPmMeter: newUnit.lastPmMeter, pmInterval: newUnit.pmInterval, meterUnit: newUnit.meterUnit } }));
      try {
        if (editingUnitId) {
          await saveUnits([newUnit]);
        } else {
          await saveUnits([newUnit]);
        }
      } catch (error) {
        reportActionError(`Unit was not saved: ${(error as Error).message}`);
        return;
      }
      setUnitData((current) =>
        editingUnitId
          ? current.map((unit) =>
              unitKey(unit) === editingUnitId ? newUnit : unit,
            )
          : [newUnit, ...current],
      );
      void writeActivityLog(activeUser ?? "Unknown", editingUnitId ? "updated" : "created", "unit", newUnit.unit);
      if (returnToJob) {
        setForm((current) => ({
          ...current,
          unit: newUnit.unit,
          client: newUnit.client,
          meterReading: newUnit.currentMeter == null ? current.meterReading : String(newUnit.currentMeter),
          meterUnit: newUnit.meterUnit,
          usage: newUnit.usage,
        }));
        setWorkOrderUnitSearch(newUnit.unit);
        setWorkOrderUnitPickerOpen(false);
        setReturnToJob(false);
        setModal("job");
        return;
      }
      setSection("units");
    }
    closeModal();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-lockup brand-home-button" onClick={() => { setSection("overview"); closeModal(); }} aria-label="Go to dashboard overview">
          <Image
            className="brand-logo"
            src="/logo3.png"
            alt="RPM Diesel logo"
            width={72}
            height={48}
            priority
          />
          <span className="brand-name">
            RPM <strong className="brand-diesel">DIESEL</strong>
          </span>
        </button>
        <div className="topbar-actions">
          <ThemeToggle language={language} />
          <button className="language-button" onClick={toggleLanguage} aria-label={t("language")}>{language === "en" ? "FR" : "EN"}</button>
          <span className="profile-name">{activeUser}</span>
          <div className="profile-menu-wrap">
            <button className="avatar" onClick={() => setProfileMenuOpen((open) => !open)} title={`${t("signedInAs")} ${activeUser}`}>{activeUser.slice(0, 2).toUpperCase()}</button>
            {profileMenuOpen && <div className="profile-menu">
              {activeUser && <>
                <button className="profile-menu-item" onClick={() => { setPasswordEditorOpen((open) => !open); setPasswordError(""); }}>{t("changePassword")}</button>
                {passwordEditorOpen && <div className="password-editor">
                  <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t("currentPassword")} aria-label={t("currentPassword")} />
                  <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder={t("newPassword")} aria-label={t("newPassword")} />
                  <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t("confirmPassword")} aria-label={t("confirmPassword")} />
                  {passwordError && <small className="password-error">{passwordError}</small>}
                  <button className="primary-button" onClick={changeOwnPassword}>{t("updatePassword")}</button>
                </div>}
              </>}
              <button className="profile-menu-item profile-signout" onClick={signOut}>{t("signOut")}</button>
            </div>}
          </div>
        </div>
      </header>
      <div className="dashboard-layout">
        <aside className="sidebar">
          <p className="sidebar-label">{t("workspace")}</p>
          <nav className="sidebar-nav">
            {visibleNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`nav-item ${section === item.id ? "nav-item-active" : ""}`}
                aria-current={section === item.id ? "page" : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {t(item.label)}
              </button>
            ))}
          </nav>
          <div className={`sidebar-footer ${cloudError || !hasSupabaseConfig ? "sync-offline" : ""}`}>
            <span className="online-dot" aria-hidden="true" />
            <div>
              <b>{!hasSupabaseConfig ? (language === "en" ? "Local workspace" : "Espace local") : cloudError ? (language === "en" ? "Sync interrupted" : "Synchro interrompue") : cloudLoading ? (language === "en" ? "Synchronizing" : "Synchronisation") : (language === "en" ? "Cloud connected" : "Connecté au cloud")}</b>
              <small>RPM DIESEL / {language === "en" ? "OPERATIONS" : "OPÉRATIONS"}</small>
            </div>
          </div>
        </aside>
        <main className="main-content">
          {!hasSupabaseConfig && <div className="cloud-banner cloud-warning">{t("cloudNotConfigured")}</div>}
          {cloudError && <div className="cloud-banner cloud-warning">{cloudError}</div>}
          {actionError && <div className="cloud-banner cloud-error" role="alert">{actionError}</div>}
          {cloudLoading && <div className="dashboard-sync-indicator"><span className="sync-pulse" /> {language === "en" ? "Syncing fleet data" : "Synchronisation des données de flotte"}</div>}
          <button className="mobile-nav-toggle" type="button" onClick={() => setMobileNavOpen((open) => !open)} aria-expanded={mobileNavOpen} aria-label={t("chooseSection")}><Menu size={18} /><b>{t(visibleNavItems.find((item) => item.id === section)?.label ?? "section")}</b></button>
          {mobileNavOpen && <div className="mobile-nav-drawer" role="dialog" aria-label={t("workspace")}><div className="mobile-nav-drawer-header"><b>{t("workspace")}</b><button type="button" onClick={() => setMobileNavOpen(false)} aria-label={t("close")}><X size={18} /></button></div>{visibleNavItems.map((item) => <button key={item.id} type="button" className={`mobile-drawer-item ${section === item.id ? "mobile-drawer-active" : ""}`} onClick={() => { setSection(item.id); setMobileNavOpen(false); }}><span>{item.icon}</span>{t(item.label)}</button>)}</div>}
          <div className="mobile-nav-select">
            <span className="mobile-nav-label">{t("section")}</span>
            <CustomSelect value={section} onChange={(value) => { setSection(value as Section); setMobileNavOpen(false); }} ariaLabel={t("chooseSection")} options={visibleNavItems.map((item) => ({ value: item.id, label: t(item.label) }))} />
          </div>
          <div className="page-heading">
            <div>
              <p className="breadcrumb">
                RPM DIESEL <span>/</span>{" "}
                {t(visibleNavItems.find((item) => item.id === section)?.label ?? "")}
              </p>
              <h1>
                {section === "overview"
                  ? `${greeting}, ${activeUser}`
                  : t(visibleNavItems.find((item) => item.id === section)?.label ?? "")}
              </h1>
            </div>
            <div className="date-chip"><CalendarDays size={14} aria-hidden="true" />{todayLabel}</div>
          </div>
          {section === "overview" && (
            <>
              <div className="operations-alerts">
              {(() => {
                const openTechnicianJobs = jobData.filter((job) => job.tech === activeUser && job.status === "In Progress").length;
                return openTechnicianJobs > 0 && !isAlertDismissed("workload") ? (
                  <div className="alert-banner alert-danger">
                    <span className="alert-icon">!</span>
                    <div>
                      <b>{openTechnicianJobs} {workloadAlert.assigned.replace("job(s)", openTechnicianJobs === 1 ? "job" : "jobs").replace("travail(aux)", openTechnicianJobs === 1 ? "travail" : "travaux")}</b>
                      <span>{workloadAlert.continue}</span>
                    </div>
                    <button onClick={openJobsQueue}>{workloadAlert.view}</button>
                    <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("workload")}>×</button>
                  </div>
                ) : null;
              })()}
              {visibleLongPunchEntries.length > 0 && <div className="alert-banner alert-warning">
                <span className="alert-icon">!</span>
                <div>
                  <b>{language === "en" ? `${visibleLongPunchEntries.length} punch${visibleLongPunchEntries.length === 1 ? "" : "es"} exceeds 7.00 hours.` : `${visibleLongPunchEntries.length} poinçon${visibleLongPunchEntries.length === 1 ? "" : "s"} dépasse 7,00 heures.`}</b>
                  <span>{language === "en" ? "Please verify the clock-out time and work order." : "Veuillez vérifier l'heure de dépointage et l'ordre de travail."}</span>
                </div>
                <button onClick={() => setSection("punch")}>{language === "en" ? "Review punches →" : "Vérifier les poinçons →"}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={dismissLongPunchAlert}>×</button>
              </div>}
              {isAdmin && !isAlertDismissed("estimates") && jobData.filter((job) => job.status === "Waiting on Estimates").length > 0 && <div className="alert-banner alert-danger">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Waiting on Estimates").length} {t("adminPendingEstimates")}</b></div>
                <button onClick={() => { setJobFilter("Waiting on Estimates"); setSection("jobs"); }}>{t("reviewEstimates")}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("estimates")}>×</button>
              </div>}
              {isAdmin && !isAlertDismissed("parts") && jobData.filter((job) => job.status === "Waiting on Parts").length > 0 && <div className="alert-banner alert-danger">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Waiting on Parts").length} {t("adminPendingParts")}</b></div>
                <button onClick={() => { setJobFilter("Waiting on Parts"); setSection("jobs"); }}>{t("reviewParts")}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("parts")}>×</button>
              </div>}
              {isAdmin && !isAlertDismissed("invoicing") && jobData.filter((job) => job.status === "Ready for Invoicing").length > 0 && <div className="alert-banner alert-danger">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Ready for Invoicing").length} {t("adminReadyForInvoicing")}</b></div>
                <button onClick={() => { setJobFilter("Ready for Invoicing"); setSection("jobs"); }}>{t("reviewInvoicing")}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("invoicing")}>×</button>
              </div>}
              {!isAlertDismissed("scheduled") && jobData.filter((job) => job.status === "Scheduled").length > 0 && <div className="alert-banner">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Scheduled").length} {t("scheduledJobsNotice")}</b></div>
                <button onClick={() => { setJobFilter("Scheduled"); setSection("jobs"); }}>{t("reviewScheduled")}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("scheduled")}>×</button>
              </div>}
              {!isAlertDismissed("pm") && unitData.filter((unit) => pmDueForUnit(unit)).length > 0 && <div className="alert-banner">
                <span className="alert-icon">!</span>
                <div>
                  <b>{unitData.filter((unit) => pmDueForUnit(unit)).length} {t("overduePm")}</b>
                  <span>{language === "en" ? " Schedule service before they go back on the road." : " Planifiez le service avant leur retour sur la route."}</span>
                </div>
                <button onClick={() => setSection("units")}>{t("reviewUnits")}</button>
                <button className="alert-dismiss" aria-label={t("dismiss")} onClick={() => dismissAlert("pm")}>×</button>
              </div>}
              </div>
              <section className="telemetry-grid" aria-label={t("dashboardOverview")}>
                <TelemetryBlock title={t("workOrders")} label={t("activeJobs")} value={String(jobData.filter((job) => job.status !== "Completed").length)} icon={Wrench} tone="cyan" onOpen={openJobsQueue}>
                  <TelemetrySignal label={t("totalInProgress")} value={jobData.filter((job) => job.status === "In Progress").length} onClick={() => openFilteredQueue("In Progress")} />
                  <TelemetrySignal label={t("waitingParts")} value={jobData.filter((job) => job.status === "Waiting on Parts").length} warning={jobData.some((job) => job.status === "Waiting on Parts")} onClick={() => openFilteredQueue("Waiting on Parts")} />
                  <TelemetrySignal label={t("waitingEstimates")} value={jobData.filter((job) => job.status === "Waiting on Estimates").length} warning={jobData.some((job) => job.status === "Waiting on Estimates")} onClick={() => openFilteredQueue("Waiting on Estimates")} />
                </TelemetryBlock>
                <TelemetryBlock title={t("fleetHealth")} label={t("totalUnits")} value={String(unitData.length)} icon={Truck} tone="green" onOpen={() => { setPmDueOnly(false); setSection("units"); }}>
                  <TelemetrySignal label={t("pmCompliance")} value={unitData.length ? `${Math.round(((unitData.length - unitData.filter((unit) => pmDueForUnit(unit)).length) / unitData.length) * 1000) / 10}%` : t("noData")} onClick={() => { setPmDueOnly(false); setSection("units"); }} />
                  <TelemetrySignal label={t("overduePm")} value={unitData.filter((unit) => pmDueForUnit(unit)).length} warning={unitData.some((unit) => pmDueForUnit(unit))} onClick={() => { setPmDueOnly(true); setSection("units"); }} />
                  <TelemetrySignal label={language === "en" ? "Ready for invoicing" : "Prêts à facturer"} value={jobData.filter((job) => job.status === "Ready for Invoicing").length} onClick={() => openFilteredQueue("Ready for Invoicing")} />
                </TelemetryBlock>
                <TelemetryBlock title={t("fieldOperations")} label={language === "en" ? "Active technicians" : "Techniciens actifs"} value={String(new Set(jobData.filter((job) => job.status !== "Completed" && job.tech !== "Unassigned" && timeEntries.some((entry) => entry.status === "active" && entry.userName === job.tech)).map((job) => job.tech)).size)} icon={Activity} tone="amber" onOpen={() => setSection("punch")}>
                  <TelemetrySignal label={t("unassignedCalls")} value={jobData.filter((job) => job.tech === "Unassigned" && job.status !== "Completed").length} warning={jobData.some((job) => job.tech === "Unassigned" && job.status !== "Completed")} onClick={() => openFilteredQueue("All", "Unassigned")} />
                  <TelemetrySignal label={t("Scheduled")} value={jobData.filter((job) => job.status === "Scheduled").length} onClick={() => openFilteredQueue("Scheduled")} />
                  <TelemetrySignal label={t("Completed")} value={jobData.filter((job) => job.status === "Completed").length} onClick={() => openFilteredQueue("Completed")} />
                </TelemetryBlock>
              </section>
              <section className="bottom-grid">
                <div className="section-card activity-card">
                  <div className="card-heading">
                    <div>
                      <p className="card-kicker">{t("recentActivity")}</p>
                      <h2>{t("latestUpdates")}</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={openJobsQueue}
                    >
                      {t("viewAll")}
                    </button>
                  </div>
                  {recentJobs.map((job, index) => (
                    <div className="activity-row" key={job.id}>
                      <span className={`activity-mark mark-${index}`} />
                      <div className="activity-copy">
                        <p>
                          <b>{unitLabelForJob(job.unit, job.client)}</b> {language === "en" ? "is assigned to" : "est assigné à"} <b>{job.tech}</b>
                        </p>
                        <span>
                          {job.issue}
                        </span>
                        <ActivityTimestamp updatedAt={job.updatedAt} language={language} />
                      </div>
                      <StatusPill status={job.status} language={language} />
                    </div>
                  ))}
                </div>
                <div className="section-card quick-card">
                  <p className="card-kicker">{t("quickActions")}</p>
                  <h2>{t("quickQuestion")}</h2>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); openModal("job"); }}
                    className="quick-action"
                  >
                    <Plus size={18} aria-hidden="true" />
                    <span>
                      <b>{t("createWorkOrder")}</b>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => openModal("unit")}
                    className="quick-action"
                  >
                    <Truck size={18} aria-hidden="true" />
                    <span>
                      <b>{t("addUnit")}</b>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </section>
            </>
          )}
          {section === "punch" && (
            <section className="section-card full-card punch-page-card">
              <div className="toolbar"><div><p className="card-kicker">{t("punchClock")}</p><h2>{t("punchClock")}</h2></div></div>
              <p className="punch-page-copy">{t("punchSubtitle")}</p>
              <PunchClock
                activeEntry={activeTimeEntry}
                jobs={jobData}
                language={language}
                onClockIn={clockIn}
                onClockOut={clockOut}
                onStartBreak={startBreak}
                onEndBreak={endBreak}
              />
              {canManageWorkOrders && <><div className="manual-time-card"><div className="detail-section-heading"><h3>{t("addTechnicianTime")}</h3></div><div className="manual-time-form"><CustomSelect value={manualTimeUser} onChange={setManualTimeUser} ariaLabel={t("technician")} placeholder={t("technician")} options={userAccounts.filter((account) => account.active && account.isTechnician).map((account) => ({ value: account.name, label: account.name }))} /><CustomSelect value={manualTimeJob} onChange={setManualTimeJob} ariaLabel={t("workOrder")} placeholder={t("noData")} options={jobData.filter((job) => job.status !== "Completed").map((job) => ({ value: job.id, label: `${job.unit} · ${job.client} · ${job.issue}` }))} /><input type="number" min="0.01" step="0.01" value={manualTimeHours} onChange={(event) => setManualTimeHours(event.target.value)} placeholder={t("hoursDecimal")} aria-label={t("hoursDecimal")} /><button className="primary-button" onClick={addManualTime}>{t("add")}</button></div></div><div className="manual-time-card"><div className="detail-section-heading"><h3>{t("manageLivePunches")}</h3></div><div className="manual-time-form"><CustomSelect value={adminPunchUser} onChange={setAdminPunchUser} ariaLabel={t("technician")} placeholder={t("technician")} options={userAccounts.filter((account) => account.active && account.isTechnician).map((account) => ({ value: account.name, label: account.name }))} /><CustomSelect value={adminPunchJob} onChange={setAdminPunchJob} ariaLabel={t("workOrder")} placeholder={t("noData")} options={jobData.filter((job) => job.status !== "Completed").map((job) => ({ value: job.id, label: `${job.unit} · ${job.client} · ${job.issue}` }))} /><button className="primary-button" disabled={!adminPunchUser || !adminPunchJob} onClick={adminClockIn}>{t("clockInTechnician")}</button></div><div className="admin-active-punches">{timeEntries.filter((entry) => entry.status === "active" && entry.userId !== activeUser).map((entry) => { const linkedJob = jobData.find((job) => job.id === entry.workOrderId); const linkedUnit = linkedJob ? unitData.find((unit) => unit.unit === linkedJob.unit && unit.client === linkedJob.client) : undefined; const jobLabel = linkedJob ? `${linkedJob.unit} · ${linkedJob.client}${linkedUnit?.type ? ` · ${linkedUnit.type}` : ""}` : t("noData"); return <div className="admin-active-punch" key={entry.id}><span><strong>{entry.userName}</strong><small>{jobLabel}</small></span><button className="punch-button punch-out" onClick={() => adminClockOut(entry)}>{t("clockOut")}</button></div>; })}</div></div></>}
              <div className="punch-history-section">
                <div className="detail-section-heading punch-history-heading"><div><h3>{t("punchHistory")}</h3><span>{periodTimeEntries.length} {t("entries")} · {periodStart.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")} - {new Date(periodEnd.getTime() - 86400000).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")}</span></div><div className="punch-history-controls-row"><div className="punch-history-admin-controls">{isAdmin && <><button type="button" className="outline-button" onClick={() => { setAdminSeeAllPunches((current) => !current); setAdminPunchFilter("all"); }}>{adminSeeAllPunches ? t("seeMyPunches") : t("seeAllPunches")}</button>{adminSeeAllPunches && <CustomSelect value={adminPunchFilter} onChange={setAdminPunchFilter} ariaLabel={t("filterTechnician")} options={[{ value: "all", label: t("filterTechnician") }, ...userAccounts.filter((account) => account.active && account.isTechnician).map((account) => ({ value: account.name, label: account.name }))]} />}</>}</div><div className="punch-period-controls"><button type="button" className="period-nav-button" onClick={() => { const next = new Date(`${punchAnchorDate}T12:00:00`); if (punchPeriod === "week") next.setDate(next.getDate() - 7); else next.setMonth(next.getMonth() - 1); setPunchAnchorDate(next.toISOString().slice(0, 10)); }} aria-label={t("previousPeriod")}>‹</button><input className="punch-date-picker" type="date" value={punchAnchorDate} onChange={(event) => setPunchAnchorDate(event.target.value)} aria-label={t("chooseDate")} /><button type="button" className="period-nav-button" onClick={() => { const next = new Date(`${punchAnchorDate}T12:00:00`); if (punchPeriod === "week") next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1); setPunchAnchorDate(next.toISOString().slice(0, 10)); }} aria-label={t("nextPeriod")}>›</button><CustomSelect className="punch-period-select" value={punchPeriod} onChange={(value) => setPunchPeriod(value as "day" | "week" | "month")} ariaLabel={t("punchHistory")} options={[{ value: "day", label: t("day") }, { value: "week", label: t("week") }, { value: "month", label: t("month") }]} /><button type="button" className="period-today-button" onClick={() => setPunchAnchorDate(new Date().toISOString().slice(0, 10))}>{t("currentPeriod")}</button></div></div></div>
                <div className="punch-day-groups">{punchGroups.map((group) => <div className={`punch-day-group ${group.dayKey === punchDayKey(new Date().toISOString()) ? "punch-day-current" : ""}`} key={group.dayKey}><strong>{group.dayKey === punchDayKey(new Date().toISOString()) ? `${t("today")} · ` : ""}{new Date(`${group.dayKey}T00:00:00`).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" })}</strong><span>{group.entries.length} {t("entries")}</span></div>)}</div>
                <div className="table-wrap"><ResponsiveTable className="punch-history-table"><thead><tr><th>{t("punchedBy")}</th><th>{t("workOrder")}</th><th>{t("clockIn")}</th><th>{t("clockOut")}</th><th>{t("totalHours")}</th><th>{t("status")}</th>{canManageWorkOrders && <th>Break</th>}{canManageWorkOrders && <th>Lost time</th>}{canManageWorkOrders && <th>Reason</th>}{canManageWorkOrders && <th />}</tr></thead><tbody>{visibleTimeEntries.length ? visibleTimeEntries.map((entry) => editingTimeEntryId === entry.id && editingTimeEntry ? <tr key={entry.id} className="time-entry-edit-row"><td><strong>{entry.userName}</strong></td><td>{entry.workOrderId ? (() => { const linkedJob = jobData.find((job) => job.id === entry.workOrderId); return linkedJob ? `${linkedJob.unit} · ${linkedJob.client} · ${linkedJob.issue}` : entry.workOrderId; })() : t("noData")}</td><td><input type="datetime-local" value={toDatetimeLocalValue(editingTimeEntry.clockIn)} onChange={(event) => { const clockIn = fromDatetimeLocalValue(event.target.value) ?? editingTimeEntry.clockIn; const totalHours = editingTimeEntry.clockOut ? Number(((new Date(editingTimeEntry.clockOut).getTime() - new Date(clockIn).getTime()) / 3600000).toFixed(2)) : editingTimeEntry.totalHours; setEditingTimeEntry({ ...editingTimeEntry, clockIn, totalHours }); }} /></td><td><input type="datetime-local" value={toDatetimeLocalValue(editingTimeEntry.clockOut)} onChange={(event) => { const clockOut = fromDatetimeLocalValue(event.target.value); const totalHours = clockOut ? Number(((new Date(clockOut).getTime() - new Date(editingTimeEntry.clockIn).getTime()) / 3600000).toFixed(2)) : editingTimeEntry.totalHours; setEditingTimeEntry({ ...editingTimeEntry, clockOut, status: clockOut ? "completed" : "active", totalHours }); }} /></td><td><input type="number" min="0" step="0.01" value={editingTimeEntry.totalHours ?? ""} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, totalHours: event.target.value ? Number(event.target.value) : null })} /></td><td><span className={`time-status ${editingTimeEntry.status === "active" ? "time-active" : "time-completed"}`}>{editingTimeEntry.status === "active" ? t("activePunch") : t("Completed")}</span></td>{canManageWorkOrders && <td><input type="number" min="0" step="1" value={editingTimeEntry.breakMinutes ?? 0} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, breakMinutes: Number(event.target.value) || 0 })} aria-label="Break minutes" /></td>}{canManageWorkOrders && <td><input type="number" min="0" step="1" value={editingTimeEntry.lostTimeMinutes ?? 0} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, lostTimeMinutes: Number(event.target.value) || 0 })} aria-label="Lost-time minutes" /></td>}{canManageWorkOrders && <td><select value={editingTimeEntry.lostTimeReason ?? ""} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, lostTimeReason: event.target.value || null })} aria-label="Lost-time reason"><option value="">—</option><option>Parts wait</option><option>Traffic</option><option>Admin</option><option>Equipment issue</option><option>Other</option></select></td>}{canManageWorkOrders && <td><div className="time-entry-actions"><button type="button" className="primary-button" onClick={() => void saveTimeEntryEdit()}>{t("save")}</button><button type="button" className="outline-button" onClick={cancelTimeEntryEdit}>{t("cancel")}</button></div></td>}</tr> : <tr key={entry.id}><td><strong>{entry.userName}</strong></td><td>{entry.workOrderId ? (() => { const linkedJob = jobData.find((job) => job.id === entry.workOrderId); return linkedJob ? `${linkedJob.unit} · ${linkedJob.client} · ${linkedJob.issue}` : entry.workOrderId; })() : t("noData")}</td><td>{new Date(entry.clockIn).toLocaleString()}</td><td>{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : t("activePunch")}</td><td>{entry.totalHours == null ? t("activePunch") : `${entry.totalHours.toFixed(2)} h`}</td><td><span className={`time-status ${entry.status === "active" ? "time-active" : "time-completed"}`}>{entry.status === "active" ? t("activePunch") : t("Completed")}</span></td>{canManageWorkOrders && <td>{Math.round(entry.breakMinutes ?? 0)} min</td>}{canManageWorkOrders && <td>{Math.round(entry.lostTimeMinutes ?? 0)} min</td>}{canManageWorkOrders && <td>{entry.lostTimeReason ?? "—"}</td>}{canManageWorkOrders && <td><div className="time-entry-actions"><button type="button" className="outline-button" onClick={() => startTimeEntryEdit(entry)}>{t("edit")}</button><button type="button" className="entry-delete" onClick={() => void deleteTimeEntryRow(entry.id)}>{t("delete")}</button></div></td>}</tr>) : <tr><td colSpan={canManageWorkOrders ? 10 : 6} className="empty-history">{t("noPunches")}</td></tr>}</tbody></ResponsiveTable></div>
              </div>
            </section>
          )}
          {section === "technicianPayroll" && activeUser && !isAdmin && (
            <section className="section-card full-card technician-payroll-card">
              <div className="toolbar my-payroll-toolbar"><div className="punch-history-controls-row"><PayrollPeriodSelect value={payrollPeriodPreset} onChange={changePayrollPeriod} language={language} /></div></div>
              {(() => { const payrollUser = isAdmin ? (myPayrollUser || userAccounts.find((account) => account.active && account.isTechnician)?.name || activeUser) : activeUser; const rows = dailyTimesheetSummary.filter((row) => row.userId === payrollUser && row.workDate >= payrollPeriodStart && row.workDate <= payrollPeriodEnd); const metrics = rows.map((row) => dailyMetrics(row as unknown as Record<string, any>, lunchProposals, timeEntries)); const totals = metrics.reduce((sum, value) => ({ rawHours: sum.rawHours + value.rawHours, breakMinutes: sum.breakMinutes + value.breakMinutes, lostTimeMinutes: sum.lostTimeMinutes + value.lostTimeMinutes, netPayableHours: sum.netPayableHours + value.netPayableHours, billableHours: sum.billableHours + value.billableHours }), { rawHours: 0, breakMinutes: 0, lostTimeMinutes: 0, netPayableHours: 0, billableHours: 0 }); const paidLunchHours = rows.length * 0.5; return <><div className="metrics-grid"><MetricCard label="RAW hours" value={`${totals.rawHours.toFixed(2)} h`} detail="Full day span" tone="blue" icon="◷" /><MetricCard label="Net payable" value={`${(totals.netPayableHours + paidLunchHours).toFixed(2)} h`} detail={`Includes ${paidLunchHours.toFixed(1)} h paid lunch`} tone="green" icon="✓" /><MetricCard label="Billable" value={`${totals.billableHours.toFixed(2)} h`} detail="After lost time" tone="red" icon="!" /><MetricCard label="Breaks / lost time" value={`${Math.round(totals.breakMinutes)} / ${Math.round(totals.lostTimeMinutes)} min`} detail="Recorded for this period" tone="orange" icon="•" /></div><div className="table-wrap admin-summary-table"><ResponsiveTable><thead><tr><th>Day</th><th>RAW</th><th>Net payable</th><th>Billable</th><th>Break</th><th>Lost time</th></tr></thead><tbody>{rows.map((row) => { const value = dailyMetrics(row as unknown as Record<string, any>, lunchProposals, timeEntries); return <tr key={row.workDate}><td>{row.workDate}</td><td>{value.rawHours.toFixed(2)} h</td><td>{(value.netPayableHours + 0.5).toFixed(2)} h</td><td>{value.billableHours.toFixed(2)} h</td><td>{Math.round(value.breakMinutes)} min</td><td>{Math.round(value.lostTimeMinutes)} min</td></tr>; })}</tbody></ResponsiveTable></div>{!rows.length && <p className="empty-history">No payroll entries for this period.</p>}</>; })()}
            </section>
          )}
          {section === "payroll" && isAdmin && (
            <section className="section-card full-card">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">Payroll</p>
                  <h2>Admin Payroll</h2>
                </div>
                <div className="punch-history-controls-row">
                  <PayrollPeriodSelect value={payrollPeriodPreset} onChange={changePayrollPeriod} language={language} />
                  <CustomSelect
                    className="punch-period-select"
                    value={payrollTechFilter[0] ?? "all"}
                    onChange={(value) => setPayrollTechFilter(value === "all" ? [] : [value])}
                    ariaLabel="Technician filter"
                    options={[
                      { value: "all", label: "All technicians" },
                      ...userAccounts.filter((account) => account.active && account.isTechnician).map((account) => ({ value: account.name, label: account.name })),
                    ]}
                  />
                  <button type="button" className="outline-button" onClick={() => setShowPayrollCost((current) => !current)}>{showPayrollCost ? (language === "fr" ? "Masquer les coûts" : "Hide cost") : (language === "fr" ? "Afficher les coûts" : "Show cost")}</button>
                </div>
              </div>
              {payrollLoading ? <p className="empty-history">Loading payroll…</p> : (() => {
                const selectedRows = payrollRows.length ? payrollRows : [];
                if (!selectedRows.length) return <p className="empty-history">No time entries for this period</p>;
                const metricsByDay = new Map(selectedRows.map((row: any) => [`${row.user_id}:${row.work_date}`, dailyMetrics(row, lunchProposals, timeEntries)]));
                const hourlyRateFor = (userId: string) => Number(userAccounts.find((account) => account.name === userId)?.hourlyRate ?? 0);
                const formatCost = (value: number) => showPayrollCost ? `$${value.toFixed(2)}` : "•••";
                const rowsByTech = new Map<string, Array<Record<string, any>>>();
                for (const row of selectedRows) {
                  const tech = String(row.user_name ?? row.user_id ?? "Unknown");
                  const current = rowsByTech.get(tech) ?? [];
                  current.push(row);
                  rowsByTech.set(tech, current);
                }
                const grand = { rawHours: 0, breakMinutes: 0, lostTimeMinutes: 0, netPayableHours: 0, billableHours: 0, cost: 0 };
                const techTotals = Array.from(rowsByTech.entries()).map(([tech, entries]) => {
                  const total = entries.reduce((acc, row) => {
                    const metrics = metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries);
                    acc.rawHours += metrics.rawHours;
                    acc.breakMinutes += metrics.breakMinutes;
                    acc.lostTimeMinutes += metrics.lostTimeMinutes;
                    acc.netPayableHours += metrics.netPayableHours;
                    acc.billableHours += metrics.billableHours;
                    acc.cost += metrics.billableHours * hourlyRateFor(row.user_id);
                    return acc;
                  }, { rawHours: 0, breakMinutes: 0, lostTimeMinutes: 0, netPayableHours: 0, billableHours: 0, cost: 0 });
                  Object.entries(total).forEach(([key, value]) => { (grand as any)[key] += value; });
                  return { tech, total };
                });
                return (
                  <div className="table-wrap admin-summary-table">
                    <ResponsiveTable>
                      <thead>
                        <tr>
                          <th>Technician</th>
                          <th>Day</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Raw</th>
                          <th>Break</th>
                          <th>Lost</th>
                          <th>Net</th>
                          <th>Billable</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRows.map((row: any) => (
                          <tr key={`${row.user_id}-${row.work_date}`}>
                            <td>{row.user_name ?? row.user_id}</td>
                            <td>{row.work_date}{lunchProposals.some((proposal) => proposal.userId === row.user_id && proposal.workDate === row.work_date) && <span title="Auto-detected lunch" style={{ marginLeft: 6, color: "#2563eb" }}>🍽</span>}</td>
                            <td>{formatTorontoTime(row.day_start)}</td>
                            <td>{formatTorontoTime(row.day_end)}</td>
                            <td>{(metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).rawHours.toFixed(2)} h</td>
                            <td>{(metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).breakMinutes.toFixed(0)} min</td>
                            <td>{(metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).lostTimeMinutes.toFixed(0)} min</td>
                            <td>{(metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).netPayableHours.toFixed(2)} h</td>
                            <td>{(metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).billableHours.toFixed(2)} h</td>
                            <td>{formatCost((metricsByDay.get(`${row.user_id}:${row.work_date}`) ?? dailyMetrics(row, lunchProposals, timeEntries)).billableHours * hourlyRateFor(row.user_id))}</td>
                          </tr>
                        ))}
                        {techTotals.map(({ tech, total }) => (
                          <tr key={`subtotal-${tech}`} style={{ fontWeight: 700, background: "rgba(15, 23, 42, 0.03)" }}>
                            <td>{tech}</td>
                            <td>Subtotal</td>
                            <td>—</td>
                            <td>—</td>
                            <td>{total.rawHours.toFixed(2)} h</td>
                            <td>{total.breakMinutes.toFixed(0)} min</td>
                            <td>{total.lostTimeMinutes.toFixed(0)} min</td>
                            <td>{total.netPayableHours.toFixed(2)} h</td>
                            <td>{total.billableHours.toFixed(2)} h</td>
                            <td>{formatCost(total.cost)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 800, background: "rgba(239, 68, 68, 0.08)" }}>
                          <td colSpan={4}>Grand total</td>
                          <td>{grand.rawHours.toFixed(2)} h</td>
                          <td>{grand.breakMinutes.toFixed(0)} min</td>
                          <td>{grand.lostTimeMinutes.toFixed(0)} min</td>
                          <td>{grand.netPayableHours.toFixed(2)} h</td>
                          <td>{grand.billableHours.toFixed(2)} h</td>
                          <td>{formatCost(grand.cost)}</td>
                        </tr>
                      </tbody>
                    </ResponsiveTable>
                  </div>
                );
              })()}
            </section>
          )}
          {section === "profitability" && isAdmin && (
            <section className="section-card full-card">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">{language === "fr" ? "Rentabilité" : "Profitability"}</p>
                  <h2>Profitability</h2>
                </div>
                <div className="punch-history-controls-row">
                  <PayrollPeriodSelect value={payrollPeriodPreset} onChange={changePayrollPeriod} language={language} />
                  <CustomSelect
                    className="punch-period-select"
                    value={payrollTechFilter[0] ?? "all"}
                    onChange={(value) => setPayrollTechFilter(value === "all" ? [] : [value])}
                    ariaLabel="Technician filter"
                    options={[
                      { value: "all", label: "All technicians" },
                      ...userAccounts.filter((account) => account.active && account.isTechnician).map((account) => ({ value: account.name, label: account.name })),
                    ]}
                  />
                  <button type="button" className="outline-button" onClick={() => setShowPayrollCost((current) => !current)}>{showPayrollCost ? (language === "fr" ? "Masquer les coûts" : "Hide cost") : (language === "fr" ? "Afficher les coûts" : "Show cost")}</button>
                </div>
              </div>
              {profitabilityLoading ? <p className="empty-history">{language === "fr" ? "Chargement des données de rentabilité…" : "Loading profitability data…"}</p> : (() => {
                const rateByUser = new Map(profitabilityRows.map((entry: any) => [String(entry.user_id), Number(entry.hourly_rate ?? 0)]));
                const formatCost = (value: number) => showPayrollCost ? `$${value.toFixed(2)}` : "•••";
                const entries = timeEntries.filter((entry) => entry.status === "completed" && torontoDateKey(entry.clockIn) >= payrollPeriodStart && torontoDateKey(entry.clockIn) <= payrollPeriodEnd && Number(entry.lostTimeMinutes ?? 0) > 0).map((entry) => ({ ...entry, user_id: entry.userId, user_name: entry.userName, lost_time_minutes: entry.lostTimeMinutes ?? 0, lost_time_reason: entry.lostTimeReason, hourly_rate: userAccounts.find((account) => account.name === entry.userId)?.hourlyRate ?? rateByUser.get(entry.userId) ?? 0 }));
                const totalLostHours = entries.reduce((sum: number, entry: any) => sum + Number(entry.lost_time_minutes ?? 0) / 60, 0);
                const estimatedCost = entries.reduce((sum: number, entry: any) => sum + ((Number(entry.lost_time_minutes ?? 0) / 60) * Number(entry.hourly_rate ?? 0)), 0);
                const profitabilityMetrics = profitabilitySummaryRows.map((row: any) => dailyMetrics(row, lunchProposals, timeEntries));
                const totalRawHours = profitabilityMetrics.reduce((sum, metrics) => sum + metrics.rawHours, 0);
                const totalBillableHours = profitabilityMetrics.reduce((sum, metrics) => sum + metrics.billableHours, 0);
                const utilizationRate = totalRawHours > 0 ? totalBillableHours / totalRawHours : 0;
                const timeSummaryRows = profitabilitySummaryRows.length ? profitabilitySummaryRows : payrollRows;
                const byReason = Object.entries(entries.reduce((acc: Record<string, { hours: number; cost: number }>, entry: any) => {
                  const reason = String(entry.lost_time_reason || "Unspecified");
                  const hours = Number(entry.lost_time_minutes ?? 0) / 60;
                  const cost = hours * Number(entry.hourly_rate ?? 0);
                  acc[reason] = acc[reason] ? { hours: acc[reason].hours + hours, cost: acc[reason].cost + cost } : { hours, cost };
                  return acc;
                }, {})).sort(([, a], [, b]) => b.hours - a.hours);
                const byTech = Object.entries(entries.reduce((acc: Record<string, { hours: number; cost: number }>, entry: any) => {
                  const tech = String(entry.user_name ?? entry.user_id ?? "Unknown");
                  const hours = Number(entry.lost_time_minutes ?? 0) / 60;
                  const cost = hours * Number(entry.hourly_rate ?? 0);
                  acc[tech] = acc[tech] ? { hours: acc[tech].hours + hours, cost: acc[tech].cost + cost } : { hours, cost };
                  return acc;
                }, {})).sort(([, a], [, b]) => b.hours - a.hours);
                return (
                  <>
                    <div className="metrics-grid">
                      <div className="metric-card"><div className="metric-top"><div><p className="eyebrow">Lost time hours</p><p className="metric-number">{totalLostHours.toFixed(2)} h</p></div><span className="metric-icon metric-red !">!</span></div><p className="metric-detail">Across the selected range</p></div>
                      <div className="metric-card"><div className="metric-top"><div><p className="eyebrow">{language === "fr" ? "Coût du temps perdu" : "Lost-time cost"}</p><p className="metric-number">{formatCost(estimatedCost)}</p></div><span className="metric-icon metric-blue $">$</span></div><p className="metric-detail">{language === "fr" ? "Temps perdu enregistré seulement" : "Recorded lost time only"}</p></div>
                      <div className="metric-card"><div className="metric-top"><div><p className="eyebrow">Utilization</p><p className="metric-number">{(utilizationRate * 100).toFixed(1)}%</p></div><span className="metric-icon metric-green ↗">↗</span></div><p className="metric-detail">Billable / raw hours</p></div>
                    </div>
                      <div className="section-card" style={{ marginTop: 16 }}>
                      <div className="detail-section-heading"><h3>{language === "fr" ? "Repas et temps perdu" : "Lunch & lost time"}</h3></div>
                      <div className="table-wrap"><ResponsiveTable>
                        <thead><tr><th>{t("technician")}</th><th>Date</th><th>{language === "fr" ? "Repas" : "Lunch"}</th><th>{language === "fr" ? "Temps perdu" : "Lost time"}</th><th>{t("status")}</th></tr></thead>
                        <tbody>{timeSummaryRows.map((row: any) => {
                          const metrics = dailyMetrics(row, lunchProposals, timeEntries);
                          const lunch = lunchProposals.find((proposal) => proposal.userId === row.user_id && proposal.workDate === row.work_date);
                          return <tr key={`time-${row.user_id}-${row.work_date}`}>
                            <td>{row.user_name ?? row.user_id}</td><td>{row.work_date}</td>
                            <td>{metrics.breakMinutes} min{lunch && <small>{language === "fr" ? `Repas détecté (${lunch.minutes} min)` : `Detected lunch (${lunch.minutes} min)`}</small>}</td>
                            <td>{metrics.lostTimeMinutes} min</td>
                            <td>{metrics.lostTimeMinutes > 0 ? (language === "fr" ? "Automatique" : "Automatic") : "-"}</td>
                          </tr>;
                        })}</tbody>
                      </ResponsiveTable></div>
                    </div>
                    <div className="bottom-grid">
                      <div className="section-card">
                        <div className="detail-section-heading"><h3>By lost-time reason</h3></div>
                        <div className="table-wrap profitability-table">
                          <ResponsiveTable>
                            <thead><tr><th>Reason</th><th>Hours</th><th>Cost</th></tr></thead>
                            <tbody>
                              {byReason.map(([reason, value]) => (
                                <tr key={reason}><td>{reason}</td><td>{value.hours.toFixed(2)} h</td><td>{formatCost(value.cost)}</td></tr>
                              ))}
                            </tbody>
                          </ResponsiveTable>
                        </div>
                      </div>
                      <div className="section-card">
                        <div className="detail-section-heading"><h3>By technician</h3></div>
                        <div className="table-wrap profitability-table">
                          <ResponsiveTable>
                            <thead><tr><th>Technician</th><th>Hours</th><th>Cost</th></tr></thead>
                            <tbody>
                              {byTech.map(([tech, value]) => (
                                <tr key={tech}><td>{tech}</td><td>{value.hours.toFixed(2)} h</td><td>{formatCost(value.cost)}</td></tr>
                              ))}
                            </tbody>
                          </ResponsiveTable>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </section>
          )}
          {section === "clients" && (
            <section className="section-card full-card client-management-card">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">{t("clientManagement")}</p>
                  <h2>{t("clientManagement")}</h2>
                </div>
                <span className="client-count">{filteredClients.length} {t("clients")}</span>
              </div>
              <div className="client-toolbar">
                <SearchField value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder={t("searchClients")} aria-label={t("searchClients")} />
                <input className="client-add-input" placeholder={t("newClientName")} onKeyDown={(event) => { if (event.key === "Enter") addClient(event.currentTarget); }} />
                <button className="primary-button" onClick={(event) => { const input = event.currentTarget.previousElementSibling; if (input instanceof HTMLInputElement) addClient(input); }}>{t("addClient")}</button>
              </div>
              <div className="client-grid">{filteredClients.map((client) => <div className="client-card" key={client}><span className="client-initial">{client.slice(0, 1).toUpperCase()}</span>{editingClient === client ? <div className="client-edit-form"><input value={editingClientName} onChange={(event) => setEditingClientName(event.target.value)} autoFocus /><div><button className="primary-button" onClick={saveClientEdit}>{t("save")}</button><button className="outline-button" onClick={() => setEditingClient(null)}>{t("cancel")}</button></div></div> : <><div className="client-card-copy"><strong>{client}</strong><small>{t("fleetClient")}</small></div>{activeUser === "Marc" && <div className="client-actions"><button className="row-action" onClick={() => { setEditingClient(client); setEditingClientName(client); }}>{t("edit")}</button><button className="entry-delete" onClick={() => removeClient(client)}>{t("delete")}</button></div>}</>}</div>)}</div>
              {isAdmin && activeUser !== "Marc" && <div className="admin-client-actions">{filteredClients.map((client) => <div className="admin-client-row" key={`admin-${client}`}><strong>{client}</strong><div><button className="row-action" onClick={() => { setEditingClient(client); setEditingClientName(client); }}>{t("edit")}</button><button className="entry-delete" onClick={() => removeClient(client)}>{t("delete")}</button></div></div>)}</div>}
            </section>
          )}
          {section === "users" && isAdmin && (
            <section className="section-card full-card user-management-card">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">{t("userDirectory")}</p>
                  <h2>{t("userManagement")}</h2>
                </div>
              </div>
              <p className="user-management-copy">{t("manageProfiles")}</p>
              <div className="user-create-row">
                <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder={t("name")} aria-label={t("name")} />
                <input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} placeholder={t("password")} aria-label={t("password")} />
                <label className="tech-list-toggle"><input type="checkbox" checked={newUserIsTechnician} onChange={(event) => setNewUserIsTechnician(event.target.checked)} /> {t("technicianList")}</label>
                <button className="primary-button" onClick={addUser}>{t("addTechnician")}</button>
              </div>
              <div className="user-list">
                {userAccounts.map((account) => (
                  <div className="user-row" key={account.id}>
                    <div className="user-avatar">{account.name.slice(0, 2).toUpperCase()}</div>
                    <div className="user-primary"><b>{account.name}</b><span>{account.role === "Admin" ? t("admin") : t("technician")}</span></div>
                    <span className={`user-status ${account.active ? "user-active" : "user-disabled"}`}>{account.active ? t("active") : t("disabled")}</span>
                    <label className="user-rate-field">Hourly rate<input type="number" min="0" step="0.01" value={account.hourlyRate ?? ""} onChange={(event) => { const hourlyRate = event.target.value === "" ? null : Number(event.target.value); const nextUsers = userAccounts.map((candidate) => candidate.id === account.id ? { ...candidate, hourlyRate } : candidate); setUserAccounts(nextUsers); }} aria-label={`Hourly rate for ${account.name}`} /><button type="button" className="outline-button user-rate-save" onClick={() => { const nextUsers = userAccounts.map((candidate) => candidate.id === account.id ? { ...candidate, hourlyRate: account.hourlyRate ?? null } : candidate); void saveUsers(nextUsers).catch((error: Error) => reportActionError(`Hourly rate save failed: ${error.message}`)); }}>Save</button></label>
                    <label className="tech-list-toggle"><input type="checkbox" checked={account.isTechnician} onChange={() => toggleTechnician(account.id)} /> {t("technicianList")}</label>
                    {account.name !== "Marc" && account.name !== activeUser && <button className="outline-button" onClick={() => toggleAdminRole(account.id)}>{account.role === "Admin" ? t("technician") : t("admin")}</button>}
                    <button className="outline-button" onClick={() => setPasswordTargetId(passwordTargetId === account.id ? null : account.id)}>{t("adminChangePassword")}</button>
                    {passwordTargetId === account.id && <div className="managed-password-editor"><input type="password" value={managedPassword} onChange={(event) => setManagedPassword(event.target.value)} placeholder={t("newPassword")} /><button className="primary-button" onClick={saveManagedPassword}>{t("updatePassword")}</button></div>}
                    {account.name !== "Marc" && account.name !== activeUser && <button className="outline-button" onClick={() => toggleUser(account.id)}>{account.active ? t("disabled") : t("active")}</button>}
                    {account.name !== "Marc" && account.name !== activeUser && <button className="danger-button user-delete" onClick={() => removeUser(account.id)}>{t("removeUser")}</button>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {section === "jobs" && (
            <section className="section-card full-card job-queue">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">{t("serviceOperations")}</p>
                  <h2 id="queue-heading">{t("workOrderQueue")} <span className="queue-count">{filteredJobs.length}</span></h2>
                </div>
                <button
                  className="primary-button"
                  onClick={() => openModal("job")}
                >
                  <Plus size={16} aria-hidden="true" />{t("newWorkOrder")}
                </button>
              </div>
              <div className="queue-search-row">
                <SearchField value={jobQueueSearch} onChange={(event) => setJobQueueSearch(event.target.value)} placeholder={language === "en" ? "Search work orders, units, clients…" : "Rechercher travaux, unités, clients…"} aria-label={language === "en" ? "Search work orders" : "Rechercher les ordres de travail"} />
                <span className="queue-scope"><ListFilter size={14} aria-hidden="true" />{jobFilter === "All" ? t("activeJobs") : t(jobFilter)}</span>
              </div>
              <div className="filter-row">
                <div className="filter-tabs">
                  {(
                    [
                      "All",
                      "Scheduled",
                      "In Progress",
                      "Waiting on Parts",
                      "Waiting on Estimates",
                      "Ready for Invoicing",
                      "Completed",
                    ] as const
                  ).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setJobFilter(filter)}
                      className={jobFilter === filter ? "filter-active" : ""}
                      aria-pressed={jobFilter === filter}
                    >
                      {filter === "All" ? (language === "en" ? "All" : "Tous") : t(filter)}
                      <span>
                        {filter === "All"
                          ? jobData.filter((job) => job.status.trim() !== "Completed").length
                          : jobData.filter((job) => job.status === filter)
                              .length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-wrap queue-table-wrap" tabIndex={0} role="region" aria-labelledby="queue-heading">
                <table className="queue-table">
                  <caption className="sr-only">{t("workOrderQueue")}</caption>
                  <colgroup><col className="queue-col-order" /><col className="queue-col-unit" /><col className="queue-col-tech" /><col className="queue-col-priority" /><col className="queue-col-status" /><col className="queue-col-updated" /><col className="queue-col-actions" /></colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{t("workOrder")}</th>
                      <th scope="col">{t("unitClient")}</th>
                      <th scope="col">{t("technician")}</th>
                      <th scope="col">{t("priority")}</th>
                      <th scope="col">{t("status")}</th>
                      <th scope="col">{t("updated")}</th>
                      <th scope="col"><span className="sr-only">{t("viewAll")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="interactive-row"
                        onClick={() => openJobDetails(job)}
                      >
                        <td className="work-order-cell">
                          <button type="button" className="work-description" title={job.issue} onClick={(event) => { event.stopPropagation(); openJobDetails(job); }}>{job.issue}</button>
                          <span className="work-order-id" title={job.id}>{job.id}</span>
                        </td>
                        <td className="unit-client-cell">
                          <strong>{unitLabelForJob(job.unit, job.client)}</strong>
                          <span>{job.client}</span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          {canManageWorkOrders ? <CustomSelect
                            className="inline-job-select technician-select"
                            value={job.tech}
                            onChange={(value) => updateJobRecord(job, "tech", value)}
                            ariaLabel={`${t("technician")} ${job.unit}`}
                            options={Array.from(new Set([...technicianOptions, job.tech])).map((tech) => ({ value: tech, label: tech }))}
                          /> : <span className="read-only-job-value">{job.tech}</span>}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          {canManageWorkOrders ? <CustomSelect
                            className={`inline-job-select priority-select priority-${job.priority.toLowerCase()}`}
                            value={job.priority}
                            onChange={(value) => updateJobRecord(job, "priority", value)}
                            ariaLabel={`${t("priority")} ${job.unit}`}
                            options={(["High", "Normal", "Low"] as Job["priority"][]).map((priority) => ({ value: priority, label: t(priority) }))}
                          /> : <span className={`read-only-job-value priority-${job.priority.toLowerCase()}`}>{t(job.priority)}</span>}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <CustomSelect
                            className={`inline-job-select status-select ${job.status.startsWith("Waiting") ? "queue-status-waiting" : job.status === "Completed" ? "queue-status-completed" : ""}`}
                            value={job.status}
                            onChange={(value) => setStatus(job.id, value as JobStatus)}
                            ariaLabel={`${t("status")} ${job.unit}`}
                            options={(["Scheduled", "In Progress", "Waiting on Parts", "Waiting on Estimates", "Ready for Invoicing", "Completed"] as JobStatus[]).map((status) => ({ value: status, label: t(status) }))}
                          />
                        </td>
                        <td className="updated-cell"><ActivityTimestamp updatedAt={job.updatedAt} language={language} compact /></td>
                        <td>
                          <button
                            className="row-action icon-button"
                            aria-label={`${t("workOrder")} ${job.id}`}
                            title={`${t("workOrder")} ${job.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openJobDetails(job);
                            }}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredJobs.length === 0 && <div className="queue-empty"><Search size={24} aria-hidden="true" /><p>{language === "en" ? "No matching work orders" : "Aucun ordre de travail correspondant"}</p>{(jobQueueSearch || jobFilter !== "All") && <button className="outline-button" onClick={openJobsQueue}>{language === "en" ? "Clear filters" : "Effacer les filtres"}</button>}</div>}
              <div className="mobile-job-list">
                {filteredJobs.map((job) => <article className="mobile-job-card" key={`mobile-${job.id}`} onClick={() => openJobDetails(job)}><div className="mobile-job-heading"><div><strong>{job.unit}</strong><span>{job.client}</span></div><span className="work-order-id">{job.id}</span></div><button type="button" className="mobile-job-description" onClick={(event) => { event.stopPropagation(); openJobDetails(job); }}>{job.issue}</button><div className="mobile-job-meta"><span><small>{t("technician")}</small>{job.tech}</span><span><small>{t("priority")}</small><b className={`mobile-job-priority priority-${job.priority.toLowerCase()}`}>{t(job.priority)}</b></span><span><small>{t("status")}</small><StatusPill status={job.status} language={language} /></span></div><small className="mobile-job-updated"><ActivityTimestamp updatedAt={job.updatedAt} language={language} compact /></small></article>)}
              </div>
              <footer className="queue-footer"><span><span className="signal-dot" aria-hidden="true" />{jobFilter === "All" ? t("activeJobs") : t(jobFilter)}</span><span className="font-mono">{filteredJobs.length} / {jobData.length}</span></footer>
            </section>
          )}
          {section === "units" && (
            <>
              <div className="unit-metrics">
                <MetricCard
                  label={t("totalUnits")}
                  value={String(unitData.length)}
                  detail={t("fleetRecordsDetail")}
                  tone="blue"
                  icon="unit"
                />
                <MetricCard
                  label={t("unitsOverduePm")}
                  value={String(unitData.filter((unit) => pmDueForUnit(unit)).length)}
                  detail={t("requiresAttention")}
                  icon="!"
                />
              </div>
              <section className="section-card full-card">
                <div className="toolbar">
                  <div>
                    <p className="card-kicker">{t("assetDatabase")}</p>
                    <h2>{t("fleetDirectory")}</h2>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => openModal("unit")}
                  >
                    {t("addNewUnit")}
                  </button>
                </div>
                <div className="search-row">
                  <SearchField
                    value={unitSearch}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder={language === "en" ? "Search by unit, VIN, or client name..." : "Rechercher une unité, un NIV ou un client..."}
                    aria-label={language === "en" ? "Search units" : "Rechercher les unités"}
                  />
                  <button className={`outline-button ${pmDueOnly ? "filter-active-button" : ""}`} onClick={() => setPmDueOnly((current) => !current)}>{pmDueOnly ? t("pmDueOnly") : t("filters")}</button>
                </div>
                <div className="unit-list card-grid">
                  {filteredUnits.map((unit) => (
                    <div
                      className="unit-row"
                      key={unitKey(unit)}
                    >
                      <div className="unit-avatar">{unit.unit.slice(0, 3)}</div>
                      <div className="unit-primary">
                        <b>{unit.unit}</b>
                        <span>
                          {unit.type} · VIN {unit.vin}
                        </span>
                      </div>
                      <div>
                        <label>{t("assignedClientLabel")}</label>
                        <b>{unit.client}</b>
                      </div>
                      <div>
                        <label>{t("lastServiceLabel")}</label>
                        <b>{unit.service}</b>
                      </div>
                      <div>
                        <label>{t("lastUsageLabel")}</label>
                        <b>{(() => { const summary = meterSummaryForUnit(unit); return summary.currentMeter == null ? unit.usage : `${summary.currentMeter} ${summary.meterUnit}`; })()}</b>
                      </div>
                      <div className="unit-meter-summary">{(() => { const summary = meterSummaryForUnit(unit); return <><label>PM / {summary.meterUnit}</label><b>{summary.currentMeter ?? "-"} / {summary.pmInterval}</b>{summary.overdueBy != null && summary.overdueBy > 0 ? <small className="pm-remaining pm-remaining-due">{summary.overdueBy} {summary.meterUnit} {t("pmOverdueBy")}</small> : summary.remaining != null && <small className="pm-remaining">{summary.remaining} {summary.meterUnit} {t("pmRemaining")}</small>}</>; })()}</div>
                      <div className="unit-due">
                        <button
                          type="button"
                          className={`pm-toggle ${pmDueForUnit(unit) ? "pm-needed" : "pm-clear"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePm(unit);
                          }}
                          aria-label={`Toggle PM for ${unit.unit}`}
                        >
                          <span>{pmDueForUnit(unit) ? t("pmNeeded") : t("pmClear")}</span>
                        </button>
                        <small>{unit.due}</small>
                      </div>
                      <button
                        type="button"
                        className="history-button"
                        onPointerDown={(event) => { event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); }}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.nativeEvent.stopImmediatePropagation();
                          openUnitHistory(unit);
                        }}
                      >
                        {t("history")}
                      </button>
                      <button
                        type="button"
                        className="row-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          openUnitEditor(unit);
                        }}
                      >
                        →
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {modal === "history" && historyUnit && (
            <ModalFrame title={t("serviceHistory")} wide onClose={closeModal}>
              <div className="modal-card detail-modal unit-history-modal">
                <div className="modal-header"><div><p className="card-kicker">{t("serviceHistory")}</p><h2>{historyUnit.unit}</h2><small>{historyUnit.client} · {historyUnit.type}</small></div><button type="button" className="modal-close" onPointerDown={armModalClose} onClick={handleModalCloseClick} aria-label={t("close")}>×</button></div>
                <div className="modal-body">
                <div className="detail-section-heading"><h3>{t("completedWorkOrders")}</h3><span>{jobData.filter((job) => job.unit === historyUnit.unit && job.client === historyUnit.client && job.status === "Completed").length}</span></div>
                <div className="service-history-list">{jobData.filter((job) => job.unit === historyUnit.unit && job.client === historyUnit.client && job.status === "Completed").map((job) => <div className="service-history-row" key={job.id}><div><strong>{job.issue}</strong><small>{job.id} · {job.updated}</small></div><span>{job.tech}</span><b>{workedHoursFor(job.id)} h</b><button className="outline-button" onClick={() => openJobDetails(job)}>{language === "en" ? "Open" : "Ouvrir"}</button></div>)}{jobData.filter((job) => job.unit === historyUnit.unit && job.client === historyUnit.client && job.status === "Completed").length === 0 && <p className="empty-history">{language === "en" ? "No completed service history for this unit." : "Aucun historique de service complété pour cette unité."}</p>}</div>
                </div>
                <div className="modal-actions"><button type="button" className="outline-button" onClick={closeModal}>{t("done")}</button></div>
              </div>
            </ModalFrame>
          )}
          {modal === "detail" && activeJob && (
            <ModalFrame title={`${t("workOrderDetails")} ${activeJob.id}`} wide onClose={closeModal}>
              <div className="modal-card detail-modal">
                <div className="modal-header detail-modal-header">
                  <div className="detail-modal-header-content">
                    <p className="card-kicker">{t("workOrderDetails")} {activeJob.id}</p>
                    <div className="detail-title-row">
                      {editingWorkOrderTitle ? <input
                        className="detail-title-editor"
                        value={workOrderTitleDraft}
                        onChange={(event) => setWorkOrderTitleDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const title = workOrderTitleDraft.trim();
                            if (title) void updateJob("issue", title);
                            setEditingWorkOrderTitle(false);
                          }
                          if (event.key === "Escape") {
                            setWorkOrderTitleDraft(activeJob.issue);
                            setEditingWorkOrderTitle(false);
                          }
                        }}
                        autoFocus
                      /> : <h2>{activeJob.issue}</h2>}
                      {canManageWorkOrders && (editingWorkOrderTitle ? <div className="detail-title-actions"><button type="button" className="title-edit-button" onClick={() => { const title = workOrderTitleDraft.trim(); if (title) void updateJob("issue", title); setEditingWorkOrderTitle(false); }}>{t("save")}</button><button type="button" className="title-cancel-button" onClick={() => { setWorkOrderTitleDraft(activeJob.issue); setEditingWorkOrderTitle(false); }}>{t("cancel")}</button></div> : <button type="button" className="title-edit-button" onClick={() => { setWorkOrderTitleDraft(activeJob.issue); setEditingWorkOrderTitle(true); }}>{t("edit")}</button>)}
                    </div>
                  </div>
                  <button type="button" className="modal-close" onPointerDown={armModalClose} onClick={handleModalCloseClick} aria-label={t("close")}>×</button>
                </div>
                <div className="modal-body">
                    {(() => {
                      const unit = unitData.find((item) => item.unit === activeJob.unit && item.client === activeJob.client);
                      const summary = unit ? meterSummaryForUnit(unit) : null;
                      const currentMeter = summary?.currentMeter ?? activeJob.meterReading;
                      const meterUnit = summary?.meterUnit ?? unit?.meterUnit ?? "KM";
                      const due = summary ? summary.currentMeter != null && summary.currentMeter - summary.baseline >= summary.pmInterval : false;
                      return <div className="detail-meta-grid">
                        <div><span>{t("workOrderDetails")}</span><strong>{activeJob.id}</strong></div>
                        <div><span>{t("clientName")}</span><strong>{activeJob.client}</strong></div>
                        <div><span>{t("unitNumber")}</span><strong className={isMissingUnit(activeJob.unit, activeJob.client) ? "missing-unit-badge" : ""}>{unitLabelForJob(activeJob.unit, activeJob.client)}</strong></div>
                        <div><span>{t("currentMileageHours")}</span><strong>{currentMeter == null ? activeJob.usage : `${currentMeter} ${meterUnit}`}</strong></div>
                        <div><span>{t("status")}</span><strong className={`detail-meta-pill status-${activeJob.status.toLowerCase().replaceAll(" ", "-")}`}>{t(activeJob.status)}</strong></div>
                        <div><span>{t("priority")}</span><strong className={`detail-meta-pill priority-${activeJob.priority.toLowerCase()}`}>{t(activeJob.priority)}</strong></div>
                        <div><span>PM</span><strong className={`detail-meta-pill ${due ? "detail-meta-due" : "detail-meta-clear"}`}>{due ? t("pmDue") : t("pmClear")}</strong></div>
                        <div className="detail-meta-hours"><span>{t("totalWorked")}</span><strong>{workedHoursFor(activeJob.id)} h</strong></div>
                      </div>;
                    })()}
                    <span className="work-order-total-hours">{t("totalWorked")}: {workedHoursFor(activeJob.id)} h</span>
                    <div className="work-order-punch-actions">
                      {activeTimeEntry?.workOrderId === activeJob.id ? <button type="button" className="punch-button punch-out" onClick={clockOut}>{t("clockOut")}</button> : <button type="button" className="punch-button punch-in" disabled={Boolean(activeTimeEntry)} onClick={() => clockIn(activeJob.id)}>{t("clockInThisWorkOrder")}</button>}
                    </div>
                <div className="detail-controls detail-edit-controls">
                  <label>
                    {t("status")}
                    <CustomSelect
                      value={activeJob.status}
                      onChange={(value) => updateJob("status", value)}
                      options={(
                        [
                          "Scheduled",
                          "In Progress",
                          "Waiting on Parts",
                          "Waiting on Estimates",
                          "Ready for Invoicing",
                          "Completed",
                        ] as JobStatus[]
                      ).map((status) => ({ value: status, label: t(status) }))}
                    />
                  </label>
                  <label>
                    {t("priority")}
                    {canManageWorkOrders ? <CustomSelect
                      value={activeJob.priority}
                      onChange={(value) => updateJob("priority", value)}
                      options={(["High", "Normal", "Low"] as Job["priority"][]).map((priority) => ({ value: priority, label: t(priority) }))}
                    /> : <span className={`read-only-detail-value priority-${activeJob.priority.toLowerCase()}`}>{t(activeJob.priority)}</span>}
                  </label>
                  <label>
                    {t("technician")}
                    {canManageWorkOrders ? <CustomSelect
                      value={activeJob.tech}
                      onChange={(value) => updateJob("tech", value)}
                      options={Array.from(new Set([...technicianOptions, activeJob.tech])).map((tech) => ({ value: tech, label: tech }))}
                    /> : <span className="read-only-detail-value">{activeJob.tech}</span>}
                  </label>
                </div>
                <div className="detail-section detail-section-card work-order-time-section">
                  <div className="detail-section-heading"><h3>{t("punchHistory")}</h3><span>{activeJobPunches.length} {t("entries")}</span></div>
                  <div className="work-order-time-list" id="work-order-punch-history">
                    {visibleWorkOrderPunches.map((entry) => <div className="work-order-time-row" key={entry.id}>
                      <strong>{entry.userName}</strong>
                      <time dateTime={entry.clockIn}>{formatTorontoDateTime(entry.clockIn)}</time>
                      {entry.clockOut ? <time dateTime={entry.clockOut}>{formatTorontoDateTime(entry.clockOut)}</time> : <span>{t("activePunch")}</span>}
                      <b>{entry.totalHours == null ? t("activePunch") : `${entry.totalHours.toFixed(2)} h`}</b>
                    </div>)}
                    {activeJobPunches.length === 0 && <small className="empty-history">{t("noPunches")}</small>}
                  </div>
                  {activeJobPunches.length > 4 && <button type="button" className="outline-button work-order-punch-toggle" aria-expanded={showAllWorkOrderPunches} aria-controls="work-order-punch-history" onClick={() => setShowAllWorkOrderPunches((current) => !current)}>
                    {showAllWorkOrderPunches ? (language === "fr" ? "Afficher moins" : "Show less") : `${language === "fr" ? "Tout afficher" : "Show all"} (${activeJobPunches.length})`}
                  </button>}
                </div>
                <div className="detail-section detail-section-card">
                  <div className="detail-section-heading">
                    <h3>{t("notes")}</h3>
                    <span>{activeJob.notes?.length ?? 0} notes</span>
                  </div>
                  <div className="note-list">
                    {(activeJob.notes ?? []).map((note) => (
                      <div className="note-item" key={note.id}>
                        <input
                          value={note.text}
                          readOnly={!canManageNote(note)}
                          className={!canManageNote(note) ? "note-read-only" : ""}
                          onChange={(event) =>
                            updateNote(note.id, event.target.value)
                          }
                        />
                        <small>
                          {note.author} ·{" "}
                          {formatTorontoTime(note.createdAt)}
                        </small>
                        {canManageNote(note) && <button
                          className="entry-delete"
                          onClick={() => deleteNote(note.id)}
                        >
                          {t("delete")}
                        </button>}
                      </div>
                    ))}
                  </div>
                  <div className="inline-entry">
                    <input
                      value={noteText}
                      onChange={(event) => setNoteText(event.target.value)}
                      placeholder={t("addNotePlaceholder")}
                    />
                    <button className="primary-button" onClick={saveNote}>
                      {t("addNote")}
                    </button>
                  </div>
                </div>
                <div className="detail-section detail-section-card">
                  <div className="detail-section-heading">
                    <h3>{t("parts")}</h3>
                    <div className="line-item-summary">
                      <span>{(activeJob.lineItems ?? []).length} {t("items")}</span>
                      <strong>{t("total")}: {formatCurrency((activeJob.lineItems ?? []).reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.amount) || 0), 0))}</strong>
                    </div>
                  </div>
                  <div className="line-item-list">
                    {(activeJob.lineItems ?? []).map((item) => (
                      <div className="line-item" key={item.id}>
                        <div className="line-item-header">
                          <span className={`line-item-kind line-item-kind-${item.kind.toLowerCase()}`}>
                            {item.kind === "Labor" ? t("labor") : t("part")}
                          </span>
                          <button
                            className="entry-delete"
                            onClick={() => deleteLineItem(item.id)}
                          >
                            {t("delete")}
                          </button>
                        </div>
                        <label className="line-item-part-number">
                          <span>{t("partNumber")}</span>
                          <input
                            value={item.partNumber ?? ""}
                            onChange={(event) => updateLineItem(item.id, "partNumber", event.target.value)}
                          />
                        </label>
                        <label className="line-item-description">
                          <span>{t("description")}</span>
                          <input
                            value={item.description}
                            onChange={(event) =>
                              updateLineItem(item.id, "description", event.target.value)
                            }
                          />
                        </label>
                        <div className="line-item-fields">
                          <label>
                            <span>{t("quantity")}</span>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(event) =>
                                updateLineItem(item.id, "quantity", event.target.value)
                              }
                            />
                          </label>
                          <label>
                            <span>{t("amountPerItem")}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.amount}
                              onChange={(event) =>
                                updateLineItem(item.id, "amount", event.target.value)
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="line-item-entry">
                    <div className="line-item-entry-header">
                      <span className="line-item-entry-title">{t("addAnItem")}</span>
                      <span className="line-item-entry-hint">{t("partsOnly")}</span>
                    </div>
                      <span className="line-item-kind line-item-kind-part">{t("part")}</span>
                    <label className="line-item-part-number">
                      <span>{t("partNumber")}</span>
                      <input
                        value={lineItem.partNumber}
                        onChange={(event) => setLineItem((current) => ({ ...current, partNumber: event.target.value }))}
                        placeholder={t("partNumber")}
                      />
                    </label>
                    <label className="line-item-description">
                      <span>{t("description")}</span>
                      <input
                        value={lineItem.description}
                        onChange={(event) =>
                          setLineItem((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        placeholder={t("description")}
                      />
                    </label>
                    <div className="line-item-fields">
                      <label className="unit-form-picker-label">
                        <span>{t("quantity")}</span>
                        <input
                          type="number"
                          min="1"
                          value={lineItem.quantity}
                          onChange={(event) =>
                            setLineItem((current) => ({
                              ...current,
                              quantity: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>{t("amountPerItem")}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={lineItem.amount}
                          onChange={(event) =>
                            setLineItem((current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                          placeholder={t("amountPerItem")}
                        />
                      </label>
                    </div>
                    <button className="outline-button" onClick={saveLineItem}>
                      {t("add")}
                    </button>
                  </div>
                </div>
                </div>
                <div className="modal-actions">
                  {canManageWorkOrders && <button
                    className="danger-button"
                    onClick={() => deleteJob(activeJob.id)}
                  >
                    {t("deleteWorkOrder")}
                  </button>}
                  <button className="outline-button" onClick={closeModal}>
                    {t("done")}
                  </button>
                </div>
              </div>
            </ModalFrame>
          )}
          {classifyingDay && (() => {
            const summary = [...payrollRows, ...profitabilitySummaryRows].find((row) => row.user_id === classifyingDay.userId && row.work_date === classifyingDay.workDate);
            const remaining = summary ? automaticLostTimeMinutesFor(timeEntries, [summary], lunchProposals).get(`${classifyingDay.userId}:${classifyingDay.workDate}`) ?? 0 : 0;
            return <ModalFrame title={language === "fr" ? "Repas et temps perdu" : "Lunch & lost time"} onClose={() => setClassifyingDay(null)}><form className="modal-card" onSubmit={(event) => { event.preventDefault(); void saveDayClassification(); }}><div className="modal-header"><div><p className="card-kicker">{language === "fr" ? "Repas et temps perdu" : "Lunch & lost time"}</p><h2>{classifyingDay.userId} · {classifyingDay.workDate}</h2></div><button type="button" className="modal-close" onClick={() => setClassifyingDay(null)} aria-label={t("close")}>×</button></div><div className="modal-body"><p>{language === "fr" ? `${remaining} min à répartir entre repas et temps perdu.` : `${remaining} min to allocate to lunch or lost time.`}</p><div className="modal-fields"><label>{language === "fr" ? "Minutes de repas" : "Lunch minutes"}<input type="number" min="0" max={remaining} value={classificationBreakMinutes} onChange={(event) => setClassificationBreakMinutes(event.target.value)} /></label><label>{language === "fr" ? "Minutes de temps perdu" : "Lost-time minutes"}<input type="number" min="0" max={remaining} value={classificationLostMinutes} onChange={(event) => setClassificationLostMinutes(event.target.value)} /></label><label>{language === "fr" ? "Motif du temps perdu" : "Lost-time reason"}<select value={classificationReason} onChange={(event) => setClassificationReason(event.target.value)}><option>Parts wait</option><option>Traffic</option><option>Admin</option><option>Equipment issue</option><option>Other</option></select></label></div></div><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setClassifyingDay(null)}>{t("cancel")}</button><button type="submit" className="primary-button">{t("save")}</button></div></form></ModalFrame>;
          })()}
          {completionPrompt && (
            <ModalFrame title={t("closingMeterReading")} onClose={() => setCompletionPrompt(null)}>
              <form className="modal-card completion-meter-modal" onSubmit={(event) => { event.preventDefault(); void completeJobWithMeter(); }}>
                <div className="modal-header"><div><p className="card-kicker">{t("workOrderDetails")}</p><h2>{t("closingMeterReading")}</h2><small>{t("enterCurrentMeter")} ({unitData.find((unit) => unit.unit === completionPrompt.job.unit && unit.client === completionPrompt.job.client)?.meterUnit ?? "KM"})</small></div></div>
                <div className="modal-body"><div className="modal-fields"><label>{t("finalMeterReading")}<input autoFocus type="number" min="0" required value={completionPrompt.reading} onChange={(event) => setCompletionPrompt({ ...completionPrompt, reading: event.target.value })} /></label>{(() => { const unit = unitData.find((item) => item.unit === completionPrompt.job.unit && item.client === completionPrompt.job.client); const reading = Number(completionPrompt.reading); const baseline = unit?.lastPmMeter ?? unit?.currentMeter ?? reading; return unit && Number.isFinite(reading) && reading - baseline >= (unit.pmInterval ?? 25000) ? <div className="cloud-banner cloud-warning">{t("pmIntervalExceeded")}: {reading - baseline} {unit.meterUnit} {t("sinceLastPm")}.</div> : null; })()}</div></div>
                <div className="modal-actions"><button type="button" className="outline-button" onClick={() => setCompletionPrompt(null)}>{t("cancel")}</button><button type="submit" className="primary-button">{t("completeWorkOrder")}</button></div>
              </form>
            </ModalFrame>
          )}
          {modal !== "detail" && modal !== "history" && modal && (
            <ModalFrame title={modal === "job" ? t("createTitle") : editingUnitId ? t("editUnitTitle") : t("addUnitTitle")} onClose={closeModal}>
              <form
                className="modal-card"
                noValidate
                onSubmit={submitForm}
                onKeyDownCapture={(event) => { if (event.key === "Enter") submitArmedRef.current = true; }}
              >
                <div className="modal-header">
                  <div>
                    <p className="card-kicker">
                      {modal === "job"
                        ? t("serviceOperations")
                        : t("assetDatabase")}
                    </p>
                    <h2>
                      {modal === "job"
                        ? t("createTitle")
                        : returnToJob
                          ? t("addToRepertory")
                          : editingUnitId
                            ? t("editUnitTitle")
                            : t("addUnitTitle")}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="modal-close"
                    onPointerDown={armModalClose}
                    onClick={handleModalCloseClick}
                    aria-label="Close modal"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                <div className="modal-fields">
                  {modal === "job" ? (
                    <>
                      <div className="unit-form-picker-label form-field-group" onClick={(event) => event.stopPropagation()}>
                        <label htmlFor="work-order-unit-picker">{t("fleetUnit")}</label>
                        <div className="unit-form-picker">
                          <SearchField
                            id="work-order-unit-picker"
                            required
                            value={workOrderUnitSearch}
                            onFocus={(event) => { event.stopPropagation(); setWorkOrderUnitPickerOpen(true); }}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => { event.stopPropagation(); setWorkOrderUnitSearch(event.target.value); setWorkOrderUnitPickerOpen(true); }}
                            placeholder={t("selectUnit")}
                          />
                          <button
                            type="button"
                            className="outline-button"
                            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); beginAddUnitInline(); }}
                            onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                          >
                            {t("addNewUnitOption")}
                          </button>
                        </div>
                        {workOrderUnitPickerOpen && <div className="unit-client-suggestions" role="listbox" onClick={(event) => event.stopPropagation()}>{unitData.filter((unit) => `${unit.unit} ${unit.client}`.toLowerCase().includes(workOrderUnitSearch.toLowerCase())).slice(0, 8).map((unit) => <button type="button" key={unitKey(unit)} role="option" aria-selected={form.unit === unit.unit && form.client === unit.client} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setWorkOrderUnitSearch(unit.unit); setWorkOrderUnitPickerOpen(false); selectUnit(`${unit.unit} · ${unit.client}`); }}>{unit.unit} · {unit.client}</button>)}</div>}
                      </div>
                      <label>
                        {t("currentMileageHours")} ({form.meterUnit})
                        <input
                          required
                          type="number"
                          min="0"
                          value={form.meterReading}
                          onChange={(event) => updateForm("meterReading", event.target.value)}
                          placeholder={form.meterUnit === "KM" ? "e.g. 250000" : "e.g. 5000"}
                        />
                      </label>
                      <label>
                        {t("serviceRequest")}
                        <input
                          required
                          value={form.issue}
                          onChange={(event) =>
                            updateForm("issue", event.target.value)
                          }
                          placeholder={t("describeIssue")}
                        />
                      </label>
                      <label onMouseDown={(event) => event.stopPropagation()}>
                        {t("technician")}
                        <CustomSelect
                          value={form.tech}
                          onChange={(value) => updateForm("tech", value)}
                          onSelect={() => { pickerActivityRef.current = Date.now(); }}
                          options={technicianOptions.map((tech) => ({ value: tech, label: tech }))}
                        />
                      </label>
                      <label onMouseDown={(event) => event.stopPropagation()}>
                        {t("priority")}
                        <CustomSelect
                          value={form.priority}
                          onChange={(value) => updateForm("priority", value)}
                          onSelect={() => { pickerActivityRef.current = Date.now(); }}
                          options={[
                            { value: "High", label: t("High") },
                            { value: "Normal", label: t("Normal") },
                            { value: "Low", label: t("Low") },
                          ]}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        {t("unitNumber")}
                        <input
                          required
                          value={form.unit}
                          onChange={(event) =>
                            updateForm("unit", event.target.value)
                          }
                          placeholder={t("unitExample")}
                        />
                      </label>
                      <label>
                        {t("vin")}
                        <input
                          required
                          value={form.vin}
                          onChange={(event) =>
                            updateForm("vin", event.target.value)
                          }
                          placeholder={t("vinExample")}
                        />
                      </label>
                      <div className="unit-client-picker form-field-group" onClick={(event) => event.stopPropagation()}>
                        <label htmlFor="unit-client-picker-input">{t("clientName")}</label>
                        <div className="unit-client-picker-row">
                          <SearchField
                            id="unit-client-picker-input"
                            required
                            value={form.client}
                            onFocus={(event) => { event.stopPropagation(); setUnitClientPickerOpen(true); }}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => { event.stopPropagation(); setUnitClientSearch(event.target.value); setUnitClientPickerOpen(true); updateForm("client", event.target.value); }}
                            placeholder={t("searchClients")}
                          />
                          <button type="button" className="outline-button" onClick={(event) => { event.stopPropagation(); addClientName(unitClientSearch || form.client); }}>{t("addClient")}</button>
                        </div>
                        {unitClientPickerOpen && unitClientSearch && <div className="unit-client-suggestions" role="listbox" onClick={(event) => event.stopPropagation()}>{clientData.filter((client) => client.toLowerCase().includes(unitClientSearch.toLowerCase())).slice(0, 8).map((client) => <button type="button" key={client} role="option" aria-selected={form.client === client} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setUnitClientSearch(""); setUnitClientPickerOpen(false); updateForm("client", client); }}>{client}</button>)}</div>}
                      </div>
                      <div className="unit-form-field">
                        <label htmlFor="unit-type-input">{t("unitType")}</label>
                        <input
                          id="unit-type-input"
                          value={form.type}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateForm("type", event.target.value)
                          }
                          placeholder={t("typeExample")}
                        />
                      </div>
                      <div className="unit-form-field">
                        <label htmlFor="meter-type-select">{t("meterType")}</label>
                        <CustomSelect id="meter-type-select" value={form.meterUnit} onChange={(value) => updateForm("meterUnit", value)} options={[{ value: "KM", label: "KM" }, { value: "HRS", label: "HRS" }]} />
                      </div>
                      <label>
                        {t("currentMileageHours")}
                        <input required type="number" min="0" value={form.currentMeter} onChange={(event) => updateForm("currentMeter", event.target.value)} placeholder={form.meterUnit === "KM" ? "e.g. 250000" : "e.g. 5000"} />
                      </label>
                      {editingUnitId && <label>
                        {t("lastServiceMeter")}
                        <input type="number" min="0" value={form.lastPmMeter} onChange={(event) => updateForm("lastPmMeter", event.target.value)} placeholder={form.meterUnit === "KM" ? "e.g. 225000" : "e.g. 4500"} />
                      </label>}
                      <label>
                        {t("pmIntervalLabel")} ({form.meterUnit})
                        <input type="number" min="1" value={form.pmInterval} onChange={(event) => updateForm("pmInterval", event.target.value)} placeholder={form.meterUnit === "KM" ? "e.g. 25000" : "e.g. 500"} />
                      </label>
                    </>
                  )}
                </div>
                {modal === "unit" && editingUnitId && <div className="unit-notes-section"><div className="detail-section-heading"><h3>Service notes</h3><span>{(unitNotes[editingUnitId] ?? []).length}</span></div><div className="unit-notes-list">{(unitNotes[editingUnitId] ?? []).map((note) => <div className="unit-note note-item" key={note.id}>{isAdmin ? <input value={note.text} onChange={(event) => updateUnitNoteForKey(editingUnitId, note.id, event.target.value)} onBlur={(event) => void commitUnitNoteEdit(editingUnitId, note.id, event.target.value)} /> : <p>{note.text}</p>}<small>{note.author} · {formatTorontoTime(note.createdAt)}</small>{isAdmin && <button type="button" className="entry-delete" onClick={() => void deleteUnitNoteForKey(editingUnitId, note.id)}>{t("delete")}</button>}</div>)}</div><textarea value={unitNoteText} onChange={(event) => setUnitNoteText(event.target.value)} placeholder="Add a service remark" aria-label="Add a service remark" /><button type="button" className="outline-button" onClick={() => void saveUnitNoteForKey(editingUnitId)}>Save note</button></div>}
                </div>
                <div className="modal-actions">
                  {modal === "unit" && editingUnitId && (
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => deleteUnit(editingUnitId)}
                    >
                      {t("deleteUnit")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="outline-button"
                    onClick={closeModal}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="primary-button create-work-order-submit"
                    onPointerDown={(event) => { event.stopPropagation(); submitArmedRef.current = true; }}
                    onPointerUp={(event) => event.stopPropagation()}
                  >
                    {modal === "job" ? t("createWorkOrder") : t("saveUnit")}
                  </button>
                </div>
              </form>
            </ModalFrame>
          )}
        </main>
      </div>
    </div>
  );
}
