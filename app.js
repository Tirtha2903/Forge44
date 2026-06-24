/* ================================================================
   APPFORGE COMPILER — app.js
   Multi-stage pipeline: Intent → Design → Schema → Refine → Validate → Repair → Runtime
   ================================================================ */

/* ================================================================
   SAMPLE PROMPTS
   ================================================================ */
const samples = {
  crm:
    "Build a CRM with login, contacts, dashboard, role-based access, and premium plan with payments. Admins can see analytics. Sales reps manage contacts and deals.",
  marketplace:
    "Create a two-sided marketplace for tutors and students. Tutors list courses, students book sessions, admins review payments, and premium tutors get promoted search placement.",
  conflict:
    "Build a finance dashboard where guests can see all private payroll analytics, but payroll data must only be visible to admins. Include invoices and approval workflow.",
  vague:
    "Make me an internal business app with users, reports, and some automation. It should be simple but powerful."
};

/* ================================================================
   EVALUATION PROMPT DATASET (10 real + 10 edge cases)
   ================================================================ */
const evaluationPrompts = [
  // Real-world prompts
  "Build a CRM with contacts, companies, deals, login, admin analytics, and paid premium features.",
  "Create an appointment booking app for clinics with doctors, patients, calendar, reminders, and billing.",
  "Build a project management tool with tasks, teams, comments, files, roles, and client dashboards.",
  "Make an ecommerce admin for products, inventory, orders, coupons, payments, and warehouse staff.",
  "Create a learning management system with courses, lessons, students, instructors, certificates, and subscriptions.",
  "Build a real estate lead tracker with listings, agents, buyers, appointments, maps, and premium reports.",
  "Create a support desk with tickets, agents, priorities, SLA rules, knowledge base, and analytics.",
  "Build a hiring ATS with candidates, jobs, interview stages, recruiters, scorecards, and offer approvals.",
  "Create a gym membership platform with members, trainers, classes, payments, and attendance dashboards.",
  "Build a restaurant operations app with reservations, tables, menus, staff, orders, and manager analytics.",
  // Edge cases
  "Make an app.",
  "Build a dashboard with everything.",
  "Guests should edit payroll, but payroll must be admin only.",
  "Create a healthcare app with no login but include private patient records.",
  "Build a marketplace with payments but do not store users.",
  "Make a CRM, remove contacts, but contacts are the main feature.",
  "Build an analytics tool where viewers can delete all data.",
  "Create a project app with tasks assigned to nonexistent robots.",
  "Build a subscription app with premium gates but no billing.",
  "Create an app for teams, roles, files, invoices, reports, approvals, and permissions, but keep it vague."
];

/* ================================================================
   GLOBAL STATE
   ================================================================ */
const state = {
  compiled:     null,
  activePageId: null,
  pipeline:     []
};

/* ================================================================
   FEATURE CATALOG & COMPONENT TYPES
   ================================================================ */
const componentTypes = {
  dashboard:  ["metric", "chart", "activity"],
  contacts:   ["table", "form", "search"],
  deals:      ["kanban", "metric", "table"],
  companies:  ["table", "form"],
  analytics:  ["chart", "metric", "table"],
  payments:   ["metric", "table", "form"],
  bookings:   ["calendar", "table", "form"],
  courses:    ["table", "form", "metric"],
  tickets:    ["table", "form", "metric"],
  tasks:      ["kanban", "table", "form"],
  products:   ["table", "form", "metric"],
  orders:     ["table", "metric", "form"],
  users:      ["table", "form"],
  reports:    ["chart", "table", "metric"],
  files:      ["table", "form"],
  invoices:   ["table", "form", "metric"],
  candidates: ["table", "kanban", "form"]
};

const featureCatalog = [
  ["contacts",   ["contact", "crm", "lead", "customer", "buyer", "patient", "student", "member"]],
  ["companies",  ["company", "companies", "account"]],
  ["deals",      ["deal", "pipeline", "sales", "opportunity"]],
  ["analytics",  ["analytics", "dashboard", "report", "metric", "insight"]],
  ["payments",   ["payment", "billing", "subscription", "premium", "invoice", "paid"]],
  ["bookings",   ["booking", "appointment", "calendar", "reservation", "session"]],
  ["courses",    ["course", "lesson", "learning", "tutor", "student", "certificate"]],
  ["tickets",    ["ticket", "support", "sla", "knowledge"]],
  ["tasks",      ["task", "project", "kanban", "comment", "team"]],
  ["products",   ["product", "inventory", "warehouse", "coupon"]],
  ["orders",     ["order", "checkout", "ecommerce", "restaurant"]],
  ["users",      ["user", "login", "auth", "role", "staff", "admin", "guest"]],
  ["reports",    ["report", "export", "dashboard"]],
  ["files",      ["file", "document", "attachment"]],
  ["invoices",   ["invoice", "approval", "finance"]],
  ["candidates", ["candidate", "hiring", "recruiter", "interview", "job"]]
];

const defaultPrompt = samples.crm;

/* ================================================================
   UTILITY FUNCTIONS
   ================================================================ */
function stableId(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 42);
}

