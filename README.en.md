# FlowVault – version control and backup for n8n

Connect as many n8n instances as you like. FlowVault backs up all workflows automatically, creates a new version on every change and shows you visually what changed.

*Deutsche Version: [README.md](README.md)*

**Status: 0.2.0, early development.** FlowVault is self-hosted and uses a single admin account with email and password plus optional two-factor authentication (TOTP). Multiple users and roles are not implemented. The project is independent of n8n and GitHub.

[Quick start](#quick-start-local) · [Docker](#running-with-docker) · [Development](#development) · [Languages](#languages) · [Contributing](CONTRIBUTING.md) (German) · [Security reports](SECURITY.md) (German)

## Features

- **Multiple instances**: production, staging, customer instances – all in one place
- **Automatic backups** at an adjustable interval (5 minutes to daily) or manually
- **Version history** like Git commits, with an automatically generated description (“‘Slack’ added · ‘HTTP Request’ changed”) and your own notes
- **Visual diff**: workflow canvas with colour-marked nodes (new / changed / removed), changes per node, changed connections, full JSON diff
- **Compare any versions**
- **Restore**: write a version back to n8n – or create it as a copy, also on another instance (staging → prod)
- **Environments (staging → prod)**: promote workflows between instances without tripping over IDs – FlowVault replaces credentials, sub-workflow and error-workflow IDs, data table IDs and webhook paths based on mappings you save once. The drift view shows which workflows differ between two instances and in which direction (see [Environments](#environments-staging--production))
- **Deleted workflows** are kept with their complete history
- **Archived workflows** are skipped by default. Switch them on per instance under *Edit instance → Back up archived workflows*. History that was already saved is kept (Workflows → “Archived”).
- **Which change broke it?** FlowVault fetches the executions from n8n and lays them over the version history: failure rate per version (“since v14, 38 % fail, before 0 %”), the node that has been failing since the change marked red in the diff canvas, and a warning with a rollback suggestion when the rate rises. Rollback with one click. It runs as its own process inside FlowVault, see [Health service](#health-service-failure-rate-per-version)
- **Download** every version as JSON that n8n can import
- Activity feed and heatmap, sync log per instance
- API keys encrypted with AES-256-GCM, sign-in with email and password, optional 2FA with an authenticator app and one-time recovery codes (see [Security](#security))
- **English and German**: interface, error messages and AI texts; more languages can be added without code changes (see [Languages](#languages))
- **AI change texts (optional)** via [Melious](https://melious.ai): for every new version, a model on EU infrastructure writes a commit-style title plus bullet points. Only the changed nodes and parameters are sent – the whole workflow only if you request a text for a first version yourself. FlowVault removes values of fields such as `password`, `token`, `apiKey` or `Authorization`, as well as typical key formats (Bearer, JWT, `sk_…`, `ghp_…`, AWS), beforehand. That is a heuristic: credentials belong in n8n credentials, not in code nodes. Set it up under **Settings → AI change texts**.

Only real changes create versions – runtime data such as `staticData` (e.g. polling timestamps) is ignored.

## Quick start (local)

Prerequisite: **Node.js ≥ 22.18** (24 recommended). No database needed – SQLite is built in.

First clone this repository using the URL from **Code → SSH/HTTPS** on GitHub and change into the project folder. Then run:

```bash
npm ci
npm run build
npm start            # → http://127.0.0.1:4000
```

On first access, you choose the email and password for your admin account and then connect your first instance. For that you need the **setup code** the server prints to the terminal on startup – so nobody else can take over a freshly started instance. Afterwards, you can enable 2FA under **Settings → Two-factor authentication**.

For existing installations, first sign in with the previous admin password and then set the admin email once. Until then, the other functions are locked. The previous password is kept; the switch signs other devices out.

### Getting an n8n API key

In n8n: **Settings → n8n API → Create an API key**. The key needs read access to workflows (and write access for restoring and promoting). For the failure rates, read access to executions is needed as well. Whether the public API and individual permissions are available depends on your n8n installation.

## Development

After `npm ci`, start development with `npm run dev`. Run the mock and the test commands below each in another terminal. In FlowVault, connect the mock via `http://localhost:5679` with the API key `test-key`; no real n8n instance is needed for that.

```bash
npm run dev          # API (port 4000, also starts the health service) + Vite frontend (http://localhost:5173)
npm run mock-n8n     # fake n8n on port 5679, API key: test-key, keeps generating executions
MOCK_ENV=Prod MOCK_PORT=5680 npm run mock-n8n   # second fake instance with its own IDs – for environments (staging → prod)
curl -X POST localhost:5679/_mock/mutate   # simulates a workflow change
curl -X POST localhost:5679/_mock/break    # change after which a node fails in 40 % of runs
curl -X POST 'localhost:5679/_mock/run?n=30'  # immediately 30 runs per active workflow
npm test             # auth/2FA tests, environment mappings, health analysis and translations
# The mock also plays Melious: API address http://localhost:5679/v1, key test-ai-key
MOCK_LOG_PROMPT=1 npm run mock-n8n          # shows what would be sent to the AI
npm run typecheck
```

## Running with Docker

```bash
cp .env.example .env
openssl rand -base64 32
```

Enter the generated value in `.env` after `APP_SECRET=`. Keep the file and the key; with an existing installation, do not generate a new key. Then start:

```bash
docker compose up -d --build
docker compose logs flowvault  # shows the setup code for the admin account
```

To get English server logs and AI texts, add `DEFAULT_LANGUAGE=en` to the `.env` (see [Languages](#languages)).

The port is only exposed on `127.0.0.1`. To make FlowVault reachable from outside, use a reverse proxy with HTTPS (Caddy, Traefik, nginx) – and then **set `TRUST_PROXY=1`**, otherwise all sign-in attempts count against the proxy’s IP. If FlowVault runs in the same Docker network as n8n, you can enter e.g. `http://n8n:5678` as the URL.

The container runs as user `node` (UID 1000). Hand over a volume from an older version (which ran as root) once. With Compose, this addresses the volume that is actually used, even if its name contains a project prefix:

```bash
docker compose stop flowvault
docker compose run --rm --no-deps --user root --entrypoint chown flowvault -R 1000:1000 /data
docker compose up -d
```

## Version and updates

Every completed project change receives a higher version. The Git hook and CI enforce version updates; see [versioning](docs/VERSIONING.md) (German).

The installed version number is shown at the bottom of the sidebar. Clicking it opens **Settings → About FlowVault**. There you also see the Git commit (if known) and, in the Docker image, the build date. Local changes are marked separately. The information comes from the running server, not from a version number hard-coded in the frontend. There is currently no automatic check for newer releases.

### Updating manually

With Docker from a local checkout, first make sure you have the [FlowVault backup](#backing-up-flowvault-itself), then run in the project folder:

```bash
git pull --ff-only
APP_REVISION="$(git rev-parse HEAD)" docker compose build --pull flowvault
docker compose up -d flowvault
```

The build parameter `APP_REVISION` stores the built commit in the image. Without it, a Docker image shows the version number and build date; a Git commit is not guessed. When started directly from a Git checkout, FlowVault detects the commit itself at server start. Then reload the page.

For the included `docker-compose.arcane.yml`, build and deploy the new state in **Arcane → Project → Build & Deploy**. A restart or merely pulling an image does not pick up new source code with this `build:` configuration. Without Docker: after `git pull --ff-only`, run `npm ci` and `npm run build` and restart the FlowVault process. Keep the data volume and `APP_SECRET`.

### Requesting an update from the interface

The **Request update** button becomes available as soon as an external deployment webhook is configured. Before every request, FlowVault confirms the current password and, with 2FA enabled, a fresh app or recovery code. The deployment service takes care of the actual rebuild and container replacement; FlowVault needs neither a Docker socket nor write access to its source code.

Set this in the `.env` of the Compose/Arcane project and redeploy the container once:

```dotenv
UPDATE_WEBHOOK_URL=https://deployment.example.com/trigger
# Only if the deployment service expects a bearer token:
UPDATE_WEBHOOK_TOKEN=
# Optional: link to the project or deployment history, shown in the browser:
UPDATE_MANAGEMENT_URL=https://deployment.example.com/projects/flowvault
```

The webhook receives a JSON POST with `app`, the installed `version`, the known `revision` and `requestedAt` (Unix milliseconds). It must accept the job promptly with HTTP 2xx and run it in the background. An optional token is sent as `Authorization: Bearer …`. Target and token come exclusively from the server configuration and are never sent to the browser. Redirects are not followed. On a timeout after ten seconds or a dropped connection, the outcome is shown as unclear; there are no automatic retries. Concurrent requests are blocked, with at least two minutes between attempts. The deployment service should also prevent parallel jobs.

**Arcane:** According to its [webhook documentation](https://getarcane.app/docs/reference/api), webhooks are created under **Settings → Webhooks**. Choose only the affected project as the target. A project-redeploy webhook can update provided images; for our current source-code build that alone is not enough: the connected job must run **Build & Deploy**. For example, trigger a dedicated deployment job through a webhook. Until that is set up, build and deploy directly in Arcane. `UPDATE_MANAGEMENT_URL` can point to the Arcane project.

An accepted request does **not** mean the update was installed successfully. Check the history in the deployment service and reload FlowVault afterwards; the displayed version and build information then show the running state.

## Configuration

| Variable         | Default      | Description |
|------------------|--------------|-------------|
| `PORT`           | `4000`       | HTTP port |
| `HOST`           | `127.0.0.1`  | Bind address (`0.0.0.0` in the container) |
| `DATA_DIR`       | `./data`     | Location for the database and keys |
| `APP_SECRET`     | –            | Key for encrypting the API keys. Without it, one is created automatically in `data/secret.key` |
| `ADMIN_PASSWORD` | –            | Fixed admin password instead of setting it up in the browser |
| `ADMIN_EMAIL`    | –            | Fixed admin email; together with `ADMIN_PASSWORD` usable without initial setup. Without this variable, the email is set in the browser |
| `DEFAULT_LANGUAGE` | `de`       | `de` or `en`: language of the server logs and of the AI change texts, and fallback language of the interface (see [Languages](#languages)) |
| `TRUST_PROXY`    | –            | `1` behind a reverse proxy (mandatory, otherwise the sign-in lock applies to everyone) |
| `APP_REVISION`   | –            | Optional Docker build parameter for the built Git commit |
| `UPDATE_WEBHOOK_URL` | –        | External deployment webhook (POST); without it the UI update button is not active |
| `UPDATE_WEBHOOK_TOKEN` | –      | Optional bearer token for the deployment webhook, used server-side only |
| `UPDATE_MANAGEMENT_URL` | –     | Optional public link to the deployment history or Arcane project |
| `HEALTH_PORT`    | `4100`       | Internal port of the health service (`127.0.0.1` only, never exposed) |

Docker Compose reads `.env` for the variables referenced in `docker-compose.yml`. Further settings have to be added there under `environment`. When started directly via npm, `.env` is not loaded automatically: set variables in the shell, e.g. `PORT=4001 HEALTH_PORT=4101 npm start` (macOS/Linux).

FlowVault starts the health service itself as a child process and restarts it after a crash. If it fails, FlowVault keeps running normally, just without operating data. The core and the service share an internal token that is stored automatically in `data/internal.token`.

## Languages

The interface is available in **English** and **German**. It first follows the browser language; with the language selector on the sign-in page and under **Settings → Language**, it can be switched per browser. Server error messages appear in the same language.

With `DEFAULT_LANGUAGE=en` (in the `.env` or in Arcane), FlowVault writes the server logs – e.g. the setup code in `docker logs flowvault` – and new AI change texts in English; the interface falls back to it when the browser reports no supported language. The language of the AI texts can additionally be chosen under **Settings → AI change texts**.

Further languages are a folder of text files, with no changes to the program code: [docs/I18N.md](docs/I18N.md) (in German).

## Environments: staging → production

In practice, copying between instances fails on IDs that are different everywhere: credentials (“Slack Staging” ↔ “Slack Prod”), sub-workflow IDs in Execute Workflow, error workflows in the settings, data table IDs, webhook paths. **Environments** supports this promotion through the n8n public API with its own mappings:

- **Save mappings once** (Environments → Mappings), per direction (staging → prod and back are separate). **Suggestions** detects counterparts automatically: credentials through the n8n public API (the API key needs read access to credentials for that) or names without an environment suffix, sub-workflows through the workflows that are backed up anyway, data tables and webhook paths from the saved snapshots.
- **Drift view**: which workflows differ between the instances – measured against the state *after* applying the mappings – and which side has the newer change. “Diff” shows per workflow what a promotion would change.
- **Promote** overwrites the target workflow (the previous state stays saved as a version) or creates it – inactive – if it is new. Copying from the version history to another instance applies the same mappings.
- FlowVault shows missing mappings before the promotion; the affected IDs then stay unchanged.

FlowVault remembers workflow pairings (source ID ↔ target ID) by itself with every promotion – so the mapping survives renames. Credentials stay encrypted: the target instance is only reached through its saved address and its own API key.

## Health service: failure rate per version

GitHub only sees the code, not how it runs in production. FlowVault connects both: every execution from n8n is assigned to the workflow version that was running at that time.

- **Assignment**: What counts is the time of saving in n8n (`updatedAt`), not the time of the backup. If n8n supplies a `workflowVersionId` on the execution, it takes precedence. If you save several times between two backups, the runs in between land on the previous saved version. A shorter sync interval makes the assignment more precise.
- **Assessment**: A version is only judged from a minimum number of runs (default 5). It is compared with the versions before it. If the failure rate rises by at least 20 percentage points, there is a warning on the overview and on the workflow, with a suggestion of the last stable version. Nothing is rolled back unless you click, never automatically.
- **Test runs** from the editor (`mode: manual`) do not count by default.
- **Data-minimal**: The core reduces every execution to status, time, mode, node name and error message before passing it on. Input and output data never leave the core. API keys do not either: the health service fetches the executions through the core’s internal API, not directly from n8n.
- **Limits**: At most 10,000 executions and 200 errors with details per instance per fetch. Very busy instances therefore do not fetch older runs completely on the first fetch. The n8n API key needs read access to executions.

All thresholds are under **Settings → Failure rate per version**.

## Security

Anyone signed in to FlowVault can write workflows to all connected n8n instances. That is why:

- **Setup only with a code** from the server log. After 5 wrong attempts (sign-in as well as setup), FlowVault locks the IP with a growing waiting time.
- **Admin account**: Sign-in with email and password. The email is used as the sign-in name and is not confirmed by mail. Mail delivery and password reset by email are not implemented yet. Values configured via `ADMIN_EMAIL` or `ADMIN_PASSWORD` cannot be changed in the browser; 2FA remains available with these variables.
- **2FA (optional)**: Start under **Settings → Two-factor authentication** with the current password, scan the QR code with an authenticator app (or enter the key manually) and confirm a six-digit app code. The setup is valid for ten minutes and not active until confirmed. The TOTP secret is stored encrypted with AES-256-GCM. App codes are valid for 30 seconds, with one time step of tolerance in both directions; accepted codes cannot be reused. Server and phone should have synchronised clocks.
- **Recovery codes**: When enabled, ten random codes are shown once and can be downloaded as a text file. Keep them safe, separate from the password. A code replaces the app code once; the password is still required. Only SHA-256 hashes are stored. New codes can be created with the password and a valid app or recovery code; that invalidates all old codes. If you lose your phone, sign in with a recovery code and disable 2FA with another code, then set it up again.
- **Signing in with 2FA**: After a valid email and password, there is only a sign-in check valid for five minutes, no session or API access yet. After five wrong codes, this check becomes invalid even if the IP changes. QR setups are bound to the signed-in session and discarded after five wrong codes.
- **Sessions**: HttpOnly cookies with `SameSite=Strict` (additionally `Secure` under HTTPS); session tokens and sign-in checks are stored in the database only as SHA-256. Changes to the email or password, as well as enabling/disabling 2FA and renewing the recovery codes, sign out all other devices and discard pending sign-ins. Such changes require the current password and, with 2FA enabled, additionally a fresh app or recovery code.
- **CSRF**: Writing requests only from the own site (`Sec-Fetch-Site`/`Origin`) and only as JSON.
- **API keys** leave FlowVault only to the saved address. If the URL of an instance or of the AI API is changed, the key has to be entered again. Redirects are not followed; cloud metadata addresses (169.254.x.x) are blocked.
- **Headers**: strict Content-Security-Policy, no embedding in other sites, HSTS behind an HTTPS proxy.
- **Files** in `DATA_DIR` are readable only by the user FlowVault runs as.
- **Fonts** are served locally; the browser loads nothing from third parties.

Good to know: The snapshots also contain pin data (test data) and `staticData` of the workflows. They are stored compressed but not encrypted in the database – if test data contains personal data, protect the database accordingly.

## Backing up FlowVault itself

Back up `flowvault.db` (SQLite, all versions gzip-compressed) from `DATA_DIR` and the key in use: either `secret.key` from the same directory or the value of `APP_SECRET` from your operating configuration. **Back up the database and the key together** – without the key, the API keys have to be entered again and active 2FA can only be reset with recovery codes; the workflow versions stay readable. Keep the recovery codes safe as well.

For a simple file copy, stop FlowVault first (`docker compose stop flowvault` or stop the local server). Do not make an isolated copy of `flowvault.db` while it is running: SQLite additionally uses WAL files. Afterwards, start FlowVault again.

`health.db` contains derived execution data, warnings and the settings of the health service. Existing executions can be fetched again from n8n, as far as n8n still has them stored. Back up this file too if you want to keep settings and warning states.

## Architecture

```
server/          Node.js + Express (TypeScript, runs natively without a build)
  index.ts       REST API & serving of the frontend
  auth-router.ts Admin account, email migration, 2FA and confirmed update trigger
  version.ts     Version and build information of the running server
  updates.ts     Optional external deployment webhook
  auth.ts        Password check, sessions and sign-in lock
  two-factor.ts  TOTP check, replay protection and recovery codes
  sync.ts        Sync engine, scheduler, restore
  n8n.ts         Client for the n8n public API
  internal.ts    Internal API for services (token) + forwarding /api/health → health service
  ai.ts          AI change texts via Melious, queue, secret filter
  promote/        Environments (staging → prod): ID mappings, drift view, promotion
    transform.ts  Replaces IDs in snapshots – purely functional + tests
    mappings.ts  Mapping store, suggestions, workflow pairing
    drift.ts      Differences between two instances
    promote.ts    Promotion to the target instance
    router.ts     HTTP API of the module (/api/promote)
  db.ts          SQLite schema (node:sqlite)
  crypto.ts      Encryption, password hashing, compression
  services.ts    Starts and supervises the health service (child process)
services/health/ Health service: executions ↔ versions, failure rates, warnings
  index.ts       HTTP API (for the core only)
  poller.ts      Fetches executions through the core
  analysis.ts    Pure analysis (assignment, failure rate, rollback suggestion) + tests
  evaluate.ts    Links the analysis with versions, maintains warnings
  db.ts          Own SQLite database (health.db)
shared/diff.ts   Workflow comparison (server & browser)
shared/i18n/     Languages: translator and texts (German, English), used by server and browser
shared/executions.ts  Reduce executions, types for core, service & browser
web/             React + Tailwind (Vite)
scripts/         Mock n8n for testing
```

## Contributing and GitHub

Notes on development, bug reports and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md) (German). The GitHub Actions under [`.github/workflows/ci.yml`](.github/workflows/ci.yml) check tests, TypeScript and the frontend build with Node.js 22.18 and 24.

The steps for the first publication of this repository are in [docs/GITHUB.md](docs/GITHUB.md). Please report security issues confidentially according to [SECURITY.md](SECURITY.md).

## License

FlowVault is released under the [MIT license](LICENSE). Dependencies are subject to their respective licenses.
