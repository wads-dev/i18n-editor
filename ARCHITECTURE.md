# i18n Editor Architecture

The Editor is a local Node.js application with a browser interface. The published executable owns the HTTP server and serves the compiled frontend from the same origin.

## Source boundaries

- `src/core/` contains environment-neutral editing and export-plan operations. It is strict TypeScript and may be consumed by the browser or future server routes.
- `src/web/` contains the browser interface. It is bundled into `dist/public/editor.js`.
- `src/server/` owns the local Fastify server. It must bind to loopback by default.
- `src/cli/` owns process lifecycle and declares commands and options through Commander. Commander owns parsing, validation and generated help. The emitted entry point is the package executable.
- `scripts/` contains deterministic build support only.

## Build output

- Node modules and declarations are emitted into `dist/` by TypeScript.
- Browser TypeScript is bundled by esbuild into `dist/public/editor.js`.
- Static HTML and CSS are copied to `dist/public/`.
- The CLI keeps a Node shebang and executable permission.

## Project connection

- The CLI fixes the project root, configuration, catalog and bundle paths at startup. Browser requests cannot choose filesystem paths.
- `GET /api/project` reads the current project configuration and bundle and reports whether a catalog is available for generation.
- `POST /api/bundle` runs the `@wads.dev/i18n-ts` bundler for the fixed catalog and writes only the configured bundle file.
- `POST /api/export-preview` compares the browser's in-memory bundle and configuration with the fixed project filesystem. It is read-only and returns relative paths, statuses and unified diffs, never generated contents or absolute paths.
- `POST /api/export` recalculates that plan from the browser's in-memory bundle and configuration, then writes generated sources through the same atomic export operation used by the CLI. Obsolete files require either project `autoDelete` or explicit confirmation from the editor request.
- Concurrent generation requests share one in-flight operation.
- The browser can regenerate translation sources only through an explicit export action and confirmation. It cannot choose the project directory or arbitrary output paths.

The default project is the process working directory. CLI arguments override discovery, followed by `catalogFile` from `i18n.config.json`, then conventional catalog paths.

`i18n-edit preview` is the read-only CLI representation of the Web Editor export preview. Both originate from the same environment-neutral `buildExportPlan` operation; the server enriches that plan with filesystem states, obsolete files and unified diffs. The CLI displays diffs by default and accepts `--no-diff`; the browser requests them only through its explicit verification action.

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
