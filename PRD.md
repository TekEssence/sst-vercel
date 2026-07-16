# PRD: Vercel Clone on AWS (SST-Powered)

## 1. Overview

A self-hosted Vercel alternative built on AWS using SST v3. Git-based deployments, auto-scaling, custom domains, preview URLs, and a dashboard UI — all running in your own AWS account. No per-seat pricing, no bandwidth overage panic.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User (Browser/CLI)                    │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               ▼                          ▼
      ┌────────────────┐       ┌──────────────────┐
      │  CloudFront     │       │  API Gateway      │
      │  (Custom Domains│       │  (REST + WSS)     │
      │   + CDN)        │       │                   │
      └────────┬───────┘       └────────┬──────────┘
               │                        │
               ▼                        ▼
      ┌────────────────┐       ┌──────────────────┐
      │  S3 (Assets)    │       │  Lambda (API)     │
      │  S3 (Builds)    │       │  ─ control plane  │
      │  S3 (Logs)      │       │  ─ webhooks       │
      └────────────────┘       │  ─ build trigger   │
                               └────────┬──────────┘
                                        │
               ┌────────────────────────┼────────────────────┐
               ▼                        ▼                    ▼
      ┌────────────────┐       ┌──────────────────┐  ┌──────────┐
      │  DynamoDB       │       │  CodeBuild        │  │  Cognito  │
      │  ─ projects     │       │  (Build workers)  │  │  ─ auth   │
      │  ─ deployments  │       │  ─ npm install    │  │           │
      │  ─ domains      │       │  ─ npm build      │  └──────────┘
      │  ─ users        │       │  ─ deploy to S3  │
      │  ─ logs         │       │  ─ invalidate CF │
      └────────────────┘       └──────────────────┘
                                        │
                               ┌────────▼────────┐
                               │  EventBridge     │
                               │  (Async events)   │
                               │  ─ build status   │
                               │  ─ deploy hooks   │
                               └─────────────────┘
```

---

## 3. Components

### 3.1 Control Plane API (`packages/api/`)
- **Framework**: Hono.js on Lambda (via SST `ApiGatewayV2`)
- **Endpoints**:
  - `POST /api/projects` — create project (link GitHub repo)
  - `GET /api/projects` — list projects
  - `GET /api/projects/:id` — project details
  - `DELETE /api/projects/:id` — delete project
  - `POST /api/projects/:id/deploy` — trigger manual deploy
  - `GET /api/projects/:id/deployments` — list deployments
  - `GET /api/deployments/:id` — deployment details & logs
  - `POST /api/webhooks/github` — GitHub push webhook receiver
  - `GET /api/deployments/:id/logs` — stream build logs
  - `POST /api/projects/:id/domains` — add custom domain
  - `DELETE /api/projects/:id/domains/:domain` — remove domain
- **WebSocket**: `wss://api/deployments/:id/status` — real-time status updates

### 3.2 Build Service (`packages/functions/build/`)
- **Trigger**: EventBridge → CodeBuild (or Lambda for small builds)
- **Flow**:
  1. Clone repo from GitHub (via provided token)
  2. Detect framework (package.json, framework config)
  3. Install deps (`npm ci`, `yarn`, `pnpm`)
  4. Run build (`npm run build`, `next build`, etc.)
  5. Upload output to `s3://<stage>-builds/<project-id>/<deploy-id>/`
  6. Create CloudFront invalidation
  7. Store deployment metadata in DynamoDB
  8. Emit status via EventBridge → WebSocket broadcast
- **Supported Frameworks**: Next.js (static), React, Vue, Svelte, Astro, Vite
- **SSR Support**: Lambda@Edge or Lambda function URLs for server-side rendering
- **Build Spec**: `buildspec.yml` generated dynamically per project

### 3.3 Storage Layer
| Service | Purpose | Estimated Size |
|---------|---------|---------------|
| S3 (builds) | Build artifacts per deployment | 50-500 MB per deploy |
| S3 (assets) | Static file serving via CloudFront | Same as build output |
| S3 (logs) | Build logs archived | ~100 KB per deploy |
| DynamoDB | Metadata: projects, deployments, domains, users, logs index | < 1 GB for 10K projects |

### 3.4 CDN & Domains (`packages/infra/cdn.ts`)
- **CloudFront**: Global CDN with custom domain support
  - Origin: S3 bucket (static assets)
  - Origin: Lambda function URL (SSR fallback)
  - SSL via ACM (auto-provisioned per custom domain)
- **Route53**: DNS management for custom domains
- **Preview URLs**: `<deploy-id>--<project-slug>.example.com` per deployment

### 3.5 Auth (`packages/infra/auth.ts`)
- **Cognito User Pool**: Email/password + GitHub OAuth
- **Identity Pool**: IAM roles for API access
- **JWT**: Cognito-issued tokens, validated in Lambda authorizer

