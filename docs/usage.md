# Using Bar Translator

Bar Translator translates text from the address bar in desktop Chrome, Firefox, and Microsoft Edge. Set your usual source and target languages once, then type ordinary text to use them. Safari is unsupported because it lacks the required extension address-bar API.

Firefox displays a stable instruction in the default address-bar row and the completed translation in a suggestion below it. Wait until that result appears before pressing Enter. Selecting the translation row also copies it when copying is enabled. Firefox's default row cannot refresh asynchronously, so it does not show changing loading text or post-copy success/failure text; Chrome and Edge retain their default-row preview.

## First-time setup

Settings open in a dedicated tab after a new installation. You can reopen them through the extension's options in your browser.

1. Choose a source and target language. **Auto-detect** is available as a source choice.
2. Google Web, Lingva, DeepL and LibreTranslate appear together in the translation-priority list. Only Google Web is enabled in a new setup. Use **Configure** on a provider's row to set it up there, or **Add instance** on a DeepL or LibreTranslate row for another configuration. Saving keeps a new instance disabled, and cancelling discards the draft.
3. Enable the saved instances you allow to receive your text. For a custom LibreTranslate server, use **Connect**. Grant the requested domain access when prompted.
4. Reorder enabled instances into your preferred sequence.
5. Optionally enable **Enter to copy** and grant clipboard access.

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

## Providers, instances and fallback

An instance is one configuration of a translation provider. LibreTranslate and DeepL support multiple instances with custom names. Google Web and Lingva each have one configuration and use their fixed provider name.

Enable only the instances you allow to receive text, then reorder them. The first eligible instance is tried first. Missing permission or required credentials causes a warning and skips that instance. If an attempt fails, the next enabled instance may receive the same text. For example, an enabled managed service after a local server may receive text when that local server fails.

Each eligible instance is attempted once, sequentially. An attempt has up to four seconds, including permission checks and reading its response, within a ten-second total budget. A timeout cancels that attempt and leaves the remaining time for later enabled instances. Adding instances does not extend the total budget, so later entries may not be reached.

Disabling every instance pauses translation and preserves that choice across browser restarts. Disabling or deleting an instance releases access that no other enabled instance needs. Browser host grants can cover several endpoints on the same host, even on different ports or paths. Synced instance selections may need another grant on a different device.

### Google Translate Web

Google Web uses Google's keyless web JSON endpoint at `translate.googleapis.com`. It remains a best-effort integration whose availability and rate limits can change. Rate limits, redirects and invalid responses produce a failure or fallback warning; the extension never treats an unsuccessful response as a translation.

Users upgrading from the former mobile endpoint must allow access to `translate.googleapis.com` in settings. The earlier `translate.google.com` grant does not cover this address. No browser cookies or account session are used.

### Lingva

Lingva is a public Google Translate proxy that requires no API key. Its availability varies. It currently needs no extension host permission because its API supports cross-origin requests.

### DeepL

DeepL uses its official API and your own key. Add named instances for separate accounts or tiers. You can enable an instance before entering a key. Enabling requests access to both `api-free.deepl.com` and `api.deepl.com`, regardless of subscription plan.

Saving a key trusts your input and does not send a test request. The optional **Test** button uses DeepL's authenticated [usage endpoint](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits). Testing is available with a supplied key while DeepL is enabled and permitted. A failed test leaves it enabled and eligible for later translation attempts with a supplied key.

Rejected credentials produce an error or fallback warning during translation or an explicit test.

### LibreTranslate

Choose LibreTranslate from the same provider list as the other services, then create a named configuration for the managed service or a custom server. The managed preset uses `https://libretranslate.com` and requires your own API key. A custom server can require a key or allow access without one, depending on its operator's configuration. Saving creates a disabled instance and makes no network request.

Custom base URLs support ports and path prefixes, for example `http://localhost:5000`, `http://192.168.1.20:5000`, or `https://translate.example/libre/`. Enter the base URL, not the `/translate` API path. HTTP sends text and any API key without encryption; the settings show a warning. The server must be reachable from this computer, and HTTPS certificates must be trusted by the browser.

When editing a saved instance, save a changed endpoint before entering its new key. Changing the endpoint clears its previous key so credentials are not sent to a different server unintentionally. A rename keeps the same instance and credentials.

**Connect** first requests access to the configured host, then checks that server's connection during setup without sending translation text or an API key. It enables the selected instance after host access is allowed. A connection failure shows a warning and keeps your configuration; it does not invalidate the key or silently disable the instance. Approve local-network access for your browser if prompted, then use **Test** to try again.

