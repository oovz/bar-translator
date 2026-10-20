<img src="public/icons/icon-128.png" width="64" alt="Bar Translator icon" />

# Bar Translator

Translate text from Chrome's address bar and optionally press Enter to copy the result, without leaving your current tab.

[![Available in the Chrome Web Store](https://user-images.githubusercontent.com/22908993/166417152-f870bfbd-1770-4c28-b69d-a7303aebc9a6.png)](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)

## Usage

On a new installation, settings open automatically. Grant access to your chosen providers and optionally enable **Enter to copy**. You can use translation previews without clipboard access.

1. Focus the address bar with Ctrl+L (Windows/Linux) or Cmd+L (macOS).
2. Type `t` followed by a space to enter translation mode.
3. Enter your text, optionally prefixed with a language code.
4. Wait for the translation preview, then press Enter to copy it if copying is enabled.

The primary result contains only the translated text. Additional suggestions show copy actions and provider warnings. Select a settings action and press Enter to fix missing permissions or credentials. When a settings problem blocks translation, pressing Enter on the error also opens settings. Temporary network errors do not redirect you. After changing settings or permissions, edit the input or enter translation mode again to refresh completed suggestions.

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

Enable the providers you allow to receive your text, then drag them into order in settings. Enabling Google or DeepL requests access to that provider’s domains; DeepL requires both its Free and Pro domains regardless of your plan. Lingva currently needs no host permission because its API supports cross-origin requests. Disabling a provider releases its host access. Permission grants apply to this device; synced provider choices may need access granted again on another device. The first available provider is tried first. If it fails, later enabled providers may receive the same text. Disabling every provider pauses translation; the selection is saved across settings and browser restarts.

Each provider is attempted once, in sequence. An attempt has up to four seconds, including reading the response, within a ten-second total budget. A timeout aborts that request and moves to the next available provider with the remaining time. If translation fails, the clipboard stays unchanged. Public web endpoints can become unavailable or change their response format.

You can enable DeepL before entering a key. Any supplied key is used for translation without a required test; rejected keys produce errors or fallback warnings. DeepL’s optional **Test** button checks your key through the authenticated [usage endpoint](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits), and is available only while DeepL is enabled and permitted. A failed test does not disable the provider.

## Run locally

With [Node.js](https://nodejs.org/) 24.15+ and [pnpm](https://pnpm.io/) 12.14.0 installed:

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

This launches a browser with the extension loaded.

## Permissions and privacy

Only extension storage is required at installation. Provider access and clipboard/offscreen access are optional. Clipboard access allows writing translations, not reading your clipboard. Turning off **Enter to copy** releases both clipboard and offscreen permissions. Settings do not open automatically on updates; missing access is shown in the address-bar preview.

Translation requests go directly to your enabled providers. Translation content is sent only to those providers, and API keys go to their corresponding provider for translation and explicit key validation. Cancelling a request cannot undo text a provider has already received or any resulting billing.

The extension collects no usage analytics and creates no analytics identity. Production logs exclude translation text, results, credentials, and provider response bodies. The maintainer uses Chrome Web Store reporting outside the extension.

Settings sync across your Chrome instances. API keys default to local storage, and each device chooses its own **API Key Storage** setting:

- **Sync** copies this device's keys to shared storage. It preserves keys for other providers already stored there; this device's key takes precedence for the same provider.
- **Local** copies shared keys to this device and keeps the shared copy available to other devices.

> [!IMPORTANT]
> Both local and synced storage hold readable API keys.
