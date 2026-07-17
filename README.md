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
