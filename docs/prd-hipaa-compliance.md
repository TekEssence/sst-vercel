# PRD: HIPAA Compliance for sst-aws-vercel

## Objective

Achieve HIPAA compliance readiness so that the platform can host applications handling Protected Health Information (PHI). This covers both the platform itself (dashboard, API, databases) and the deployed customer applications (SSR Lambdas, S3 assets, logs).

---

## 1. BAA (Business Associate Agreement)

**Requirement**: AWS requires a signed BAA before any PHI can be stored or processed on HIPAA-eligible services.

| Action | Cost |
|--------|------|
| Accept AWS BAA via AWS Artifact | Free |
| Ensure all services used are in the [HIPAA-eligible services list](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/) | Free |

**Impact**: None — the platform already uses HIPAA-eligible services (Lambda, API Gateway, DynamoDB, S3, CloudWatch). Only **CloudFront** with Lambda@Edge is not eligible; the dashboard can be served via CloudFront without edge functions (already the case).

---

## 2. Encryption

### At Rest

| Service | Current | HIPAA Requirement | Change Needed | Cost Impact |
|---------|---------|-------------------|---------------|-------------|
| DynamoDB | Default AWS-owned key | Customer-managed KMS key | Enable `point_in_time_recovery` + KMS `aws:kms` key | +$1/key/month |
| S3 | AES-256 (SSE-S3) | SSE-KMS or SSE-C | Enable bucket key + KMS | Free (KMS key $1/mo) |
| CloudWatch Logs | Default encrypted | KMS encryption | Associate KMS key with log groups | +$1/key/month |
| Lambda env vars | Encrypted at rest | Already HIPAA-eligible | No change | None |
| EBS / Snapshots | Default | KMS encryption | N/A (Lambda is ephemeral) | None |

### In Transit

All traffic already uses TLS 1.2+ (API Gateway, CloudFront). No changes needed.

### Key Management

| Action | Cost |
|--------|------|
| Create single KMS key for all platform PHI | $1/month |
| Enable automatic key rotation (annual) | Free |
| **Total KMS** | **~$1/mo** |

---

## 3. Access Controls

### Authentication

| Requirement | Current State | Change Needed | Cost |
|-------------|--------------|---------------|------|
| MFA for dashboard | Not supported | Add TOTP/WebAuthn to auth flow | Dev effort |
| Session timeout | None | Add session TTL + refresh | Dev effort |
| API key rotation | N/A (session tokens) | Add key rotation on session endpoints | Dev effort |
| GitHub OAuth → SSO | GitHub only | Support SAML 2.0 / OIDC (Okta, Azure AD) | Dev effort |

### Authorization (IAM)

| Requirement | Current State | Change Needed | Cost |
|-------------|--------------|---------------|------|
| Least-privilege per-project | All users share `ownerId: "default"` | Multi-tenant isolation with per-project IAM roles | Dev effort |
| Audit of access changes | None | Enable CloudTrail + trail for management events | $2.10/trail/month |
| VPC for Lambda functions | No VPC | Move API/BuildComplete/SSR Lambdas into VPC | +$0 (NAT Gateway ~$32/mo) |

### Network

| Action | Cost |
|--------|------|
| VPC with private subnets for all Lambdas | Free |
| NAT Gateway for internet access from private subnets | ~$32/mo |
| VPC Endpoints (DynamoDB, S3, CloudWatch, Lambda) | ~$7/mo (4 endpoints × $1.75) |
| WAF on API Gateway | ~$6/mo + $0.60/1M requests |
| Shield Advanced (optional) | $3000/yr |
| **Total network changes** | **~$45/mo** |

---

## 4. Audit Logging

| Component | Requirement | Current | Change Needed | Cost |
|-----------|-------------|---------|---------------|------|
| CloudTrail | All management events | Not enabled | Enable organization trail | $2.10/trail/mo |
| CloudTrail + data events | S3, Lambda | Not enabled | Add data events (filtered) | ~$5/mo |
| CloudWatch Logs retention | Minimum 6 years | Unlimited | Add retention policy (6 yr) | Free |
| Config | Resource tracking | Not enabled | Enable AWS Config | ~$3/mo |
| **Total audit** | | | | **~$10/mo** |

---

