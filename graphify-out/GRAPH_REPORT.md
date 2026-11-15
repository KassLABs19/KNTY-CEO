# Graph Report - knty-ceo  (2026-11-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 703 nodes · 1465 edges · 24 communities (22 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a1ac044f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23

## God Nodes (most connected - your core abstractions)
1. `ApiClient` - 26 edges
2. `registerAuthRoutes()` - 25 edges
3. `withCompany()` - 18 edges
4. `registerCoreRoutes()` - 16 edges
5. `audit()` - 15 edges
6. `withSystem()` - 15 edges
7. `AppError` - 14 edges
8. `decide()` - 14 edges
9. `upsertRequest()` - 14 edges
10. `registerRequestRoutes()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `submit()` --calls--> `ApiClient`  [EXTRACTED]
  apps/desktop/src/screens/ServerSetup.tsx → packages/shared/src/api-client.ts
- `DecideInput` --references--> `Decision`  [EXTRACTED]
  apps/server/src/approvals.ts → packages/shared/src/approvals.ts
- `typescript@^5.6.3` --declares--> `typescript`  [EXTRACTED]
  packages/shared/package.json → apps/server/package.json
- `RequestRow` --references--> `RequestKind`  [EXTRACTED]
  apps/server/src/approvals.ts → packages/shared/src/approvals.ts
- `RequestRow` --references--> `RequestStatus`  [EXTRACTED]
  apps/server/src/approvals.ts → packages/shared/src/approvals.ts

## Import Cycles
- None detected.

## Communities (24 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (85): buildApp(), Actor, actorsFor(), blockedReason(), cancelRequest(), canSee(), decide(), DecideInput (+77 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (50): bridge, CeoBridge, UpdateState, api, store, App(), Stage, bridge (+42 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (49): StepRow, CurrentUser, fastify, FastifyRequest, ApiError, ChainStepView, RequestFilter, DecideRequest (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (49): author, dependencies, electron-updater@^6.3.9, description, devDependencies, concurrently@^9.1.0, cross-env@^7.0.3, electron@^33.2.1 (+41 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (46): @ceo/shared@0.1.0, dependencies, bcryptjs@^2.4.3, @ceo/shared@0.1.0, fastify@^5.1.0, @fastify/cors@^10.0.1, @fastify/rate-limit@^10.2.1, jose@^5.9.6 (+38 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (40): compilerOptions, declaration, jsx, lib, module, moduleResolution, noEmit, types (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (33): appId, asar, copyright, directories, buildResources, output, extraResources, from (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (33): condition, environment, healthcheck, image, restart, volumes, db, APP_DB_PASSWORD (+25 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (29): env, runs-on, services, steps, ELECTRON_SKIP_BINARY_DOWNLOAD, PGPASSWORD, POSTGRES_DB, POSTGRES_PASSWORD (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (22): CSC_KEY_PASSWORD, CSC_LINK, GH_TOKEN, RELEASES_TOKEN, jobs, windows, name, on (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (19): dependencies, zod@^3.23.8, devDependencies, typescript@^5.6.3, vitest@^2.1.8, exports, ./theme.css, vitest (+11 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (12): config, db, { values }, loadConfig(), createPool(), loadEnvFile(), config, db (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (11): dir, pgBin(), setup(), entries, extra, extraDesktop, found, out (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (16): description, engines, node, license, name, private, scripts, build (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.21
Nodes (13): currentTotp(), byExternal(), get(), h(), licence, login(), partnerSend(), post() (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.19
Nodes (11): body, { values }, asUser(), DEMO_COMPANY, DEMO_PARTNER_SECRETS, DEMO_PASSWORD, DEMO_PEOPLE, msg() (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (12): ACCEPTED_MAJORS, cancelMessage, CancelMessage, decisionMessage, DecisionMessage, envelope, inboundMessage, InboundMessage (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noUncheckedIndexedAccess, resolveJsonModule (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (9): withSystem(), signBody(), ALERT_AFTER_HOURS, alertStuck(), backoffMinutes(), deliverDue(), Fetch, startJobs() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.36
Nodes (6): [command, ...rest], canonical(), checkLicence(), Licence, loadLicence(), SignedLicence

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (6): DEFAULT_RULES, requestMessage, sanitizeLevels(), withLimits, compareVersions(), isVersionSupported()

### Community 22 - "Community 22"
Cohesion: 0.28
Nodes (4): readSettings(), Settings, settingsPath(), writeSettings()

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Community 1` to `Community 3`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06460044809559373 - nodes in this community are weakly interconnected._
- **Why does `fastify` connect `Community 0` to `Community 2`, `Community 4`, `Community 15`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05630834086118639 - nodes in this community are weakly interconnected._
- **Why does `typescript` connect `Community 3` to `Community 11`, `Community 4`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06936026936026936 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.05176470588235294 - nodes in this community are weakly interconnected._