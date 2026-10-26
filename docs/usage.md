# Using Bar Translator

Bar Translator lets you translate from the address bar in desktop Chrome, Firefox, and Microsoft Edge. Choose your usual languages once, then type text to translate while keeping your current page open. Safari does not support the address-bar feature the extension needs.

In Firefox, look for the finished translation below the top instruction row. Wait for it to appear before pressing Enter, or select the translation row to copy it when copying is enabled. The top row stays as instructions; it does not show loading progress or copy confirmations. Chrome and Edge show the preview in their top row.

## First-time setup

Settings open in a new tab when you first install Bar Translator. To return later, open the extension's options in your browser.

1. Choose your source and target languages. Use **Auto-detect** if you want the provider to identify the source language.
2. Choose your translation services. Only Google Web is active in a new setup. Lingva, DeepL and LibreTranslate appear under **Available providers**. For DeepL or LibreTranslate, choose **Configure**, fill in the details, and save.
3. Activate the saved instances you want to use. Choose **Grant access** if an active instance needs permission, or **Connect** for a custom LibreTranslate server. Allow access when your browser asks.
4. Drag **Activated instances** or use their arrow buttons to choose which one is tried first.
5. Turn on **Enter to copy** if you want to copy translations, and allow clipboard access.

Configuring an instance does not activate it. You can cancel an unfinished draft or use **Add instance** to save another DeepL or LibreTranslate configuration. Saved instances that are turned off stay under **Available providers**. Save any edits before changing an instance's activation.

Updates do not reopen settings automatically. If a provider needs access or a key, a message appears alongside the translation preview.

## Translate ordinary text

Press **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS to focus the address bar. Type `t`, press Space, then enter your text.

| Input | Translation |
| --- | --- |
| `t Hello world` | Uses your saved source and target languages. |

A translation preview starts after a 300 ms pause in typing. While it loads, you can keep editing your text. The finished translation appears with separate suggestions for copying, provider warnings, or settings that need attention.

Wait for the result before pressing Enter. With **Enter to copy** on, pressing Enter on the finished translation copies it. You can also choose the separate copy action. With copying off, you can still read translations; Enter leaves your clipboard unchanged.

> [!NOTE]
> Pressing Enter before the result is ready ends the interaction and cancels the request without changing your clipboard. Editing or clearing your text also cancels the pending translation.

After changing settings or allowing access, edit your text or start translation mode again to refresh the suggestions.

## Language shortcuts

To change languages for one translation, add a language code before your text. Your saved language choices stay the same.

| Input | Override |
| --- | --- |
| `t fr Hello world` | Translates to French using your saved source language. |
| `t en>fr Hello world` | Translates from English to French. |

You can also choose regional language preferences in settings, such as using `zh-TW` whenever you enter `zh`.

## Providers, instances and fallback

An instance is a saved configuration of a provider. For example, you can keep separate DeepL accounts or LibreTranslate servers under names you choose. Google Web and Lingva each have one configuration, with their provider name.

Bar Translator tries your activated instances in order. It skips an instance that needs access or a key and shows a warning. If one cannot translate, the next may receive the same text. For example, a managed service placed after your local server may receive text when that server fails. Activate only the instances you are comfortable sending text to.

Each instance is tried once. Each try has up to four seconds, including access checks and receiving the result. All tries share a ten-second limit, so later instances may not be reached if time runs out.

Turning off every instance pauses translation, including after a browser restart. Turning off or deleting an instance removes browser access that no other active instance needs. Instances on the same host can share access, even if their ports or paths differ. On another device, your browser may ask you to allow access again.

### Google Translate Web

Google Web translates through `translate.googleapis.com` without an API key, browser cookies, or a Google account session. Availability and rate limits can change. If it is blocked or returns an unusable response, you see an error. If another active instance succeeds, its translation appears with a warning about Google Web.

If you previously allowed `translate.google.com`, open settings and allow access to `translate.googleapis.com`. The earlier permission does not cover the new address.

### Lingva

Lingva is a public Google Translate proxy that works without an API key. Its availability varies. It currently works without an extra browser access prompt because the service allows requests from other sites and extensions.

### DeepL

DeepL uses the official API with your own key. Add named instances for different accounts or API plans. You can activate an instance before adding its key, but it needs a key to translate. Activation asks for access to both `api-free.deepl.com` and `api.deepl.com`, whichever plan you use.

Saving a key does not contact DeepL. To check it, activate the instance, allow access, then choose **Test**. This optional check reads your [DeepL account usage](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits).

An unsuccessful test leaves the instance active, so it can be tried again when translating. If DeepL rejects the key, the translation or test shows an error or fallback warning.

### LibreTranslate

Choose **Configure** beside LibreTranslate and name your instance. Use the managed service at `https://libretranslate.com` with your own API key, or enter a custom server. A custom server may work with or without a key, depending on how its operator set it up. Saving keeps the instance turned off and does not contact the server.

Enter the server's base address, such as `http://localhost:5000`, `http://192.168.1.20:5000`, or `https://translate.example/libre/`. Leave off the `/translate` API path. The server must be reachable from this computer, and your browser must trust its HTTPS certificate. HTTP sends text and any key without encryption; settings show a warning when you use it.