## 5. Backup & Disaster Recovery

| Service | Requirement | Change Needed | Cost |
|---------|-------------|---------------|------|
| DynamoDB | Point-in-time recovery | Enable `point_in_time_recovery` on all tables | ~$1/mo per table (5 tables = $5/mo) |
| S3 | Versioning + cross-region | Enable versioning on assets bucket | Free (storage cost of old versions) |
| Lambda | Source code backup | Already in S3 (build artifacts) | No change |
| CloudFormation/SST | Infrastructure backup | Already in Git | No change |
| **Total DR** | | | **~$5/mo** |

---

## 6. Logging & PHI Scrub

| Requirement | Change Needed | Cost |
|-------------|---------------|------|
| Runtime logs must not contain PHI | Add log scrubbing layer in SSR Lambda (strip `req.body`, `req.headers.authorization`, known PHI patterns) | Dev effort |
| BuildComplete pipeline logs | Already stored in DynamoDB — control what gets logged | Dev effort |
| CloudTrail audit events | Enable + retain for 6 years | $2/mo |
| Access logs for API Gateway | Enable access logging | ~$1/mo |

---

## 7. Incident Response & Policies (Operational)

These have no direct AWS cost but require organizational investment:

| Item | Cost |
|------|------|
| Written HIPAA Security Policies | Internal/consultant effort |
| Risk Assessment | $5k–$20k one-time (vendor) |
| Employee training | $0–$500/year (HIPAA training platform) |
| Incident response plan | Internal effort |
| Penetration testing | $5k–$25k per engagement |

---

## 8. Summary: Cost Increase

### AWS Infrastructure (monthly)

| Category | Current Est. | HIPAA-Compliant Est. | Delta |
|----------|-------------|----------------------|-------|
| KMS | $0 | $1 | +$1 |
| VPC + NAT Gateway | $0 | $32 | +$32 |
| VPC Endpoints | $0 | $7 | +$7 |
| WAF | $0 | $6 | +$6 |
| CloudTrail | $0 | $7 | +$7 |
| AWS Config | $0 | $3 | +$3 |
| DynamoDB PITR | $0 | $5 | +$5 |
| **AWS total** | **~$100/mo** | **~$161/mo** | **+$61/mo** |

### One-Time

| Item | Cost |
|------|------|
| Risk Assessment | $5k–$20k |
| Security Policies | $5k–$15k |
| Penetration Test | $5k–$25k |
| **One-time total** | **$15k–$60k** |

### Development Effort

| Feature | Estimated Effort |
|---------|-----------------|
| Multi-tenant auth + MFA | 2-3 weeks |
| VPC migration for all Lambdas | 1 week |
| KMS encryption integration | 3-5 days |
| Log scrubbing in SSR Lambda | 1-2 weeks |
| WAF rules + IP allowlisting | 2-3 days |
| CloudTrail + Config setup | 1 day |
| Automated backup/restore testing | 3-5 days |
| Documentation + policy writing | 1 week |
| **Total dev effort** | **6-10 weeks** |

---

## 9. Recommended Priority Order

1. **Phase 1 (Week 1-2)** — Sign BAA, enable CloudTrail, Config, KMS encryption, DynamoDB PITR, S3 versioning
2. **Phase 2 (Week 3-5)** — VPC + NAT Gateway + VPC endpoints, WAF, move Lambdas into VPC
3. **Phase 3 (Week 6-8)** — Multi-tenant auth with MFA, session management, SSO support
4. **Phase 4 (Week 9-10)** — Log scrubbing, penetration testing, policy documentation

---

## 10. Things That Stay the Same

- CloudFront dashboard (no Lambda@Edge)
- API Gateway (HIPAA-eligible)
- Lambda compute (HIPAA-eligible)
- DynamoDB (HIPAA-eligible with KMS)
- S3 assets (HIPAA-eligible with KMS)
- CodeBuild (HIPAA-eligible)

## 11. Services That Need Replacement or Removal

| Service | Issue | Replacement |
|---------|-------|-------------|
| CloudFront + S3 (dashboard) | CloudFront is eligible, S3 is eligible | No replacement needed |
| Cognito User Pool | Eligible | Can keep, but add MFA |

All current services are HIPAA-eligible. No replacement needed.
