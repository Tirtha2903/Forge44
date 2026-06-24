# Loom Script

## 1. Opening

Hi, this is AppForge Compiler. It is a small but engineered prototype of a Base44-style app generator. The goal is not to claim it is Base44. The goal is to prove the core architecture: natural language becomes structured config, the config is validated and repaired, and the result can be executed by a runtime.

## 2. Product Demo

I enter a prompt like:

Build a CRM with login, contacts, dashboard, role-based access, premium payments, and admin analytics.

The system compiles it into an app with pages, roles, database tables, API endpoints, auth rules, business rules, and a runtime preview.

The important part is that the JSON is not just display text. The UI preview is rendered from the generated config, and the runtime checks prove whether the config is executable.

## 3. Architecture

The pipeline is split into stages:

1. Intent extraction
2. System design
3. Schema generation
4. Refinement
5. Validation
6. Targeted repair
7. Runtime simulation

This separation is intentional. A single prompt would be hard to control, hard to debug, and hard to repair. With this design, every layer has a contract.

## 4. Schema Enforcement

The generated config includes:

- UI schema: navigation, pages, components, component endpoints, role access
- API schema: endpoints, methods, request fields, response fields, allowed roles
- Database schema: tables, fields, types, relations
- Auth schema: provider, sessions, roles, permissions
- Business logic: premium gates, least-privilege access, financial boundaries

Validation checks that UI components call real API endpoints, API endpoints map to real DB tables, API fields exist in table fields, and roles are declared before being used.

## 5. Repair Engine

The repair engine does not blindly retry the whole generation. It repairs specific failures.

For example, on vague prompts, the generator may produce an unresolved automation endpoint. The validator catches that UI-to-API mismatch. The repair engine rewires only that component to a valid endpoint.

For conflicting prompts, the system may detect a hallucinated private field in an API response. The repair engine removes only the invalid response field.

This is the core reliability feature.

## 6. Ambiguity and Conflict Handling

For vague prompts, the system makes conservative assumptions and documents them.

For conflicting prompts, security wins. For example, if a prompt says guests can access private payroll analytics, the system resolves the conflict with least-privilege access and removes guest access from private areas.

## 7. Evaluation

The Evaluation tab runs a 20-prompt benchmark:

- 10 normal product prompts
- 10 edge cases covering vague, conflicting, incomplete, and unsafe requirements

It reports success rate, latency, total repairs, quality score, and per-prompt cost units.

## 8. Cost vs Quality

The prototype uses cost units rather than real token cost because it runs locally. The idea is the same: more features, ambiguity, conflicts, and repair loops increase cost.

The design balances quality and cost by repairing only failed stages instead of rerunning the full pipeline.

## 9. Closing

This is a first-copy prototype of a compiler for software generation. It is small, but it has the important production ideas: staged generation, typed contracts, validation, targeted repair, deterministic behavior, runtime awareness, and measurable evaluation.

