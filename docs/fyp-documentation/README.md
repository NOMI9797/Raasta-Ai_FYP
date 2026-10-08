# Raasta-AI · Technical Documentation

**Multi-Platform AI-Powered Recruitment and Client Acquisition System** · Final Year Project, FAST-NUCES Islamabad
Zain Abbas · Nawal Hassan · Malik Noman Ahmad · Supervisor: Dr. Isma ul Hassan

> **What this is.** A complete, evidence-based technical description of the system as it exists in the repository on **2026-10-08** (branch `feature/ai-hiring-pipeline`, working tree including 134 uncommitted paths). It is written to do three things: make every concept understandable top-down (you can draw it on a whiteboard, then open the code), explain every feature however small, and prepare the team to defend the project in front of the evaluation panel.
>
> **What it is not.** It is not a marketing document. Where something is missing, unmeasured or risky, it says so and says what to do about it.

## Contents

| Part | File | What you will find |
|---|---|---|
| **Inventory** | [00-inventory.md](00-inventory.md) | Everything in the repository before it is explained: programs, 20 modules, features, **167 HTTP handlers**, 22 tables, queue jobs, Redis keys, external services, env-variable names, scripts, and the list of things that are *absent* |
| **Part 1** | [01-big-picture.md](01-big-picture.md) | Problem statement, one-paragraph overview, what "multi-platform" means, tech-stack table, glossary, six diagrams (context, C4, stack, deployment, use cases) |
| **Part 2A** | [02a-end-to-end-process.md](02a-end-to-end-process.md) | The recruitment and client-acquisition processes as stories, sync vs async, where a human overrides the AI, swimlanes per actor |
| **Part 2B** | [02b-conceptual-modules.md](02b-conceptual-modules.md) · [02b2-conceptual-modules-cont.md](02b2-conceptual-modules-cont.md) | Modules M1–M20: responsibility, first-principles concept, I/O, internal working, code mapping, why separate |
| **Part 2C** | [02c-module-interaction.md](02c-module-interaction.md) | Module maps, dependency and single-point-of-failure diagrams, three sequence diagrams |
| **Part 2D** | [02d-foundational-concepts.md](02d-foundational-concepts.md) | A primer on the concepts the panel will probe (HTTP, databases, auth, LLMs, queues, locks, testing, CI/CD…), each with viva questions |
| **Part 2E** | [02e-development-process.md](02e-development-process.md) | How the project was actually built: methodology, requirements, roles, version control, timeline, AI-assisted development |
| **Part 3** | [03-architecture-and-data.md](03-architecture-and-data.md) | Architecture style, folders, full data model with ER diagrams, data lifecycle and PII protection, external integrations |
| **Part 4** | [04a](04a-functionality-intake-screening.md) · [04b](04b-functionality-interview.md) · [04c](04c-functionality-evaluation-decisions.md) · [04d](04d-functionality-publishing.md) · [04e](04e-functionality-client-acquisition.md) · [04f](04f-functionality-platform-ops.md) | Every feature with trigger, flow with exact files and functions, validation, edge cases, security, design decision, and a 30-second explanation |
| **Part 5** | [05-ai-components.md](05-ai-components.md) | Every AI component with the real prompts and rubrics, why this model, failure modes, fairness, how quality was (not) measured, the "ChatGPT wrapper" answer |
| **Part 6** | [06-cross-cutting.md](06-cross-cutting.md) | Authentication, security audit, privacy, platform-automation law, performance and scalability, AI cost, logging, testing, deployment, configuration, risk register |
| **Part 7** | [07-implementation-journey.md](07-implementation-journey.md) | Phase-by-phase story, the interview-module integration with a reuse ledger, real incidents, lessons, current status |
| **Part 8** | [08a-panel-questions.md](08a-panel-questions.md) · [08b-weaknesses-demo-cheatsheet.md](08b-weaknesses-demo-cheatsheet.md) | 84 panel questions with answers and evidence; 28 known weaknesses; live demo script with backup plan; one-page cheat sheet |
| **Part 9** | [09-future-work.md](09-future-work.md) | Prioritised future work tied to each limitation |
| **Part 10** | [10-coverage-checklist.md](10-coverage-checklist.md) | Every path in the repository mapped to the section that explains it, and what is documented only lightly |

A one-page **supervisor brief** (Parts 1–7 in a few minutes) was published as an artifact: https://claude.ai/artifact/BZJANV9uu6nTQTBqe2fxF6 (private to the owner until shared).

## How to read it

