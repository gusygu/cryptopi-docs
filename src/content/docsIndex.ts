// src/content/docsIndex.ts

export type DocCategoryId =
  | "high-level"
  | "architecture-modules"
  | "database-ddl"
  | "operations"
  | "security-legal-ip"
  | "release-versioning"
  | "client-ux-feature"
  | "dev-helpers"
  | "future-research";

export type DocMeta = {
  id: string;
  slug: string;      // URL segment, e.g. "client-guide" → /docs/client-guide
  title: string;
  file: string;      // relative to docs_info/
  category: DocCategoryId;
  short: string;
  order: number;     // per-category ordering
};

export const DOC_CATEGORIES: Record<
  DocCategoryId,
  { label: string; order: number }
> = {
  "high-level": {
    label: "A. High-level / Product",
    order: 1,
  },
  "architecture-modules": {
    label: "B. Architecture & Modules",
    order: 2,
  },
  "database-ddl": {
    label: "C. Database / DDL",
    order: 3,
  },
  operations: {
    label: "D. Operations",
    order: 4,
  },
  "security-legal-ip": {
    label: "E. Security / Legal / IP",
    order: 5,
  },
  "release-versioning": {
    label: "F. Release & Versioning",
    order: 6,
  },
  "client-ux-feature": {
    label: "G. Client UX / Feature semantics",
    order: 7,
  },
  "dev-helpers": {
    label: "H. Dev-only helpers",
    order: 8,
  },
  "future-research": {
    label: "I. Future & Research",
    order: 9,
  },
};