Changing a saved server address clears its old key to avoid sending it to a different server. Save the new address before entering a new key. Renaming an instance keeps its key and other settings.

Choose **Connect** to allow browser access and check the server's connection. This first check sends no translation text or API key. Once access is allowed, the instance is active. If the check fails, a warning appears and your settings stay saved; the instance stays active and its key is not marked invalid. Allow local-network access if prompted, then choose **Test** to try again.

Your computer may ask separately whether the browser can access the local network. For example, [macOS may ask on the first connection](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), which can fail while you answer the prompt. Connect lets you handle this during setup. The extension cannot approve it for you. Website permissions are separate; [Chrome extensions use their own host permissions](https://developer.chrome.com/blog/local-network-access).

The optional **Test** checks supported languages and sends a fixed sample for translation. It needs an active instance with browser access. Saving an address or key does not run it, and a failed test does not turn the instance off. Servers differ in their languages, models, and text limits; if one cannot handle your request, the next active instance may be tried.

## Warnings and settings actions

If translation is blocked by missing access, a missing or rejected key, or no active instances, press Enter on the error to open settings.

When another instance succeeds, its translation stays as the main result. A separate warning may let you open settings for the instance that needs attention. Temporary network or service errors do not open settings when you press Enter, and leave your clipboard unchanged.

A failed translation or copy leaves your clipboard unchanged. Cancelling a request cannot recall text already sent to a provider or undo any charges it has incurred.

## Permissions and privacy

At installation, the extension requires only `storage` access. Other access is requested when you turn on the feature that needs it.

| Feature | Optional access |
| --- | --- |
| Google Translate Web | `https://translate.googleapis.com/*` |
| DeepL | Both `https://api-free.deepl.com/*` and `https://api.deepl.com/*` |
| LibreTranslate | The configured HTTP(S) host, requested when enabling, connecting or repairing access |
| Enter to copy in Chrome/Edge | `clipboardWrite` and `offscreen`, requested together |
| Enter to copy in Firefox | `clipboardWrite` |

Clipboard access lets the extension copy translations; it does not read your clipboard. Copying needs both **Enter to copy** and browser permission. If you sync the setting to another device, you may still need to allow access there. Turning copying off releases the clipboard permissions on that device.

Firefox's installation notice mentions translation text and authentication information because your chosen providers receive your text and any key they require. You still choose the providers, supply the keys, and allow access separately. This notice does not enable analytics.

Your text goes directly to the active instances tried in your chosen order. If several are tried, each may receive the same text. API keys go to their corresponding provider for translation and tests you choose to run. Each provider's own privacy terms apply.

Bar Translator collects no usage analytics and does not create an analytics identity. Its production logs exclude your text, translations, credentials, and the contents of provider responses. The maintainer uses Chrome Web Store reporting separately from the extension.

### Settings storage

Choose **Local** or **Sync** for your whole setup: languages, named instances, server addresses, keys, translation order, and copying preference. New installations use Local. Each device keeps its own storage choice and browser permissions.

> [!WARNING]
> API keys, tokens, and other credentials you save are stored as plain text in your browser profile. Anyone who gains access to that profile may be able to read and use them without your permission.

- **Local** keeps the setup you are using on this device.
- **Sync** shares the whole setup, including credentials, through your browser account. Browser sync must be on. Chrome, Firefox and Edge do not sync with one another, and offline changes may take time to arrive.
- If a different setup is already saved in the destination, choose to use it or replace it with your current setup. The two are not merged. Your current setup stays active until the change succeeds, and you can retry a failed save.
- Switching to Local does not erase the earlier Sync copy that other devices may use.

> [!IMPORTANT]
> Choose Sync only if you want to share your credentials along with your settings. A localhost or LAN address may point to a different service on another computer.

### Upgrading an existing setup

The upgrade keeps your languages, instances, order, active credentials, and Local/Sync choice, including any instances you turned off. If you already use Local, your languages and translation order become local too. The initial copy setting follows this device's existing clipboard permission.

Older versions keep their own settings, so changes do not pass between old and upgraded installations. Old records, including credentials, are kept for recovery. If the upgrade finds a different saved setup, you can choose which one to use; translation keeps working with your current setup while you decide.

## Browser builds

To install a local build, use the repository's Node/pnpm versions, install dependencies, then build for your browser:

```bash
pnpm install --frozen-lockfile
pnpm build          # Chrome 116+
pnpm build:firefox  # Firefox 140+
pnpm build:edge     # Edge 116+
```

In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, turn on developer mode, and load `.output/chrome-mv3` or `.output/edge-mv3` as an unpacked extension. In Firefox, open **about:debugging → This Firefox → Load Temporary Add-on** and select `.output/firefox-mv3/manifest.json`.

Firefox removes temporary installations when you restart the browser. Permanent installation in release Firefox requires Mozilla signing; a local build is not signed or published automatically. Keep the add-on ID `bar-translator@oovz` unchanged across upgrades so the browser recognizes its saved settings.

[Back to the README](../README.md)
