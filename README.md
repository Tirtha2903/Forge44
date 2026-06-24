# AppForge Compiler

AppForge Compiler is a compact Base44-style prototype that behaves like a software-generation compiler:

`natural language -> intent -> architecture -> strict schemas -> refinement -> validation -> targeted repair -> runtime preview`

It is intentionally dependency-free so it can be opened locally, hosted on GitHub Pages, Netlify, Vercel static hosting, or any basic HTTP server.

## What It Demonstrates

- Multi-stage generation pipeline, not a single prompt
- Strict JSON contract for UI, API, database, auth, and business logic
- Cross-layer validation
- Targeted repair instead of blind full retries
- Deterministic behavior for repeatable outputs
- Runtime simulation that renders pages and checks executability
- 20-prompt evaluation harness with success rate, repairs, latency, quality, and cost units

## Project Structure

```text
appforge-compiler/
  index.html      Static product interface
  styles.css      Professional responsive UI
  app.js          Compiler pipeline, validator, repair engine, runtime, benchmark
  README.md       Submission and architecture notes
  loom-script.md  5-10 minute walkthrough script
```

## Run Locally

From this folder:

```bash
python -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173
```

## Pipeline

1. Intent Extraction
   Parses the raw product prompt into features, roles, monetization, ambiguity, and conflicts.

2. System Design Layer
   Converts intent into app architecture: entities, flows, policy decisions, and assumptions.

3. Schema Generation
   Emits strict config for UI pages, API endpoints, database tables, auth roles, and business rules.

4. Refinement Layer
   Applies least-privilege policy and creates realistic edge-case inconsistencies for ambiguous/conflicting prompts so validation and repair are exercised.

5. Validation
   Checks JSON serializability, required structure, API-to-DB consistency, UI-to-API consistency, auth role validity, relation fields, and business-rule dependencies.

6. Repair Engine
   Repairs specific failures:
   - rewires UI components to existing endpoints
   - removes hallucinated API response fields
   - adds missing relation fields
   - creates subscription infrastructure when premium gates require it

7. Runtime Simulation
   Renders the compiled app from config and validates that the generated app can execute.

## Reliability Notes

The system is deterministic by design. The same prompt produces the same structured output because generation is broken into explicit compiler stages with stable schema rules. Ambiguity is handled by documenting assumptions. Conflicts are handled by choosing least-privilege security policies.

## Cost vs Quality Tradeoff

The app shows estimated cost units instead of token spend because this prototype runs without an external model. Cost increases with feature count, conflicts, and repair loops. The architecture is designed so expensive regeneration is localized to failed stages rather than rerunning the entire pipeline.

## Submission Strategy

For the Google Form:

- Live URL: host this folder using GitHub Pages, Netlify, or Vercel static hosting.
- GitHub Repository: push this folder with the README.
- Loom: use `loom-script.md` as the walkthrough.

