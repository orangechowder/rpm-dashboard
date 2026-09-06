"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Section = "overview" | "jobs" | "units";
type Language = "en" | "fr";
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
  { id: "units", label: "unitManagement", icon: "▣" },
];

const translations: Record<Language, Record<string, string>> = {
  en: {
    dashboardOverview: "Dashboard Overview", activeJobQueue: "Active Job Queue", unitManagement: "Unit Management", workspace: "WORKSPACE",
    goodMorning: "Good morning, Jordan", overviewSubtitle: "Here's what's happening across your fleet today.", jobsSubtitle: "Monitor and coordinate every active service request.", unitsSubtitle: "Keep your fleet records current and service-ready.", systemOperational: "System operational", lastSynced: "Last synced just now", emergency: "Emergency", reviewUnits: "Review units →",
    workOrders: "WORK ORDERS", activeJobs: "Active Jobs", totalInProgress: "Total in progress", waitingParts: "Waiting on parts", waitingEstimates: "Waiting on estimates", fleetHealth: "FLEET HEALTH", unitStatus: "Unit Status", totalUnits: "Total units repertoried", fleetRecords: "All fleet records up to date", pmCompliance: "PM compliance", overduePm: "units overdue for PM", fieldOperations: "FIELD OPERATIONS", fieldService: "Field Service", techsOnRoad: "Technicians on road", unassignedCalls: "Unassigned calls", responseTime: "Avg response time", recentActivity: "RECENT ACTIVITY", latestUpdates: "Latest updates", viewAll: "View all →", quickActions: "QUICK ACTIONS", quickQuestion: "What would you like to do?", createWorkOrder: "Create work order", startService: "Start a new service request", addUnit: "Add a unit", registerAsset: "Register a vehicle or asset", serviceOperations: "SERVICE OPERATIONS", workOrderQueue: "Work order queue", newWorkOrder: "+ New work order", export: "Export ↓", assetDatabase: "ASSET DATABASE", fleetDirectory: "Fleet directory", addNewUnit: "+ Add unit", filters: "Filters ≡", assignedClient: "ASSIGNED CLIENT", lastService: "LAST SERVICE", lastUsage: "LAST SERVICE USAGE", pmNeeded: "PM needed", pmClear: "PM clear", workOrder: "Work order", unitClient: "Unit / client", technician: "Technician", priority: "Priority", status: "Status", updated: "Updated", fleetUnit: "Fleet unit", selectUnit: "Select a unit from the repertory", addNewUnitOption: "+ Add New Unit to Repertory", serviceRequest: "Service request", lastServiceUsage: "Last service mileage / hours", unitNumber: "Unit number", vin: "VIN", clientName: "Client name", lastServiceDate: "Last service", unitType: "Unit type", saveUnit: "Save unit", cancel: "Cancel", deleteUnit: "Delete unit", close: "Close modal", workOrderDetails: "WORK ORDER", notes: "Technician notes", addNotePlaceholder: "Add a timestamped note...", addNote: "Add note", parts: "Labor & parts", description: "Description", amount: "Amount", add: "Add", delete: "Delete", deleteWorkOrder: "Delete work order", done: "Done", createTitle: "Create work order", addUnitTitle: "Add fleet unit", editUnitTitle: "Edit fleet unit", addToRepertory: "Add unit to repertory", part: "Part", labor: "Labor", loginTitle: "RPM Diesel Dashboard", loginSubtitle: "Sign in to manage fleet operations", name: "Name", password: "Password", signIn: "Sign in", invalidLogin: "Enter a valid name and password.", signedInAs: "Signed in as", signOut: "Sign out", language: "Switch language",
    "In Progress": "In Progress", "Waiting on Parts": "Waiting on Parts", "Waiting on Estimates": "Waiting on Estimates", Completed: "Completed", High: "High", Normal: "Normal", Low: "Low",
  },
  fr: {
    dashboardOverview: "Vue d'ensemble", activeJobQueue: "File des travaux actifs", unitManagement: "Gestion des unités", workspace: "ESPACE DE TRAVAIL",
    goodMorning: "Bonjour, Jordan", overviewSubtitle: "Voici ce qui se passe dans votre flotte aujourd'hui.", jobsSubtitle: "Surveillez et coordonnez chaque demande de service active.", unitsSubtitle: "Gardez les dossiers de votre flotte à jour et prête pour le service.", systemOperational: "Système opérationnel", lastSynced: "Synchronisé à l'instant", emergency: "Urgence", reviewUnits: "Réviser les unités →",
    workOrders: "ORDRES DE TRAVAIL", activeJobs: "Travaux actifs", totalInProgress: "Total en cours", waitingParts: "En attente de pièces", waitingEstimates: "En attente d'estimations", fleetHealth: "ÉTAT DE LA FLOTTE", unitStatus: "État des unités", totalUnits: "Total des unités répertoriées", fleetRecords: "Tous les dossiers sont à jour", pmCompliance: "Conformité PM", overduePm: "unités en retard de PM", fieldOperations: "OPÉRATIONS TERRAIN", fieldService: "Service sur le terrain", techsOnRoad: "Techniciens sur la route", unassignedCalls: "Appels non assignés", responseTime: "Temps de réponse moyen", recentActivity: "ACTIVITÉ RÉCENTE", latestUpdates: "Dernières mises à jour", viewAll: "Voir tout →", quickActions: "ACTIONS RAPIDES", quickQuestion: "Que voulez-vous faire?", createWorkOrder: "Créer un ordre de travail", startService: "Démarrer une demande de service", addUnit: "Ajouter une unité", registerAsset: "Enregistrer un véhicule ou un actif", serviceOperations: "OPÉRATIONS DE SERVICE", workOrderQueue: "File des ordres de travail", newWorkOrder: "+ Nouvel ordre de travail", export: "Exporter ↓", assetDatabase: "BASE DES ACTIFS", fleetDirectory: "Répertoire de la flotte", addNewUnit: "+ Ajouter une unité", filters: "Filtres ≡", assignedClient: "CLIENT ASSIGNÉ", lastService: "DERNIER SERVICE", lastUsage: "DERNIÈRE UTILISATION", pmNeeded: "PM requis", pmClear: "PM à jour", workOrder: "Ordre de travail", unitClient: "Unité / client", technician: "Technicien", priority: "Priorité", status: "Statut", updated: "Mis à jour", fleetUnit: "Unité de la flotte", selectUnit: "Sélectionner une unité du répertoire", addNewUnitOption: "+ Ajouter une unité au répertoire", serviceRequest: "Demande de service", lastServiceUsage: "Kilométrage / heures depuis le dernier service", unitNumber: "Numéro d'unité", vin: "NIV", clientName: "Nom du client", lastServiceDate: "Dernier service", unitType: "Type d'unité", saveUnit: "Enregistrer l'unité", cancel: "Annuler", deleteUnit: "Supprimer l'unité", close: "Fermer la fenêtre", workOrderDetails: "ORDRE DE TRAVAIL", notes: "Notes du technicien", addNotePlaceholder: "Ajouter une note horodatée...", addNote: "Ajouter la note", parts: "Main-d'œuvre et pièces", description: "Description", amount: "Montant", add: "Ajouter", delete: "Supprimer", deleteWorkOrder: "Supprimer l'ordre de travail", done: "Terminé", createTitle: "Créer un ordre de travail", addUnitTitle: "Ajouter une unité", editUnitTitle: "Modifier l'unité", addToRepertory: "Ajouter au répertoire", part: "Pièce", labor: "Main-d'œuvre", loginTitle: "Tableau de bord RPM Diesel", loginSubtitle: "Connectez-vous pour gérer les opérations de flotte", name: "Nom", password: "Mot de passe", signIn: "Se connecter", invalidLogin: "Entrez un nom et un mot de passe valides.", signedInAs: "Session de", signOut: "Se déconnecter", language: "Changer de langue",
    "In Progress": "En cours", "Waiting on Parts": "En attente de pièces", "Waiting on Estimates": "En attente d'estimations", Completed: "Terminé", High: "Élevée", Normal: "Normale", Low: "Faible",
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

export default function Home() {
  const [language, setLanguage] = useState<Language>(() => loadStored("rpm-diesel-language", "en" as Language));
  const [activeUser, setActiveUser] = useState<string | null>(() => loadStored("rpm-diesel-session", null as string | null));
  const [loginName, setLoginName] = useState("Andrée-Anne");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [jobFilter, setJobFilter] = useState<"All" | JobStatus>("All");
  const [unitSearch, setUnitSearch] = useState("");
  const [modal, setModal] = useState<"job" | "unit" | "detail" | null>(null);
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
  const [unitData, setUnitData] = useState<Unit[]>(() =>
    loadStored<Unit[]>("rpm-diesel-units", units).map((unit) => ({
      ...unit,
      usage: unit.usage ?? "Not recorded",
    })),
  );
  const [jobData, setJobData] = useState<Job[]>(() =>
    loadStored<Job[]>("rpm-diesel-jobs", jobs).map((job) => ({
      ...job,
      usage: job.usage ?? "Not recorded",
    })),
  );
  const t = (key: string) => translations[language][key] ?? key;
  const accounts = ["Andrée-Anne", "Marc", "Dannick"];
  const signIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accounts.includes(loginName) && loginPassword === "12345678") {
      setActiveUser(loginName);
      setLoginError(false);
      window.localStorage.setItem("rpm-diesel-session", JSON.stringify(loginName));
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
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-jobs", JSON.stringify(jobData));
  }, [jobData]);
  useEffect(() => {
    window.localStorage.setItem("rpm-diesel-units", JSON.stringify(unitData));
  }, [unitData]);
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
  if (!activeUser) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <Image className="login-logo" src="/logo3.png" alt="RPM Diesel logo" width={96} height={72} priority />
          <p className="card-kicker">RPM DIESEL</p>
          <h1>{t("loginTitle")}</h1>
          <p className="login-subtitle">{t("loginSubtitle")}</p>
          <form onSubmit={signIn} className="login-form">
            <label>{t("name")}<select value={loginName} onChange={(event) => setLoginName(event.target.value)}>{accounts.map((account) => <option key={account}>{account}</option>)}</select></label>
            <label>{t("password")}<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" /></label>
            {loginError && <p className="login-error">{t("invalidLogin")}</p>}
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
    setJobData((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status, updated: "Just now" } : item,
      ),
    );
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
      id: crypto.randomUUID(),
      text: noteText.trim(),
      author: "Jordan Davis",
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
  const updateNote = (noteId: string, text: string) =>
    setJobData((current) =>
      current.map((job) =>
        job.id === detailJobId
          ? {
              ...job,
              notes: (job.notes ?? []).map((note) =>
                note.id === noteId ? { ...note, text } : note,
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
              notes: (job.notes ?? []).filter((note) => note.id !== noteId),
            }
          : job,
      ),
    );
  const saveLineItem = () => {
    if (!detailJobId || !lineItem.description.trim() || !lineItem.amount)
      return;
    const item: LineItem = {
      id: crypto.randomUUID(),
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
  const updateJob = (
    field: "tech" | "priority" | "status" | "usage",
    value: string,
  ) => {
    if (!detailJobId) return;
    const job = jobData.find((item) => item.id === detailJobId);
    if (job && (field === "status" || field === "usage"))
      syncUnitFromJob(
        job,
        field === "status" ? (value as JobStatus) : job.status,
        field === "usage" ? value : job.usage,
      );
    setJobData((current) =>
      current.map((item) =>
        item.id === detailJobId
          ? { ...item, [field]: value, updated: "Just now" }
          : item,
      ),
    );
  };
  const deleteJob = (id: string) => {
    setJobData((current) => current.filter((job) => job.id !== id));
    setModal(null);
    setDetailJobId(null);
  };
  const deleteUnit = (unitId: string) => {
    setUnitData((current) => current.filter((unit) => unit.unit !== unitId));
    setModal(null);
    setEditingUnitId(null);
  };
  const togglePm = (unitId: string) =>
    setUnitData((current) =>
      current.map((unit) =>
        unit.unit === unitId ? { ...unit, overdue: !unit.overdue } : unit,
      ),
    );
  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modal === "job") {
      const newJob: Job = {
        id: `WO-${2420 + jobData.length}`,
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
      setJobData((current) => [newJob, ...current]);
      syncUnitFromJob(newJob, newJob.status, newJob.usage);
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
      setUnitData((current) =>
        editingUnitId
          ? current.map((unit) =>
              unit.unit === editingUnitId ? newUnit : unit,
            )
          : [newUnit, ...current],
      );
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
        <div className="brand-lockup">
          <Image
            className="brand-logo"
            src="/logo3.png"
            alt="RPM Diesel logo"
            width={72}
            height={48}
            priority
          />
          <span className="brand-name">
            RPM <strong>DIESEL</strong>
          </span>
        </div>
        <div className="topbar-actions">
          <a href="tel:4509992221" className="emergency-button">
            ◉ <span className="desktop-only">{t("emergency")} </span>450 999-2221
          </a>
          <button className="language-button" onClick={toggleLanguage} aria-label={t("language")}>{language === "en" ? "FR" : "EN"}</button>
          <button className="avatar" onClick={signOut} title={`${t("signedInAs")} ${activeUser}`}>{activeUser.slice(0, 2).toUpperCase()}</button>
        </div>
      </header>
      <div className="dashboard-layout">
        <aside className="sidebar">
          <p className="sidebar-label">{t("workspace")}</p>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
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
          <div className="mobile-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={section === item.id ? "mobile-nav-active" : ""}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <div className="page-heading">
            <div>
              <p className="breadcrumb">
                RPM DIESEL <span>/</span>{" "}
                {t(navItems.find((item) => item.id === section)?.label ?? "")}
              </p>
              <h1>
                {section === "overview"
                  ? t("goodMorning")
                  : t(navItems.find((item) => item.id === section)?.label ?? "")}
              </h1>
              <p className="page-subtitle">
                {section === "overview"
                  ? t("overviewSubtitle")
                  : section === "jobs"
                    ? t("jobsSubtitle")
                    : t("unitsSubtitle")}
              </p>
            </div>
            <div className="date-chip">□ &nbsp; May 24, 2024 &nbsp;⌄</div>
          </div>
          {section === "overview" && (
            <>
              <div className="alert-banner">
                <span className="alert-icon">!</span>
                <div>
                  <b>
                    {unitData.filter((unit) => unit.overdue).length} {t("overduePm")}
                  </b>
                  <span>
                    {" "}
                    {language === "en" ? " Schedule service before they go back on the road." : " Planifiez le service avant leur retour sur la route."}
                  </span>
                </div>
                <button onClick={() => setSection("units")}>
                  {t("reviewUnits")}
                </button>
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
                    value="24"
                    detail="↑ 8% from last week"
                    icon="↗"
                  />
                  <div className="mini-metrics">
                    <div>
                      <span>● {t("waitingParts")}</span>
                      <b>7</b>
                    </div>
                    <div>
                      <span>● {t("waitingEstimates")}</span>
                      <b>4</b>
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
                    icon="▣"
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
                    value="12"
                    detail="↑ 2 since 8:00 AM"
                    tone="green"
                    icon="↗"
                  />
                  <div className="mini-metrics">
                    <div>
                      <span>● {t("unassignedCalls")}</span>
                      <b>3</b>
                    </div>
                    <div>
                      <span>● {t("responseTime")}</span>
                      <b>
                        42 <small>min</small>
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
                        <td>
                          <b>{job.id}</b>
                          <small>{job.issue}</small>
                        </td>
                        <td>
                          <b>{job.unit}</b>
                          <small>{job.client}</small>
                        </td>
                        <td>
                          <span
                            className={
                              job.tech === "Unassigned"
                                ? "unassigned"
                                : "tech-name"
                            }
                          >
                            {job.tech}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`priority priority-${job.priority.toLowerCase()}`}
                          >
                            ● {job.priority}
                          </span>
                        </td>
                        <td>
                          <button
                            className="status-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setStatus(
                                job.id,
                                job.status === "Completed"
                                  ? "In Progress"
                                  : "Completed",
                              );
                            }}
                          >
                            <StatusPill status={job.status} language={language} />
                          </button>
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
                      className="unit-row interactive-row"
                      key={unit.unit}
                      onClick={() => openUnitEditor(unit)}
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
                    <select
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
                    </select>
                  </label>
                  <label>
                    {t("technician")}
                    <select
                      value={activeJob.tech}
                      onChange={(event) =>
                        updateJob("tech", event.target.value)
                      }
                    >
                      {[
                        "Unassigned",
                        "Marcus T.",
                        "Jamie R.",
                        "Devin L.",
                        "Sam K.",
                      ].map((tech) => (
                        <option key={tech}>{tech}</option>
                      ))}
                    </select>
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
                          onChange={(event) =>
                            updateNote(note.id, event.target.value)
                          }
                        />
                        <small>
                          {note.author} ·{" "}
                          {new Date(note.createdAt).toLocaleString()}
                        </small>
                        <button
                          className="entry-delete"
                          onClick={() => deleteNote(note.id)}
                        >
                          {t("delete")}
                        </button>
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
                  <button
                    className="danger-button"
                    onClick={() => deleteJob(activeJob.id)}
                  >
                    {t("deleteWorkOrder")}
                  </button>
                  <button className="outline-button" onClick={closeModal}>
                    {t("done")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {modal !== "detail" && modal && (
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
                          <option value="Unassigned">Unassigned</option>
                          <option>Marcus T.</option>
                          <option>Jamie R.</option>
                          <option>Devin L.</option>
                          <option>Sam K.</option>
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
                        <input
                          required
                          value={form.client}
                          onChange={(event) =>
                            updateForm("client", event.target.value)
                          }
                          placeholder="e.g. Summit Transport"
                        />
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