export const DOCS: DocMeta[] = [
  // -------------------------
  // A – High-level / Product
  // -------------------------
  {
    id: "architecture-dev",
    slug: "architecture-dev",
    title: "Architecture (Dev)",
    file: "A-HIGH-LEVEL/ARCHITECTURE_DEV.md",
    category: "high-level",
    short: "High-level system architecture for developers.",
    order: 10,
  },
  {
    id: "product-overview",
    slug: "product-overview",
    title: "Product Overview",
    file: "A-HIGH-LEVEL/PRODUCT_OVERVIEW.md",
    category: "high-level",
    short: "What CryptoPill is and what it does.",
    order: 20,
  },
  {
    id: "roadmap",
    slug: "roadmap",
    title: "Roadmap",
    file: "A-HIGH-LEVEL/ROADMAP.md",
    category: "high-level",
    short: "Planned milestones and feature evolution.",
    order: 30,
  },
  {
    id: "whitepaper-full",
    slug: "whitepaper-full",
    title: "Whitepaper (Full)",
    file: "A-HIGH-LEVEL/WHITEPAPER_FULL.md",
    category: "high-level",
    short: "Full conceptual and technical whitepaper.",
    order: 40,
  },
  {
    id: "whitepaper-lite",
    slug: "whitepaper-lite",
    title: "Whitepaper (Lite)",
    file: "A-HIGH-LEVEL/WHITEPAPER_LITE.md",
    category: "high-level",
    short: "Lighter, more accessible version of the whitepaper.",
    order: 50,
  },

  // -------------------------
  // B – Architecture / Modules
  // -------------------------
  {
    id: "modules-overview",
    slug: "modules-overview",
    title: "Modules Overview",
    file: "B-Architecture_Modules/MODULES_OVERVIEW.md",
    category: "architecture-modules",
    short: "Overview of all modules and their roles.",
    order: 10,
  },
  {
    id: "data-flows",
    slug: "data-flows",
    title: "Data Flows",
    file: "B-Architecture_Modules/DATA_FLOWS.md",
    category: "architecture-modules",
    short: "How data moves across ingest, matrices, and aux modules.",
    order: 20,
  },
  {
    id: "jobs-and-daemons",
    slug: "jobs-and-daemons",
    title: "Jobs & Daemons",
    file: "B-Architecture_Modules/JOBS_AND_DAEMONS.md",
    category: "architecture-modules",
    short: "Background jobs, daemons, and their responsibilities.",
    order: 30,
  },

  // -------------------------
  // C – Database / DDL
  // -------------------------
  {
    id: "database",
    slug: "database",
    title: "Database",
    file: "C-Database_DDL/DATABASE.md",
    category: "database-ddl",
    short: "Database overview and schema organization.",
    order: 10,
  },
  {
    id: "ddl-order",
    slug: "ddl-order",
    title: "DDL Order",
    file: "C-Database_DDL/DDL_ORDER.md",
    category: "database-ddl",
    short: "Execution order of DDL files and rationale.",
    order: 20,
  },
  {
    id: "migrations",
    slug: "migrations",
    title: "Migrations",
    file: "C-Database_DDL/MIGRATIONS.md",
    category: "database-ddl",
    short: "How schema migrations are handled.",
    order: 30,
  },
  {
    id: "roles-and-rls",
    slug: "roles-and-rls",
    title: "Roles & RLS",
    file: "C-Database_DDL/ROLES_AND_RLS.md",
    category: "database-ddl",
    short: "Roles, grants, and row-level security model.",
    order: 40,
  },
  {
    id: "schemas-reference",
    slug: "schemas-reference",
    title: "Schemas Reference",
    file: "C-Database_DDL/SCHEMAS_REFERENCE.md",
    category: "database-ddl",
    short: "Reference for all schemas and main tables.",
    order: 50,
  },
  {
    id: "views-reference",
    slug: "views-reference",
    title: "Views Reference",
    file: "C-Database_DDL/VIEWS_REFERENCE.md",
    category: "database-ddl",
    short: "Reference for views and their purposes.",
    order: 60,
  },

  // -------------------------
  // D – Operations
  // -------------------------
  {
    id: "operations",
    slug: "operations",
    title: "Operations",
    file: "D-Operations/OPERATIONS.md",
    category: "operations",
    short: "How to operate the system in day-to-day use.",
    order: 10,
  },
  {
    id: "jobs-operations",
    slug: "jobs-operations",
    title: "Jobs Operations",
    file: "D-Operations/JOBS_OPERATIONS.md",
    category: "operations",
    short: "How to operate and supervise background jobs.",
    order: 20,
  },
  {
    id: "smokes",
    slug: "smokes",
    title: "Smokes",
    file: "D-Operations/SMOKES.md",
    category: "operations",
    short: "Runbooks for smoke tests and quick health checks.",
    order: 30,
  },
  {
    id: "environments",
    slug: "environments",
    title: "Environments",
    file: "D-Operations/ENVIRONMENTS.md",
    category: "operations",
    short: "Dev, staging, production and configuration differences.",
    order: 40,
  },
  {
    id: "backup-and-recovery",
    slug: "backup-and-recovery",
    title: "Backup & Recovery",
    file: "D-Operations/BACKUP_AND_RECOVERY.md",
    category: "operations",
    short: "Strategies and procedures for data backup and recovery.",
    order: 50,
  },

  // -------------------------
  // E – Security / Legal / IP
  // -------------------------
  {
    id: "security",
    slug: "security",
    title: "Security",
    file: "E-Security_Legal_IP/SECURITY.md",
    category: "security-legal-ip",
    short: "Security model overview and guiding principles.",
    order: 10,
  },
  {
    id: "security-implementation",
    slug: "security-implementation",
    title: "Security Implementation",
    file: "E-Security_Legal_IP/SECURITY_IMPLEMENTATION.md",
    category: "security-legal-ip",
    short: "Concrete security controls and implementation notes.",
    order: 20,
  },
  {
    id: "timestamping",
    slug: "timestamping",
    title: "Timestamping",
    file: "E-Security_Legal_IP/TIMESTAMPING.md",
    category: "security-legal-ip",
    short: "Timestamping approach for IP / docs / releases.",
    order: 30,
  },
  {
    id: "ip-and-registration",
    slug: "ip-and-registration",
    title: "IP & Registration",
    file: "E-Security_Legal_IP/IP_AND_REGISTRATION.md",
    category: "security-legal-ip",
    short: "Notes about IP, registration, and legal framing.",
    order: 40,
  },
  {
    id: "privacy-policy-draft",
    slug: "privacy-policy-draft",
    title: "Privacy Policy (Draft)",
    file: "E-Security_Legal_IP/PRIVACY_POLICY_DRAFT.md",
    category: "security-legal-ip",
    short: "Draft privacy policy for future refinement.",
    order: 50,
  },

  // -------------------------
  // F – Release / Versioning
  // -------------------------
  {
    id: "versioning",
    slug: "versioning",
    title: "Versioning",
    file: "F-Release_Versioning/VERSIONING.md",
    category: "release-versioning",
    short: "Versioning scheme for code and docs.",
    order: 10,
  },
  {
    id: "release-process",
    slug: "release-process",
    title: "Release Process",
    file: "F-Release_Versioning/RELEASE_PROCESS.md",
    category: "release-versioning",
    short: "How releases are cut, validated, and deployed.",
    order: 20,
  },
  {
    id: "release-notes-template",
    slug: "release-notes-template",
    title: "Release Notes Template",
    file: "F-Release_Versioning/RELEASE_NOTES_TEMPLATE.md",
    category: "release-versioning",
    short: "Template for writing release notes.",
    order: 30,
  },
  {
    id: "docs-packing",
    slug: "docs-packing",
    title: "Docs Packing",
    file: "F-Release_Versioning/DOCS_PACKING.md",
    category: "release-versioning",
    short: "How docs are bundled, hashed, and shipped.",
    order: 40,
  },

  // -------------------------
  // G – Client UX / Feature semantics
  // -------------------------
  {
    id: "client-guide",
    slug: "client-guide",
    title: "Client Guide",
    file: "G-Client_UX_Feature_Semantics/CLIENT_GUIDE.md",
    category: "client-ux-feature",
    short: "Main screens, typical flows, and UI navigation.",
    order: 10,
  },
  {
    id: "client-calculations",
    slug: "client-calculations",
    title: "Client Calculations",
    file: "G-Client_UX_Feature_Semantics/CALCULATIONS.md",
    category: "client-ux-feature",
    short: "Single reference for every UI formula and threshold.",
    order: 15,
  },
  {
    id: "matrices-semantics",
    slug: "matrices-semantics",
    title: "Matrices Semantics",
    file: "G-Client_UX_Feature_Semantics/MATRICES_SEMANTICS.md",
    category: "client-ux-feature",
    short: "pct24h, benchmarks, tiers, and derived fields.",
    order: 20,
  },
  {
    id: "str-aux-semantics",
    slug: "str-aux-semantics",
    title: "Str-Aux Semantics",
    file: "G-Client_UX_Feature_Semantics/STR_AUX_SEMANTICS.md",
    category: "client-ux-feature",
    short: "Sampling, windows, vectors, and flow gaps.",
    order: 30,
  },
  {
    id: "mea-mood-semantics",
    slug: "mea-mood-semantics",
    title: "Mea-Mood Semantics",
    file: "G-Client_UX_Feature_Semantics/MEA_MOOD_SEMANTICS.md",
    category: "client-ux-feature",
    short: "Mood tiers, thresholds, and symbol contributions.",
    order: 40,
  },
  {
    id: "cin-aux-semantics",
    slug: "cin-aux-semantics",
    title: "Cin-Aux Semantics",
    file: "G-Client_UX_Feature_Semantics/CIN_AUX_SEMANTICS.md",
    category: "client-ux-feature",
    short: "Ledger logic, imprint/luggage, and PnL framing.",
    order: 50,
  },
  {
    id: "risk-flags-explained",
    slug: "risk-flags-explained",
    title: "Risk Flags Explained",
    file: "G-Client_UX_Feature_Semantics/RISK_FLAGS_EXPLAINED.md",
    category: "client-ux-feature",
    short: "What each alert/flag in the UI means.",
    order: 60,
  },

  // -------------------------
  // H – Dev-only helpers
  // -------------------------
  {
    id: "dev-setup",
    slug: "dev-setup",
    title: "Dev Setup",
    file: "H-Dev-only_helpers/DEV_SETUP.md",
    category: "dev-helpers",
    short: "Clone, install deps, DB bootstrap, and jobs.",
    order: 10,
  },
  {
    id: "smoke-scripts-reference",
    slug: "smoke-scripts-reference",
    title: "Smoke Scripts Reference",
    file: "H-Dev-only_helpers/SMOKE_SCRIPTS_REFERENCE.md",
    category: "dev-helpers",
    short: "apply-ddls, smokes, jobs and helpers.",
    order: 20,
  },
  {
    id: "contributing",
    slug: "contributing",
    title: "Contributing",
    file: "H-Dev-only_helpers/CONTRIBUTING.md",
    category: "dev-helpers",
    short: "Branching, commit style, and PR flow.",
    order: 30,
  },
  {
    id: "testing",
    slug: "testing",
    title: "Testing",
    file: "H-Dev-only_helpers/TESTING.md",
    category: "dev-helpers",
    short: "Unit, integration, and smokes-as-tests.",
    order: 40,
  },
  {
    id: "debugging-playbook",
    slug: "debugging-playbook",
    title: "Debugging Playbook",
    file: "H-Dev-only_helpers/DEBUGGING_PLAYBOOK.md",
    category: "dev-helpers",
    short: "Common failure modes and first checks.",
    order: 50,
  },
  {
    id: "styleguide-ui",
    slug: "styleguide-ui",
    title: "UI Styleguide",
    file: "H-Dev-only_helpers/STYLEGUIDE_UI.md",
    category: "dev-helpers",
    short: "Cobalt / tetrahedron vibe, grids, and components.",
    order: 60,
  },

  // -------------------------
  // I – Future / Research
  // -------------------------
  {
    id: "research-notes",
    slug: "research-notes",
    title: "Research Notes",
    file: "I-Future_Research/RESEARCH_NOTES.md",
    category: "future-research",
    short: "Deeper math, survival analysis, and experiments.",
    order: 10,
  },
  {
    id: "future-modules",
    slug: "future-modules",
    title: "Future Modules",
    file: "I-Future_Research/FUTURE_MODULES.md",
    category: "future-research",
    short: "Toxicology module, Gaia integration, extended risk.",
    order: 20,
  },
];

export function getDocBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

export function getDocsByCategory(cat: DocCategoryId): DocMeta[] {
  return DOCS
    .filter((d) => d.category === cat)
    .sort((a, b) => a.order - b.order);
}

export const DEFAULT_DOC_SLUG = "client-guide";
