---
name: security-review
description: "Use for authentication, authorization, admin features, user data, secrets, tokens, file uploads, API routes, and external integrations."
---

# Security Review Skill

Use this skill for defensive security review of the app.

## Review areas

1. Authentication:
   - login/logout/session handling
   - expired sessions
   - token handling
2. Authorization:
   - admin-only features
   - role-based access
   - user/customer isolation
   - object-level permissions
3. Data protection:
   - personal data
   - HR data
   - banking/payment data
   - confidential documents
4. API routes:
   - missing auth checks
   - unsafe parameters
   - overbroad responses
   - server/client trust boundaries
5. File handling:
   - upload validation
   - path traversal risk
   - unsafe file previews/downloads
6. Secrets:
   - exposed env vars
   - tokens in frontend code
   - logs containing sensitive data
7. External integrations:
   - webhooks
   - API keys
   - third-party document services

Focus on defensive review and safe fixes. Do not generate exploit code. Explain the risk and the recommended mitigation.