function titleCase(text) {
  return text
    .replace(/_/g, " ")
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function hasAny(text, words) {
  return words.some(word => text.includes(word));
}

/* ================================================================
   PIPELINE STAGE RUNNER
   ================================================================ */
function runStage(name, detail, fn) {
  const started = performance.now();
  const result = fn();
  state.pipeline.push({
    name,
    detail,
    ms: Math.max(1, Math.round(performance.now() - started))
  });
  return result;
}

/* ================================================================
   STAGE 1 — INTENT EXTRACTION
   ================================================================ */
function extractIntent(prompt) {
  const text = prompt.toLowerCase();
  const features = [];
  for (const [feature, words] of featureCatalog) {
    if (hasAny(text, words)) features.push(feature);
  }
  if (!features.length) features.push("dashboard", "users", "reports");
  if (!features.includes("dashboard")) features.unshift("dashboard");
  if (text.includes("crm") && !features.includes("deals")) features.push("deals");

  const roles = ["admin"];
  if (hasAny(text, ["sales", "rep", "agent"]))                                     roles.push("sales_rep");
  if (hasAny(text, ["client", "student", "patient", "member", "customer", "buyer"])) roles.push("customer");
  if (hasAny(text, ["staff", "manager", "recruiter", "tutor", "doctor", "instructor"])) roles.push("staff");
  if (text.includes("guest")) roles.push("guest");

  const needsAuth =
    hasAny(text, ["login", "role", "private", "admin", "auth", "user", "patient", "payroll"]) ||
    !text.includes("no login");
  const premium = hasAny(text, ["premium", "subscription", "paid", "billing", "payment"]);

  const conflicts = [];
  if (text.includes("guest") && hasAny(text, ["private", "payroll", "delete all", "edit payroll"]))
    conflicts.push("Guest access conflicts with private/admin-only data.");
  if (text.includes("no login") && hasAny(text, ["private", "patient", "payroll", "admin only"]))
    conflicts.push("Private records require authentication even though prompt says no login.");
  if (text.includes("remove contacts") && hasAny(text, ["crm", "contacts are the main feature"]))
    conflicts.push("CRM request conflicts with removing contacts.");

  return {
    original_prompt:  prompt.trim(),
    app_name:         inferAppName(text, features),
    domain:           inferDomain(text),
    features:         uniq(features),
    roles:            uniq(roles),
    needs_auth:       needsAuth,
    monetization:     premium ? "subscription" : "none",
    ambiguity:
      prompt.trim().split(/\s+/).length < 8 ||
      text.includes("everything") ||
      text.includes("some automation"),
    conflicts,
    assumptions: []
  };
}

function inferAppName(text, features) {
  if (text.includes("crm"))                            return "CRM Operating System";
  if (text.includes("marketplace"))                   return "Marketplace Control Center";
  if (text.includes("clinic") || text.includes("patient")) return "CareOps Portal";
  if (text.includes("project"))                        return "Project Command";
  if (text.includes("ecommerce"))                      return "Commerce Backoffice";
  if (text.includes("support"))                        return "Support Desk";
  return `${titleCase(features[0] || "business")} Studio`;
}

function inferDomain(text) {
  if (text.includes("crm") || text.includes("sales"))         return "sales";
  if (text.includes("marketplace"))                            return "marketplace";
  if (text.includes("clinic") || text.includes("health"))     return "healthcare";
  if (text.includes("project"))                                return "operations";
  if (text.includes("ecommerce") || text.includes("product")) return "commerce";
  if (text.includes("hiring") || text.includes("candidate"))  return "recruiting";
  return "business-operations";
}

/* ================================================================
   STAGE 2 — SYSTEM DESIGN
   ================================================================ */
function designSystem(intent) {
  const entities = uniq([
    "users",
    ...intent.features.filter(f => f !== "dashboard" && f !== "analytics" && f !== "reports")
  ]);
  const flows = ["sign_in", "dashboard_review"];
  if (intent.features.includes("contacts")) flows.push("manage_contacts");
  if (intent.features.includes("payments")) flows.push("billing_checkout");
  if (intent.features.includes("tasks"))    flows.push("assign_work");
  if (intent.features.includes("bookings")) flows.push("schedule_session");
  if (intent.conflicts.length)              flows.push("policy_resolution");

  const assumptions = [...intent.assumptions];
  if (intent.ambiguity)
    assumptions.push("Used a conservative admin/staff/customer model because the prompt was underspecified.");
  if (intent.monetization === "subscription")
    assumptions.push("Premium access is implemented as a subscription gate backed by payment records.");
  if (!intent.needs_auth)
    assumptions.push("Public access is limited to marketing-safe pages; private data remains protected.");

  return {
    app_name:   intent.app_name,
    domain:     intent.domain,
    entities,
    flows,
    roles:      intent.roles,
    assumptions,
    policy_decisions: intent.conflicts.map(conflict => ({
      conflict,
      resolution: "Prefer least-privilege access. Admin-only resources remain protected from guest roles."
    }))
  };
}

/* ================================================================
   STAGE 3 — SCHEMA GENERATION
   ================================================================ */
function generateSchemas(intent, architecture) {
  const db       = generateDbSchema(architecture.entities, intent);
  const api      = generateApiSchema(db, intent);
  const auth     = generateAuthRules(intent, db);
  const ui       = generateUiSchema(intent, db, api);
  const business = generateBusinessRules(intent, db);
  return {
    compiler_version: "1.0.0",
    generated_at:     new Date(0).toISOString(),
    app: {
      name:             architecture.app_name,
      domain:           architecture.domain,
      assumptions:      architecture.assumptions,
      policy_decisions: architecture.policy_decisions
    },
    ui,
    api,
    database:       db,
    auth,
    business_logic: business
  };
}

/* -- DB Schema -- */
function generateDbSchema(entities, intent) {
  const tables = entities.map(entity => ({
    name:      entity,
    fields:    fieldsForEntity(entity),
    relations: entity === "users" ? [] : [{ table: "users", field: "owner_id", type: "many_to_one" }]
  }));
  if (intent.monetization === "subscription" && !tables.some(t => t.name === "subscriptions")) {
    tables.push({
      name: "subscriptions",
      fields: [
        field("id",         "uuid",     true),
        field("user_id",    "uuid",     true),
        field("plan",       "enum",     true,  ["free", "premium"]),
        field("status",     "enum",     true,  ["active", "past_due", "cancelled"]),
        field("created_at", "datetime", true)
      ],
      relations: [{ table: "users", field: "user_id", type: "many_to_one" }]
    });
  }
  return { tables };
}

function field(name, type, required, options) {
  return { name, type, required, ...(options ? { options } : {}) };
}

function fieldsForEntity(entity) {
  const shared = [
    field("id",         "uuid",     true),
    field("created_at", "datetime", true),
    field("owner_id",   "uuid",     false)
  ];
  const map = {
    users:      [field("id","uuid",true), field("email","email",true), field("name","string",true), field("role","enum",true,["admin","staff","sales_rep","customer","guest"]), field("created_at","datetime",true)],
    contacts:   [...shared, field("name","string",true), field("email","email",false), field("status","enum",true,["new","active","won","lost"])],
    companies:  [...shared, field("name","string",true), field("industry","string",false), field("size","number",false)],
    deals:      [...shared, field("title","string",true), field("amount","currency",true), field("stage","enum",true,["lead","qualified","proposal","won","lost"])],
    payments:   [...shared, field("amount","currency",true), field("status","enum",true,["pending","paid","failed"]), field("provider_ref","string",false)],
    bookings:   [...shared, field("starts_at","datetime",true), field("status","enum",true,["requested","confirmed","cancelled"])],
    courses:    [...shared, field("title","string",true), field("price","currency",false), field("published","boolean",true)],
    tickets:    [...shared, field("subject","string",true), field("priority","enum",true,["low","medium","high"]), field("status","enum",true,["open","pending","closed"])],
    tasks:      [...shared, field("title","string",true), field("status","enum",true,["todo","doing","done"]), field("assignee_id","uuid",false)],
    products:   [...shared, field("name","string",true), field("sku","string",true), field("stock","number",true)],
    orders:     [...shared, field("total","currency",true), field("status","enum",true,["draft","paid","fulfilled","cancelled"])],
    reports:    [...shared, field("title","string",true), field("scope","string",true)],
    files:      [...shared, field("filename","string",true), field("url","url",true)],
    invoices:   [...shared, field("amount","currency",true), field("approval_status","enum",true,["draft","submitted","approved","rejected"])],
    candidates: [...shared, field("name","string",true), field("stage","enum",true,["applied","screen","interview","offer"])]
  };
  return map[entity] || [...shared, field("name","string",true), field("status","string",true)];
}

/* -- API Schema -- */
function generateApiSchema(db, intent) {
  const endpoints = [];
  for (const table of db.tables) {
    endpoints.push({
      id:            `list_${table.name}`,
      method:        "GET",
      path:          `/api/${table.name}`,
      table:         table.name,
      operation:     "list",
      request:       { fields: [] },
      response:      { fields: table.fields.map(f => f.name) },
      roles_allowed: rolesForTable(table.name, "read", intent)
    });
    endpoints.push({
      id:            `create_${table.name}`,
      method:        "POST",
      path:          `/api/${table.name}`,
      table:         table.name,
      operation:     "create",
      request:       { fields: table.fields.filter(f => f.required && !["id","created_at"].includes(f.name)).map(f => f.name) },
      response:      { fields: table.fields.map(f => f.name) },
      roles_allowed: rolesForTable(table.name, "write", intent)
    });
  }
  return { endpoints };
}

function rolesForTable(table, mode, intent) {
  if (table === "users" && mode === "write") return ["admin"];
  if (["payments","subscriptions","invoices","analytics"].includes(table)) return ["admin"];
  if (mode === "read" && intent.roles.includes("customer"))
    return ["admin","staff","sales_rep","customer"].filter(r => intent.roles.includes(r));
  return intent.roles.filter(r => r !== "guest");
}

/* -- Auth Schema -- */
function generateAuthRules(intent, db) {
  const roles = intent.roles.map(role => ({
    name:        role,
    description: `${titleCase(role)} access profile`,
    permissions: permissionsForRole(role, db)
  }));
  return {
    provider: intent.needs_auth ? "email_password" : "optional_public_session",
    session:  { strategy: "signed_jwt", ttl_minutes: 480 },
    roles
  };
}

function permissionsForRole(role, db) {
  return db.tables.map(table => {
    if (role === "admin") return { table: table.name, actions: ["create","read","update","delete"] };
    if (role === "guest") return { table: table.name, actions: [] };
    const protectedTables = ["payments","subscriptions","invoices"];
    return {
      table:   table.name,
      actions: protectedTables.includes(table.name) ? ["read"] : ["create","read","update"]
    };
  });
}

/* -- UI Schema -- */
function generateUiSchema(intent, db, api) {
  const pages = [];
  pages.push({
    id:          "dashboard",
    title:       "Executive Dashboard",
    route:       "/",
    role_access: intent.roles.filter(r => r !== "guest"),
    components: [
      component("metric",   "Active records",  "list_users"),
      component("chart",    "Growth trend",    api.endpoints[0]?.id || "list_users"),
      component("activity", "Recent activity", api.endpoints[0]?.id || "list_users")
    ]
  });
  for (const table of db.tables.filter(t => !["subscriptions"].includes(t.name))) {
    if (table.name === "users") continue;
    pages.push({
      id:          `${table.name}_page`,
      title:       titleCase(table.name),
      route:       `/${table.name}`,
      role_access: rolesForTable(table.name, "read", intent),
      components:  (componentTypes[table.name] || ["table","form"]).map(type =>
        component(type, `${titleCase(table.name)} ${type}`, `${type === "form" ? "create" : "list"}_${table.name}`)
      )
    });
  }
  if (intent.monetization === "subscription") {
    pages.push({
      id:          "billing_page",
      title:       "Billing and Plans",
      route:       "/billing",
      role_access: ["admin","customer"].filter(r => intent.roles.includes(r)),
      components: [
        component("metric", "Premium conversion", "list_subscriptions"),
        component("table",  "Subscriptions",      "list_subscriptions"),
        component("form",   "Upgrade plan",        "create_subscriptions")
      ]
    });
  }
  return {
    navigation: pages.map(p => ({ label: p.title, route: p.route, page_id: p.id })),
    pages
  };
}

function component(type, title, endpoint) {
  return { id: stableId(`${title}_${endpoint}`), type, title, endpoint };
}

/* -- Business Rules -- */
function generateBusinessRules(intent, db) {
  const rules = [{
    id:          "least_privilege_access",
    description: "Users may only perform actions granted by role permissions.",
    enforcement: "api_middleware"
  }];
  if (intent.monetization === "subscription") {
    rules.push({
      id:          "premium_gate",
      description: "Premium-only surfaces require an active premium subscription.",
      enforcement: "ui_and_api",
      depends_on:  ["subscriptions.status","subscriptions.plan"]
    });
  }
  if (db.tables.some(t => ["payments","invoices"].includes(t.name))) {
    rules.push({
      id:          "financial_admin_boundary",
      description: "Financial records can be mutated only by admins.",
      enforcement: "api_policy"
    });
  }
  return { rules };
}

/* ================================================================
   STAGE 4 — REFINEMENT
   ================================================================ */
function refineConfig(config, intent) {
  const refined = structuredClone(config);
  if (intent.conflicts.length) {
    for (const page of refined.ui.pages) {
      page.role_access = page.role_access.filter(r => r !== "guest");
    }
    for (const endpoint of refined.api.endpoints) {
      endpoint.roles_allowed = endpoint.roles_allowed.filter(r => r !== "guest");
    }
  }
  for (const page of refined.ui.pages) {
    page.components = page.components.filter(
      (c, i, arr) => arr.findIndex(o => o.id === c.id) === i
    );
  }
  if (intent.ambiguity) {
    const dashboard = refined.ui.pages.find(p => p.id === "dashboard");
    dashboard?.components.push({
      id:       "ambiguous_automation_panel",
      type:     "activity",
      title:    "Automation Queue",
      endpoint: "run_unspecified_automation"
    });
  }
  if (intent.conflicts.length) {
    const first = refined.api.endpoints.find(e => e.operation === "list");
    if (first && !first.response.fields.includes("private_notes"))
      first.response.fields.push("private_notes");
  }
  return refined;
}

/* ================================================================
   STAGE 5 — VALIDATION
   ================================================================ */
function validateConfig(config) {
  const issues = [];
  const requiredTop = ["compiler_version","app","ui","api","database","auth","business_logic"];
  requiredTop.forEach(key => {
    if (!config[key])
      issues.push(issue("schema","missing_key",`Missing top-level key: ${key}`,"fail",key));
  });

  const tables    = config.database?.tables || [];
  const endpoints = config.api?.endpoints   || [];
  const pages     = config.ui?.pages        || [];
  const roles     = config.auth?.roles?.map(r => r.name) || [];

  const tableNames  = new Set(tables.map(t => t.name));
  const endpointIds = new Set(endpoints.map(e => e.id));
  const roleSet     = new Set(roles);

  for (const table of tables) {
    if (!table.fields?.some(f => f.name === "id"))
      issues.push(issue("database","missing_id",`Table ${table.name} has no id field.`,"fail",table.name));
    for (const rel of table.relations || []) {
      if (!tableNames.has(rel.table))
        issues.push(issue("database","bad_relation",`${table.name} relates to missing table ${rel.table}.`,"fail",table.name));
      if (!table.fields.some(f => f.name === rel.field))
        issues.push(issue("database","missing_relation_field",`${table.name} relation field ${rel.field} is missing.`,"fail",table.name));
    }
  }
  for (const endpoint of endpoints) {
    const table = tables.find(t => t.name === endpoint.table);
    if (!table) {
      issues.push(issue("api","missing_table",`Endpoint ${endpoint.id} references missing table ${endpoint.table}.`,"fail",endpoint.id));
      continue;
    }
    const fields = new Set(table.fields.map(f => f.name));
    for (const rf of endpoint.request.fields)
      if (!fields.has(rf))
        issues.push(issue("api","unknown_request_field",`${endpoint.id} requests missing field ${rf}.`,"fail",endpoint.id));
    for (const rf of endpoint.response.fields)
      if (!fields.has(rf))
        issues.push(issue("api","unknown_response_field",`${endpoint.id} returns missing field ${rf}.`,"fail",endpoint.id));
    for (const role of endpoint.roles_allowed)
      if (!roleSet.has(role))
        issues.push(issue("auth","unknown_endpoint_role",`${endpoint.id} allows unknown role ${role}.`,"fail",endpoint.id));
  }
  for (const page of pages) {
    for (const role of page.role_access)
      if (!roleSet.has(role))
        issues.push(issue("ui","unknown_page_role",`${page.title} uses unknown role ${role}.`,"fail",page.id));
    for (const comp of page.components)
      if (!endpointIds.has(comp.endpoint))
        issues.push(issue("ui","missing_endpoint",`${page.title} component ${comp.title} calls missing endpoint ${comp.endpoint}.`,"fail",page.id));
  }
  if (config.business_logic?.rules?.some(r => r.id === "premium_gate")) {
    if (!tableNames.has("subscriptions"))
      issues.push(issue("business","missing_subscription_table","Premium gate requires subscriptions table.","fail","premium_gate"));
    if (!endpointIds.has("list_subscriptions"))
      issues.push(issue("business","missing_subscription_endpoint","Premium gate requires subscription endpoints.","fail","premium_gate"));
  }
  if (!issues.length)
    issues.push(issue("system","valid","All cross-layer contracts passed.","pass","all"));

  return {
    valid:   !issues.some(i => i.severity === "fail"),
    issues,
    summary: {
      tables:    tables.length,
      endpoints: endpoints.length,
      pages:     pages.length,
      roles:     roles.length
    }
  };
}

function issue(layer, code, message, severity, target) {
  return { layer, code, message, severity, target };
}

/* ================================================================
   REPAIR ENGINE
   ================================================================ */
function repairConfig(config, validation) {
  const repaired  = structuredClone(config);
  const repairLog = [];
  const tables    = repaired.database.tables;

  for (const item of validation.issues) {
    if (item.code === "missing_relation_field") {
      const table    = tables.find(t => t.name === item.target);
      const relation = table?.relations?.find(rel => !table.fields.some(f => f.name === rel.field));
      if (table && relation) {
        table.fields.push(field(relation.field, "uuid", false));
        repairLog.push(`Added missing relation field ${relation.field} to ${table.name}.`);
      }
    }
    if (item.code === "missing_endpoint") {
      const page   = repaired.ui.pages.find(p => p.id === item.target);
      const broken = page?.components.find(
        c => !repaired.api.endpoints.some(e => e.id === c.endpoint)
      );
      if (broken) {
        broken.endpoint = repaired.api.endpoints[0]?.id || "list_users";
        repairLog.push(`Rewired ${broken.title} to an existing endpoint.`);
      }
    }
    if (item.code === "unknown_response_field") {
      const endpoint = repaired.api.endpoints.find(e => e.id === item.target);
      const table    = repaired.database.tables.find(t => t.name === endpoint?.table);
      if (endpoint && table) {
        const allowed = new Set(table.fields.map(f => f.name));
        endpoint.response.fields = endpoint.response.fields.filter(f => allowed.has(f));
        repairLog.push(`Removed hallucinated response fields from ${endpoint.id}.`);
      }
    }
    if (item.code === "missing_subscription_table") {
      repaired.database.tables.push({
        name: "subscriptions",
        fields: [
          field("id","uuid",true),
          field("user_id","uuid",true),
          field("plan","enum",true,["free","premium"]),
          field("status","enum",true,["active","past_due","cancelled"])
        ],
        relations: [{ table: "users", field: "user_id", type: "many_to_one" }]
      });
      repairLog.push("Created subscriptions table for premium gate.");
    }
    if (item.code === "missing_subscription_endpoint") {
      const table = repaired.database.tables.find(t => t.name === "subscriptions");
      if (table) {
        repaired.api.endpoints.push({
          id:            "list_subscriptions",
          method:        "GET",
          path:          "/api/subscriptions",
          table:         "subscriptions",
          operation:     "list",
          request:       { fields: [] },
          response:      { fields: table.fields.map(f => f.name) },
          roles_allowed: ["admin"]
        });
        repairLog.push("Added list_subscriptions endpoint for premium gate.");
      }
    }
  }
  return { repaired, repairLog };
}

/* ================================================================
   RUNTIME SIMULATION
   ================================================================ */
function simulateRuntime(config, validation) {
  const checks = [
    check("Valid JSON serialization",            canJsonSerialize(config)),
    check("At least one executable page",        config.ui.pages.length > 0),
    check("Every UI component resolves to API",  validation.issues.every(i => i.code !== "missing_endpoint")),
    check("API endpoints resolve to DB tables",  validation.issues.every(i => i.code !== "missing_table")),
    check("Auth roles are enforceable",          config.auth.roles.length > 0 && config.auth.roles.some(r => r.name === "admin")),
    check("Business rules have enforcement",     config.business_logic.rules.every(r => Boolean(r.enforcement)))
  ];
  return { ready: checks.every(c => c.pass), checks };
}

function canJsonSerialize(value) {
  try { JSON.stringify(value); return true; } catch { return false; }
}

function check(name, pass) {
  return { name, pass, detail: pass ? "Passed" : "Failed" };
}

/* ================================================================
   SCORING
   ================================================================ */
function scoreQuality(config, validation, runtime, intent) {
  let score = 100;
  score -= validation.issues.filter(i => i.severity === "fail").length * 14;
  score -= intent.ambiguity        ? 4 : 0;
  score -= intent.conflicts.length * 3;
  score += runtime.ready           ? 3 : 0;
  score += Math.min(6, config.ui.pages.length);
  return Math.max(0, Math.min(100, score));
}

function estimateCostUnits(intent, repairLoops) {
  return Number((5 + intent.features.length * 1.4 + intent.conflicts.length * 2 + repairLoops * 3).toFixed(1));
}

/* ================================================================
   MAIN COMPILE FUNCTION
   ================================================================ */
function compilePrompt(prompt) {
  state.pipeline = [];
  const started = performance.now();

  const intent      = runStage("Intent Extraction", "Prompt converted into features, roles, monetization, ambiguity, conflicts.", () => extractIntent(prompt));
  const architecture= runStage("System Design",     "Intent expanded into entities, flows, policies, and assumptions.",          () => designSystem(intent));
  const generated   = runStage("Schema Generation", "UI, API, DB, auth, and business-rule contracts emitted.",                   () => generateSchemas(intent, architecture));
  const refined     = runStage("Refinement",        "Cross-layer policy choices applied before validation.",                     () => refineConfig(generated, intent));
  let   validation  = runStage("Validation",        "Strict schema and cross-layer consistency checks executed.",                () => validateConfig(refined));

  let current    = refined;
  let repairLog  = [];
  let repairLoops = 0;
  while (!validation.valid && repairLoops < 3) {
    const repaired = repairConfig(current, validation);
    current        = repaired.repaired;
    repairLog      = repairLog.concat(repaired.repairLog);
    repairLoops++;
    validation     = validateConfig(current);
  }

  const runtime = simulateRuntime(current, validation);
  const latency = Math.round(performance.now() - started);

  return {
    intent,
    architecture,
    config:     current,
    validation,
    repair:     { loops: repairLoops, log: repairLog },
    runtime,
    metrics: {
      latency_ms:           Math.max(1, latency),
      success:              validation.valid && runtime.ready,
      quality_score:        scoreQuality(current, validation, runtime, intent),
      estimated_cost_units: estimateCostUnits(intent, repairLoops)
    }
  };
}

/* ================================================================
   JSON SYNTAX HIGHLIGHTER
   ================================================================ */
function syntaxHighlightJson(json) {
  return json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      match => {
        let cls = "json-number";
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? "json-key" : "json-string";
        } else if (/true|false/.test(match)) {
          cls = "json-bool";
        } else if (/null/.test(match)) {
          cls = "json-null";
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

/* ================================================================
   RENDER — PIPELINE STAGES
   ================================================================ */
function renderPipeline() {
  const stageEls = document.querySelectorAll("#pipeline .stage");
  stageEls.forEach((el, i) => {
    el.classList.remove("active", "done");
    const stageData = state.pipeline[i];
    if (!stageData) return;

    // Populate data
    const nameEl   = el.querySelector(".stage-name");
    const detailEl = el.querySelector(".stage-detail");
    const headerEl = el.querySelector(".stage-header");

    if (nameEl)   nameEl.textContent   = stageData.name;
    if (detailEl) detailEl.textContent = stageData.detail;

    // Add ms badge if not present
    let msEl = el.querySelector(".stage-ms");
    if (!msEl) {
      msEl = document.createElement("span");
      msEl.className = "stage-ms";
      el.appendChild(msEl);
    }
    msEl.textContent = `${stageData.ms}ms`;

    el.classList.add("done");
  });
}

function animatePipelineStages() {
  const stageEls = document.querySelectorAll("#pipeline .stage");
  stageEls.forEach((el, i) => {
    el.classList.remove("active", "done");
    setTimeout(() => {
      el.classList.add("active");
      setTimeout(() => {
        el.classList.remove("active");
        el.classList.add("done");
      }, 300);
    }, i * 180);
  });
}

/* ================================================================
   RENDER — HERO STATUS CARDS
   ================================================================ */
function updateHeroStatus(result) {
  document.getElementById("heroValidation").textContent = result.validation.valid ? "Passed" : "Failed";
  document.getElementById("heroRuntime").textContent    = result.runtime.ready    ? "Executable" : "Blocked";
  document.getElementById("heroRepairs").textContent    = String(result.repair.loops);
  document.getElementById("heroQuality").textContent    = result.metrics.quality_score;

  const valCard = document.getElementById("statValidation");
  valCard.className = `stat-card ${result.validation.valid ? "is-pass" : "is-fail"}`;

  const runCard = document.getElementById("statRuntime");
  runCard.className = `stat-card ${result.runtime.ready ? "is-run" : "is-fail"}`;

  document.getElementById("statRepairs").className = "stat-card";
  document.getElementById("statQuality").className  = "stat-card is-run";

  // Nav status
  const navStatus = document.getElementById("navStatus");
  if (navStatus) navStatus.textContent = result.metrics.success ? "Compiled" : "Needs Review";
}

/* ================================================================
   RENDER — RUNTIME PREVIEW
   ================================================================ */
function renderRuntime() {
  const result       = state.compiled;
  const preview      = document.getElementById("appPreview");
  const runtimeChecks = document.getElementById("runtimeChecks");

  if (!result) {
    preview.innerHTML = `
      <div class="app-shell-placeholder">
        <div class="placeholder-icon" aria-hidden="true">⚡</div>
        <p class="placeholder-text">Compile a prompt to render your generated application.</p>
      </div>`;
    runtimeChecks.innerHTML = "";
    return;
  }

  const pages  = result.config.ui.pages;
  const active = pages.find(p => p.id === state.activePageId) || pages[0];

  // Build nav items
  const navItems = pages.map(p => `
    <button
      class="preview-nav-item ${p.id === active.id ? "active" : ""}"
      data-page="${p.id}"
      aria-label="${p.title}"
    >
      ${pageIcon(p)} ${p.title}
    </button>`
  ).join("");

  preview.innerHTML = `
    <div class="preview-frame">
      <nav class="preview-nav" aria-label="App navigation">
        <div class="preview-nav-brand">
          <div class="preview-nav-brand-icon" aria-hidden="true">⚡</div>
          <span class="preview-nav-brand-name">${result.config.app.name}</span>
        </div>
        ${navItems}
      </nav>
      <div class="preview-page" role="main">
        <div class="preview-page-header">
          <div class="preview-page-meta">
            <span class="preview-route-badge">${active.route}</span>
            <h2 class="preview-page-title">${active.title}</h2>
          </div>
          <div class="role-badges" aria-label="Role access">
            ${active.role_access.map(r => `<span class="role-badge">${r}</span>`).join("") || '<span class="role-badge">public</span>'}
          </div>
        </div>
        <div class="component-grid">
          ${active.components.map(renderComponent).join("")}
        </div>
      </div>
    </div>`;

  preview.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activePageId = btn.dataset.page;
      renderRuntime();
    });
  });

  // Runtime checks
  runtimeChecks.innerHTML = result.runtime.checks.map(item => `
    <div class="check-item">
      <div class="check-text">
        <div class="check-name">${item.name}</div>
        <div class="check-detail">${item.detail}</div>
      </div>
      <span class="status-pill ${item.pass ? "pass" : "fail"}">${item.pass ? "pass" : "fail"}</span>
    </div>`
  ).join("");
}

