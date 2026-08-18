# Repository Guidelines

## Project Structure & Module Organization

The application is a Create React App project in `static/`. It is a client-only,
installable strength-program generator and workout tracker and must remain
deployable as an S3 static site; do not introduce a required application server
or server-side runtime. UI entry points are `static/src/index.js` and
`static/src/App.js`. Reusable controls and routine-generation code belong in
`static/src/components/`; page-level and stateful form compositions belong in
`static/src/containers/`. Persisted routine transformations and browser storage
adapters belong in `static/src/data/`. Tests live beside the code they cover.
Browser assets, PWA metadata, icons, and the offline service worker are in
`static/public/`, and generated production output is in `static/build/`.

The current UI is a phone-first Progressive Web App with multiple local
profiles, multiple routines per profile, an ordered workout queue, completion
history, future exercise editing, future-only max correction, and JSON backup
and restore. The generator supports three- and five-week microcycles, optional
mesocycle chaining, low- and high-volume plans, optional strongman work,
low-volume back-off sets, and CSV download/Markdown copy exports. Keep completed
workout prescriptions as historical snapshots when changing maxes; recalculate
only incomplete generated work and preserve explicit exercise overrides.

All profile, routine, exercise, and completion data is stored locally in
IndexedDB. There is no account or automatic synchronization. Changes to the
stored shape must include a versioned IndexedDB migration and backup-format
compatibility handling. Do not silently overwrite local records during import.
The migration framework lives in `static/src/data/storageMigrations.js`. For
every persisted-shape change, increment `DATABASE_VERSION`, add each intervening
ordered `databaseMigrations` step, and retain old steps so installations can
upgrade across multiple releases. Increment `BACKUP_VERSION` when exported JSON
changes and add a pure `backupMigrations` step for every older supported format;
never mutate the parsed backup or discard unknown user records. Add migration
tests covering both a new database and upgrades from prior versions before
shipping the change.
The service worker provides offline application-shell caching, while
`manifest.json` and the 192px/512px icons provide Android installation metadata.

The existing AWS infrastructure is defined historically in
`static/serverless.yml`: an S3 website bucket, CloudFront distribution, Route 53
record, and ACM certificate. Keep this file as the infrastructure record, but do
not use Serverless for routine content deployment. The `pipeline/` directory is
the legacy CodePipeline/CodeBuild workflow and is not the current local deploy
path. Do not modify or recreate AWS infrastructure unless the task explicitly
requires it.

## Build, Test, and Development Commands

Run application commands from `static/`:

- `npm install` installs the locked dependencies from `package-lock.json`.
- `npm start` starts the local development server with live reload.
- `npm test` launches the Create React App/Jest test watcher.
- `CI=true npm test -- --watchAll=false` runs the test suite once, as expected in CI.
- `npm run build` creates an optimized production bundle in `static/build/`.
- `npm run deploy:dry-run` runs tests and a production build, verifies the
  existing AWS target, and previews S3 changes without uploading or
  invalidating anything.
- `npm run deploy` runs tests and a production build, syncs `static/build/` to
  the existing production S3 bucket, removes stale site objects, applies
  no-cache metadata to `index.html`, and creates a CloudFront invalidation.

The deployment implementation is `static/scripts/deploy.sh`. It currently
targets the existing production site at `themcilroy.com`; there is no active dev
bucket. Always run the dry-run first when deployment changes are uncertain.
Routine deploys must update site contents only and must not invoke CloudFormation
or change S3, CloudFront, Route 53, or ACM configuration. After deployment, the
site can be installed from Android Chrome using **Install app** or **Add to Home
screen**. Verify that `manifest.json`, the app icons, and `service-worker.js` are
present in the production build whenever install or offline behavior changes.

## Coding Style & Naming Conventions

Follow the existing React and `react-app` ESLint conventions. Use semicolons, single quotes in JavaScript, and trailing commas in multiline object literals. Match surrounding indentation when editing older files, and keep new code consistently two spaces indented. Name React components and their files in PascalCase (`RoutineGenerator.js`), variables and handlers in camelCase (`handleSubmit`), and tests with the `.test.js` suffix. Prefer small reusable components over duplicating form or calculation logic.

## Testing Guidelines

Tests use Jest and React DOM utilities supplied by `react-scripts`. Add focused
tests beside changed modules and describe observable behavior rather than
implementation details. There is no configured coverage threshold;
nevertheless, cover generator calculations, completed-workout snapshots,
future-only recalculation, manual override preservation, backup validation,
input boundaries, and regression fixes. Run the non-watch CI command and a
production build before opening a pull request. Exercise install, update, and
offline behavior manually in Android Chrome when PWA assets or caching change.

## Commit & Pull Request Guidelines

Recent history favors short, direct subjects such as `Added about` and `minor formatting`. Use a concise imperative subject, keep each commit focused, and avoid unrelated cleanup. Pull requests should explain the user-visible change, list test commands and results, link relevant issues, and include screenshots for UI changes. Call out modifications to AWS resources, domains, certificates, or deployment stages explicitly.

## Security & Configuration

Do not commit AWS credentials, GitHub tokens, `.env` credential files, or new
account-specific secrets. Deployment uses the AWS CLI's standard credential
chain and assumes credentials are already available on the machine; the deploy
script must never read, write, or persist credentials. Review
`static/scripts/deploy.sh` targets before deploying. Treat `serverless.yml` and
`pipeline/` as legacy infrastructure definitions, not as instructions to
provision or redeploy infrastructure during an ordinary site release.
