# Development and testing

Use Node.js 24 (the repository's `.node-version`) and pnpm 12.14.0. Install dependencies and Playwright's bundled Chromium:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
```

For Linux CI, install Chromium's system dependencies with `pnpm exec playwright install --with-deps chromium`. `pnpm dev` runs the extension through WXT. `pnpm build` creates the production extension in `.output/chrome-mv3`; load that directory through **Load unpacked** at `chrome://extensions` to check the production build manually.

## Checks

| Command | Purpose |
| --- | --- |
| `pnpm lint` | ESLint checks |
| `pnpm typecheck` | WXT preparation and TypeScript checks |
| `pnpm test` | All unit and integration tests |
| `pnpm test:unit` | Parsers, languages, provider adapters, permissions and individual UI components |
| `pnpm test:integration` | Background/omnibox flow, provider orchestration and credential storage |
| `pnpm test:e2e` | Build current sources, then run browser workflows |
| `pnpm test:e2e --headed` | Run the same workflows with a visible browser |
| `pnpm build` | Production Chrome build |

The CI workflow runs lint, typechecking, unit/integration tests and browser tests. The browser command builds the current sources before testing, so it does not rely on an earlier build in the workspace. Browser failures retain Playwright reports, traces and screenshots as configured in `playwright.config.ts`.

Run a focused check while working:

```bash
pnpm exec vitest run tests/unit/services/lingva.test.ts
pnpm exec vitest run tests/integration/omnibox.test.ts
pnpm test:e2e providers.spec.ts
```

## Test boundaries

### Unit tests

`tests/unit` checks individual modules with controlled browser or network boundaries. Most files use Node. UI component files opt into jsdom with `@vitest-environment jsdom`.

Adapter tests verify request encoding, credentials, response parsing, HTTP failures and cancellation using synthetic responses. Permission tests verify complete domain grants, partial grants, denial and resource cleanup. These tests establish extension behavior against a provider contract; they do not establish a public provider's current availability.

### Integration tests

`tests/integration/omnibox.test.ts` loads the real background entry point, parser, orchestrator, provider adapters and offscreen copy handler. It controls Chrome events, storage, fetch responses, clocks and the DOM clipboard operation. Tests observe outgoing requests, default/auxiliary suggestions and copy effects across those modules.

The integration layer covers stale results, cancellation, pending Enter, settings changes, permission revocation, allowed sequential fallback, deadlines and failed copies. Additional suites check provider orchestration and credential switches, including concurrent edits and recoverable storage failures.

The event harness does not operate Chrome's native address bar. A confirmed mock DOM copy also does not prove an operating-system clipboard write.

### Browser workflows

`tests/e2e` loads the production extension in an isolated persistent Chromium context. The shared fixture supports headless and headed mode and closes its context after each test. The restart workflow uses a disposable profile to check persistence across browser restarts.

Browser tests exercise first-install setup, settings, provider ordering, credential editing and testing, storage recovery and localization. Permission grant/denial/revocation workflows use an explicitly named settings permission mock. The manifest/fresh-install test inspects actual Chrome grants; the mocked workflows do not prove native permission-dialog behavior.

Unexpected HTTP(S) requests are aborted and fail the test with the method and origin. Paths and queries are omitted because providers may encode translation text in either. Explicit response routes supply expected provider fixtures. Tests use synthetic keys/text and never require a real API key or a live provider. Do not remove this boundary to make a failing provider test pass.

## Native Chrome acceptance

Use a disposable Chrome profile and public, non-sensitive sample text. Record the browser version, build commit, date, provider, scenario and observed result. Keep user text, keys, response bodies and complete challenge URLs out of saved evidence.

1. Load the production build. Confirm first-install settings open in a dedicated tab and only storage is initially granted.
2. Choose source and target languages. Enter translation mode with `t` then Space and type ordinary text. Check that a completed result uses the saved languages. Check an optional target prefix separately.
3. Enable a provider through its native permission prompt. Exercise acceptance and denial. Confirm DeepL requests both declared domains and that missing access appears in the preview without another prompt while typing.
4. Enable copying through its native permission prompt. Check that Enter copies a matching completed translation once and the separate copy action works. Disable copying and confirm previews still work.
5. Press Enter while loading, edit input quickly, clear input and start a new interaction. Confirm stale results never replace or copy the new input's translation. Check the clipboard using known disposable content.
6. Revoke provider/copy access in Chrome. Check warnings and settings actions, then edit input to refresh completed suggestions. Verify settings-fixable blocking errors open settings on Enter and transient failures preserve the clipboard.
7. Disable all providers, restart Chrome and confirm that translation remains paused. Re-enable only a chosen provider to resume.

Live provider checks are separate from deterministic acceptance. Google mobile may present human verification on the current network, and Lingva's availability is an accepted limitation. Record an unavailable service accurately. Perform credentialed DeepL checks only with a key supplied for that purpose and awareness of provider usage. Never bypass verification, change networks automatically or add retries to make a smoke check pass.

## Adding coverage

Put a regression at the lowest layer that can detect the behavior. Use integration tests when modules, events or persistence interact; use browser tests for built-extension UI and lifecycle behavior. Add a native acceptance step when Chrome browser UI or the operating-system clipboard is involved.

Assert observable behavior rather than helper structure or literal prose. Preserve tests for duplicate submissions, stale copies, recipient selection and secret exposure. Add response fixtures for malformed provider data and reachable failures. Keep live availability and benchmark experiments outside the deterministic suite.

## References

- [Vitest environments](https://vitest.dev/guide/environment)
- [Playwright Chrome extension testing](https://playwright.dev/docs/chrome-extensions)
- [WXT unit testing](https://wxt.dev/guide/essentials/unit-testing)

[Back to the README](../README.md)
