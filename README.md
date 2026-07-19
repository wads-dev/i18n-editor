# @wads.dev/i18n-editor

Local web editor for typed i18n projects.

This first alpha compiles the existing browser editor and its reusable operations from TypeScript, then serves the generated application through a local Fastify server.

> Status: `0.0.1-alpha.0`. The package is under active development and has not been published to npm yet.

## Wads i18n ecosystem

| Project | Responsibility |
| --- | --- |
| [`@wads.dev/i18n-ts`](https://github.com/wads-dev/i18n-ts) | Framework-independent contracts, language loading, project configuration and portable bundles. |
| [`@wads.dev/i18n-react`](https://github.com/wads-dev/i18n-react) | Optional React Provider, hooks and rich translation rendering. |
| [`@wads.dev/i18n-editor`](https://github.com/wads-dev/i18n-editor) | Local bundle and project editor. This repository. |

The Editor consumes the bundle and `i18n.config.json` formats defined by `i18n-ts`. It is framework-independent: React projects may use `i18n-react`, but the Editor does not require it.

## Development

```sh
npm install
npm run check
npm run build
```

Run the generated executable from this repository:

```sh
./dist/cli/index.js
```

Or run it from a consuming project that keeps the repository under `wads.dev/i18n-editor`:

```sh
./wads.dev/i18n-editor/dist/cli/index.js
```

The default address is `http://127.0.0.1:4173`. Override it when needed:

```sh
./wads.dev/i18n-editor/dist/cli/index.js --port 4300
```

The current directory is the project root. On startup, the server reads `i18n.config.json` and `i18n.bundle.json`. If the bundle does not exist, it uses `catalogFile` from the configuration to generate it automatically. Paths can be overridden explicitly:

```sh
./wads.dev/i18n-editor/dist/cli/index.js \
  --project . \
  --config i18n.config.json \
  --input src/shared/i18n/index.ts \
  --bundle i18n.bundle.json
```

## CLI commands

Generate the default `i18n.bundle.json` without starting the server:

```sh
i18n-edit bundle
i18n-edit bundle --output review.bundle.json
```

Print the same generated-file preview used by the Web Editor, enriched with the current filesystem state:

```sh
i18n-edit preview
i18n-edit preview --file review.bundle.json
```

Preview is read-only. It resolves the bundle and `i18n.config.json`, then classifies every managed path as unchanged, modified, new or deleted. New paths are green, modified paths are yellow and files that exist inside a managed `i18n` directory but are absent from the generation plan are red. Unified diffs for new and modified files are shown by default; use `--no-diff` for the compact file list. Deleted files never print their full removed contents.

Plan the source files generated from a bundle:

```sh
i18n-edit export
i18n-edit export --file review.bundle.json
```

The export command shows the same status and unified-diff preview before asking for confirmation. Divergent files are warnings and remain preserved unless the project enables `deletion.autoDelete` or the command explicitly receives `--delete`. Use `--no-diff` for the compact plan, and use `--yes` or `-y` only in automation or after reviewing the plan:

```sh
i18n-edit export --file review.bundle.json --delete
i18n-edit export --file review.bundle.json --delete --yes
```

Each configured `i18n` directory is checked against the generated plan. Generated `base.ts`, language files and the configured root catalog are written; other files become deletion candidates unless their extensions are ignored by project configuration. Set `deletion` to `false` to disable this detection entirely. Files outside configured `i18n` directories are never candidates. Writes are restricted to the selected project directory and use a temporary file followed by an atomic rename.

After the npm package is published, its binaries will be named `i18n-edit` and `i18n-editor`.

The shortest npm invocation will be:

```sh
npx @wads.dev/i18n-editor
```

The explicit binary form will also be available:

```sh
npm exec --package=@wads.dev/i18n-editor -- i18n-edit
```

Because the npm package is scoped, `npx i18n-editor` would refer to a different, unscoped package. Use the scoped command above.

## Current boundary

The server reads project configuration and bundles through `GET /api/project`. It can generate a missing bundle through `POST /api/bundle`; this is currently its only project write. The Web Editor can explicitly request a read-only filesystem comparison through `POST /api/export-preview`. Source regeneration is available explicitly through the CLI `export` command and is not exposed as a browser route yet.
