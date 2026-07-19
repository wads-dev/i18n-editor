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

The server reads project configuration and bundles through `GET /api/project`. It can generate a missing bundle through `POST /api/bundle`; this is currently its only project write. It does not modify translation source files. Applying edited bundles and regenerating source files will be introduced with a separate filesystem safety contract.
