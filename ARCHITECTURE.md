# i18n Editor Architecture

The Editor is a local Node.js application with a browser interface. The published executable owns the HTTP server and serves the compiled frontend from the same origin.

## Source boundaries

- `src/core/` contains environment-neutral editing and export-plan operations. It is strict TypeScript and may be consumed by the browser or future server routes.
- `src/web/` contains the browser interface. It is bundled into `dist/public/editor.js`.
- `src/server/` owns the local Fastify server. It must bind to loopback by default.
- `src/cli/` owns argument parsing and process lifecycle. Its emitted entry point is the package executable.
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
- Concurrent generation requests share one in-flight operation.
- Translation source files remain read-only. Applying edited bundles back to source files requires a separate safety contract.

The default project is the process working directory. CLI arguments override discovery, followed by `catalogFile` from `i18n.config.json`, then conventional catalog paths.