### 3.6 Dashboard UI (`packages/web/`)
- **Framework**: React Router v7 (or TanStack Start) — deployed via SST `aws.React`
- **Pages**:
  - `/login` — auth
  - `/` — project list
  - `/projects/new` — create/link project
  - `/projects/:id` — project detail, deploy button
  - `/projects/:id/deployments` — deployment history
  - `/projects/:id/deployments/:deployId` — live logs
  - `/projects/:id/settings` — domains, env vars, build config
- **Real-time**: WebSocket connection for live deployment log streaming
- **Components**: TailwindCSS + shadcn/ui

### 3.7 Event System (`packages/infra/events.ts`)
- **EventBridge Bus**: Decouples build trigger → status updates → notifications
- **Events**:
  - `deployment.queued`
  - `deployment.building`
  - `deployment.ready`
  - `deployment.failed`
  - `deployment.cancelled`

### 3.8 Optional: Edge Functions / SSR
- **Lambda@Edge**: For SSR frameworks (Next.js, Nuxt, SvelteKit)
- **Lambda Function URL**: For API-backed routes
- **Reserved Concurrency**: Minimum 1, burst 5 per project

---

## 4. SST Infrastructure (`sst.config.ts`)

```ts
// High-level SST resource map
new sst.aws.ApiGatewayV2("Api");           // Control plane
new sst.aws.Function("BuildTrigger");       // Start CodeBuild
new sst.aws.Function("WebhookHandler");     // GitHub webhooks
new sst.aws.Bucket("BuildArtifacts");       // Build outputs
new sst.aws.Bucket("Assets");              // Static file serving
new sst.aws.Cognito("Auth");               // User auth
new sst.aws.DynamoDB("ProjectsTable");     // Metadata store
new sst.aws.DynamoDB("DeploymentsTable");
new sst.aws.DynamoDB("DomainsTable");
new sst.aws.React("Dashboard");            // UI (or TanStackStart)
new sst.aws.Router("CdnRouter");           // CloudFront + S3 origin
sst.aws.codebuild.BuildProject("Builder"); // CodeBuild project
new sst.aws.EventBus("Bus");               // EventBridge
```

---

## 5. Monthly AWS Cost Estimate

### 5.1 Base (idle, no traffic)

| Service | Item | Cost |
|---------|------|------|
| DynamoDB | 3 tables on-demand, <1 GB | ~$1.50 |
| S3 | Builds + Assets + Logs (<5 GB total) | ~$0.12 |
| CloudFront | Idle, ~10 GB transfer | ~$1.00 |
| API Gateway | REST + WSS, ~0 requests | ~$1.00 |
| Lambda | Warm pings, ~100K invocations | ~$0.02 |
| Cognito | 0 MAU (free tier covers 50K) | $0.00 |
| EventBridge | <100K events | ~$0.00 |
| Route53 | 1 hosted zone + 5 records | ~$0.50 |
| ACM | SSL certs (free) | $0.00 |
| **Total** | | **~$4.14/mo** |

### 5.2 Light Production (10 projects, 50 deploys/mo, 35K visitors, 180 GB bandwidth)

| Service | Item | Cost |
|---------|------|------|
| DynamoDB | On-demand, ~5 GB/mo | ~$3.00 |
| S3 | Storage + requests | ~$2.00 |
| CloudFront | 180 GB transfer @ $0.085/GB | ~$15.30 |
| API Gateway | REST: ~50K requests | ~$1.50 |
| Lambda | API + WebSocket + build mgmt: ~500K invocations | ~$0.50 |
| CodeBuild | 50 builds × 3 min × $0.005/min | ~$0.75 |
| Cognito | <100 MAU (within free tier) | $0.00 |
| EventBridge | ~5K events | $0.00 |
| Route53 | 1 hosted zone + ~15 records | ~$0.50 |
| CloudWatch Logs | ~2 GB ingested | ~$1.00 |
| ACM | Free | $0.00 |
| **Total** | | **~$24.55/mo** |

### 5.3 Growth (50 projects, 500 deploys/mo, 100K visitors, 2 TB bandwidth)

| Service | Item | Cost |
|---------|------|------|
| DynamoDB | On-demand, ~25 GB | ~$12.00 |
| S3 | Storage + requests | ~$8.00 |
| CloudFront | 2 TB @ $0.085/GB (first 10 TB) | ~$170.00 |
| API Gateway | REST: ~500K requests | ~$3.50 |
| Lambda | ~5M invocations | ~$1.00 |
| CodeBuild | 500 builds × 5 min × $0.005/min | ~$12.50 |
| Cognito | <1K MAU (within free tier) | $0.00 |
| WAF | Web ACL for CloudFront | ~$16.00 |
| Route53 | 1 zone + ~50 records | ~$0.50 |
| CloudWatch Logs | ~10 GB | ~$5.00 |
| **Total** | | **~$228.50/mo** |