Your operating system may control local-network access for the whole browser separately from the extension's host grant. For example, [macOS can prompt on the first local-network operation](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), and that initial operation can fail while the prompt is being answered. Connect makes that first contact an explicit setup action. The extension cannot grant this OS permission itself. Browser website local-network prompts are a separate mechanism; the [Chrome extension path uses its host permissions](https://developer.chrome.com/blog/local-network-access).

The optional test checks the server's advertised languages and sends a fixed sample translation. It requires an enabled instance with browser access. Saving a URL or key does not run a test, and a failed test does not disable the instance. Language/model availability and text limits vary by server; an instance-specific limitation can advance to the next enabled instance.

## Warnings and settings actions

When a settings problem blocks translation, pressing Enter on the error opens settings. Missing domain access, missing credentials, invalid credentials, and an empty provider selection are settings problems.

When another enabled provider succeeds, its translation stays primary. A separate warning can offer a settings action for the provider that needs attention. Temporary network and service failures remain errors; Enter on those errors leaves the clipboard unchanged.

A failed translation or unsuccessful copy leaves the clipboard unchanged. Cancelling a request cannot undo text already received by a provider or any resulting provider charges.

## Permissions and privacy

Only `storage` is required at installation.

| Feature | Optional access |
| --- | --- |
| Google Translate Web | `https://translate.googleapis.com/*` |
| DeepL | Both `https://api-free.deepl.com/*` and `https://api.deepl.com/*` |
| LibreTranslate | The configured HTTP(S) host, requested when enabling, connecting or repairing access |
| Enter to copy in Chrome/Edge | `clipboardWrite` and `offscreen`, requested together |
| Enter to copy in Firefox | `clipboardWrite` |

Clipboard access allows writing translations. The extension does not read your clipboard. The **Enter to copy** preference is saved separately from browser permission, so a synced enabled preference may show that access is needed on this device. Both the preference and permission are required to copy. Turning the preference off releases local clipboard access. Chrome and Edge also release the offscreen permission and close the document used for copying; Firefox copies from its background document.

Firefox's installation consent declares translation text and authentication information because enabled providers receive your text and, where required, your supplied API key. This does not enable analytics or grant provider host access. You still choose providers and whether to supply credentials.

Translation requests go directly to enabled providers. A fallback may send the same text to each enabled provider reached in your chosen order. API keys go to their corresponding provider for translation and explicit tests. Each provider's own data-handling terms apply to those requests.

The extension collects no usage analytics and creates no analytics identity. Production logs exclude translation text, results, credentials, and provider response bodies. The maintainer uses Chrome Web Store reporting outside the extension.

### Settings storage

Each device chooses one **Local** or **Sync** setting for the complete setup: language preferences, instances and names, endpoints, keys, enabled order and copy preference. New installations default to Local. Browser grants and the Local/Sync choice itself remain device-local.

- **Local** keeps the active setup on this device.
- **Sync** uses your browser's shared setup. Browser account synchronization must be enabled; this does not synchronize across Chrome, Firefox and Edge, and offline changes may arrive later.
- If the destination already contains a different setup, choose whether to use it or replace it with the current setup. The extension does not silently merge them. Until the choice succeeds, the current setup remains active. Failed saves can be retried.
- Choosing Local does not erase the shared setup used by other devices.

> [!IMPORTANT]
> Both local and synced extension storage hold readable API keys. Choose syncing only if you want your browser to share the whole configuration, including those credentials. A localhost or LAN address can identify a different service on another computer.

### Upgrading an existing setup

The one-time migration preserves your current values, enabled order, disabled state, active credentials and Local/Sync selection. Existing Local users' language and order settings become local too. The copy preference starts from this device's existing clipboard access.

Older extension versions continue using their old records. Edits are not exchanged between old and upgraded versions; legacy records are retained for recovery. If migration finds a different saved setup, settings offer the same explicit use/replace choice while the current translation setup remains usable.

## Browser builds

For a local installation, use the Node/pnpm versions declared by the repository, install dependencies, and build your browser target:

```bash
pnpm install --frozen-lockfile
pnpm build          # Chrome 116+
pnpm build:firefox  # Firefox 140+
pnpm build:edge     # Edge 116+
```

In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, enable developer mode, and load `.output/chrome-mv3` or `.output/edge-mv3` as an unpacked extension. In Firefox, open **about:debugging → This Firefox → Load Temporary Add-on** and select `.output/firefox-mv3/manifest.json`.

Firefox temporary installations last until browser restart. Permanent installation in release Firefox requires Mozilla signing; building or packaging does not sign or publish an add-on. Preserve the stable add-on ID `bar-translator@oovz` across upgrades so saved settings keep their identity.

[Back to the README](../README.md)
