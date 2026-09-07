"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { completeTimeEntry, createManualTimeEntry, createTimeEntry, hasSupabaseConfig, loadFleetData, loadTimeEntries, loadUsers, removeJob, removeTimeEntry, removeUnit, saveJobs, saveUnits, saveUsers, subscribeToFleet, updateTimeEntry, writeActivityLog, type RealtimeChange, type CloudJob, type CloudTimeEntry, type CloudUnit, type CloudUser } from "../lib/fleet-repository";

type Section = "overview" | "jobs" | "units" | "users" | "clients" | "punch";
type Language = "en" | "fr";
type UserAccount = { id: string; name: string; role: "Admin" | "Technician"; password: string; active: boolean; isTechnician: boolean };
type JobStatus =
  "In Progress" | "Waiting on Parts" | "Waiting on Estimates" | "Completed";
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
};

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
const navItems: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "dashboardOverview", icon: "▦" },
  { id: "jobs", label: "activeJobQueue", icon: "≡" },
  { id: "punch", label: "punchClock", icon: "◷" },
  { id: "units", label: "unitManagement", icon: "▣" },
  { id: "clients", label: "clientManagement", icon: "◇" },
];
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

`
function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    //
      previousPeriod: "Previous period", nextPeriod: "Next period", chooseDate: "Choose date", currentPeriod: "Current period", day: "Day",
    return stored ? (JSON.parse(stored) as T) : fallback;
    workOrders: "WORK ORDERS", activeJobs: "Active Jobs", totalInProgress: "Total in progress", waitingParts: "Waiting on parts", waitingEstimates: "Waiting on estimates", fleetHealth: "FLEET HEALTH", unitStatus: "Unit Status", totalUnits: "Total units repertoried", fleetRecords: "All fleet records up to date", pmCompliance: "PM compliance", overduePm: "units overdue for PM", fieldOperations: "FIELD OPERATIONS", fieldService: "Field Service", techsOnRoad: "Technicians on road", unassignedCalls: "Unassigned calls", responseTime: "Avg response time", recentActivity: "RECENT ACTIVITY", latestUpdates: "Latest updates", viewAll: "View all →", quickActions: "QUICK ACTIONS", quickQuestion: "What would you like to do?", createWorkOrder: "Create work order", startService: "Start a new service request", addUnit: "Add a unit", registerAsset: "Register a vehicle or asset", serviceOperations: "SERVICE OPERATIONS", workOrderQueue: "Work order queue", newWorkOrder: "+ New work order", export: "Export ↓", assetDatabase: "ASSET DATABASE", fleetDirectory: "Fleet directory", addNewUnit: "+ Add unit", filters: "Filters ≡", assignedClient: "ASSIGNED CLIENT", lastService: "LAST SERVICE", lastUsage: "LAST SERVICE USAGE", pmNeeded: "PM needed", pmClear: "PM clear", workOrder: "Work order", unitClient: "Unit / client", technician: "Technician", priority: "Priority", status: "Status", updated: "Updated", fleetUnit: "Fleet unit", selectUnit: "Select a unit from the repertory", addNewUnitOption: "+ Add New Unit to Repertory", serviceRequest: "Service request", lastServiceUsage: "Last service mileage / hours", unitNumber: "Unit number", vin: "VIN", clientName: "Client name", lastServiceDate: "Last service", unitType: "Unit type", saveUnit: "Save unit", cancel: "Cancel", deleteUnit: "Delete unit", close: "Close modal", workOrderDetails: "WORK ORDER", notes: "Technician notes", addNotePlaceholder: "Add a timestamped note...", addNote: "Add note", parts: "Labor & parts", description: "Description", amount: "Amount", add: "Add", delete: "Delete", deleteWorkOrder: "Delete work order", done: "Done", createTitle: "Create work order", addUnitTitle: "Add fleet unit", editUnitTitle: "Edit fleet unit", addToRepertory: "Add unit to repertory", part: "Part", labor: "Labor", loginTitle: "RPM Diesel Dashboard", loginSubtitle: "Sign in to manage fleet operations", name: "Name", password: "Password", signIn: "Sign in", invalidLogin: "Enter a valid name and password.", signedInAs: "Signed in as", signOut: "Sign out", language: "Switch language",
    return fallback;
    //
      previousPeriod: "Période précédente", nextPeriod: "Période suivante", chooseDate: "Choisir une date", currentPeriod: "Période actuelle", day: "Jour",
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}
`;

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function StatusPill({ status, language }: { status: JobStatus; language: Language }) {
  const styles = {
    "In Progress": "status-blue",
    "Waiting on Parts": "status-amber",
    "Waiting on Estimates": "status-purple",
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
  return (
    <div className="metric-card">
      <div className="metric-top">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="metric-number">{value}</p>
        </div>
        <span className={`metric-icon metric-${tone} ${icon === "unit" ? "metric-unit-icon" : ""}`}>{icon === "unit" ? null : icon}</span>
      </div>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function PunchClock({ activeEntry, jobs, language, onClockIn, onClockOut }: { activeEntry?: CloudTimeEntry; jobs: Job[]; language: Language; onClockIn: (workOrderId: string | null) => void; onClockOut: () => void }) {
  const [workOrderId, setWorkOrderId] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!activeEntry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeEntry]);
  const elapsed = activeEntry ? Math.max(0, now - new Date(activeEntry.clockIn).getTime()) : 0;
  const elapsedLabel = `${String(Math.floor(elapsed / 3600000)).padStart(2, "0")}:${String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`;
  return <div className={`punch-clock ${activeEntry ? "punch-active" : ""}`}><span className="punch-indicator" /><div className="punch-copy"><strong>{activeEntry ? (language === "en" ? "On the clock" : "Pointé") : (language === "en" ? "Off the clock" : "Non pointé")}</strong><small>{activeEntry ? elapsedLabel : (language === "en" ? "Select a work order first" : "Sélectionnez d'abord un ordre")}</small></div>{!activeEntry ? <><select required value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)} aria-label={language === "en" ? "Assign work order" : "Assigner un ordre de travail"}><option value="">{language === "en" ? "Select work order" : "Sélectionner un ordre"}</option>{jobs.filter((job) => job.status !== "Completed").map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select><button disabled={!workOrderId} className="punch-button punch-in" onClick={() => onClockIn(workOrderId)}>{language === "en" ? "Clock In" : "Pointer"}</button></> : <button className="punch-button punch-out" onClick={onClockOut}>{language === "en" ? "Clock Out" : "Dépointer"}</button>}</div>;
}

