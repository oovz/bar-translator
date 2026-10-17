<img src="public/icons/icon-128.png" width="64" alt="Bar Translator icon" />

# Bar Translator

Translate text from Chrome's address bar and press Enter to copy the result, without leaving your current tab.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)

## Usage

1. Focus the address bar with Ctrl+L (Windows/Linux) or Cmd+L (macOS).
2. Type `t` followed by a space to enter translation mode.
3. Enter your text, optionally prefixed with a language code.
4. Wait for the translation preview, then press Enter to copy it.

| Input | Translation |
| --- | --- |
| `t Hello world` | Uses your default target language. |
| `t fr Hello world` | Translates to French. |
| `t en>fr Hello world` | Uses English as the source and French as the target. |

The source language is detected automatically unless you specify one. In settings, choose default source and target languages and preferred regional variants, such as mapping `zh` to `zh-TW`.

Previews start after a 300 ms pause in typing. The address bar shows loading text while a request is pending and an error if translation fails. Editing or clearing the input, or ending the interaction, cancels pending work.

> [!NOTE]
> Enter copies a completed result that matches your current input and settings. Pressing it before a result is ready ends the interaction, cancels the request, and leaves your clipboard unchanged.

## Translation providers

| Provider | Access |
| --- | --- |
| Google Translate | Public web endpoint; no API key required. |
| Lingva Translate | Alternative frontend for Google Translate; no API key required. |
| DeepL | Official API; requires a Free or Pro API key. |

Enable the providers you allow to receive your text, then drag them into order in settings. The first available provider is tried first. If it fails, later enabled providers may receive the same text. Disabling every provider pauses translation; the selection is saved across settings and browser restarts.

Each provider is attempted once, in sequence. An attempt has up to four seconds, including reading the response, within a ten-second total budget. A timeout aborts that request and moves to the next available provider with the remaining time. If translation fails, the clipboard stays unchanged. Public web endpoints can become unavailable or change their response format.

DeepL's **Test** button checks your key through the authenticated [usage endpoint](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits). Enable DeepL separately to use it for translation.

## Privacy

Translation requests go directly to your enabled providers. Translation content is sent only to those providers, and API keys go to their corresponding provider for translation and explicit key validation. Cancelling a request cannot undo text a provider has already received or any resulting billing.

The extension collects no usage analytics and creates no analytics identity. Production logs exclude translation text, results, credentials, and provider response bodies. The maintainer uses Chrome Web Store reporting outside the extension.

Settings sync across your Chrome instances. API keys default to local storage, and each device chooses its own **API Key Storage** setting:

- **Sync** copies this device's keys to shared storage. It preserves keys for other providers already stored there; this device's key takes precedence for the same provider.
- **Local** copies shared keys to this device and keeps the shared copy available to other devices.

> [!IMPORTANT]
> Both local and synced storage hold readable API keys.

## Development

Use [Node.js](https://nodejs.org/) 24.15+ (24 LTS) and [pnpm](https://pnpm.io/) 12.14.0, as pinned in `package.json`.

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

The development command launches a browser with the extension loaded.

### Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The build produces `.output/chrome-mv3/`. Browser tests use that build and run in headed Chromium:

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

On Linux without a display, run `xvfb-run --auto-servernum pnpm test:e2e`.

### Packaging and CI

Run `pnpm zip` to create the Chrome extension ZIP in `.output/`.

[CI](.github/workflows/ci.yml) runs lint, typechecking, unit tests, a Chrome build, and browser tests on branch pushes and pull requests. The [release workflow](.github/workflows/release.yml) runs the same checks for pushed tags starting with `v`. The tag must match the version in `package.json`, such as `v1.1.0` for version `1.1.0`. After the checks pass, it publishes a GitHub release with the Chrome ZIP.

### Tech stack

[WXT](https://wxt.dev/), [Preact](https://preactjs.com/), [Vite](https://vitejs.dev/), and [TypeScript](https://www.typescriptlang.org/), with [Vitest](https://vitest.dev/) for unit tests and [Playwright](https://playwright.dev/) for browser tests.
