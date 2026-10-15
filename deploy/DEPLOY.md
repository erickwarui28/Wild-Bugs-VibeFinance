# Deployment overview

## Public demo

The demo is served at https://erickwarui28.github.io/vibefinance/ from the `vibefinance/` directory of the separate `erickwarui28.github.io` profile repository. This review-only repository does not own Pages settings or deployment workflows.

Build the frontend with Node 22.12 or newer:

```bash
npm ci
npm run build -w shared
VITE_BASE=/vibefinance/ VITE_API_BASE_URL=https://YOUR_API_HOST npm run build -w web
```

On PowerShell, set those two environment variables with `$env:VITE_BASE` and `$env:VITE_API_BASE_URL` before running the build. Copy only the resulting `web/dist/` contents into the profile repository's `vibefinance/` folder. Do not copy source, databases, environment files or credentials into the served folder. Preserve other profile pages and the root 404 page. Hash routes keep navigation under `/vibefinance/#/…`.

The profile repository's manual VibeFinance quality workflow checks out the exact public submission commit and runs type checks, server tests, a build, browser tests and operational unit tests. It does not access the VPS or call paid models.

## API hosting on your own infrastructure

For local review, follow the root README and select Demo. Production API hosting is optional for reviewing the source. Copy `.env.example` to `server/.env`, keep credentials private, configure the allowed frontend origin and use a restricted service account behind HTTPS. Build the workspaces, seed a new database, then start the server. Do not expose the loopback HTTP listener publicly.

The included Linux deployment and systemd templates illustrate release backup, health checks, restricted runtime, monitoring and recovery. Review and adapt all absolute paths and service settings before using them on your own host; do not run existing-host migration or retention scripts blindly. No production database, credential, certificate private key or admin identity is included.

Keep provider keys server-side. Admin access requires explicit credentials over HTTPS. Configure visitor/network/global call ceilings and the separate estimated spending budget before enabling a paid provider. Same-host backups are not disaster recovery. See the architecture document for data provenance, evaluation and operational limitations.
