# Accounts and Live access

Demo is public. Live requires an authenticated account with administrator approval. Signup never grants Live automatically, and client-side fields cannot grant approval.

## Hosting and sessions

The GitHub Pages demo links to the authenticated workspace on the HTTPS API origin at `/vibefinance/`. Keep the UI and API on the same origin: account cookies are HTTP-only, SameSite=Lax, Secure over HTTPS, and never returned as JSON or stored in local/session storage. This avoids third-party-cookie restrictions. Local Vite uses a same-origin API proxy.

Sessions last 30 days. The Account page explicitly renews them for another 30 days or logs out. Tokens have 256 bits of random entropy and only their SHA-256 hashes are stored server-side. Logout, password reset and Live revocation invalidate sessions immediately. Approval is checked on every Live request; further queued OpenAI calls also recheck account approval. Already-issued provider requests cannot be unspent or recalled. Expired sessions are pruned on subsequent login.

Passwords use salted scrypt (N=32768, r=8, p=3), asynchronous verification, bounded concurrent hashing, and constant-time derived-key comparison. New/reset passwords require 12–128 characters. Login/signup share an IP throttle. Auth responses are not cached. Mutating account/admin requests require same-origin requests. HTTPS is required outside local development.

## Operations

Configure `ADMIN_USERNAME` as an email and `ADMIN_PASSWORD` privately in the server environment before first startup. Startup creates one approved owner account if that email does not exist. Existing account passwords are not overwritten on restart. There are no built-in production credentials. The existing operations dashboard keeps its separate Basic authentication.

Open `/admin/users` (or follow Users and Live approvals from `/admin`) to search paginated users, approve/revoke Live, or set a new password. Approval/revocation/reset actions append a private database audit record. Password resets invalidate every login for that account; coordinate replacement passwords privately. Resetting the owner account password does not change the separate Basic-auth deployment credentials.

No email service is configured: addresses are self-declared, not verified, and password recovery is administrator-managed. Verify a requester's identity out of band before approving Live or resetting a password. No email, remote personal-note synchronization or outbound notifications are introduced. Accounts have stable usage identities across browsers; existing network, global call and spending ceilings remain in force. Browser-local journals are shared by whoever uses that browser and do not become account-private storage.

Deploy additive database migrations with a database backup; preserve users, usage, spending and audit history. Build the web bundle on the backend too, grant the runtime read-only access to `web/dist`, and configure the nginx `/vibefinance/` and `/admin` prefix routes in `deploy/vibefinance-api.conf`. Do not expose `.env`, source databases, private backups or audit data as static content.

## QA

Account API regressions cover public Demo, direct Live denial, owner bootstrap, no client self-approval, approval, revocation, session expiry/forgery/logout/renewal, admin-only mutation, cross-origin denial, password reset, safe listing and audit persistence. Browser journeys cover signup through approval, real fixture-backed Live, revocation/recovery/logout, anonymous Live redirects, responsive layouts and automated accessibility checks. Tests use disposable databases and no paid models.
