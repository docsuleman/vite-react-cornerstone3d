# Repository Guidelines

## Project Structure & Module Organization
- Source in `src/` with feature folders: `components/`, `utils/`, `hooks/`, `types/`, `lib/`, `customTools/`, `services/`, `config/`.
- Public assets in `public/`; build output in `dist/`.
- Examples and docs: see `docs/` and reference summaries like `CORNERSTONE_REFERENCE_INDEX.md`.
- Examples: `src/components/ProperMPRViewport.tsx`, `src/utils/cornerstoneInit.ts`, `src/config/measurementWorkflow.json`.

## Build, Test, and Development Commands
- Install: `npm i` (or `bun install`).
- Dev server: `npm run dev` (Vite dev server with HMR).
- Type-check + build: `npm run build` (runs `tsc` then `vite build`).
- Preview built app: `npm run preview`.
- Lint: `npm run lint` (ESLint with TS/React rules).

## Coding Style & Naming Conventions
- Language: TypeScript + React function components; hooks where appropriate.
- Indentation: 2 spaces; semicolons optional per TS defaults—keep consistent with existing files.
- Naming:
  - Components: `PascalCase` filenames and exports (e.g., `MPRViewport.tsx`).
  - Utilities/modules: prefer `camelCase` filenames when procedural (e.g., `viewportResize.ts`) and `PascalCase` when class-like (e.g., `SplineStatistics.ts`).
  - Variables/functions: `camelCase`; types/interfaces: `PascalCase`.
- Imports: group by external → internal; avoid unused symbols (lint will flag).

## Testing Guidelines
- No unit test framework is configured yet. If adding tests, prefer Vitest + React Testing Library.
- Name tests `*.test.ts`/`*.test.tsx` and colocate next to the module or in `src/__tests__/`.
- For algorithmic utilities (e.g., `CPRCoordinateConverter`), include edge cases and sample fixtures.

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject; include scope when helpful (e.g., `mpr: fix viewport sync`).
- PRs must include:
  - Clear description, rationale, and affected areas/components.
  - Screenshots/GIFs for UI or viewport behavior changes.
  - Steps to reproduce and verify; mention any new config/env needs.
  - Linked issue/MD references when applicable (e.g., `VIEWPORT_UTILITIES.md`).

## Security & Configuration Tips
- Do not commit secrets. For DICOM/DICOMweb endpoints or auth, use environment variables and document usage.
- Cornerstone WASM/decoders: Vite is configured in `vite.config.ts`; if adding codecs, update `optimizeDeps`/`worker` accordingly.
- WebGL constraints vary by device; capture issues with reproducible data and browser details.

## Architecture Notes
- This app centers on Cornerstone3D MPR/CPR viewports and measurement workflows. Review `docs/` and the summary MDs (e.g., CPR rotation, WebGL fixes) before large changes.