function pageIcon(page) {
  const map = {
    dashboard:  "◈",
    contacts:   "◉",
    deals:      "◇",
    analytics:  "▲",
    payments:   "◈",
    billing:    "◈",
    tasks:      "▣",
    tickets:    "◎",
    users:      "●",
    reports:    "▤",
    products:   "▣",
    orders:     "◇",
    bookings:   "◎",
    courses:    "▤",
    files:      "▥",
    invoices:   "◈",
    candidates: "◉"
  };
  const key = Object.keys(map).find(k => page.id.startsWith(k)) || "";
  return `<span aria-hidden="true">${map[key] || "◉"}</span>`;
}

/* ================================================================
   RENDER — COMPONENT TYPES
   ================================================================ */
function renderComponent(item) {
  if (item.type === "table") {
    return `
      <article class="preview-component full" aria-label="${item.title}">
        <div class="component-label">${item.type}</div>
        <div class="component-title">${item.title}</div>
        <table class="mini-table" aria-label="Sample data">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Owner</th><th>Created</th></tr>
          </thead>
          <tbody>
            <tr><td>Northstar Account</td><td><span class="mini-status-badge">active</span></td><td>Admin</td><td>Today</td></tr>
            <tr><td>Launch Pipeline</td><td><span class="mini-status-badge warn">pending</span></td><td>Staff</td><td>Yesterday</td></tr>
          </tbody>
        </table>
        <span class="endpoint-badge">GET ${item.endpoint.replace(/_/g," / ")}</span>
      </article>`;
  }
  if (item.type === "chart") {
    const heights = [44,72,38,92,60,80,55,70];
    return `
      <article class="preview-component" aria-label="${item.title}">
        <div class="component-label">${item.type}</div>
        <div class="component-title">${item.title}</div>
        <div class="mini-chart" role="img" aria-label="Bar chart">
          ${heights.map(h => `<div class="mini-chart-bar" style="height:${h}px"></div>`).join("")}
        </div>
        <span class="endpoint-badge">GET ${item.endpoint.replace(/_/g," / ")}</span>
      </article>`;
  }
  if (item.type === "metric") {
    return `
      <article class="preview-component" aria-label="${item.title}">
        <div class="component-label">${item.type}</div>
        <div class="component-title">${item.title}</div>
        <div class="metric-value-large">${Math.floor(Math.random() * 800 + 200)}</div>
        <div class="metric-sub">+12.4% vs last period</div>
        <span class="endpoint-badge">GET ${item.endpoint.replace(/_/g," / ")}</span>
      </article>`;
  }
  if (item.type === "form") {
    return `
      <article class="preview-component" aria-label="${item.title}">
        <div class="component-label">${item.type}</div>
        <div class="component-title">${item.title}</div>
        <div class="mini-form-field">
          <div class="mini-form-label">Name</div>
          <div class="mini-form-input">Required field</div>
        </div>
        <div class="mini-form-field">
          <div class="mini-form-label">Status</div>
          <div class="mini-form-input">Select…</div>
        </div>
        <span class="endpoint-badge">POST ${item.endpoint.replace(/_/g," / ")}</span>
      </article>`;
  }
  // kanban / activity / other
  return `
    <article class="preview-component" aria-label="${item.title}">
      <div class="component-label">${item.type}</div>
      <div class="component-title">${item.title}</div>
      <p style="font-size:0.76rem;color:var(--text-muted);line-height:1.6">
        Runtime component bound to <strong style="color:var(--text-secondary)">${item.endpoint}</strong>
      </p>
      <span class="endpoint-badge">${item.endpoint.replace(/_/g," / ")}</span>
    </article>`;
}

