# Schematic

A visual JSON Schema editor built with Vite and React.

## Run locally

```bash
npm install
npm run dev
```

Create a production bundle with:

```bash
npm run build
```

## Build a single executable

The Go server embeds the complete production web app, so deployment only needs
one executable file. Node.js, npm, and Go 1.22 or newer are required to build it.

```bash
npm ci
npm run build:single
./bin/schematic
```

Open <http://localhost:8080>. The listen address can be changed with either an
environment variable or a command-line flag:

```bash
ADDR=127.0.0.1:3000 ./bin/schematic
./bin/schematic -addr 127.0.0.1:3000
```

The binary does not need `dist/`, Node.js, or any other runtime files. To build
for another platform, set the standard Go variables when running the script,
for example `GOOS=linux GOARCH=amd64 npm run build:single`.

## Publish a release

Open **Actions → Build and publish release → Run workflow** on GitHub, select
`major`, `minor`, or `patch`, and run it from `main`. The workflow updates the
npm version, tests the application, commits and tags the version, and publishes
a GitHub Release containing Linux, macOS, and Windows executables plus SHA-256
checksums.

## Deployment

Every push to `main` runs the production build and deploys `dist/` to GitHub Pages. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** before the first deployment.

## Features

- Import JSON Schema files
- Create schemas from scratch
- Keep multiple schemas in an IndexedDB-backed local library
- Autosave edits and safely switch between stored schemas
- Duplicate an entire schema into a new independent copy
- Edit nested object and array properties visually
- Configure types, required fields, formats, constraints, enums, and defaults
- Preview and copy generated JSON live
- Edit raw JSON directly for complete access to every JSON Schema keyword
- Add, duplicate, rename, and delete properties with persistent toolbar actions
- Undo and redo edits
- Export a formatted `.schema.json` file
- Responsive desktop and mobile layouts
