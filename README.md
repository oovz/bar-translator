<img src="public/icons/icon-128.png" width="64" alt="Bar Translator icon" />

# Bar Translator

Translate text from Chrome's address bar and press Enter to copy the result, without leaving your current tab.

[![Available in the Chrome Web Store](https://user-images.githubusercontent.com/22908993/166417152-f870bfbd-1770-4c28-b69d-a7303aebc9a6.png)](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)

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

## Run locally

With [Node.js](https://nodejs.org/) 24.15+ and [pnpm](https://pnpm.io/) 12.14.0 installed:

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

This launches a browser with the extension loaded.

## Privacy

Translation requests go directly to your enabled providers. Translation content is sent only to those providers, and API keys go to their corresponding provider for translation and explicit key validation. Cancelling a request cannot undo text a provider has already received or any resulting billing.

The extension collects no usage analytics and creates no analytics identity. Production logs exclude translation text, results, credentials, and provider response bodies. The maintainer uses Chrome Web Store reporting outside the extension.

Settings sync across your Chrome instances. API keys default to local storage, and each device chooses its own **API Key Storage** setting:

- **Sync** copies this device's keys to shared storage. It preserves keys for other providers already stored there; this device's key takes precedence for the same provider.
- **Local** copies shared keys to this device and keeps the shared copy available to other devices.

> [!IMPORTANT]
> Both local and synced storage hold readable API keys.