/* ================================================================
   RENDER — JSON OUTPUT
   ================================================================ */
function renderJson() {
  const jsonStr = JSON.stringify(state.compiled.config, null, 2);
  document.getElementById("jsonOutput").innerHTML = syntaxHighlightJson(jsonStr);
  document.getElementById("jsonFilename").textContent =
    `// ${stableId(state.compiled.config.app.name)}.json`;
}

/* ================================================================
   RENDER — VALIDATION REPORT
   ================================================================ */
function renderValidation() {
  const result = state.compiled;
  const v      = result.validation;
  const m      = result.metrics;

  const statusClass = v.valid ? "status-pass" : "status-fail";

  const summaryCards = `
    <div class="summary-grid">
      <div class="summary-card ${statusClass}">
        <div class="summary-card-label">Status</div>
        <div class="summary-card-value">${v.valid ? "Pass" : "Fail"}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Pages</div>
        <div class="summary-card-value">${v.summary.pages}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Endpoints</div>
        <div class="summary-card-value">${v.summary.endpoints}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Quality</div>
        <div class="summary-card-value">${m.quality_score}</div>
      </div>
    </div>`;

  const assumptionItems = result.config.app.assumptions.map(a => `
    <div class="issue-item type-note">
      <div class="issue-body">
        <div class="issue-title">Assumption</div>
        <div class="issue-msg">${a}</div>
      </div>
      <span class="status-pill note">note</span>
    </div>`).join("");

  const policyItems = result.config.app.policy_decisions.map(p => `
    <div class="issue-item type-warn">
      <div class="issue-body">
        <div class="issue-title">Policy Conflict Resolved</div>
        <div class="issue-msg">${p.conflict} — ${p.resolution}</div>
      </div>
      <span class="status-pill warn">resolved</span>
    </div>`).join("");

  const repairItems = result.repair.log.map(log => `
    <div class="issue-item type-warn">
      <div class="issue-body">
        <div class="issue-title">Repair Applied</div>
        <div class="issue-msg">${log}</div>
      </div>
      <span class="status-pill repair">repair</span>
    </div>`).join("");

  const issueItems = v.issues.map(item => `
    <div class="issue-item type-${item.severity}">
      <div class="issue-body">
        <div class="issue-title">${titleCase(item.layer)}: ${item.code}</div>
        <div class="issue-msg">${item.message}</div>
      </div>
      <span class="status-pill ${item.severity}">${item.severity}</span>
    </div>`).join("");

  document.getElementById("validationReport").innerHTML = `
    ${summaryCards}
    <div class="issue-list animate-in">
      ${assumptionItems}
      ${policyItems}
      ${repairItems}
      ${issueItems}
    </div>`;
}

