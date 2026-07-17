# sst-aws-vercel

A Vercel-like deployment platform built on AWS with SST v3. Deploy web applications (Next.js, React, etc.) with preview deployments, production releases, environment variable management, and live runtime logs.

## Architecture

```
Webhook/Browser → API Gateway → Lambda (API) → EventBridge → CodeBuild → S3 + Lambda (SSR)
                                                      ↓
                                              CloudWatch Logs ← Dashboard (React SPA via CloudFront)
```

- **Preview deployments** → `/_preview/{deploymentId}/` — ephemeral Lambda per deploy
- **Production deployments** → `/_production/{projectId}/` — persistent Lambda per project
- **Static assets** served from S3 with CDN caching
- **Auth** via GitHub OAuth (with bypass option for dev)
- **Limits** — max 5 preview + 5 production deployments per project, oldest auto-deleted

## Prerequisites

- **Node.js 22+**
- **AWS Account** with credentials configured
- **GitHub personal access token** (for GitHub OAuth, optional for bypass mode)
- **npm** or **pnpm**

## Quick Start

```bash
# 1. Clone and install
git clone <repo>
cd sst-aws-vercel
npm install

# 2. Configure AWS credentials
aws configure --profile sst-dev
# AWS Access Key ID:     AKIA...
# AWS Secret Access Key: ...
# Default region:        us-east-1
# Default output format: json

# 3. Deploy to AWS (SST dev stage)
npx sst deploy --stage dev

# 4. Open the dashboard
# After deploy completes, you'll see:
#   DashboardWeb: https://xxxxxxx.cloudfront.net
#   ApiGateway:   https://xxxxxx.execute-api.us-east-1.amazonaws.com
```

## Setup Steps (in detail)

### 1. AWS Credentials

Create an IAM user or use an existing one with sufficient permissions (AdministratorAccess recommended for dev). Configure the profile:

```bash
aws configure --profile sst-dev
```

The profile name `sst-dev` is configured in `sst.config.ts`. Change it if needed:

```ts
providers: {
  aws: {
    profile: "sst-dev",
  },
},
```

### 2. Deploy the Stack

```bash
npx sst deploy --stage dev
```

This provisions all AWS resources (~3-5 min):

| Resource | Purpose |
|----------|---------|
| API Gateway (HTTP API) | Routes all requests |
| DynamoDB (Projects, Deployments, Domains, Sessions, Connections) | Data storage |
| S3 (Build, Assets, Log buckets) | Build artifacts, static files |
| CodeBuild | Build service |
| Lambda (API, BuildTrigger, BuildComplete, WS, Preview/Production SSR) | Compute |
| Cognito User Pool + Identity Pool | Auth (legacy) |
| EventBridge Bus | Internal events |
| CloudFront + S3 | Dashboard hosting |
| CloudWatch Log Groups | Logging |

### 3. Open the Dashboard

```
DashboardWeb: https://xxxxxxx.cloudfront.net
```

Click **"Continue without login"** to use bypass mode, or set up GitHub OAuth (see below).

### 4. Add a Project

1. Click **New Project**
2. Enter name and GitHub repo URL
3. Build command and output dir auto-detect for common frameworks
4. Deploy from the project page — choose **Preview** or **Production**

## GitHub OAuth (Optional)

To enable sign-in with GitHub:

1. Create a [GitHub OAuth App](https://github.com/settings/developers)
   - Homepage URL: `https://xxxxxxx.cloudfront.net`
   - Authorization callback URL: `https://xxxxxx.execute-api.us-east-1.amazonaws.com/api/auth/github/callback`

2. Deploy with credentials:

```bash
GITHUB_CLIENT_ID=your_client_id \
GITHUB_CLIENT_SECRET=your_client_secret \
npx sst deploy --stage dev
```

## Webhook (Auto-deploy on Push)

Add this URL to your GitHub repo **Settings → Webhooks**:

```
https://xxxxxx.execute-api.us-east-1.amazonaws.com/api/webhooks/github
```

The webhook URL is displayed on each project's detail page in the dashboard.

## Environment Variables

Two scopes, selected by branch:

| Branch | Env Var Scope |
|--------|---------------|
| `main` | Production env vars (`productionEnvVars`) |
| other  | Preview env vars (`envVars`) |

Set them in the project detail page. Click **Copy from Preview** to copy preview vars to production.

## Deployment Limits

- Max **5 preview** deployments per project
- Max **5 production** deployments per project  
- Oldest deployments are auto-deleted when creating a new one above the limit

## Viewing Logs

| Tab | Source | Shows |
|-----|--------|-------|
| **Build Logs** | CodeBuild CloudWatch | Build output (live during build) |
| **Runtime Logs** | SSR Lambda CloudWatch | App logs from last 30 min (live when ready) |

## Project Structure

```
├── packages/
│   ├── api/                    # API Gateway Lambda handler
│   │   └── src/
│   │       ├── index.ts        # Hono app, route mounting
│   │       └── routes/
│   │           ├── auth.ts     # GitHub OAuth, session, bypass
│   │           ├── deployments.ts  # Deployment CRUD + logs
│   │           ├── detect-framework.ts
│   │           ├── domains.ts
│   │           ├── preview.ts  # Preview/production SSR proxy
│   │           ├── projects.ts # Project CRUD, deploy, env vars
│   │           └── webhooks.ts # GitHub webhook handler
│   ├── functions/              # Background Lambda functions
│   │   └── src/build/
│   │       ├── trigger.ts      # Starts CodeBuild from EventBridge
│   │       └── complete.ts     # Creates Lambda from build artifact
│   └── web/                    # Dashboard SPA (React Router)
│       └── app/
│           ├── routes/         # Page components
│           └── lib/api.ts      # API client + auth helpers
├── sst.config.ts               # SST v3 infrastructure definition
└── sst-env.d.ts                # SST type declarations
```

## Local Development

```bash
# Run dashboard locally (point to deployed API)
VITE_API_URL=https://xxxxxx.execute-api.us-east-1.amazonaws.com \
npm run dev --workspace=packages/web
```

## Production Stage

```bash
npx sst deploy --stage production
```

Resources are retained on `sst remove` when stage is `production` (see `removal: "retain"` in `sst.config.ts`).

## Cleaning Up

```bash
npx sst remove --stage dev
```

This deletes all resources for the `dev` stage. Note: DynamoDB data is deleted unless you modify the removal policy.
