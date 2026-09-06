"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { completeTimeEntry, createManualTimeEntry, createTimeEntry, hasSupabaseConfig, loadFleetData, loadTimeEntries, loadUsers, removeJob, removeUnit, saveJobs, saveUnits, saveUsers, subscribeToFleet, writeActivityLog, type RealtimeChange, type CloudJob, type CloudTimeEntry, type CloudUnit, type CloudUser } from "../lib/fleet-repository";

type Section = "overview" | "jobs" | "units" | "users" | "clients" | "punch";
type Language = "en" | "fr";
type UserAccount = { id: string; name: string; role: "Admin" | "Technician"; password: string; active: boolean; isTechnician: boolean };
type JobStatus =
  "In Progress" | "Waiting on Parts" | "Waiting on Estimates" | "Completed";
type Note = { id: string; text: string; author: string; createdAt: string };
type LineItem = {
  id: string;
  kind: "Labor" | "Part";
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
    dashboardOverview: "Dashboard Overview", activeJobQueue: "Active Job Queue", unitManagement: "Unit Management", clientManagement: "Client Management", punchClock: "Punch Clock", punchSubtitle: "Track your working time and connect it to a work order.", userManagement: "User Management", usersSubtitle: "Manage dashboard access, roles, and active profiles.", clientsSubtitle: "Browse and manage every fleet client.", workspace: "WORKSPACE",
    goodMorning: "Good morning", overviewSubtitle: "Here's what's happening across your fleet today.", jobsSubtitle: "Monitor and coordinate every active service request.", unitsSubtitle: "Keep your fleet records current and service-ready.", systemOperational: "System operational", lastSynced: "Last synced just now", emergency: "Emergency", reviewUnits: "Review units →",
    workOrders: "WORK ORDERS", activeJobs: "Active Jobs", totalInProgress: "Total in progress", waitingParts: "Waiting on parts", waitingEstimates: "Waiting on estimates", fleetHealth: "FLEET HEALTH", unitStatus: "Unit Status", totalUnits: "Total units repertoried", fleetRecords: "All fleet records up to date", pmCompliance: "PM compliance", overduePm: "units overdue for PM", fieldOperations: "FIELD OPERATIONS", fieldService: "Field Service", techsOnRoad: "Technicians on road", unassignedCalls: "Unassigned calls", responseTime: "Avg response time", recentActivity: "RECENT ACTIVITY", latestUpdates: "Latest updates", viewAll: "View all →", quickActions: "QUICK ACTIONS", quickQuestion: "What would you like to do?", createWorkOrder: "Create work order", startService: "Start a new service request", addUnit: "Add a unit", registerAsset: "Register a vehicle or asset", serviceOperations: "SERVICE OPERATIONS", workOrderQueue: "Work order queue", newWorkOrder: "+ New work order", export: "Export ↓", assetDatabase: "ASSET DATABASE", fleetDirectory: "Fleet directory", addNewUnit: "+ Add unit", filters: "Filters ≡", assignedClient: "ASSIGNED CLIENT", lastService: "LAST SERVICE", lastUsage: "LAST SERVICE USAGE", pmNeeded: "PM needed", pmClear: "PM clear", workOrder: "Work order", unitClient: "Unit / client", technician: "Technician", priority: "Priority", status: "Status", updated: "Updated", fleetUnit: "Fleet unit", selectUnit: "Select a unit from the repertory", addNewUnitOption: "+ Add New Unit to Repertory", serviceRequest: "Service request", lastServiceUsage: "Last service mileage / hours", unitNumber: "Unit number", vin: "VIN", clientName: "Client name", lastServiceDate: "Last service", unitType: "Unit type", saveUnit: "Save unit", cancel: "Cancel", deleteUnit: "Delete unit", close: "Close modal", workOrderDetails: "WORK ORDER", notes: "Technician notes", addNotePlaceholder: "Add a timestamped note...", addNote: "Add note", parts: "Labor & parts", description: "Description", amount: "Amount", add: "Add", delete: "Delete", deleteWorkOrder: "Delete work order", done: "Done", createTitle: "Create work order", addUnitTitle: "Add fleet unit", editUnitTitle: "Edit fleet unit", addToRepertory: "Add unit to repertory", part: "Part", labor: "Labor", loginTitle: "RPM Diesel Dashboard", loginSubtitle: "Sign in to manage fleet operations", name: "Name", password: "Password", signIn: "Sign in", invalidLogin: "Enter a valid name and password.", signedInAs: "Signed in as", signOut: "Sign out", language: "Switch language",
    userDirectory: "USER DIRECTORY", manageProfiles: "Manage dashboard access and roles", addTechnician: "+ Add technician", role: "Role", active: "Active", disabled: "Disabled", admin: "Admin", removeUser: "Remove user", changePassword: "Change password", adminChangePassword: "Set password", currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm new password", updatePassword: "Update password", technicianList: "Technician list", punchHistory: "Punch history", punchedBy: "Punched by", clockIn: "Clock in", clockOut: "Clock out", totalHours: "Total hours", totalWorked: "Total worked hours", activePunch: "Active", noPunches: "No punches recorded yet.", noData: "—", "In Progress": "In Progress", "Waiting on Parts": "Waiting on Parts", "Waiting on Estimates": "Waiting on Estimates", Completed: "Completed", High: "High", Normal: "Normal", Low: "Low",
  },
  fr: {
    dashboardOverview: "Vue d'ensemble", activeJobQueue: "File des travaux actifs", unitManagement: "Gestion des unités", clientManagement: "Gestion des clients", punchClock: "Poinçonneuse", punchSubtitle: "Suivez votre temps de travail et associez-le à un ordre de travail.", userManagement: "Gestion des utilisateurs", usersSubtitle: "Gérez les accès, les rôles et les profils actifs.", clientsSubtitle: "Consultez et gérez tous les clients de la flotte.", workspace: "ESPACE DE TRAVAIL",
    goodMorning: "Bonjour", overviewSubtitle: "Voici ce qui se passe dans votre flotte aujourd'hui.", jobsSubtitle: "Surveillez et coordonnez chaque demande de service active.", unitsSubtitle: "Gardez les dossiers de votre flotte à jour et prête pour le service.", systemOperational: "Système opérationnel", lastSynced: "Synchronisé à l'instant", emergency: "Urgence", reviewUnits: "Réviser les unités →",
    workOrders: "ORDRES DE TRAVAIL", activeJobs: "Travaux actifs", totalInProgress: "Total en cours", waitingParts: "En attente de pièces", waitingEstimates: "En attente d'estimations", fleetHealth: "ÉTAT DE LA FLOTTE", unitStatus: "État des unités", totalUnits: "Total des unités répertoriées", fleetRecords: "Tous les dossiers sont à jour", pmCompliance: "Conformité PM", overduePm: "unités en retard de PM", fieldOperations: "OPÉRATIONS TERRAIN", fieldService: "Service sur le terrain", techsOnRoad: "Techniciens sur la route", unassignedCalls: "Appels non assignés", responseTime: "Temps de réponse moyen", recentActivity: "ACTIVITÉ RÉCENTE", latestUpdates: "Dernières mises à jour", viewAll: "Voir tout →", quickActions: "ACTIONS RAPIDES", quickQuestion: "Que voulez-vous faire?", createWorkOrder: "Créer un ordre de travail", startService: "Démarrer une demande de service", addUnit: "Ajouter une unité", registerAsset: "Enregistrer un véhicule ou un actif", serviceOperations: "OPÉRATIONS DE SERVICE", workOrderQueue: "File des ordres de travail", newWorkOrder: "+ Nouvel ordre de travail", export: "Exporter ↓", assetDatabase: "BASE DES ACTIFS", fleetDirectory: "Répertoire de la flotte", addNewUnit: "+ Ajouter une unité", filters: "Filtres ≡", assignedClient: "CLIENT ASSIGNÉ", lastService: "DERNIER SERVICE", lastUsage: "DERNIÈRE UTILISATION", pmNeeded: "PM requis", pmClear: "PM à jour", workOrder: "Ordre de travail", unitClient: "Unité / client", technician: "Technicien", priority: "Priorité", status: "Statut", updated: "Mis à jour", fleetUnit: "Unité de la flotte", selectUnit: "Sélectionner une unité du répertoire", addNewUnitOption: "+ Ajouter une unité au répertoire", serviceRequest: "Demande de service", lastServiceUsage: "Kilométrage / heures depuis le dernier service", unitNumber: "Numéro d'unité", vin: "NIV", clientName: "Nom du client", lastServiceDate: "Dernier service", unitType: "Type d'unité", saveUnit: "Enregistrer l'unité", cancel: "Annuler", deleteUnit: "Supprimer l'unité", close: "Fermer la fenêtre", workOrderDetails: "ORDRE DE TRAVAIL", notes: "Notes du technicien", addNotePlaceholder: "Ajouter une note horodatée...", addNote: "Ajouter la note", parts: "Main-d'œuvre et pièces", description: "Description", amount: "Montant", add: "Ajouter", delete: "Supprimer", deleteWorkOrder: "Supprimer l'ordre de travail", done: "Terminé", createTitle: "Créer un ordre de travail", addUnitTitle: "Ajouter une unité", editUnitTitle: "Modifier l'unité", addToRepertory: "Ajouter au répertoire", part: "Pièce", labor: "Main-d'œuvre", loginTitle: "Tableau de bord RPM Diesel", loginSubtitle: "Connectez-vous pour gérer les opérations de flotte", name: "Nom", password: "Mot de passe", signIn: "Se connecter", invalidLogin: "Entrez un nom et un mot de passe valides.", signedInAs: "Session de", signOut: "Se déconnecter", language: "Changer de langue",
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
        <span className={`metric-icon metric-${tone}`}>{icon}</span>
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
  return <div className={`punch-clock ${activeEntry ? "punch-active" : ""}`}><span className="punch-indicator" /><div className="punch-copy"><strong>{activeEntry ? (language === "en" ? "On the clock" : "Pointé") : (language === "en" ? "Off the clock" : "Non pointé")}</strong><small>{activeEntry ? elapsedLabel : (language === "en" ? "Ready to start" : "Prêt à commencer")}</small></div>{!activeEntry ? <><select value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)} aria-label={language === "en" ? "Assign work order" : "Assigner un ordre de travail"}><option value="">{language === "en" ? "No work order" : "Aucun ordre"}</option>{jobs.filter((job) => job.status !== "Completed").map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select><button className="punch-button punch-in" onClick={() => onClockIn(workOrderId || null)}>{language === "en" ? "Clock In" : "Pointer"}</button></> : <button className="punch-button punch-out" onClick={onClockOut}>{language === "en" ? "Clock Out" : "Dépointer"}</button>}</div>;
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
    tech: "Unassigned",
    priority: "Normal" as Job["priority"],
    status: "In Progress" as JobStatus,
  });
  const [noteText, setNoteText] = useState("");
  const [lineItem, setLineItem] = useState({
    kind: "Labor" as LineItem["kind"],
    description: "",
    quantity: "1",
    amount: "",
  });
  const [manualTimeUser, setManualTimeUser] = useState("");
  const [manualTimeJob, setManualTimeJob] = useState("");
  const [manualTimeHours, setManualTimeHours] = useState("");
  const [unitData, setUnitData] = useState<Unit[]>(units);
  const [jobData, setJobData] = useState<Job[]>(jobs);
  const [timeEntries, setTimeEntries] = useState<CloudTimeEntry[]>([]);
  const [cloudReady, setCloudReady] = useState(!hasSupabaseConfig);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const remoteJobsUpdate = useRef(false);
  const remoteUnitsUpdate = useRef(false);
  const remoteUsersUpdate = useRef(false);
  const cloudPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudRefreshInFlight = useRef(false);
  const t = (key: string) => translations[language][key] ?? key;
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
    if (!activeUser || activeTimeEntry) return;
    try {
      const created = await createTimeEntry({ userId: activeUser, userName: activeUser, workOrderId, clockIn: new Date().toISOString() });
      if (created) setTimeEntries((current) => [created, ...current]);
      else setCloudError("Punch Clock is not installed in Supabase yet. Run supabase/schema.sql to create time_entries.");
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
  const visibleNavItems = activeUser === "Marc" ? [...navItems, { id: "users" as Section, label: "userManagement", icon: "♙" }] : navItems;
  const canManageWorkOrders = activeUser === "Marc";
  const technicianOptions = ["Unassigned", ...userAccounts.filter((account) => account.active && account.isTechnician).map((account) => account.name)];
  const addUser = () => {
    const name = newUserName.trim();
    if (!name || userAccounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) return;
    setUserAccounts((current) => [...current, { id: `user-${createId()}`, name, role: "Technician", password: newUserPassword || "12345678", active: true, isTechnician: newUserIsTechnician }]);
    setNewUserName("");
    setNewUserPassword("12345678");
    setNewUserIsTechnician(true);
  };
  const toggleUser = (id: string) => setUserAccounts((current) => current.map((account) => account.id === id ? { ...account, active: !account.active } : account));
  const toggleTechnician = (id: string) => setUserAccounts((current) => current.map((account) => account.id === id ? { ...account, isTechnician: !account.isTechnician } : account));
  const saveManagedPassword = () => {
    if (!passwordTargetId || managedPassword.length < 8) return;
    setUserAccounts((current) => current.map((account) => account.id === passwordTargetId ? { ...account, password: managedPassword } : account));
    setPasswordTargetId(null);
    setManagedPassword("12345678");
  };
  const removeUser = (id: string) => setUserAccounts((current) => current.filter((account) => account.id !== id || account.name === "Marc"));
  const saveClientEdit = () => {
    const nextName = editingClientName.trim();
    if (!editingClient || !nextName) return;
    setClientData((current) => current.map((client) => client === editingClient ? nextName : client));
    setEditingClient(null);
    setEditingClientName("");
  };
  const removeClient = (client: string) => {
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
    let cancelled = false;
    if (!hasSupabaseConfig) return;
    Promise.all([loadFleetData(), loadUsers(), loadTimeEntries()]).then(([data, cloudUsers, cloudTimeEntries]) => {
      if (cancelled) return;
      if (data) {
        remoteJobsUpdate.current = true;
        remoteUnitsUpdate.current = true;
        setJobData(data.jobs as Job[]);
        setUnitData(data.units as Unit[]);
      }
      if (cloudUsers?.length) { remoteUsersUpdate.current = true; setUserAccounts(cloudUsers as UserAccount[]); }
      if (cloudTimeEntries) setTimeEntries(cloudTimeEntries);
      setCloudError(null);
      setCloudReady(true);
    }).catch((error: Error) => {
      setCloudError(error.message);
      setCloudReady(true);
    });
    return () => { cancelled = true; };
  }, [activeUser]);
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
        setUnitData(data.units as Unit[]);
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
  }, [cloudReady, activeUser]);
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
  const filteredJobs = jobData.filter(
    (job) => jobFilter === "All" || job.status === jobFilter,
  );
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
  const currentAccount = userAccounts.find((account) => account.name === activeUser);
  const visibleTimeEntries = currentAccount?.role === "Admin" ? timeEntries : timeEntries.filter((entry) => entry.userId === activeUser);
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
    setLineItem({ kind: "Labor", description: "", quantity: "1", amount: "" });
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
    if (!detailJobId || !lineItem.description.trim() || !lineItem.amount)
      return;
    const item: LineItem = {
      id: createId(),
      kind: lineItem.kind,
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
    setLineItem({ kind: "Labor", description: "", quantity: "1", amount: "" });
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
    if (field === "status" || field === "usage")
      syncUnitFromJob(
        job,
        field === "status" ? (value as JobStatus) : job.status,
        field === "usage" ? value : job.usage,
      );
    updateJobRecord(job, field, value);
  };
  const deleteJob = (id: string) => {
    if (!canManageWorkOrders) return;
    setJobData((current) => current.filter((job) => job.id !== id));
    void removeJob(id);
    void writeActivityLog(activeUser ?? "Unknown", "deleted", "work_order", id);
    setModal(null);
    setDetailJobId(null);
  };
  const deleteUnit = (unitId: string) => {
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
        usage: form.usage,
      };
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
          {!hasSupabaseConfig && <div className="cloud-banner cloud-warning">Cloud sync is not configured. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`.</div>}
          {cloudError && <div className="cloud-banner cloud-warning">{cloudError}</div>}
          <div className="mobile-nav-select">
            <span className="mobile-nav-label">{language === "en" ? "Section" : "Section"}</span>
            <select value={section} onChange={(event) => setSection(event.target.value as Section)} aria-label={language === "en" ? "Choose section" : "Choisir une section"}>
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
            <div className="date-chip">□ &nbsp; May 24, 2024 &nbsp;⌄</div>
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
                    <button onClick={() => setSection("jobs")}>{workloadAlert.view}</button>
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
              <div className="alert-banner">
                <span className="alert-icon">!</span>
                <div>
                  <b>{unitData.filter((unit) => unit.overdue).length} {t("overduePm")}</b>
                  <span>{language === "en" ? " Schedule service before they go back on the road." : " Planifiez le service avant leur retour sur la route."}</span>
                </div>
                <button onClick={() => setSection("units")}>{t("reviewUnits")}</button>
              </div>
              <section className="metrics-grid">
                <div className="section-card metric-group">
                  <div className="card-heading">
                    <div>
                            <p className="card-kicker">{t("workOrders")}</p>
                              <h2>{t("activeJobs")}</h2>
                    </div>
                    <button className="more-button">•••</button>
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
                    <button className="more-button">•••</button>
                  </div>
                  <MetricCard
                    label={t("totalUnits")}
                    value={String(unitData.length)}
                    detail="All fleet records up to date"
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
                    <button className="more-button">•••</button>
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
                      onClick={() => setSection("jobs")}
                    >
                      {t("viewAll")}
                    </button>
                  </div>
                  {jobData.slice(0, 3).map((job, index) => (
                    <div className="activity-row" key={job.id}>
                      <span className={`activity-mark mark-${index}`} />
                      <div className="activity-copy">
                        <p>
                          <b>{job.unit}</b> was assigned to <b>{job.tech}</b>
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
                    onClick={() => setSection("jobs")}
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
              {canManageWorkOrders && <div className="manual-time-card"><div className="detail-section-heading"><h3>{language === "en" ? "Add technician time manually" : "Ajouter du temps technicien manuellement"}</h3></div><div className="manual-time-form"><select value={manualTimeUser} onChange={(event) => setManualTimeUser(event.target.value)} aria-label={t("technician")}><option value="">{language === "en" ? "Select technician" : "Sélectionner un technicien"}</option>{userAccounts.filter((account) => account.active && account.isTechnician).map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}</select><select value={manualTimeJob} onChange={(event) => setManualTimeJob(event.target.value)} aria-label={t("workOrder")}><option value="">{language === "en" ? "No work order" : "Aucun ordre"}</option>{jobData.filter((job) => job.status !== "Completed").map((job) => <option key={job.id} value={job.id}>{job.unit} · {job.issue}</option>)}</select><input type="number" min="0.01" step="0.01" value={manualTimeHours} onChange={(event) => setManualTimeHours(event.target.value)} placeholder={language === "en" ? "Hours (decimal)" : "Heures (décimal)"} aria-label={language === "en" ? "Hours" : "Heures"} /><button className="primary-button" onClick={addManualTime}>{language === "en" ? "Add time" : "Ajouter le temps"}</button></div></div>}
              <div className="punch-history-section">
                <div className="detail-section-heading"><h3>{t("punchHistory")}</h3><span>{timeEntries.length} entries</span></div>
                <div className="table-wrap"><table className="punch-history-table"><thead><tr><th>{t("punchedBy")}</th><th>{t("workOrder")}</th><th>{t("clockIn")}</th><th>{t("clockOut")}</th><th>{t("totalHours")}</th><th>{t("status")}</th></tr></thead><tbody>{visibleTimeEntries.length ? visibleTimeEntries.map((entry) => <tr key={entry.id}><td><strong>{entry.userName}</strong></td><td>{entry.workOrderId ? (jobData.find((job) => job.id === entry.workOrderId)?.unit ?? entry.workOrderId) : t("noData")}</td><td>{new Date(entry.clockIn).toLocaleString()}</td><td>{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : t("activePunch")}</td><td>{entry.totalHours == null ? t("activePunch") : `${entry.totalHours.toFixed(2)} h`}</td><td><span className={`time-status ${entry.status === "active" ? "time-active" : "time-completed"}`}>{entry.status === "active" ? t("activePunch") : t("Completed")}</span></td></tr>) : <tr><td colSpan={6} className="empty-history">{t("noPunches")}</td></tr>}</tbody></table></div>
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
                <span className="client-count">{filteredClients.length} clients</span>
              </div>
              <div className="client-toolbar">
                <div className="search-box">⌕<input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder={language === "en" ? "Search clients..." : "Rechercher des clients..."} aria-label={language === "en" ? "Search clients" : "Rechercher des clients"} /></div>
                <input className="client-add-input" placeholder={language === "en" ? "New client name" : "Nom du nouveau client"} onKeyDown={(event) => { if (event.key === "Enter") addClient(event.currentTarget); }} />
                <button className="primary-button" onClick={(event) => { const input = event.currentTarget.previousElementSibling; if (input instanceof HTMLInputElement) addClient(input); }}>{language === "en" ? "Add client" : "Ajouter le client"}</button>
              </div>
              <div className="client-grid">{filteredClients.map((client) => <div className="client-card" key={client}><span className="client-initial">{client.slice(0, 1).toUpperCase()}</span>{editingClient === client ? <div className="client-edit-form"><input value={editingClientName} onChange={(event) => setEditingClientName(event.target.value)} autoFocus /><div><button className="primary-button" onClick={saveClientEdit}>Save</button><button className="outline-button" onClick={() => setEditingClient(null)}>Cancel</button></div></div> : <><div className="client-card-copy"><strong>{client}</strong><small>{language === "en" ? "Fleet client" : "Client de flotte"}</small></div>{activeUser === "Marc" && <div className="client-actions"><button className="row-action" onClick={() => { setEditingClient(client); setEditingClientName(client); }}>Edit</button><button className="entry-delete" onClick={() => removeClient(client)}>Delete</button></div>}</>}</div>)}</div>
            </section>
          )}
          {section === "users" && activeUser === "Marc" && (
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
                    <button className="outline-button" onClick={() => setPasswordTargetId(passwordTargetId === account.id ? null : account.id)}>{t("adminChangePassword")}</button>
                    {passwordTargetId === account.id && <div className="managed-password-editor"><input type="password" value={managedPassword} onChange={(event) => setManagedPassword(event.target.value)} placeholder={t("newPassword")} /><button className="primary-button" onClick={saveManagedPassword}>{t("updatePassword")}</button></div>}
                    <button className="outline-button" onClick={() => toggleUser(account.id)}>{account.active ? t("disabled") : t("active")}</button>
                    {account.name !== "Marc" && <button className="danger-button user-delete" onClick={() => removeUser(account.id)}>{t("removeUser")}</button>}
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
                          ? jobData.length
                          : jobData.filter((job) => job.status === filter)
                              .length}
                      </span>
                    </button>
                  ))}
                </div>
                <button className="outline-button">{t("export")}</button>
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
            </section>
          )}
          {section === "units" && (
            <>
              <div className="unit-metrics">
                <MetricCard
                  label={t("totalUnits")}
                  value={String(unitData.length)}
                  detail="↑ 6 units this quarter"
                  tone="blue"
                  icon="▣"
                />
                <MetricCard
                  label="Units overdue for PM"
                  value={String(unitData.filter((unit) => unit.overdue).length)}
                  detail={language === "en" ? "Requires immediate attention" : "Attention immédiate requise"}
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
                  <button className="outline-button">{t("filters")}</button>
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
                        <label>ASSIGNED CLIENT</label>
                        <b>{unit.client}</b>
                      </div>
                      <div>
                        <label>LAST SERVICE</label>
                        <b>{unit.service}</b>
                      </div>
                      <div>
                        <label>LAST SERVICE USAGE</label>
                        <b>{unit.usage}</b>
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
                        {language === "en" ? "History" : "Historique"}
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
                <div className="modal-header"><div><p className="card-kicker">{language === "en" ? "SERVICE HISTORY" : "HISTORIQUE DE SERVICE"}</p><h2>{historyUnit.unit}</h2><small>{historyUnit.client} · {historyUnit.type}</small></div><button type="button" className="modal-close" onClick={closeModal} aria-label={t("close")}>×</button></div>
                <div className="detail-section-heading"><h3>{language === "en" ? "Completed work orders" : "Ordres de travail complétés"}</h3><span>{jobData.filter((job) => job.unit === historyUnit.unit && job.status === "Completed").length}</span></div>
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
                      {activeJob.unit} · {activeJob.client} · Last service
                      usage: {activeJob.usage}
                    </small>
                    <span className="work-order-total-hours">{t("totalWorked")}: {workedHoursFor(activeJob.id)} h</span>
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
                      placeholder="184220 KM or 4280 Hrs"
                    />
                  </label>
                </div>
                <div className="detail-section work-order-time-section">
                  <div className="detail-section-heading"><h3>{t("punchHistory")}</h3><span>{timeEntries.filter((entry) => entry.workOrderId === activeJob.id).length} entries</span></div>
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
                    <span>{(activeJob.lineItems ?? []).length} items</span>
                  </div>
                  <div className="line-item-list">
                    {(activeJob.lineItems ?? []).map((item) => (
                      <div className="line-item" key={item.id}>
                        <select
                          value={item.kind}
                          onChange={(event) =>
                            updateLineItem(item.id, "kind", event.target.value)
                          }
                        >
                          <option value="Labor">{t("labor")}</option>
                          <option value="Part">{t("part")}</option>
                        </select>
                        <input
                          value={item.description}
                          onChange={(event) =>
                            updateLineItem(
                              item.id,
                              "description",
                              event.target.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(event) =>
                            updateLineItem(
                              item.id,
                              "quantity",
                              event.target.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.amount}
                          onChange={(event) =>
                            updateLineItem(
                              item.id,
                              "amount",
                              event.target.value,
                            )
                          }
                        />
                        <button
                          className="entry-delete"
                          onClick={() => deleteLineItem(item.id)}
                        >
                          {t("delete")}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="line-item-entry">
                    <select
                      value={lineItem.kind}
                      onChange={(event) =>
                        setLineItem((current) => ({
                          ...current,
                          kind: event.target.value as LineItem["kind"],
                        }))
                      }
                    >
                      <option value="Labor">{t("labor")}</option>
                      <option value="Part">{t("part")}</option>
                    </select>
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
                      placeholder={t("amount")}
                    />
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
                        {t("lastServiceUsage")}
                        <input
                          required
                          value={form.usage}
                          onChange={(event) =>
                            updateForm("usage", event.target.value)
                          }
                          placeholder="e.g. 184220 KM or 4280 Hrs"
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
                          placeholder="Describe the issue"
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
                          placeholder="e.g. TRK-506"
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
                          placeholder="17-character VIN"
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
                      <label>
                        {t("lastServiceDate")}
                        <input
                          type="date"
                          value={form.service}
                          onChange={(event) =>
                            updateForm("service", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        {t("lastServiceUsage")}
                        <input
                          required
                          value={form.usage}
                          onChange={(event) =>
                            updateForm("usage", event.target.value)
                          }
                          placeholder="e.g. 184220 KM or 4280 Hrs"
                        />
                      </label>
                      <label>
                        {t("unitType")}
                        <input
                          value={form.type}
                          onChange={(event) =>
                            updateForm("type", event.target.value)
                          }
                          placeholder="e.g. Volvo VNL"
                        />
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