/* ================================================================
   RENDER — ALL
   ================================================================ */
function renderAll(result) {
  state.compiled    = result;
  state.activePageId = result.config.ui.pages[0]?.id || null;

  updateHeroStatus(result);
  animatePipelineStages();
  setTimeout(renderPipeline, state.pipeline.length * 180 + 400);

  renderRuntime();
  renderJson();
  renderValidation();
}

/* ================================================================
   EVALUATION BENCHMARK
   ================================================================ */
function runEvaluation() {
  const btn = document.getElementById("runEvaluation");
  if (btn) { btn.textContent = "⏳ Running…"; btn.disabled = true; }

  setTimeout(() => {
    const started = performance.now();
    const rows = evaluationPrompts.map(prompt => {
      const result = compilePrompt(prompt);
      return {
        prompt,
        success:       result.metrics.success,
        repairs:       result.repair.loops,
        latency_ms:    result.metrics.latency_ms,
        failure_types: result.validation.issues.filter(i => i.severity === "fail").map(i => i.code),
        quality_score: result.metrics.quality_score,
        cost_units:    result.metrics.estimated_cost_units
      };
    });

    const successCount = rows.filter(r => r.success).length;
    const avgLatency   = Math.round(rows.reduce((s, r) => s + r.latency_ms, 0)    / rows.length);
    const avgQuality   = Math.round(rows.reduce((s, r) => s + r.quality_score, 0) / rows.length);
    const totalRepairs = rows.reduce((s, r) => s + r.repairs, 0);
    const successRate  = Math.round((successCount / rows.length) * 100);

    const evalRows = rows.map((row, i) => {
      const isEdge = i >= 10;
      return `
        <div class="eval-row animate-in" style="animation-delay:${i * 30}ms">
          <div class="eval-row-prompt" title="${row.prompt}">${isEdge ? "⚠ " : ""}${row.prompt}</div>
          <div class="eval-row-meta">
            <span class="eval-meta-item">${row.latency_ms}ms</span>
            <span class="eval-meta-item">Q:${row.quality_score}</span>
            <span class="eval-meta-item">R:${row.repairs}</span>
            <span class="status-pill ${row.success ? "pass" : "fail"}">${row.success ? "pass" : "fail"}</span>
          </div>
        </div>`;
    }).join("");

    document.getElementById("evaluationReport").innerHTML = `
      <div class="eval-summary summary-grid">
        <div class="summary-card status-pass">
          <div class="summary-card-label">Success Rate</div>
          <div class="summary-card-value">${successRate}%</div>
          <div class="success-rate-bar" style="margin-top:6px">
            <div class="success-rate-fill" style="width:${successRate}%"></div>
          </div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Avg Latency</div>
          <div class="summary-card-value">${avgLatency}ms</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Total Repairs</div>
          <div class="summary-card-value">${totalRepairs}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Avg Quality</div>
          <div class="summary-card-value">${avgQuality}</div>
        </div>
      </div>
      <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span style="font-size:0.75rem;color:var(--text-muted)">
          10 real-world prompts · 10 edge cases (⚠ marked) · ${Math.round(performance.now() - started)}ms total
        </span>
      </div>
      <div class="eval-table">${evalRows}</div>`;

    if (btn) { btn.textContent = "▶ Run 20 Prompts"; btn.disabled = false; }
  }, 50);
}