### 5.4 Comparison: Same workloads on Vercel Pro

| Scenario | AWS (this project) | Vercel Pro |
|----------|-------------------|------------|
| Idle | ~$4/mo | $20/mo |
| Light (35K visitors, 180 GB) | ~$25/mo | $20 + overages ~$150 = **~$170/mo** |
| Growth (100K visitors, 2 TB) | ~$229/mo | $20 + $1,600 overages = **~$1,620/mo** |
| 50 projects | Same as growth | 50 × $20 = **$1,000/mo** |

AWS costs scale linearly with usage. Vercel hits overage cliffs hard.

---

## 6. Directory Structure

```
sst-aws-vercel/
├── sst.config.ts              # SST app definition
├── packages/
│   ├── web/                   # Dashboard UI (React Router v7)
│   │   ├── app/
│   │   │   ├── routes/
│   │   │   ├── components/
│   │   │   └── lib/
│   │   └── package.json
│   ├── api/                   # Control plane API (Hono)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── middleware/
│   │   │   └── lib/
│   │   └── package.json
│   ├── functions/             # Lambda functions
│   │   ├── build/
│   │   ├── webhooks/
│   │   └── events/
│   └── core/                  # Shared types & logic
│       └── src/
├── infra/                     # SST infrastructure components
│   ├── api.ts
│   ├── web.ts
│   ├── storage.ts
│   ├── auth.ts
│   ├── events.ts
│   └── cdn.ts
└── scripts/                   # Dev scripts
```

---

## 7. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build runtime | AWS CodeBuild | Handles npm install + build natively; Lambda times out (15 min) for large builds |
| Build orchestration | EventBridge → CodeBuild | Async, decoupled, retry with DLQ |
| SSR for frameworks | Lambda (Function URL) | Cheaper than Lambda@Edge; supports streaming |
| Preview URLs | CloudFront + subdomains | Wildcard SSL cert + path-based routing |
| State store | DynamoDB | Single-digit ms latency; on-demand scaling; no RDS overhead |
| Real-time logs | WebSocket API + S3 presigned URLs | WebSocket for streaming; S3 for archived logs |
| Container support | ECS Fargate (future) | Not in v1; can run Dockerized apps |
| Database per user | Not included (v1) | Users bring their own DB (RDS, DynamoDB, Neon) |
| CI/CD integration | GitHub webhooks (v1), GitLab/Bitbucket (future) | Covers 90%+ of users |
| Monitoring | CloudWatch + SST Console | Built-in; no Datadog cost |

---

## 8. v1 Milestones

### Phase 1 — Core (Weeks 1-2)
- SST project scaffold with 3 environments (dev/staging/prod)
- Control plane CRUD API (projects, deployments, domains)
- DynamoDB schema + SST bindings
- Dashboard UI skeleton: login → project list → deployment history

### Phase 2 — Build Pipeline (Weeks 3-4)
- CodeBuild project creation via SST
- GitHub webhook receiver (create deployment on push)
- Build → upload S3 → CloudFront invalidation flow
- Framework auto-detection (package.json → build command)
- Real-time WebSocket log streaming

### Phase 3 — Domains & SSR (Weeks 5-6)
- Custom domain management (Route53 + ACM + CloudFront)
- Preview deployment URLs (per git branch)
- SSR support: Next.js server via Lambda Function URL
- Environment variable management (per project, encrypted)

### Phase 4 — Polish (Weeks 7-8)
- Deletion protection, rollback support
- Build cancellation
- Log search (CloudWatch Logs Insights integration)
- Rate limiting, WAF rules
- RBAC (owner / collaborator)

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CodeBuild cold start (30s+) | Slow deploys | Keep 1 warm CodeBuild environment; parallel pools |
| Lambda 15-min timeout | Large builds fail | Use CodeBuild (no timeout); Lambda only for small/SSR |
| CloudFront invalidation cost | $0.025/path, adds up | Use versioned paths (`/deploy-id/...`) instead of invalidation |
| GitHub token rotation | Broken deploys | Store in Secrets Manager; auto-rotate; alert on 401 |
| Cost spike from abuse | Unexpected bill | WAF rate limits; per-account billing alerts; deploy concurrency cap |
| DynamoDB throttling | Slow API under load | On-demand capacity; DAX for hot keys if needed |

---

## 10. Success Metrics

- **Deploy time**: Median < 2 min (small projects), < 5 min (large)
- **Cost per deploy**: < $0.05 (CodeBuild + S3 + CF)
- **Cold start (SSR)**: < 200 ms
- **Dashboard TTI**: < 1.5 s
- **Uptime**: 99.9% (multi-AZ by default on AWS)
- **Preview URLs**: Available within 30s of git push
