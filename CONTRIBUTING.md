# Contributing

Use Node.js 24.15 or later in the 24.x series and pnpm 12.14.0. The repository pins the package manager in `package.json` and the Node major version in `.node-version`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Build and install

Run the build for your browser:

```bash
pnpm build          # Chrome 116+
pnpm build:firefox  # Firefox 140+
pnpm build:edge     # Edge 116+
```

In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, turn on developer mode, and load `.output/chrome-mv3` or `.output/edge-mv3` as an unpacked extension.

In Firefox, open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`. Firefox removes temporary installations when it restarts; permanent installation requires Mozilla signing.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:all
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:firefox
```

`pnpm test:unit` and `pnpm test:integration` run each Vitest layer separately. `pnpm coverage` produces coverage reports. Browser tests use isolated profiles and fixture responses. They do not contact live translation providers.

Firefox tests use Selenium Manager to acquire Firefox and geckodriver. To use installed executables, set `FIREFOX_EXECUTABLE_PATH` and `GECKODRIVER_PATH`. Run `pnpm test:e2e:edge` when Edge is installed; `EDGE_EXECUTABLE_PATH` selects a specific executable.