/* ================================================================
   TAB SWITCHING
   ================================================================ */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
    t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false");
  });
  document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
  document.getElementById(`${name}View`).classList.add("active");
}

/* ================================================================
   DOWNLOAD JSON
   ================================================================ */
function downloadJson() {
  const json = JSON.stringify(state.compiled.config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = `${stableId(state.compiled.config.app.name)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ================================================================
   COMPILE BUTTON — LOADING STATE
   ================================================================ */
function setLoading(loading) {
  const btn   = document.getElementById("generateBtn");
  const label = document.getElementById("btnLabel");
  if (!btn || !label) return;
  if (loading) {
    btn.classList.add("loading");
    btn.disabled  = true;
    label.textContent = "Compiling…";
  } else {
    btn.classList.remove("loading");
    btn.disabled  = false;
    label.textContent = "⚡ Compile App";
  }
}

/* ================================================================
   CHAR COUNTER
   ================================================================ */
function updateCharCount() {
  const count = document.getElementById("promptInput")?.value.length || 0;
  const el = document.getElementById("charCount");
  if (el) el.textContent = `${count} char${count !== 1 ? "s" : ""}`;
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  const promptInput = document.getElementById("promptInput");
  const generateBtn = document.getElementById("generateBtn");

  // Default prompt
  promptInput.value = defaultPrompt;
  updateCharCount();

  // Char counter
  promptInput.addEventListener("input", updateCharCount);

  // Compile
  generateBtn.addEventListener("click", () => {
    const prompt = promptInput.value.trim();
    setLoading(true);
    // small delay so spinner renders
    setTimeout(() => {
      renderAll(compilePrompt(prompt || defaultPrompt));
      setLoading(false);
    }, 60);
  });

  // Clear
  document.getElementById("clearPrompt").addEventListener("click", () => {
    promptInput.value = "";
    promptInput.focus();
    updateCharCount();
  });

  // Sample chips
  document.querySelectorAll("[data-sample]").forEach(btn => {
    btn.addEventListener("click", () => {
      promptInput.value = samples[btn.dataset.sample];
      updateCharCount();
    });
  });

  // Tabs
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // JSON actions
  document.getElementById("copyJson").addEventListener("click", async () => {
    if (!state.compiled) return;
    await navigator.clipboard.writeText(JSON.stringify(state.compiled.config, null, 2));
    const btn = document.getElementById("copyJson");
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });

  document.getElementById("downloadJson").addEventListener("click", () => {
    if (state.compiled) downloadJson();
  });

  // Evaluation (both nav btn and tab btn)
  document.getElementById("runEvaluation").addEventListener("click", () => {
    switchTab("evaluation");
    runEvaluation();
  });
  const navEval = document.getElementById("navRunEval");
  if (navEval) navEval.addEventListener("click", () => {
    switchTab("evaluation");
    runEvaluation();
  });

  // Boot compile
  renderAll(compilePrompt(defaultPrompt));
}

init();
