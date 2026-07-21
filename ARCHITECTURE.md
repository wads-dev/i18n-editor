# i18n Editor Architecture

The Editor is a local Node.js application with a browser interface. The published executable owns the HTTP server and serves the compiled frontend from the same origin.

## Source boundaries

- `src/core/` contains environment-neutral editing and export-plan operations. It is strict TypeScript and may be consumed by the browser or future server routes.
- `src/web/` contains the browser interface. It is bundled into `dist/public/editor.js`. Declarative DOM translation comes from `@wads.dev/i18n-html`, not from editor-owned runtime code.
- `src/web/i18n/` is the Editor's own zero-level English and Portuguese catalog. `src/web/language.ts` is the only module that imports the runtime language loader. It publishes the deeply frozen, typed translation tree as `globalThis.Lang`; browser modules consume the declared global directly instead of importing the catalog.
- `src/server/` owns the local Fastify server. It must bind to loopback by default.
- `src/cli/` owns process lifecycle and declares commands and options through Commander. Commander owns parsing, validation and generated help. The emitted entry point is the package executable.
- `scripts/` contains deterministic build support only.
- Development mode uses `concurrently` to run a `nodemon`/`tsx` TypeScript server and a second `nodemon` process for `build:web`. The server runs directly from TypeScript, while the web watcher keeps `dist/public` synchronized with browser source changes.

## Build output

- Node modules and declarations are emitted into `dist/` by TypeScript.
- Browser TypeScript is bundled by esbuild into `dist/public/editor.js`.
- Static HTML and CSS are copied to `dist/public/`.
- The CLI keeps a Node shebang and executable permission.

## Project connection

- The CLI fixes the project root, configuration, catalog and bundle paths at startup. Browser requests cannot choose filesystem paths.
- `GET /api/project` reads the current project configuration and bundle and reports whether a catalog is available for generation.
- `POST /api/bundle` runs the `@wads.dev/i18n-ts` bundler for the fixed catalog and writes only the configured bundle file. The browser renders its cached bundle immediately on load, then refreshes the project bundle asynchronously when a catalog is available; a bundle edited during that refresh is preserved in memory. An explicit usage refresh regenerates the bundle first, then analyzes that refreshed bundle.
- `POST /api/export-preview` compares the browser's in-memory bundle and configuration with the fixed project filesystem. It is read-only and returns relative paths, statuses and unified diffs, never generated contents or absolute paths.
- `POST /api/export` recalculates that plan from the browser's in-memory bundle and configuration, then writes generated sources through the same atomic export operation used by the CLI. Obsolete files require either project `autoDelete` or explicit confirmation from the editor request.
- `POST /api/usage-analysis` returns the latest disk-cached usage report immediately by default. The response marks it as `verified`, `unverified` or `missing`; this read-only request never starts an analysis. Passing `wait: true` builds a TypeScript Program from the fixed project's `tsconfig.json`, maps root translation leaf symbols, returns exact and uncertain source references and atomically replaces the cache.
- Concurrent generation requests share one in-flight operation.
- The browser can regenerate translation sources only through an explicit export action and confirmation. It cannot choose the project directory or arbitrary output paths.

The default project is the process working directory. CLI arguments override discovery, followed by `catalogFile` from `i18n.config.json`, then conventional catalog paths.

Browser-persisted bundles and project configuration are keyed by the `projectDirectory` returned by `GET /api/project`. They must never cross project boundaries, even when two editor instances share the same browser origin. The editor interface language is intentionally global to the browser and is not project-scoped.

Review baselines are IndexedDB-persisted and project-scoped because they can contain large key sets. The selected **New keys only** filter is a project-scoped `localStorage` preference. A baseline contains only the translation key set at the moment a user explicitly marks it reviewed. It is never created or updated by loading, editing or exporting a bundle. The filter compares the in-memory bundle with that baseline; value-level review is a future extension.

`i18n-edit preview` is the read-only CLI representation of the Web Editor export preview. Both originate from the same environment-neutral `buildExportPlan` operation; the server enriches that plan with filesystem states, obsolete files and unified diffs. The CLI displays diffs by default and accepts `--no-diff`; the browser requests them only through its explicit verification action.

`i18n-edit usage` and the Web Editor usage action share the Compiler API analyzer. Generated translation directories are excluded from reference counting. Exact TypeScript symbol references and declarative HTML bindings discovered by `@wads.dev/i18n-html/usage` are `used`; dynamic access to a known translation collection is `uncertain`, and a leaf with neither is `unreferenced`. A usage report belongs to the current source tree and remains outside bundles and project configuration.

Usage reports are stored at `node_modules/.cache/@wads.dev/i18n-editor/usage.json`. The cache fingerprint covers the translation key structure and the configuration fields that affect ownership and resolution. It deliberately does not fingerprint every source file: opening the editor stays fast, and the explicit **Update usages** action is responsible for incorporating source-only changes. On page load, the browser first requests the latest cache without waiting. It renders an unverified report when available, then explicitly requests a fresh report with `wait: true`; a missing cache follows the same second-request path. A verified cache is rendered without automatic regeneration.

## Source export safety

- `i18n-edit export`, `i18n-edit sync` and the confirmed Web Editor export action are the source-writing entry points.
- The complete plan is calculated before writing and classifies files as created, modified or unchanged.
- Interactive use requires explicit confirmation. `--yes` is the opt-in non-interactive mode.
- Every destination is validated to remain inside the selected project root.
- Changed files are written through a sibling temporary file and atomically renamed.
- A configured `i18n` directory is checked for files absent from the generated plan unless `deletion` is `false`. Ignored extensions are preserved and omitted from warnings.
- Deletion candidates are warnings by default. They are removed only with CLI `--delete` or project-level `deletion.autoDelete`, and remain subject to interactive confirmation unless `--yes` is used.
- Files outside managed `i18n` directories are never deleted.
- Existing interface names, leaf property types and required type imports are preserved when available. This retains public type names, literal unions and function signatures during round-trips.
- Generated source follows `exportConfig.codeFormat`. Inline object and array output is limited independently by line width and item count. Only shallow collections may be inline; a collection containing another collection is always multiline, without a configuration override. Formatter discovery and post-export commands are future integrations; any command execution must be explicit, project-controlled and outside the environment-neutral generator.
- Generated child imports retain the path intent declared by `levelImports`: aliased structural paths emit aliases and relative structural paths emit relative imports. Their local identifiers come from the child key segment so matching object properties can use shorthand syntax.