| You have | Read |
|---|---|
| **30 minutes** (supervisor or new teammate) | the supervisor brief above, then [Part 1 §1.1–1.3](01-big-picture.md#11-problem-statement) and [2A](02a-end-to-end-process.md) diagrams |
| **A day before the viva** | [8B cheat sheet](08b-weaknesses-demo-cheatsheet.md#8b3-one-page-cheat-sheet), then [8A](08a-panel-questions.md) questions marked ★, then [Part 5](05-ai-components.md), [6.2](06-cross-cutting.md#62-security) and [7.3](07-implementation-journey.md#73-the-interview-module-integration) |
| **Time to own a module** | its entry in [2B](02b-conceptual-modules.md), then the matching [Part 4](04a-functionality-intake-screening.md) file, then open the code paths it names |
| **To prepare the demo** | [8B.2](08b-weaknesses-demo-cheatsheet.md#8b2-live-demo-script-with-a-backup-plan) and [6.6 debugging playbook](06-cross-cutting.md#66-logging-monitoring-and-observability) |

## Legend: markers and how to trust a statement

| Marker | Meaning |
|---|---|
| **[GAP]** | does not exist, or is not evidenced anywhere in the repository |
| **[PARTIAL]** | exists but incomplete or inconsistent |
| **[PLANNED]** | designed (usually in `docs/ai-hiring/`) but not built; drawn with dashed lines in diagrams |
| **Recorded** | the reason for a decision is written in the repository (docs, commits, code comments) |
| **Reconstructed** | the repository records the choice but not the reason; the reason given is our best argument and the team must confirm it |
| ★ (in Part 8A) | a question likely to be asked |

Rules followed throughout: every claim cites a real path, function, route, table or setting; numbers come from counts or test runs dated 2026-10-08 (otherwise they are marked as estimates or left out); nothing was invented to fill a gap.

## Snapshot facts (verified 2026-10-08)

| Fact | Value | How it was obtained |
|---|---|---|
| JavaScript tests | **436 pass, 0 fail** (42 files, 92 s) | `npx tsx --test tests/hiring/*.test.js` |
| Python tests | **37 pass** (8 files, 70 s) | `pytest` in `services/ai-engine` |
| HTTP handlers | 167 (134 wrapped in `withAuth`, 15 authenticate inside, 18 do not: 9 intended, 9 defects) | script over `app/api/**/route.js` |
| Database tables | 22 | `libs/schema.ts` |
| Commits / authors | 121 / 3 | `git shortlog` |
| Uncommitted paths | 134 at the start of this work | `git status` |
| Branding check | passes on the whole repository including these documents | `npm run check:branding` |
| Repository paths mapped in Part 10 | see [10.1](10-coverage-checklist.md#101-summary-by-top-level-folder) | generator over `git ls-files -co --exclude-standard` |

## Evidence limits (what could not be verified)

* **Not deployed anywhere.** No production, staging, TLS, CI or load test exists.
* **No AI accuracy, fairness, latency or cost measurement exists.** Part 5.6 and 6.5.6 give the protocols.
* **Live platform behaviour** (LinkedIn, Rozee.pk, Indeed) was not exercised by this documentation; the Indeed test account was paused by Indeed on the owner's side.
* **Facts outside the repository**: supervisor meetings, requirement sources, each member's non-code work, the reason for the May–September gap, authorship and licence of the earlier interview prototype. Fill-in tables are provided ([2E §E.7](02e-development-process.md#e7-supervisor-review-checkpoints), [7.3.8](07-implementation-journey.md#738-provenance-what-the-panel-can-and-cannot-see)).
* **Provider prices and plan limits** (Groq, Deepgram, Mailgun) are not recorded in the repository.
* The comparison with commercial products in [1.1.4](01-big-picture.md#114-why-existing-tools-are-insufficient-and-the-honest-limits-of-that-claim) is general market knowledge and must be re-checked before it is presented.

## A note on the earlier interview prototype

The Raasta AI Interviewer is a module of Raasta-AI. The fact that its conversation rules were first developed in a separate earlier prototype is discussed **only** in [Part 7 §7.3](07-implementation-journey.md#73-the-interview-module-integration) and in panel question [Q5](08a-panel-questions.md#q5--is-this-your-own-work-where-did-the-interview-agent-come-from). The project's hard rule 1 forbids writing that project's name anywhere in the repository, and this documentation follows it; `npm run check:branding` confirms.

## Maintaining this set

* Re-run the counts before presenting: `npm run test:hiring`, the Python tests, `npm run check:branding`, `git status`, and the route scan described in [00 §5](00-inventory.md#5-http-routes-all-167-handlers) (the scan script was kept outside the repository; it is about 30 lines and walks `app/api/**/route.js`).
* Part 10 is generated from the file list; regenerate it after adding files so the mapping stays complete.
* The documents describe the **working tree**, not only the last commit; commit the work so history and documentation agree.
* Diagrams are Mermaid and render on GitHub, VS Code (with a Mermaid extension) and most Markdown viewers.
