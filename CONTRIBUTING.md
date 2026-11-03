# Contributing

Thanks for being here! Bug reports, documentation fixes, translations, and code changes are all welcome.

If you find a bug, let us know what you expected, what happened, which browser and version you use, and how to reproduce it. Please leave translation text, API keys, and other private information out of reports. When opening a pull request, tell us about the problem, your approach, and the checks you ran.

## Set up

You'll need Node.js 24.15 or later in the 24.x series and pnpm 12.14.0. The repository pins the package manager in `package.json` and the Node major version in `.node-version`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the Chrome development target. Use `pnpm dev:firefox` or `pnpm dev:edge` for the other browsers.

## Build and install

Build for your browser:

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
pnpm exec web-ext lint --source-dir .output/firefox-mv3 --no-input --no-config-discovery
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:firefox
```

`pnpm test:unit` and `pnpm test:integration` run each Vitest layer separately. For a quicker feedback loop, use `pnpm test:watch`; `pnpm coverage` produces a coverage report. The browser test commands build their target before running. On Linux, Playwright may also need system dependencies; see the [CI workflow](.github/workflows/ci.yml).

Browser tests use isolated profiles and fixture responses. They do not verify live provider availability, OS clipboard access, or browser-account sync across devices.

Firefox tests use Selenium Manager to find or acquire Firefox and geckodriver. To use installed executables, set `FIREFOX_EXECUTABLE_PATH` and `GECKODRIVER_PATH`; the [CI workflow](.github/workflows/ci.yml) records the pinned versions used there. Run `pnpm test:e2e:edge` when Edge is installed; `EDGE_EXECUTABLE_PATH` selects a specific executable.
