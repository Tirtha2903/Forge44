'use strict';

/**
 * LLM output validator and normaliser for Forge44.
 *
 * The LLM is instructed to return a specific JSON schema, but models can deviate.
 * This module is the gatekeeper between the LLM and the pipeline:
 *
 *  1. Throws INVALID_SCHEMA for irrecoverable errors (e.g., no pages returned).
 *     "Irrecoverable" means the frontend cannot render anything meaningful.
 *
 *  2. Applies safe defaults for optional or lightly malformed fields (normalisation).
 *     "Safe default" means the pipeline can continue and produce a valid result.
 *
 *  3. Returns a clean, consistent object that satisfies the pipeline's type contract.
 */

// ── Constants ──────────────────────────────────────────────────────────────
const VALID_HTTP_METHODS   = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
const VALID_COMP_TYPES     = new Set(['metric', 'table', 'chart', 'form', 'list']);
const VALID_ENFORCE_VALUES = new Set(['middleware', 'row_policy', 'workflow_engine', 'status_field']);

// ── Type helpers ───────────────────────────────────────────────────────────
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(isNonEmptyString).map(s => s.trim());
}

// ── Error helper ───────────────────────────────────────────────────────────
function throwInvalid(field, detail) {
  const err = new Error(`LLM schema validation failed at "${field}". ${detail ?? ''}`);
  err.code  = 'INVALID_SCHEMA';
  err.field = field;
  throw err;
}

// ── Component normaliser ───────────────────────────────────────────────────
function normaliseComponent(comp, pageIdx, compIdx) {
  if (!comp || typeof comp !== 'object') {
    return {
      type: 'metric', title: `Component ${compIdx + 1}`,
      endpoint: '/api/data', fields: [],
    };
  }
  const rawType = (comp.type ?? '').toLowerCase().trim();
  return {
    type:     VALID_COMP_TYPES.has(rawType) ? rawType : 'metric',
    title:    isNonEmptyString(comp.title)    ? comp.title.trim()    : `Component ${compIdx + 1}`,
    endpoint: isNonEmptyString(comp.endpoint) ? comp.endpoint.trim() : '/api/data',
    fields:   toStringArray(comp.fields),
  };
}

// ── Page normaliser ────────────────────────────────────────────────────────
function normalisePage(page, idx) {
  if (!page || typeof page !== 'object') {
    throwInvalid(`ui.pages[${idx}]`, 'Page entry must be an object.');
  }
  if (!isNonEmptyString(page.name)) {
    throwInvalid(`ui.pages[${idx}].name`, 'Page name is required.');
  }
  const name  = page.name.trim();
  const route = isNonEmptyString(page.route)
    ? (page.route.trim().startsWith('/') ? page.route.trim() : `/${page.route.trim()}`)
    : `/${name.toLowerCase().replace(/\s+/g, '-')}`;
  const roles = isNonEmptyArray(page.roles)
    ? toStringArray(page.roles)
    : ['user'];
  const comps = Array.isArray(page.comps) && page.comps.length > 0
    ? page.comps.map((c, ci) => normaliseComponent(c, idx, ci))
    : [{ type: 'metric', title: 'Overview', endpoint: '/api/stats', fields: [] }];

  return { name, route, roles, comps };
}

// ── Endpoint normaliser ────────────────────────────────────────────────────
function normaliseEndpoint(ep) {
  if (!ep || typeof ep !== 'object') return null;
  if (!isNonEmptyString(ep.path))    return null;

  const method = (ep.method ?? 'GET').toUpperCase().trim();
  if (!VALID_HTTP_METHODS.has(method)) return null;

  const path  = ep.path.trim().startsWith('/') ? ep.path.trim() : `/${ep.path.trim()}`;
  const roles = isNonEmptyArray(ep.roles) ? toStringArray(ep.roles) : ['user'];

  return {
    method,
    path,
    roles,
    description: isNonEmptyString(ep.description) ? ep.description.trim() : '',
  };
}

// ── Table normaliser ───────────────────────────────────────────────────────
function normaliseTable(table) {
  if (!table || typeof table !== 'object') return null;
  if (!isNonEmptyString(table.name))       return null;

  return {
    name:    table.name.trim(),
    fields:  isNonEmptyArray(table.fields)  ? toStringArray(table.fields)  : ['id', 'created_at'],
    indexes: isNonEmptyArray(table.indexes) ? toStringArray(table.indexes) : [],
  };
}

// ── Auth role normaliser ───────────────────────────────────────────────────
function normaliseRole(role) {
  if (!role || typeof role !== 'object' || !isNonEmptyString(role.name)) return null;
  const perms = role.permissions ?? {};
  return {
    name:       role.name.trim(),
    inherits:   toStringArray(role.inherits),
    permissions: {
      read:   isNonEmptyArray(perms.read)   ? toStringArray(perms.read)   : ['own_data'],
      write:  isNonEmptyArray(perms.write)  ? toStringArray(perms.write)  : ['own_data'],
      delete: isNonEmptyArray(perms.delete) ? toStringArray(perms.delete) : [],
    },
  };
}

