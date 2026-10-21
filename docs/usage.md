# Using Bar Translator

Bar Translator translates text from Chrome's address bar. Set your usual source and target languages once, then type ordinary text to use them.

## First-time setup

Settings open in a dedicated tab after a new installation. You can reopen them through the extension's options in Chrome.

1. Choose a source and target language. **Auto-detect** is available as a source choice.
2. Enable the translation providers you allow to receive your text. Grant the requested domain access for Google or DeepL.
3. Drag enabled providers into your preferred order.
4. Optionally enable **Enter to copy** and grant clipboard access.

Settings do not open automatically on updates. Missing access and credentials appear in the translation preview, so existing users can discover setup problems while translating.

## Translate ordinary text

Focus the address bar with **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS. Type `t` followed by Space, then your text.

| Input | Translation |
| --- | --- |
| `t Hello world` | Uses your saved source and target languages. |

A preview request starts after a 300 ms pause in typing. The address bar shows a loading message while the request is pending. The primary completed result contains the translation; separate suggestions show copy actions, provider warnings, and settings actions.

Wait for the result before pressing Enter. When **Enter to copy** is enabled, Enter on the completed translation copies it. You can also select the separate copy action. With copying disabled, previews remain available and Enter on the translation leaves the clipboard unchanged.

> [!NOTE]
> Enter before a result is ready ends the interaction, cancels the request, and leaves your clipboard unchanged. Editing or clearing the input also cancels pending work.

After changing settings or permissions, edit the input or enter translation mode again to refresh completed suggestions.

## Language shortcuts

Language-code prefixes are optional overrides for one translation. Ordinary text continues to use your saved choices.

| Input | Override |
| --- | --- |
| `t fr Hello world` | Translates to French using your saved source language. |
| `t en>fr Hello world` | Translates from English to French. |

Settings also let you choose preferred regional variants, such as mapping `zh` to `zh-TW`.

## Providers and fallback

Enable the providers you allow to receive text, then drag them into order. The first eligible provider is tried first. A provider missing permission or required credentials is skipped with a warning. If an attempt fails, the next enabled provider may receive the same text.

Each eligible provider is attempted once, sequentially. An attempt has up to four seconds, including reading its response, within a ten-second total budget. A timeout cancels that attempt and leaves the remaining time for later enabled providers.

Disabling every provider pauses translation and preserves that choice across browser restarts. Disabling Google or DeepL releases its domain access. Access grants apply to this device; synced provider choices may need another grant on a different device.

### Google Translate Web

Google uses its mobile web page and requires no API key. That page can redirect to a human-verification or consent page. The extension stops redirects and reports a service failure. Granting translation-host access does not guarantee that Google will serve a translation on the current network.

### Lingva

Lingva is a public Google Translate proxy that requires no API key. Its availability varies. It currently needs no extension host permission because its API supports cross-origin requests.

### DeepL

DeepL uses its official API and your own key. You can enable it before entering a key. Enabling requests access to both `api-free.deepl.com` and `api.deepl.com`, regardless of subscription plan.

Saving a key trusts your input and does not send a test request. The optional **Test** button uses DeepL's authenticated [usage endpoint](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits). Testing is available with a supplied key while DeepL is enabled and permitted. A failed test leaves it enabled and eligible for later translation attempts with a supplied key.

Rejected credentials produce an error or fallback warning during translation or an explicit test.

## Warnings and settings actions

When a settings problem blocks translation, pressing Enter on the error opens settings. Missing domain access, missing credentials, invalid credentials, and an empty provider selection are settings problems.

When another enabled provider succeeds, its translation stays primary. A separate warning can offer a settings action for the provider that needs attention. Temporary network and service failures remain errors; Enter on those errors leaves the clipboard unchanged.

A failed translation or unsuccessful copy leaves the clipboard unchanged. Cancelling a request cannot undo text already received by a provider or any resulting provider charges.

## Permissions and privacy

Only `storage` is required at installation.

| Feature | Optional access |
| --- | --- |
| Google Translate Web | `https://translate.google.com/*` |
| DeepL | Both `https://api-free.deepl.com/*` and `https://api.deepl.com/*` |
| Enter to copy | `clipboardWrite` and `offscreen`, requested together |

Clipboard access allows writing translations. The extension does not read your clipboard. Turning off **Enter to copy** releases its two permissions and closes the offscreen document used for copying.

Translation requests go directly to enabled providers. A fallback may send the same text to each enabled provider reached in your chosen order. API keys go to their corresponding provider for translation and explicit tests. Each provider's own data-handling terms apply to those requests.

The extension collects no usage analytics and creates no analytics identity. Production logs exclude translation text, results, credentials, and provider response bodies. The maintainer uses Chrome Web Store reporting outside the extension.

### API key storage

Settings sync across your Chrome instances. API keys default to local storage, and each device independently chooses **Local** or **Sync** under **API Key Storage**.

- **Sync** copies this device's keys into shared storage. It preserves keys for other providers already there; this device's key takes precedence for the same provider. The local copies are then removed.
- **Local** copies shared keys to this device and keeps the shared copy available to other devices.

> [!IMPORTANT]
> Both local and synced extension storage hold readable API keys. Choose syncing only if you want Chrome to share those credentials across your signed-in Chrome instances.

[Back to the README](../README.md)
