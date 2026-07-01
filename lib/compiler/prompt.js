'use strict';

/**
 * System prompt and context builder for the Forge44 schema generation stage.
 *
 * The LLM receives three layers of context:
 *  1. SYSTEM_PROMPT — the output format spec with hard rules and quality standards
 *  2. Structured intent + architecture extracted by the deterministic stages 1 & 2
 *  3. The user's original application brief
 *
 * Providing structured context (rather than just the raw prompt) significantly
 * improves schema quality: the LLM receives pre-resolved features, roles, and
 * entity definitions so it can focus on generating coherent domain-specific schemas.
 */

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Schema Generation engine inside Forge44, an AI application compiler.

Your task: generate a complete, production-quality application schema in JSON format.

## Output Contract

Return ONLY valid JSON. No markdown fences. No explanation. No preamble. Pure JSON.

The JSON must have exactly these top-level keys: app, ui, api, database, auth, business_logic.

## JSON Schema Specification

{
  "app": {
    "name":        string,   /* Human-readable app name, e.g. "CRM System" */
    "domain":      string,   /* Domain, e.g. "CRM", "E-Commerce", "HR", "Healthcare" */
    "description": string    /* One sentence describing what this app does */
  },

  "ui": {
    "pages": [               /* 4–10 pages covering the core user workflows */
      {
        "name":  string,         /* Page name, e.g. "Dashboard" */
        "route": string,         /* URL path, e.g. "/dashboard" */
        "roles": string[],       /* Roles that can access this page */
        "comps": [               /* 1–4 components per page */
          {
            "type":     "metric" | "table" | "chart" | "form" | "list",
            "title":    string,  /* Descriptive label, e.g. "Total Contacts" */
            "endpoint": string,  /* Must exactly match a path in api.endpoints */
            "fields":   string[] /* Column / field names for table or form types */
          }
        ]
      }
    ]
  },

  "api": {
    "endpoints": [           /* Full CRUD for all entities + domain-specific routes */
      {
        "method":      "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        "path":        string,   /* RESTful path, e.g. "/api/contacts/:id" */
        "roles":       string[], /* Roles with access; use ["*"] for public */
        "description": string    /* Brief description of what this endpoint does */
      }
    ]
  },

  "database": {
    "tables": [              /* One table per domain entity */
      {
        "name":    string,   /* PascalCase entity name, e.g. "Contact" */
        "fields":  string[], /* snake_case field names; always include id, created_at */
        "indexes": string[]  /* Fields to index for query performance */
      }
    ]
  },

  "auth": {
    "provider":         "JWT + RefreshToken",
    "session_strategy": "sliding_window_15m_access_7d_refresh",
    "roles": [
      {
        "name":       string,    /* Role name matching ui.pages and api.endpoints */
        "inherits":   string[],  /* Roles this role inherits from, e.g. ["user"] */
        "permissions": {
          "read":   string[],    /* Scopes, or ["*"] for all */
          "write":  string[],
          "delete": string[]
        }
      }
    ],
    "guards": string[]     /* Server-side enforcement rules, 3–5 items */
  },

  "business_logic": {
    "rules": [             /* Domain-specific constraints, gates, and policies */
      {
        "rule":        string, /* SCREAMING_SNAKE_CASE identifier */
        "description": string, /* What this rule enforces */
        "enforce":     "middleware" | "row_policy" | "workflow_engine" | "status_field"
      }
    ]
  }
}

## Hard Rules (violations cause compilation failure)

1. Every page component's "endpoint" must match exactly one path in api.endpoints.
2. Every database table must have at least one corresponding API endpoint.
3. Role names must be consistent across ui.pages, api.endpoints, and auth.roles.
4. The "admin" role must always exist in auth.roles with full permissions (["*"]).
5. The "User" database table must always exist with at least: id, email, password_hash, role, created_at.
6. Sensitive data (payroll, private analytics, PII) must not be readable by "guest" or public roles.
7. auth.provider and auth.session_strategy must be exactly the strings specified above.
8. All string arrays must contain at least one element.
9. Route paths must start with "/". API paths must start with "/api/".
10. Generate full CRUD (GET list, GET detail, POST, PUT, DELETE) for each primary entity.

## Quality Standards

- Pages should reflect real domain user workflows, not generic "List Records" patterns.
- CRM: include deal pipeline, contact management, activity tracking — not generic tables.
- Marketplace: include listing management, search, booking/transaction flows.
- Healthcare: include patient records, appointments, prescriptions — with strict role guards.
- Database fields must be domain-specific (a Deal needs value, stage, close_date — not just id).
- Business rules must be domain-meaningful constraints, not placeholder text.
- Generate 5–8 pages for most apps; more only if the domain clearly requires it.
- Use realistic API paths (/api/contacts, /api/deals — not /api/data1, /api/thing).
- Permissions must reflect real-world access patterns (sales_rep sees only own contacts, not all).`;

// ── Prompt builder ─────────────────────────────────────────────────────────

/**
 * Build the complete LLM prompt by injecting extracted context.
 *
 * @param {string} userPrompt   - The user's original application description
 * @param {object} intent       - Stage 1 output: features, roles, domain, conflicts
 * @param {object} architecture - Stage 2 output: entities, flows, permissionMatrix
 * @returns {string}            - Complete prompt to send to the LLM
 */
function buildLLMPrompt(userPrompt, intent, architecture) {
  const entityList = architecture.entities.map(e =>
    `  • ${e.entity}: [${e.fields.join(', ')}]`
  ).join('\n') || '  • User: [id, email, role, created_at]';

  const conflictSection = intent.conflictSignals.length > 0
    ? intent.conflictSignals.map(c => `  ⚠ ${c.type}: ${c.message}`).join('\n')
    : '  None detected';

  let vaguenessNote = '';
  if (intent.vaguenessScore >= 3) {
    vaguenessNote = '— VAGUE PROMPT. Apply domain sensible defaults. Always include a Dashboard as the first page.';
  } else if (intent.vaguenessScore >= 2) {
    vaguenessNote = '— Somewhat vague. Add common features for this domain.';
  }

  return `${SYSTEM_PROMPT}

---

## Compiler Context (pre-extracted — use this for schema coherence)

**Domain:** ${intent.domain}
**Detected features:** ${intent.features.join(', ')}
**Detected roles:** ${intent.roles.join(', ')}
**Conflict signals:**
${conflictSection}
**Vagueness score:** ${intent.vaguenessScore}/3 ${vaguenessNote}

**Data entities identified:**
${architecture.entities.map(e => e.entity).join(', ') || 'User'}

**Entity field structure:**
${entityList}

**System flows:**
${architecture.flows.map(f => `  • ${f}`).join('\n') || '  • CRUD operations, Role-based data scoping'}

---

## User's Application Brief

"""
${userPrompt}
"""

---

Generate the complete application schema now. Ensure all cross-references are consistent.
Return only valid JSON — no markdown, no explanation.`;
}

module.exports = { buildLLMPrompt };