// ── Business rule normaliser ───────────────────────────────────────────────
function normaliseRule(rule) {
  if (!rule || typeof rule !== 'object' || !isNonEmptyString(rule.rule)) return null;
  const enforce = VALID_ENFORCE_VALUES.has(rule.enforce) ? rule.enforce : 'middleware';
  return {
    rule:        rule.rule.trim().toUpperCase().replace(/\s+/g, '_'),
    description: isNonEmptyString(rule.description) ? rule.description.trim() : '',
    enforce,
  };
}

// ── Defaults ───────────────────────────────────────────────────────────────
function defaultAdminRole() {
  return {
    name: 'admin', inherits: [],
    permissions: { read: ['*'], write: ['*'], delete: ['*'] },
  };
}

function defaultUserRole() {
  return {
    name: 'user', inherits: [],
    permissions: { read: ['own_data'], write: ['own_data'], delete: [] },
  };
}

function defaultUserTable() {
  return {
    name: 'User',
    fields: ['id', 'email', 'password_hash', 'role', 'created_at', 'last_login'],
    indexes: ['email', 'role'],
  };
}

function defaultGuards() {
  return [
    'Validate JWT on every protected route',
    'Enforce role membership before handler',
    'Log auth failures to audit table',
  ];
}

// ── Main validator ─────────────────────────────────────────────────────────

/**
 * Validate and normalise raw LLM JSON output.
 *
 * @param   {unknown} raw  Parsed (but unvalidated) JSON from the LLM
 * @returns {object}       Normalised schema object ready for the pipeline
 *
 * @throws  {Error}        err.code = 'INVALID_SCHEMA' for irrecoverable errors
 */
function validateLLMSchema(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throwInvalid('root', 'LLM response must be a JSON object, not an array or primitive.');
  }

  // ── app ──────────────────────────────────────────────────────────────────
  const rawApp = raw.app ?? {};
  const app = {
    name:        isNonEmptyString(rawApp.name)        ? rawApp.name.trim()        : 'Application',
    domain:      isNonEmptyString(rawApp.domain)      ? rawApp.domain.trim()      : 'General',
    description: isNonEmptyString(rawApp.description) ? rawApp.description.trim() : '',
  };

  // ── ui.pages ─────────────────────────────────────────────────────────────
  if (!raw.ui || !Array.isArray(raw.ui.pages) || raw.ui.pages.length === 0) {
    throwInvalid('ui.pages', 'At least one page is required. The LLM produced no pages.');
  }
  const pages = raw.ui.pages.map((p, i) => normalisePage(p, i));

  // ── api.endpoints ─────────────────────────────────────────────────────────
  if (!raw.api || !Array.isArray(raw.api.endpoints)) {
    throwInvalid('api.endpoints', 'api.endpoints must be an array.');
  }
  const endpoints = raw.api.endpoints.map(normaliseEndpoint).filter(Boolean);
  if (endpoints.length === 0) {
    throwInvalid('api.endpoints', 'At least one valid API endpoint is required.');
  }

  // ── database.tables ───────────────────────────────────────────────────────
  const rawTables = raw.database?.tables ?? [];
  let tables = rawTables.map(normaliseTable).filter(Boolean);

  // Invariant: User table must always exist
  if (!tables.some(t => t.name.toLowerCase() === 'user')) {
    tables.unshift(defaultUserTable());
  }

  // ── auth ──────────────────────────────────────────────────────────────────
  const rawAuth = raw.auth ?? {};
  let authRoles = Array.isArray(rawAuth.roles)
    ? rawAuth.roles.map(normaliseRole).filter(Boolean)
    : [];

  // Invariant: admin and user roles must always exist
  if (!authRoles.some(r => r.name === 'admin')) authRoles.push(defaultAdminRole());
  if (!authRoles.some(r => r.name === 'user'))  authRoles.push(defaultUserRole());

  const auth = {
    provider:         'JWT + RefreshToken',
    session_strategy: 'sliding_window_15m_access_7d_refresh',
    roles:   authRoles,
    guards:  isNonEmptyArray(rawAuth.guards) ? toStringArray(rawAuth.guards) : defaultGuards(),
  };

  // ── business_logic ────────────────────────────────────────────────────────
  const rawRules = raw.business_logic?.rules ?? [];
  const rules    = rawRules.map(normaliseRule).filter(Boolean);

  return {
    app,
    ui:             { pages },
    api:            { endpoints },
    database:       { tables },
    auth,
    business_logic: { rules },
  };
}

module.exports = { validateLLMSchema };