export default function Home() {
  const clientReady = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [language, setLanguage] = useState<Language>(() => loadStored("rpm-diesel-language", "en" as Language));
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
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loginName, setLoginName] = useState("Andrée-Anne");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [jobFilter, setJobFilter] = useState<"All" | JobStatus>("All");
  const [unitSearch, setUnitSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientData, setClientData] = useState<string[]>(() => loadStored("rpm-diesel-clients", defaultClients));
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [editingClientName, setEditingClientName] = useState("");
  const [modal, setModal] = useState<"job" | "unit" | "detail" | "history" | null>(null);
  const [completionPrompt, setCompletionPrompt] = useState<{ job: Job; reading: string } | null>(null);
  const [historyUnit, setHistoryUnit] = useState<Unit | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
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
    pmInterval: "25000",
    meterUnit: "KM" as Unit["meterUnit"],
    tech: "Unassigned",
    priority: "Normal" as Job["priority"],
    status: "In Progress" as JobStatus,
  });
  const [noteText, setNoteText] = useState("");
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
  const [punchPeriod, setPunchPeriod] = useState<"day" | "week" | "month">("week");
  const [punchAnchorDate, setPunchAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
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
      setPunchAnchorDate(next.toISOString().slice(0, 10));
    };
    document.addEventListener("click", handleDayNavigation, true);
    return () => document.removeEventListener("click", handleDayNavigation, true);
  }, [punchPeriod, punchAnchorDate]);
  const [editingTimeEntryId, setEditingTimeEntryId] = useState<string | null>(null);
  const [editingTimeEntry, setEditingTimeEntry] = useState<CloudTimeEntry | null>(null);
  const [unitData, setUnitData] = useState<Unit[]>(units);
  const [meterOverrides, setMeterOverrides] = useState<Record<string, Pick<Unit, "currentMeter" | "lastPmMeter" | "pmInterval" | "meterUnit">>>(() => loadStored("rpm-diesel-meter-overrides", {}));
  const [jobData, setJobData] = useState<Job[]>(jobs);
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
  const t = (key: string) => translations[language][key] ?? ({
    day: language === "en" ? "Day" : "Jour",
    partNumber: language === "en" ? "Part number" : "Numéro de pièce",
    adminPendingEstimates: language === "en" ? "Pending estimates require review." : "Des estimations en attente doivent être vérifiées.",
    adminPendingParts: language === "en" ? "Check the reception of pending parts." : "Vérifiez la réception des pièces en attente.",
    reviewEstimates: language === "en" ? "Review estimates →" : "Vérifier les estimations →",
    reviewParts: language === "en" ? "Review parts →" : "Vérifier les pièces →",
    onTheClock: language === "en" ? "On the clock" : "Pointé",
    offTheClock: language === "en" ? "Off the clock" : "Non pointé",
    selectWorkOrderFirst: language === "en" ? "Select a work order first" : "Sélectionnez d'abord un ordre",
    selectWorkOrder: language === "en" ? "Select work order" : "Sélectionner un ordre",
    clockIn: language === "en" ? "Clock In" : "Pointer",
    clockOut: language === "en" ? "Clock Out" : "Dépointer",
    clockInThisWorkOrder: language === "en" ? "Clock In on this work order" : "Pointer sur cet ordre",
    addTechnicianTime: language === "en" ? "Add technician time manually" : "Ajouter du temps technicien manuellement",
    hoursDecimal: language === "en" ? "Hours (decimal)" : "Heures (décimal)",
    closingMeterReading: language === "en" ? "Closing meter reading" : "Lecture du compteur de fermeture",
    enterCurrentMeter: language === "en" ? "Enter the current meter before completing this work order." : "Entrez le compteur actuel avant de compléter cet ordre.",
    finalMeterReading: language === "en" ? "Final meter reading" : "Lecture finale du compteur",
    completeWorkOrder: language === "en" ? "Complete work order" : "Compléter l'ordre",
    meterType: language === "en" ? "Meter type" : "Type de compteur",
    currentMileageHours: language === "en" ? "Current mileage / hours" : "Kilométrage / heures actuels",
    pmIntervalLabel: language === "en" ? "PM interval" : "Intervalle PM",
    pmIntervalExceeded: language === "en" ? "PM interval exceeded" : "Intervalle PM dépassé",
    sinceLastPm: language === "en" ? "since last PM" : "depuis le dernier PM",
    quantity: language === "en" ? "Qty" : "Qté",
    addAnItem: language === "en" ? "Add an item" : "Ajouter un article",
    manageLivePunches: language === "en" ? "Manage technician live punches" : "Gérer les poinçons actifs des techniciens",
    clockInTechnician: language === "en" ? "Clock in technician" : "Pointer le technicien",
    activeTechnicianPunches: language === "en" ? "Active technician punches" : "Poinçons actifs des techniciens",
    pmDue: language === "en" ? "PM Due" : "PM requis",
    addPmService: language === "en" ? "Add PM service" : "Ajouter le service PM",
  }[key] ?? key);
  const todayLabel = new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium" }).format(new Date());
  const formatCurrency = (amount: number) => new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
  const exportJobs = () => {
    const headers = [t("workOrder"), t("unitClient"), t("technician"), t("priority"), t("status"), t("updated")];
    const rows = filteredJobs.map((job) => [job.id, `${job.unit} - ${job.client}`, job.tech, t(job.priority), t(job.status), job.updated]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `rpm-work-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
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
  const clockIn = async (workOrderId: string | null) => {
    if (!activeUser || activeTimeEntry || !workOrderId) return;
    try {
      const created = await createTimeEntry({ userId: activeUser, userName: activeUser, workOrderId, clockIn: new Date().toISOString() });
      if (created) setTimeEntries((current) => [created, ...current]);
      else setCloudError(t("cloudTimeMissing"));
    } catch (error) { setCloudError(`Clock in failed: ${(error as Error).message}`); }
  };
  const clockOut = async () => {
    if (!activeTimeEntry) return;
    const clockOutTime = new Date();
    const totalHours = (clockOutTime.getTime() - new Date(activeTimeEntry.clockIn).getTime()) / 3600000;
    try {
      await completeTimeEntry(activeTimeEntry.id, clockOutTime.toISOString(), Number(totalHours.toFixed(2)));
      setTimeEntries((current) => current.map((entry) => entry.id === activeTimeEntry.id ? { ...entry, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)), status: "completed" } : entry));
    } catch (error) { setCloudError(`Clock out failed: ${(error as Error).message}`); }
  };
  const adminClockIn = async () => {
    if (!isAdmin || !adminPunchUser || !adminPunchJob || timeEntries.some((entry) => entry.userId === adminPunchUser && entry.status === "active")) return;
    try {
      const created = await createTimeEntry({ userId: adminPunchUser, userName: adminPunchUser, workOrderId: adminPunchJob, clockIn: new Date().toISOString() });
      if (created) setTimeEntries((current) => [created, ...current]);
    } catch (error) { setCloudError(`Technician clock in failed: ${(error as Error).message}`); }
  };
  const adminClockOut = async (entry: CloudTimeEntry) => {
    if (!isAdmin || entry.status !== "active") return;
    const clockOutTime = new Date();
    const totalHours = (clockOutTime.getTime() - new Date(entry.clockIn).getTime()) / 3600000;
    try {
      await completeTimeEntry(entry.id, clockOutTime.toISOString(), Number(totalHours.toFixed(2)));
      setTimeEntries((current) => current.map((item) => item.id === entry.id ? { ...item, clockOut: clockOutTime.toISOString(), totalHours: Number(totalHours.toFixed(2)), status: "completed" } : item));
    } catch (error) { setCloudError(`Technician clock out failed: ${(error as Error).message}`); }
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
    } catch (error) { setCloudError(`Manual time entry failed: ${(error as Error).message}`); }
  };
  const startTimeEntryEdit = (entry: CloudTimeEntry) => {
    setEditingTimeEntryId(entry.id);
    setEditingTimeEntry({ ...entry });
  };
  const saveTimeEntryEdit = async () => {
    if (!editingTimeEntry) return;
    try {
      await updateTimeEntry(editingTimeEntry);
      setTimeEntries((current) => current.map((entry) => entry.id === editingTimeEntry.id ? editingTimeEntry : entry));
      setEditingTimeEntryId(null);
      setEditingTimeEntry(null);
    } catch (error) {
      setCloudError(`Time entry update failed: ${(error as Error).message}`);
    }
  };
  const deleteTimeEntry = async (entryId: string) => {
    if (!isAdmin || !confirmDeletion("punch")) return;
    const entry = timeEntries.find((candidate) => candidate.id === entryId);
    const linkedJob = entry?.workOrderId ? jobData.find((job) => job.id === entry.workOrderId) : undefined;
    if (linkedJob?.status === "Completed") {
      setActionError(language === "en" ? "Punches linked to completed work orders cannot be deleted." : "Les poinçons liés aux ordres complétés ne peuvent pas être supprimés.");
      window.setTimeout(() => setActionError(null), 8000);
      return;
    }
    try {
      await removeTimeEntry(entryId);
      setTimeEntries((current) => current.filter((entry) => entry.id !== entryId));
      if (editingTimeEntryId === entryId) {
        setEditingTimeEntryId(null);
        setEditingTimeEntry(null);
      }
    } catch (error) {
      setCloudError(`Time entry deletion failed: ${(error as Error).message}`);
    }
  };
  const currentAccount = userAccounts.find((account) => account.name === activeUser);
  const isAdmin = currentAccount?.role === "Admin";
  const confirmDeletion = (kind: "workOrder" | "unit" | "client" | "punch" | "user") => {
    const labels = language === "fr"
      ? { workOrder: "cet ordre de travail", unit: "cette unité", client: "ce client", punch: "ce poinçon", user: "cet utilisateur" }
      : { workOrder: "this work order", unit: "this unit", client: "this client", punch: "this punch entry", user: "this user" };
    return window.confirm(language === "fr" ? `Voulez-vous vraiment supprimer ${labels[kind]} ?` : `Are you sure you want to delete ${labels[kind]}?`);
  };
  const visibleNavItems = isAdmin ? [...navItems, { id: "users" as Section, label: "userManagement", icon: "♙" }] : navItems;
  const canManageWorkOrders = isAdmin;
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
  const removeUser = (id: string) => {
    if (!isAdmin) return;
    const account = userAccounts.find((candidate) => candidate.id === id);
    if (!account || account.name === "Marc" || account.name === activeUser || !confirmDeletion("user")) return;
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
  const addClient = (input: HTMLInputElement) => {
    const name = input.value.trim();
    if (!name || clientData.includes(name)) return;
    setClientData((current) => [name, ...current]);
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
    window.localStorage.setItem("rpm-diesel-users", JSON.stringify(userAccounts));
  }, [userAccounts]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-clients", JSON.stringify(clientData));
  }, [clientData]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-meter-overrides", JSON.stringify(meterOverrides));
  }, [meterOverrides]);
  useEffect(() => {
    let cancelled = false;
    if (!hasSupabaseConfig) return;
    Promise.all([loadFleetData(), loadUsers(), loadTimeEntries()]).then(([data, cloudUsers, cloudTimeEntries]) => {
      if (cancelled) return;
      if (data) {
        remoteJobsUpdate.current = true;
        remoteUnitsUpdate.current = true;
        setJobData(data.jobs as Job[]);
        setUnitData((data.units as Unit[]).map((unit) => ({ ...unit, ...(meterOverrides[unit.unit] ?? {}) })));
      }
      if (cloudUsers?.length) { remoteUsersUpdate.current = true; setUserAccounts(cloudUsers as UserAccount[]); }
      if (cloudTimeEntries) setTimeEntries(cloudTimeEntries);
      setCloudError(null);
      setCloudReady(true);
      setCloudLoading(false);
    }).catch((error: Error) => {
      setCloudError(error.message);
      setCloudReady(true);
      setCloudLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeUser, meterOverrides]);
  useEffect(() => {
    if (!cloudReady || remoteUsersUpdate.current) { remoteUsersUpdate.current = false; return; }
    void saveUsers(userAccounts);
  }, [userAccounts, cloudReady]);
  useEffect(() => {
    if (!cloudReady || remoteJobsUpdate.current) {
      remoteJobsUpdate.current = false;
      return;
    }
    void saveJobs(jobData);
  }, [jobData, cloudReady]);
  useEffect(() => {
    if (!cloudReady || remoteUnitsUpdate.current) {
      remoteUnitsUpdate.current = false;
      return;
    }
    void saveUnits(unitData);
  }, [unitData, cloudReady]);
  useEffect(() => {
    if (!cloudReady || !hasSupabaseConfig) return;
    const applyUnitChange = (change: RealtimeChange<CloudUnit>) => {
      remoteUnitsUpdate.current = true;
      setUnitData((current) => {
        const unitId = change.record?.unit ?? change.oldRecord?.unit;
        if (!unitId) return current;
        if (change.eventType === "DELETE") return current.filter((unit) => unit.unit !== unitId);
        if (!change.record) return current;
        const nextUnit = change.record as Unit;
        const existing = current.some((unit) => unit.unit === nextUnit.unit);
        return existing ? current.map((unit) => unit.unit === nextUnit.unit ? nextUnit : unit) : [nextUnit, ...current];
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
        const existing = current.some((job) => job.id === nextJob.id);
        return existing ? current.map((job) => job.id === nextJob.id ? nextJob : job) : [nextJob, ...current];
      });
    };
    const refreshFromCloud = () => {
      if (cloudRefreshInFlight.current) return;
      cloudRefreshInFlight.current = true;
      void Promise.all([loadFleetData(), loadUsers(), loadTimeEntries()]).then(([data, cloudUsers, cloudTimeEntries]) => {
        if (!data) return;
        remoteJobsUpdate.current = true;
        remoteUnitsUpdate.current = true;
        setJobData(data.jobs as Job[]);
        setUnitData((data.units as Unit[]).map((unit) => ({ ...unit, ...(meterOverrides[unit.unit] ?? {}) })));
        if (cloudUsers?.length) { remoteUsersUpdate.current = true; setUserAccounts(cloudUsers as UserAccount[]); }
        if (cloudTimeEntries) setTimeEntries(cloudTimeEntries);
        setCloudError(null);
      }).catch((error: Error) => setCloudError(`Cloud sync retrying: ${error.message}`)).finally(() => {
        cloudRefreshInFlight.current = false;
      });
    };
    refreshFromCloud();
    cloudPollTimer.current = setInterval(refreshFromCloud, 2500);
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
  }, [cloudReady, activeUser, meterOverrides]);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "rpm-diesel-session") {
        const stored = event.newValue ? JSON.parse(event.newValue) as string | { name?: string } : null;
        setActiveUser(typeof stored === "string" ? stored : stored?.name ?? null);
      }
      if (event.key === "rpm-diesel-language" && event.newValue) setLanguage(JSON.parse(event.newValue) as Language);
      if (event.key === "rpm-diesel-users" && event.newValue) setUserAccounts(JSON.parse(event.newValue) as UserAccount[]);
      if (event.key === "rpm-diesel-clients" && event.newValue) setClientData(JSON.parse(event.newValue) as string[]);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const filteredJobs = jobFilter === "All"
    ? jobData.filter((job) => job.status.trim() !== "Completed")
    : jobData.filter((job) => job.status.trim() === jobFilter);
  const openJobsQueue = () => {
    setJobFilter("All");
    setSection("jobs");
  };
  const filteredUnits = useMemo(
    () =>
      unitData.filter((unit) =>
        `${unit.unit} ${unit.vin} ${unit.client}`
          .toLowerCase()
          .includes(unitSearch.toLowerCase()),
      ),
    [unitData, unitSearch],
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
            <label>{t("name")}<select value={loginName} onChange={(event) => setLoginName(event.target.value)}>{accounts.map((account) => <option key={account.id}>{account.name}</option>)}</select></label>
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
  const workedHoursFor = (workOrderId: string) => timeEntries.filter((entry) => entry.workOrderId === workOrderId && entry.totalHours != null).reduce((total, entry) => total + (entry.totalHours ?? 0), 0).toFixed(2);
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
  const scopedTimeEntries = currentAccount?.role === "Admin" ? timeEntries : timeEntries.filter((entry) => entry.userId === activeUser);
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
  const syncUnitFromJob = (
    job: Job,
    status: JobStatus = job.status,
    usage = job.usage,
  ) => {
    setUnitData((current) =>
      current.map((unit) =>
        unit.unit === job.unit
          ? {
              ...unit,
              client: job.client,
              usage,
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
    const updatedJob = { ...job, status, updated: "Just now" };
    setJobData((current) => current.map((item) => item.id === id ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => setCloudError(`Work order update failed: ${error.message}`));
  };
  const updateJobRecord = (job: Job, field: "tech" | "priority" | "status" | "usage" | "issue", value: string) => {
    const updatedJob = { ...job, [field]: value, updated: "Just now" } as Job;
    setJobData((current) => current.map((item) => item.id === job.id ? updatedJob : item));
    void saveJobs([updatedJob]).catch((error: Error) => setCloudError(`Work order update failed: ${error.message}`));
    return updatedJob;
  };
  const openModal = (kind: "job" | "unit") => {
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
    setNoteText("");
    setLineItem({ kind: "Part", partNumber: "", description: "", quantity: "1", amount: "" });
    setModal("detail");
  };
  const openUnitEditor = (unit: Unit) => {
    if (modal === "history") return;
    setEditingUnitId(unit.unit);
    setForm({
      unit: unit.unit,
      client: unit.client,
      vin: unit.vin,
      type: unit.type,
      issue: "",
      service: unit.service,
      usage: unit.usage,
      meterReading: "",
      currentMeter: unit.currentMeter == null ? "" : String(unit.currentMeter),
      pmInterval: String(unit.pmInterval),
      meterUnit: unit.meterUnit,
      tech: "Unassigned",
      priority: "Normal",
      status: "In Progress",
    });
    setModal("unit");
  };
  const openUnitHistory = (unit: Unit) => { setHistoryUnit(unit); setEditingUnitId(null); setModal("history"); };
  const closeModal = () => setModal(null);
  const updateForm = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const selectUnit = (value: string) => {
    if (value === "__add_new_unit__") {
      setReturnToJob(true);
      setModal("unit");
      return;
    }
    const selectedUnit = unitData.find((unit) => unit.unit === value);
    setForm((current) => ({
      ...current,
      unit: value,
      client: selectedUnit?.client ?? "",
      usage: selectedUnit?.usage ?? "",
      meterReading: selectedUnit?.currentMeter == null ? "" : String(selectedUnit.currentMeter),
      meterUnit: selectedUnit?.meterUnit ?? current.meterUnit,
    }));
  };
  const saveNote = () => {
    if (!detailJobId || !noteText.trim()) return;
    const note: Note = {
      id: createId(),
      text: noteText.trim(),
      author: activeUser ?? "RPM Diesel",
      createdAt: new Date().toISOString(),
    };
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? { ...job, notes: [...(job.notes ?? []), note], updated: "Just now" }
          : job,
      ),
    );
    setNoteText("");
  };
  const canManageNote = (note?: Note) => canManageWorkOrders || note?.author === activeUser;
  const updateNote = (noteId: string, text: string) =>
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              notes: (job.notes ?? []).map((note) =>
                note.id === noteId && canManageNote(note) ? { ...note, text } : note,
              ),
            }
          : job,
      ),
    );
  const deleteNote = (noteId: string) =>
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              notes: (job.notes ?? []).filter((note) => note.id !== noteId || !canManageNote(note)),
            }
          : job,
      ),
    );
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
    const reading = Number(completionPrompt.reading);
    if (!Number.isFinite(reading) || reading < 0) return;
    const updatedJob = { ...completionPrompt.job, status: "Completed" as JobStatus, meterReading: reading, updated: "Just now" };
    setJobData((current) => current.map((item) => item.id === updatedJob.id ? updatedJob : item));
    const unit = unitData.find((item) => item.unit === updatedJob.unit);
    if (unit) setUnitData((current) => current.map((item) => item.unit === unit.unit ? { ...item, currentMeter: reading, overdue: reading - (item.lastPmMeter ?? item.currentMeter ?? reading) >= (item.pmInterval ?? 25000) } : item));
    await saveJobs([updatedJob]);
    setCompletionPrompt(null);
  };
  const addPmServiceLine = () => {
    if (!detailJobId) return;
    setJobData((current) => current.map((job) => job.id === detailJobId ? { ...job, lineItems: [...(job.lineItems ?? []), { id: createId(), kind: "Labor", partNumber: "PM", description: "Preventive maintenance service", quantity: 1, amount: 0 }], updated: "Just now" } : job));
  };
  const deleteJob = (id: string) => {
    if (!canManageWorkOrders || !confirmDeletion("workOrder")) return;
    setJobData((current) => current.filter((job) => job.id !== id));
    void removeJob(id);
    void writeActivityLog(activeUser ?? "Unknown", "deleted", "work_order", id);
    setModal(null);
    setDetailJobId(null);
  };
  const deleteUnit = (unitId: string) => {
    if (!isAdmin || !confirmDeletion("unit")) return;
    setUnitData((current) => current.filter((unit) => unit.unit !== unitId));
    void removeUnit(unitId);
    void writeActivityLog(activeUser ?? "Unknown", "deleted", "unit", unitId);
    setModal(null);
    setEditingUnitId(null);
  };
  const togglePm = (unitId: string) =>
    setUnitData((current) =>
      current.map((unit) =>
        unit.unit === unitId ? { ...unit, overdue: !unit.overdue } : unit,
      ),
    );
  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modal === "job") {
      if (!form.meterReading.trim() || !form.unit) {
        setCloudError(language === "en" ? "Opening meter reading is required." : "La lecture du compteur à l'ouverture est obligatoire.");
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
        meterReading: Number(form.meterReading),
        notes: [],
        lineItems: [],
      };
      try {
        await saveJobs([newJob]);
      } catch (error) {
        setCloudError(`Work order was not saved: ${(error as Error).message}`);
        return;
      }
      setJobData((current) => [newJob, ...current]);
      const openingMeter = Number(form.meterReading);
      const linkedUnit = unitData.find((unit) => unit.unit === newJob.unit);
      if (linkedUnit && Number.isFinite(openingMeter)) {
        const pmBaseline = linkedUnit.lastPmMeter ?? linkedUnit.currentMeter ?? openingMeter;
        const pmOverdue = openingMeter - pmBaseline >= (linkedUnit.pmInterval ?? 25000);
        const updatedUnit = { ...linkedUnit, currentMeter: openingMeter, overdue: pmOverdue };
        setUnitData((current) => current.map((unit) => unit.unit === updatedUnit.unit ? updatedUnit : unit));
        setMeterOverrides((current) => ({ ...current, [updatedUnit.unit]: { currentMeter: updatedUnit.currentMeter, lastPmMeter: updatedUnit.lastPmMeter, pmInterval: updatedUnit.pmInterval, meterUnit: updatedUnit.meterUnit } }));
      }
      syncUnitFromJob(newJob, newJob.status, newJob.usage);
      void writeActivityLog(activeUser ?? "Unknown", "created", "work_order", newJob.id, { unit: newJob.unit });
      setSection("jobs");
    }
    if (modal === "unit") {
      const newUnit = {
        unit: form.unit,
        vin: form.vin,
        client: form.client,
        type: form.type || "Fleet unit",
        service: form.service || "Not serviced yet",
        due: "Schedule PM",
        overdue: false,
        usage: form.currentMeter ? `${form.currentMeter} ${form.meterUnit}` : "Not recorded",
        currentMeter: form.currentMeter ? Number(form.currentMeter) : null,
        lastPmMeter: form.currentMeter ? Number(form.currentMeter) : null,
        pmInterval: Number(form.pmInterval) || 25000,
        meterUnit: form.meterUnit,
      };
      setMeterOverrides((current) => ({ ...current, [newUnit.unit]: { currentMeter: newUnit.currentMeter, lastPmMeter: newUnit.lastPmMeter, pmInterval: newUnit.pmInterval, meterUnit: newUnit.meterUnit } }));
      try {
        if (editingUnitId) {
          await saveUnits([newUnit]);
        } else {
          await saveUnits([newUnit]);
        }
      } catch (error) {
        setCloudError(`Unit was not saved: ${(error as Error).message}`);
        return;
      }
      setUnitData((current) =>
        editingUnitId
          ? current.map((unit) =>
              unit.unit === editingUnitId ? newUnit : unit,
            )
          : [newUnit, ...current],
      );
      void writeActivityLog(activeUser ?? "Unknown", editingUnitId ? "updated" : "created", "unit", newUnit.unit);
      if (returnToJob) {
        setForm((current) => ({
          ...current,
          unit: newUnit.unit,
          client: newUnit.client,
        }));
        setReturnToJob(false);
        setModal("job");
        return;
      }
      setSection("units");
    }
    closeModal();
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
              >
                <span className="nav-icon">{item.icon}</span>
                {t(item.label)}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="online-dot" />
            <div>
                <b>{t("systemOperational")}</b>
              <small>{t("lastSynced")}</small>
            </div>
          </div>
        </aside>
        <main className="main-content">
          {!hasSupabaseConfig && <div className="cloud-banner cloud-warning">{t("cloudNotConfigured")}</div>}
          {cloudError && <div className="cloud-banner cloud-warning">{cloudError}</div>}
          {actionError && <div className="cloud-banner cloud-error" role="alert">{actionError}</div>}
          {cloudLoading && <div className="dashboard-sync-indicator"><span className="sync-pulse" /> {language === "en" ? "Syncing fleet data" : "Synchronisation des données de flotte"}</div>}
          <div className="mobile-nav-select">
            <span className="mobile-nav-label">{t("section")}</span>
            <select value={section} onChange={(event) => setSection(event.target.value as Section)} aria-label={t("chooseSection")}>
              {visibleNavItems.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
            </select>
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
              <p className="page-subtitle">
                {section === "overview"
                  ? t("overviewSubtitle")
                  : section === "jobs"
                    ? t("jobsSubtitle")
                    : section === "units"
                        ? t("unitsSubtitle")
                        : section === "users"
                          ? t("usersSubtitle")
                          : t("clientsSubtitle")}
              </p>
            </div>
            <div className="date-chip">□ &nbsp; {todayLabel}</div>
          </div>
          {section === "overview" && (
            <>
              {(() => {
                const openTechnicianJobs = jobData.filter((job) => job.tech === activeUser && job.status === "In Progress").length;
                return openTechnicianJobs > 0 ? (
                  <div className="alert-banner alert-danger">
                    <span className="alert-icon">!</span>
                    <div>
                      <b>{openTechnicianJobs} {workloadAlert.assigned.replace("job(s)", openTechnicianJobs === 1 ? "job" : "jobs").replace("travail(aux)", openTechnicianJobs === 1 ? "travail" : "travaux")}</b>
                      <span>{workloadAlert.continue}</span>
                    </div>
                    <button onClick={openJobsQueue}>{workloadAlert.view}</button>
                  </div>
                ) : null;
              })()}
              {longPunchEntries.length > 0 && <div className="alert-banner alert-warning">
                <span className="alert-icon">!</span>
                <div>
                  <b>{language === "en" ? `${longPunchEntries.length} punch${longPunchEntries.length === 1 ? "" : "es"} exceeds 7.00 hours.` : `${longPunchEntries.length} poinçon${longPunchEntries.length === 1 ? "" : "s"} dépasse 7,00 heures.`}</b>
                  <span>{language === "en" ? "Please verify the clock-out time and work order." : "Veuillez vérifier l'heure de dépointage et l'ordre de travail."}</span>
                </div>
                <button onClick={() => setSection("punch")}>{language === "en" ? "Review punches →" : "Vérifier les poinçons →"}</button>
              </div>}
              {isAdmin && jobData.filter((job) => job.status === "Waiting on Estimates").length > 0 && <div className="alert-banner alert-danger">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Waiting on Estimates").length} {t("adminPendingEstimates")}</b></div>
                <button onClick={() => { setJobFilter("Waiting on Estimates"); setSection("jobs"); }}>{t("reviewEstimates")}</button>
              </div>}
              {isAdmin && jobData.filter((job) => job.status === "Waiting on Parts").length > 0 && <div className="alert-banner alert-danger">
                <span className="alert-icon">!</span>
                <div><b>{jobData.filter((job) => job.status === "Waiting on Parts").length} {t("adminPendingParts")}</b></div>
                <button onClick={() => { setJobFilter("Waiting on Parts"); setSection("jobs"); }}>{t("reviewParts")}</button>
              </div>}
              {unitData.filter((unit) => unit.overdue).length > 0 && <div className="alert-banner">
                <span className="alert-icon">!</span>
                <div>
                  <b>{unitData.filter((unit) => unit.overdue).length} {t("overduePm")}</b>
                  <span>{language === "en" ? " Schedule service before they go back on the road." : " Planifiez le service avant leur retour sur la route."}</span>
                </div>
                <button onClick={() => setSection("units")}>{t("reviewUnits")}</button>
              </div>}
              <section className="metrics-grid">
                <div className="section-card metric-group">
                  <div className="card-heading">
                    <div>
                            <p className="card-kicker">{t("workOrders")}</p>
                              <h2>{t("activeJobs")}</h2>
                    </div>
                    <button className="more-button" onClick={openJobsQueue} aria-label={t("activeJobQueue")}>•••</button>
                  </div>
                  <MetricCard
                    label={t("totalInProgress")}
                    value={String(jobData.filter((job) => job.status === "In Progress").length)}
                    detail={language === "en" ? "Live from the work-order queue" : "Données en direct de la file des travaux"}
                    icon="↗"
                  />
                  <div className="mini-metrics">
                    <div>
                      <span>● {t("waitingParts")}</span>
                      <b>{jobData.filter((job) => job.status === "Waiting on Parts").length}</b>
                    </div>
                    <div>
                      <span>● {t("waitingEstimates")}</span>
                      <b>{jobData.filter((job) => job.status === "Waiting on Estimates").length}</b>
                    </div>
                  </div>
                </div>
                <div className="section-card metric-group">
                  <div className="card-heading">
                    <div>
                            <p className="card-kicker">{t("fleetHealth")}</p>
                              <h2>{t("unitStatus")}</h2>
                    </div>
                    <button className="more-button" onClick={() => setSection("units")} aria-label={t("unitManagement")}>•••</button>
                  </div>
                  <MetricCard
                    label={t("totalUnits")}
                    value={String(unitData.length)}
                    detail={t("allFleetRecords")}
                    tone="blue"
                    icon="↗"
                  />
                  <div className="unit-progress">
                    <div className="progress-label">
                      <span>{t("pmCompliance")}</span>
                      <b>
                        {unitData.length
                          ? `${Math.round(((unitData.length - unitData.filter((unit) => unit.overdue).length) / unitData.length) * 1000) / 10}%`
                          : "0%"}
                      </b>
                    </div>
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${unitData.length ? ((unitData.length - unitData.filter((unit) => unit.overdue).length) / unitData.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p>
                      {unitData.filter((unit) => unit.overdue).length} {t("overduePm")}
                    </p>
                  </div>
                </div>
                <div className="section-card metric-group">
                  <div className="card-heading">
                    <div>
                            <p className="card-kicker">{t("fieldOperations")}</p>
                              <h2>{t("fieldService")}</h2>
                    </div>
                    <button className="more-button" onClick={openJobsQueue} aria-label={t("activeJobQueue")}>•••</button>
                  </div>
                  <MetricCard
                    label={t("techsOnRoad")}
                    value={String(new Set(jobData.filter((job) => job.status !== "Completed" && job.tech !== "Unassigned").map((job) => job.tech)).size)}
                    detail={language === "en" ? "Assigned technicians on active jobs" : "Techniciens assignés aux travaux actifs"}
                    tone="green"
                    icon="↗"
                  />
                  <div className="mini-metrics">
                    <div>
                      <span>● {t("unassignedCalls")}</span>
                      <b>{jobData.filter((job) => job.tech === "Unassigned" && job.status !== "Completed").length}</b>
                    </div>
                    <div>
                      <span>● {t("responseTime")}</span>
                      <b>
                        {t("noData")} <small>min</small>
                      </b>
                    </div>
                  </div>
                </div>
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
                  {jobData.slice(0, 3).map((job, index) => (
                    <div className="activity-row" key={job.id}>
                      <span className={`activity-mark mark-${index}`} />
                      <div className="activity-copy">
                        <p>
                          <b>{job.unit}</b> {language === "en" ? "was assigned to" : "a été assigné à"} <b>{job.tech}</b>
                        </p>
                        <span>
                          {job.issue} · {job.updated}
                        </span>
                      </div>
                      <StatusPill status={job.status} language={language} />
                    </div>
                  ))}
                </div>
                <div className="section-card quick-card">
                  <p className="card-kicker">{t("quickActions")}</p>
                  <h2>{t("quickQuestion")}</h2>
                  <button
                    onClick={openJobsQueue}
                    className="quick-action"
                  >
                    <i>+</i>
                    <span>
                      <b>{t("createWorkOrder")}</b>
                      <small>{t("startService")}</small>
                    </span>
                    →
                  </button>
                  <button
                    onClick={() => setSection("units")}
                    className="quick-action"
                  >
                    <i>+</i>
                    <span>
                      <b>{t("addUnit")}</b>
                      <small>{t("registerAsset")}</small>
                    </span>
                    →
                  </button>
                </div>
              </section>
            </>
          )}
          {section === "punch" && (
            <section className="section-card full-card punch-page-card">
              <div className="toolbar"><div><p className="card-kicker">{t("punchClock")}</p><h2>{t("punchClock")}</h2></div></div>
              <p className="punch-page-copy">{t("punchSubtitle")}</p>
              <PunchClock activeEntry={activeTimeEntry} jobs={jobData} language={language} onClockIn={clockIn} onClockOut={clockOut} />
              {canManageWorkOrders && <><div className="manual-time-card"><div className="detail-section-heading"><h3>{t("addTechnicianTime")}</h3></div><div className="manual-time-form"><select value={manualTimeUser} onChange={(event) => setManualTimeUser(event.target.value)} aria-label={t("technician")}><option value="">{t("technician")}</option>{userAccounts.filter((account) => account.active && account.isTechnician).map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}</select><select value={manualTimeJob} onChange={(event) => setManualTimeJob(event.target.value)} aria-label={t("workOrder")}><option value="">{t("noData")}</option>{jobData.filter((job) => job.status !== "Completed").map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select><input type="number" min="0.01" step="0.01" value={manualTimeHours} onChange={(event) => setManualTimeHours(event.target.value)} placeholder={t("hoursDecimal")} aria-label={t("hoursDecimal")} /><button className="primary-button" onClick={addManualTime}>{t("add")}</button></div></div><div className="manual-time-card"><div className="detail-section-heading"><h3>{t("manageLivePunches")}</h3></div><div className="manual-time-form"><select value={adminPunchUser} onChange={(event) => setAdminPunchUser(event.target.value)} aria-label={t("technician")}><option value="">{t("technician")}</option>{userAccounts.filter((account) => account.active && account.isTechnician).map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}</select><select value={adminPunchJob} onChange={(event) => setAdminPunchJob(event.target.value)} aria-label={t("workOrder")}><option value="">{t("noData")}</option>{jobData.filter((job) => job.status !== "Completed").map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select><button className="primary-button" disabled={!adminPunchUser || !adminPunchJob} onClick={adminClockIn}>{t("clockInTechnician")}</button></div><div className="admin-active-punches">{timeEntries.filter((entry) => entry.status === "active" && entry.userId !== activeUser).map((entry) => <div className="admin-active-punch" key={entry.id}><span><strong>{entry.userName}</strong><small>{jobData.find((job) => job.id === entry.workOrderId)?.unit ?? t("noData")}</small></span><button className="punch-button punch-out" onClick={() => adminClockOut(entry)}>{t("clockOut")}</button></div>)}</div></div></>}
              <div className="punch-history-section">
                <select className="punch-period-select punch-period-select-all" value={punchPeriod} onChange={(event) => setPunchPeriod(event.target.value as "day" | "week" | "month")} aria-label={t("punchHistory")}><option value="day">{t("day")}</option><option value="week">{t("week")}</option><option value="month">{t("month")}</option></select>
                <div className="detail-section-heading punch-history-heading"><div><h3>{t("punchHistory")}</h3><span>{periodTimeEntries.length} {t("entries")} · {periodStart.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")} - {new Date(periodEnd.getTime() - 86400000).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")}</span></div><div className="punch-period-controls"><button type="button" className="period-nav-button" onClick={() => { const next = new Date(`${punchAnchorDate}T12:00:00`); if (punchPeriod === "week") next.setDate(next.getDate() - 7); else next.setMonth(next.getMonth() - 1); setPunchAnchorDate(next.toISOString().slice(0, 10)); }} aria-label={t("previousPeriod")}>‹</button><input className="punch-date-picker" type="date" value={punchAnchorDate} onChange={(event) => setPunchAnchorDate(event.target.value)} aria-label={t("chooseDate")} /><button type="button" className="period-nav-button" onClick={() => { const next = new Date(`${punchAnchorDate}T12:00:00`); if (punchPeriod === "week") next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1); setPunchAnchorDate(next.toISOString().slice(0, 10)); }} aria-label={t("nextPeriod")}>›</button><select className="punch-period-select" value={punchPeriod} onChange={(event) => setPunchPeriod(event.target.value as "week" | "month")} aria-label={t("punchHistory")}><option value="week">{t("week")}</option><option value="month">{t("month")}</option></select><button type="button" className="period-today-button" onClick={() => setPunchAnchorDate(new Date().toISOString().slice(0, 10))}>{t("currentPeriod")}</button></div></div>
                <div className="punch-day-groups">{punchGroups.map((group) => <div className={`punch-day-group ${group.dayKey === punchDayKey(new Date().toISOString()) ? "punch-day-current" : ""}`} key={group.dayKey}><strong>{group.dayKey === punchDayKey(new Date().toISOString()) ? `${t("today")} · ` : ""}{new Date(`${group.dayKey}T00:00:00`).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" })}</strong><span>{group.entries.length} {t("entries")}</span></div>)}</div>
                <div className="table-wrap"><table className="punch-history-table"><thead><tr><th>{t("punchedBy")}</th><th>{t("workOrder")}</th><th>{t("clockIn")}</th><th>{t("clockOut")}</th><th>{t("totalHours")}</th><th>{t("status")}</th>{canManageWorkOrders && <th />}</tr></thead><tbody>{visibleTimeEntries.length ? visibleTimeEntries.map((entry) => editingTimeEntryId === entry.id && editingTimeEntry ? <tr key={entry.id} className="time-entry-edit-row"><td><select value={editingTimeEntry.userName} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, userId: event.target.value, userName: event.target.value })}>{userAccounts.filter((account) => account.active && account.isTechnician).map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}</select></td><td><select value={editingTimeEntry.workOrderId ?? ""} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, workOrderId: event.target.value || null })}><option value="">{t("noData")}</option>{jobData.map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select></td><td><input type="datetime-local" value={editingTimeEntry.clockIn.slice(0, 16)} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, clockIn: new Date(event.target.value).toISOString() })} /></td><td><input type="datetime-local" value={editingTimeEntry.clockOut ? editingTimeEntry.clockOut.slice(0, 16) : ""} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, clockOut: event.target.value ? new Date(event.target.value).toISOString() : null, status: event.target.value ? "completed" : "active" })} /></td><td><input type="number" min="0" step="0.01" value={editingTimeEntry.totalHours ?? ""} onChange={(event) => setEditingTimeEntry({ ...editingTimeEntry, totalHours: event.target.value ? Number(event.target.value) : null })} /></td><td><span className={`time-status ${editingTimeEntry.status === "active" ? "time-active" : "time-completed"}`}>{editingTimeEntry.status === "active" ? t("activePunch") : t("Completed")}</span></td><td><div className="time-entry-actions"><button className="primary-button" onClick={saveTimeEntryEdit}>{t("save")}</button><button className="entry-delete" onClick={() => deleteTimeEntry(entry.id)}>{t("delete")}</button></div></td></tr> : <tr key={entry.id}><td><strong>{entry.userName}</strong></td><td>{entry.workOrderId ? (jobData.find((job) => job.id === entry.workOrderId)?.unit ?? entry.workOrderId) : t("noData")}</td><td>{new Date(entry.clockIn).toLocaleString()}</td><td>{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : t("activePunch")}</td><td>{entry.totalHours == null ? t("activePunch") : `${entry.totalHours.toFixed(2)} h`}</td><td><span className={`time-status ${entry.status === "active" ? "time-active" : "time-completed"}`}>{entry.status === "active" ? t("activePunch") : t("Completed")}</span></td>{canManageWorkOrders && <td><div className="time-entry-actions"><button className="outline-button" onClick={() => startTimeEntryEdit(entry)}>{t("edit")}</button><button className="entry-delete" onClick={() => deleteTimeEntry(entry.id)}>{t("delete")}</button></div></td>}</tr>) : <tr><td colSpan={canManageWorkOrders ? 7 : 6} className="empty-history">{t("noPunches")}</td></tr>}</tbody></table></div>
              </div>
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
                <div className="search-box">⌕<input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder={t("searchClients")} aria-label={t("searchClients")} /></div>
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
            <section className="section-card full-card">
              <div className="toolbar">
                <div>
                  <p className="card-kicker">{t("serviceOperations")}</p>
                  <h2>{t("workOrderQueue")}</h2>
                </div>
                <button
                  className="primary-button"
                  onClick={() => openModal("job")}
                >
                  {t("newWorkOrder")}
                </button>
              </div>
              <div className="filter-row">
                <div className="filter-tabs">
                  {(
                    [
                      "All",
                      "In Progress",
                      "Waiting on Parts",
                      "Waiting on Estimates",
                      "Completed",
                    ] as const
                  ).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setJobFilter(filter)}
                      className={jobFilter === filter ? "filter-active" : ""}
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
                <button className="outline-button" onClick={exportJobs}>{t("export")}</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("workOrder")}</th>
                      <th>{t("unitClient")}</th>
                      <th>{t("technician")}</th>
                      <th>{t("priority")}</th>
                      <th>{t("status")}</th>
                      <th>{t("updated")}</th>
                      <th />
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
                          <span className="work-order-id">{job.id}</span>
                          <span className="work-description">{job.issue}</span>
                        </td>
                        <td className="unit-client-cell">
                          <strong>{job.unit}</strong>
                          <span>{job.client}</span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          {canManageWorkOrders ? <select
                            className="inline-job-select technician-select"
                            value={job.tech}
                            onChange={(event) => updateJobRecord(job, "tech", event.target.value)}
                            aria-label={`${t("technician")} ${job.unit}`}
                          >
                            {Array.from(new Set([...technicianOptions, job.tech])).map((tech) => <option key={tech} value={tech}>{tech}</option>)}
                          </select> : <span className="read-only-job-value">{job.tech}</span>}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          {canManageWorkOrders ? <select
                            className={`inline-job-select priority-select priority-${job.priority.toLowerCase()}`}
                            value={job.priority}
                            onChange={(event) => updateJobRecord(job, "priority", event.target.value)}
                            aria-label={`${t("priority")} ${job.unit}`}
                          >
                            {(["High", "Normal", "Low"] as Job["priority"][]).map((priority) => <option key={priority} value={priority}>{t(priority)}</option>)}
                          </select> : <span className={`read-only-job-value priority-${job.priority.toLowerCase()}`}>{t(job.priority)}</span>}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <select
                            className="inline-job-select status-select"
                            value={job.status}
                            onChange={(event) => setStatus(job.id, event.target.value as JobStatus)}
                            aria-label={`${t("status")} ${job.unit}`}
                          >
                            {(["In Progress", "Waiting on Parts", "Waiting on Estimates", "Completed"] as JobStatus[]).map((status) => <option key={status} value={status}>{t(status)}</option>)}
                          </select>
                        </td>
                        <td className="updated-cell">{job.updated}</td>
                        <td>
                          <button
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              openJobDetails(job);
                            }}
                          >
                            •••
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-job-list">
                {filteredJobs.map((job) => <article className="mobile-job-card" key={`mobile-${job.id}`} onClick={() => openJobDetails(job)}><div className="mobile-job-heading"><div><strong>{job.unit}</strong><span>{job.client}</span></div><span className="work-order-id">{job.id}</span></div><p className="mobile-job-description">{job.issue}</p><div className="mobile-job-meta"><span><small>{t("technician")}</small>{job.tech}</span><span><small>{t("priority")}</small><b className={`mobile-job-priority priority-${job.priority.toLowerCase()}`}>{t(job.priority)}</b></span><span><small>{t("status")}</small><StatusPill status={job.status} language={language} /></span></div><small className="mobile-job-updated">{job.updated}</small></article>)}
              </div>
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
                  value={String(unitData.filter((unit) => unit.overdue).length)}
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
                  <div className="search-box">
                    ⌕
                    <input
                      value={unitSearch}
                      onChange={(event) => setUnitSearch(event.target.value)}
                      placeholder={language === "en" ? "Search by unit, VIN, or client name..." : "Rechercher une unité, un NIV ou un client..."}
                    />
                  </div>
                  <button className="outline-button" onClick={() => setUnitSearch("")}>{t("filters")}</button>
                </div>
                <div className="unit-list">
                  {filteredUnits.map((unit) => (
                    <div
                      className="unit-row"
                      key={unit.unit}
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
                        <b>{unit.usage}</b>
                      </div>
                      <div className="unit-meter-summary">
                        <label>PM / {unit.meterUnit}</label>
                        <b>{unit.currentMeter ?? "-"} / {unit.pmInterval}</b>
                      </div>
                      <div className="unit-due">
                        <button
                          type="button"
                          className={`pm-toggle ${unit.overdue ? "pm-needed" : "pm-clear"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePm(unit.unit);
                          }}
                          aria-label={`Toggle PM for ${unit.unit}`}
                        >
                          <span>{unit.overdue ? t("pmNeeded") : t("pmClear")}</span>
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
            <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
              <div className="modal-card detail-modal unit-history-modal">
                <div className="modal-header"><div><p className="card-kicker">{t("serviceHistory")}</p><h2>{historyUnit.unit}</h2><small>{historyUnit.client} · {historyUnit.type}</small></div><button type="button" className="modal-close" onClick={closeModal} aria-label={t("close")}>×</button></div>
                <div className="detail-section-heading"><h3>{t("completedWorkOrders")}</h3><span>{jobData.filter((job) => job.unit === historyUnit.unit && job.status === "Completed").length}</span></div>
                <div className="service-history-list">{jobData.filter((job) => job.unit === historyUnit.unit && job.status === "Completed").map((job) => <div className="service-history-row" key={job.id}><div><strong>{job.issue}</strong><small>{job.id} · {job.updated}</small></div><span>{job.tech}</span><b>{workedHoursFor(job.id)} h</b><button className="outline-button" onClick={() => openJobDetails(job)}>{language === "en" ? "Open" : "Ouvrir"}</button></div>)}{jobData.filter((job) => job.unit === historyUnit.unit && job.status === "Completed").length === 0 && <p className="empty-history">{language === "en" ? "No completed service history for this unit." : "Aucun historique de service complété pour cette unité."}</p>}</div>
              </div>
            </div>
          )}
          {modal === "detail" && activeJob && (
            <div
              className="modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeModal();
              }}
            >
              <div className="modal-card detail-modal">
                <div className="modal-header">
                  <div>
                    <p className="card-kicker">{t("workOrderDetails")} {activeJob.id}</p>
                    <h2>{activeJob.issue}</h2>
                    <small>
                      {activeJob.unit} · {activeJob.client} · {t("lastServiceUsage")}: {activeJob.usage}
                    </small>
                    <span className="work-order-total-hours">{t("totalWorked")}: {workedHoursFor(activeJob.id)} h</span>
                    {(() => { const unit = unitData.find((item) => item.unit === activeJob.unit); const due = unit && activeJob.meterReading != null && activeJob.meterReading - (unit.lastPmMeter ?? unit.currentMeter ?? activeJob.meterReading) >= (unit.pmInterval ?? 25000); return due ? <div className="cloud-banner cloud-warning work-order-pm-warning"><strong>{t("pmDue")}</strong><button type="button" className="outline-button" onClick={addPmServiceLine}>{t("addPmService")}</button></div> : null; })()}
                    <div className="work-order-punch-actions">
                      {activeTimeEntry?.workOrderId === activeJob.id ? <button type="button" className="punch-button punch-out" onClick={clockOut}>{t("clockOut")}</button> : <button type="button" className="punch-button punch-in" disabled={Boolean(activeTimeEntry)} onClick={() => clockIn(activeJob.id)}>{t("clockInThisWorkOrder")}</button>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close"
                    onClick={closeModal}
                    aria-label="Close details"
                  >
                    ×
                  </button>
                </div>
                <div className="detail-controls">
                  <label>
                    {t("serviceRequest")}
                    <input
                      value={activeJob.issue}
                      onChange={(event) =>
                        updateJob("issue", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("status")}
                    <select
                      value={activeJob.status}
                      onChange={(event) =>
                        updateJob("status", event.target.value)
                      }
                    >
                      {(
                        [
                          "In Progress",
                          "Waiting on Parts",
                          "Waiting on Estimates",
                          "Completed",
                        ] as JobStatus[]
                      ).map((status) => (
                        <option key={status} value={status}>{t(status)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("priority")}
                    {canManageWorkOrders ? <select
                      value={activeJob.priority}
                      onChange={(event) =>
                        updateJob("priority", event.target.value)
                      }
                    >
                      {(["High", "Normal", "Low"] as Job["priority"][]).map(
                        (priority) => (
                          <option key={priority} value={priority}>{t(priority)}</option>
                        ),
                      )}
                    </select> : <span className={`read-only-detail-value priority-${activeJob.priority.toLowerCase()}`}>{t(activeJob.priority)}</span>}
                  </label>
                  <label>
                    {t("technician")}
                    {canManageWorkOrders ? <select
                      value={activeJob.tech}
                      onChange={(event) =>
                        updateJob("tech", event.target.value)
                      }
                    >
                      {Array.from(new Set([...technicianOptions, activeJob.tech])).map((tech) => (
                        <option key={tech}>{tech}</option>
                      ))}
                    </select> : <span className="read-only-detail-value">{activeJob.tech}</span>}
                  </label>
                  <label>
                    {t("lastServiceUsage")}
                    <input
                      value={activeJob.usage}
                      onChange={(event) =>
                        updateJob("usage", event.target.value)
                      }
                      placeholder={t("usageExample")}
                    />
                  </label>
                </div>
                <div className="detail-section work-order-time-section">
                  <div className="detail-section-heading"><h3>{t("punchHistory")}</h3><span>{timeEntries.filter((entry) => entry.workOrderId === activeJob.id).length} {t("entries")}</span></div>
                  <div className="work-order-time-list">{timeEntries.filter((entry) => entry.workOrderId === activeJob.id).map((entry) => <div className="work-order-time-row" key={entry.id}><strong>{entry.userName}</strong><span>{new Date(entry.clockIn).toLocaleString()}</span><span>{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : t("activePunch")}</span><b>{entry.totalHours == null ? t("activePunch") : `${entry.totalHours.toFixed(2)} h`}</b></div>)}{timeEntries.filter((entry) => entry.workOrderId === activeJob.id).length === 0 && <small className="empty-history">{t("noPunches")}</small>}</div>
                </div>
                <div className="detail-section">
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
                          {new Date(note.createdAt).toLocaleString()}
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
                <div className="detail-section">
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
                      <label>
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
            </div>
          )}
          {completionPrompt && (
            <div className="modal-backdrop" role="presentation">
              <form className="modal-card completion-meter-modal" onSubmit={(event) => { event.preventDefault(); void completeJobWithMeter(); }}>
                <div className="modal-header"><div><p className="card-kicker">{t("workOrderDetails")}</p><h2>{t("closingMeterReading")}</h2><small>{t("enterCurrentMeter")} ({unitData.find((unit) => unit.unit === completionPrompt.job.unit)?.meterUnit ?? "KM"})</small></div></div>
                <div className="modal-fields"><label>{t("finalMeterReading")}<input autoFocus type="number" min="0" required value={completionPrompt.reading} onChange={(event) => setCompletionPrompt({ ...completionPrompt, reading: event.target.value })} /></label>{(() => { const unit = unitData.find((item) => item.unit === completionPrompt.job.unit); const reading = Number(completionPrompt.reading); const baseline = unit?.lastPmMeter ?? unit?.currentMeter ?? reading; return unit && Number.isFinite(reading) && reading - baseline >= (unit.pmInterval ?? 25000) ? <div className="cloud-banner cloud-warning">{t("pmIntervalExceeded")}: {reading - baseline} {unit.meterUnit} {t("sinceLastPm")}.</div> : null; })()}</div>
                <div className="modal-actions"><button type="button" className="outline-button" onClick={() => setCompletionPrompt(null)}>{t("cancel")}</button><button type="submit" className="primary-button">{t("completeWorkOrder")}</button></div>
              </form>
            </div>
          )}
          {modal !== "detail" && modal !== "history" && modal && (
            <div
              className="modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeModal();
              }}
            >
              <form className="modal-card" onSubmit={submitForm}>
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
                    onClick={closeModal}
                    aria-label="Close modal"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-fields">
                  {modal === "job" ? (
                    <>
                      <label>
                        {t("fleetUnit")}
                        <select
                          required
                          value={form.unit}
                          onChange={(event) => selectUnit(event.target.value)}
                        >
                          <option value="">
                            {t("selectUnit")}
                          </option>
                          {unitData.map((unit) => (
                            <option key={unit.unit} value={unit.unit}>
                              {unit.unit} · {unit.client}
                            </option>
                          ))}
                          <option value="__add_new_unit__">
                            {t("addNewUnitOption")}
                          </option>
                        </select>
                      </label>
                      <label>
                        {t("currentMileageHours")} ({form.meterUnit})
                        <input
                          required
                          type="number"
                          min="0"
                          value={form.meterReading}
                          onChange={(event) => updateForm("meterReading", event.target.value)}
                          placeholder={form.meterUnit === "KM" ? "250000" : "5000"}
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
                      <label>
                        {t("technician")}
                        <select
                          value={form.tech}
                          onChange={(event) =>
                            updateForm("tech", event.target.value)
                          }
                        >
                          {technicianOptions.map((tech) => <option key={tech} value={tech}>{tech}</option>)}
                        </select>
                      </label>
                      <label>
                        {t("priority")}
                        <select
                          value={form.priority}
                          onChange={(event) =>
                            updateForm("priority", event.target.value)
                          }
                        >
                          <option value="High">{t("High")}</option>
                          <option value="Normal">{t("Normal")}</option>
                          <option value="Low">{t("Low")}</option>
                        </select>
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
                      <label>
                        {t("clientName")}
                        <select
                          required
                          value={form.client}
                          onChange={(event) =>
                            updateForm("client", event.target.value)
                          }
                        >
                          <option value="">{language === "en" ? "Select a client" : "Sélectionner un client"}</option>
                          {Array.from(new Set([...clientData, ...(form.client && !clientData.includes(form.client) ? [form.client] : [])])).map((client) => <option key={client} value={client}>{client}</option>)}
                        </select>
                      </label>
                      {editingUnitId && <label>
                          {t("lastServiceDate")}
                          <input
                            type="date"
                            value={form.service}
                            onChange={(event) =>
                              updateForm("service", event.target.value)
                            }
                          />
                        </label>}
                      <label>
                        {t("unitType")}
                        <input
                          value={form.type}
                          onChange={(event) =>
                            updateForm("type", event.target.value)
                          }
                          placeholder={t("typeExample")}
                        />
                      </label>
                      <label>
                        {t("meterType")}
                        <select value={form.meterUnit} onChange={(event) => updateForm("meterUnit", event.target.value)}>
                          <option value="KM">KM</option>
                          <option value="HRS">HRS</option>
                        </select>
                      </label>
                      <label>
                        {t("currentMileageHours")}
                        <input required type="number" min="0" value={form.currentMeter} onChange={(event) => updateForm("currentMeter", event.target.value)} placeholder={form.meterUnit === "KM" ? "250000" : "5000"} />
                      </label>
                      <label>
                        {t("pmIntervalLabel")} ({form.meterUnit})
                        <input type="number" min="1" value={form.pmInterval} onChange={(event) => updateForm("pmInterval", event.target.value)} placeholder={form.meterUnit === "KM" ? "25000" : "500"} />
                      </label>
                    </>
                  )}
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
                  <button type="submit" className="primary-button">
                    {modal === "job" ? t("createWorkOrder") : t("saveUnit")}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
