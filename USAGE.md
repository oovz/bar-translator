# Using Bar Translator

Bar Translator brings quick translations to your browser's address bar, so you can stay on the page you're viewing. It works in desktop Chrome, Firefox, and Microsoft Edge. Safari doesn't provide the address-bar feature the extension needs.

This guide describes the version built from this repository. If your installed extension looks different, find its version in your browser's extension settings, then open its tag from the [releases](https://github.com/oovz/bar-translator/releases) and look for the usage guide in that release's source.

In Firefox, look for the finished translation below the instruction row. Wait for it before pressing Enter, or select the translation row to copy it when copying is on. The top row stays as instructions; it doesn't show loading progress or copy confirmations. Chrome and Edge show the preview in the top row.

## First-time setup

Settings open in a new tab when you first install Bar Translator. You can always come back by opening the extension's options in your browser.

1. Pick your source and target languages. If you'd like the provider to identify the source language, choose **Auto-detect**.
2. Choose a translation service. Google Web is already active in a new setup; to use it, select **Grant access** on its row and allow the browser request. You'll find Lingva, DeepL, and LibreTranslate under **Available providers**.
   - Choose **Add** beside Google Web or Lingva to activate that fixed provider. Your browser may ask for access. If access is denied, the fixed provider is not saved; choose **Add** again to retry.
   - Choose **Add** beside DeepL or LibreTranslate to open an editor. Choose **Add and enable** to save and request access, or **Save for later** to keep the configuration inactive. If access is denied, the saved configuration stays inactive so you can retry.
3. For DeepL and LibreTranslate, use **Enable** and **Disable** to turn a saved configuration on or off. Use **Grant access** if an active service is missing browser permission. Google Web and Lingva have no separate switch: adding one activates it, and **Delete** removes it.
4. Drag **Activated instances** or use the arrow buttons to pick the order in which they're tried.
5. Want to copy translations? Turn on **Enter to copy** and allow clipboard access.

Opening an editor or saving a draft for later does not activate a service. **Add and enable** saves and activates it; **Save for later** keeps it under **Available providers**. Inactive DeepL and LibreTranslate configurations stay under **Available providers** with their saved order. Fixed providers appear there only when they are not active. **Delete** asks for confirmation before removing a configuration.

You can cancel an unfinished draft to discard it. After saving a configuration, choose **Add another** to create another DeepL or LibreTranslate instance. Save any edits before changing a service's activation.

Updates do not reopen settings automatically. If a provider needs access or a key, a message appears alongside the translation preview.

## Translate ordinary text

Press **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS to jump to the address bar. Type `t`, press Space, then enter your text.

| Input | Translation |
| --- | --- |
| `t Hello world` | Uses your saved source and target languages. |

The preview starts after a short pause in typing (300 ms). You can keep editing while it loads. Once it's ready, you'll see the translation along with any copy action, provider warnings, or settings that need attention.

Wait until the result is ready before pressing Enter. With **Enter to copy** on and clipboard access allowed, Enter copies the finished translation. You can also choose the separate copy action. If copying is off, you can still read translations; Enter leaves your clipboard as it is.

> [!NOTE]
> Pressing Enter before the result is ready ends the interaction and cancels the request without changing your clipboard. Editing or clearing your text also cancels the pending translation.

After changing settings or allowing access, edit your text or start translation mode again to refresh the suggestions.

## Language shortcuts

For a one-time language change, add a language code before your text. Your saved language choices stay the same.

| Input | Override |
| --- | --- |
| `t fr Hello world` | Translates to French using your saved source language. |
| `t en>fr Hello world` | Translates from English to French. |

You can also pick regional language preferences in settings, such as using `zh-TW` whenever you enter `zh`.

💡 If your text starts with a two-letter word made of A–Z letters, the extension reads it as a target language code. For example, `t It is late` treats `It` as Italian. To include the whole phrase, put your target code first: `t fr It is late`. The same trick works for a two-letter phrase, such as `t fr hi`.

## Providers, instances, and fallback

An instance is a saved setup for a provider. For example, you can give separate DeepL accounts or LibreTranslate servers their own names. Google Web and Lingva each have one setup, using their provider name. Adding one activates it; deleting its row removes it.

Bar Translator tries your active instances in order. It skips one that needs access or a key and shows a warning. If one can't translate, the next may receive the same text. For example, a managed service placed after your local server may receive text if that server fails. Activate only the instances you're comfortable sending text to.

Each instance is tried once. Each try has up to four seconds, including access checks and receiving the result. All tries share a ten-second limit, so later instances may not be reached if time runs out.

Translation pauses when no instances are active, even after a browser restart. To pause it, remove Google Web and Lingva and disable or remove any DeepL and LibreTranslate instances. Turning off or deleting an instance removes browser access that no other active instance needs. Instances on the same host can share access, even if their ports or paths differ. On another device, your browser may ask you to allow access again.

### Google Translate Web

Google Web translates through `translate.googleapis.com` without an API key, browser cookies, or a Google account session. Availability and rate limits can change. If it is blocked or returns an unusable response, you see an error. If another active instance succeeds, its translation appears with a warning about Google Web.

If you previously allowed `translate.google.com`, open settings and allow access to `translate.googleapis.com`. The earlier permission does not cover the new address.

### Lingva

Lingva is a public Google Translate proxy that works without an API key. Its availability varies. It currently works without an extra browser access prompt because the service allows requests from other sites and extensions.

### DeepL

DeepL uses the official API with your own key. Add named instances for different accounts or API plans. You can activate an instance before adding its key, but it needs a key to translate. Activation asks for access to both `api-free.deepl.com` and `api.deepl.com`, whichever plan you use.

Saving a key does not contact DeepL. To check a saved account, activate it, allow access, then choose **Test**. This optional check reads your [DeepL account usage](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits). In the add editor, **Test** checks the current values without saving or enabling the account and releases the access it requested.

An unsuccessful test leaves the instance active, so it can be tried again when translating. If DeepL rejects the key, the translation or test shows an error or fallback warning.

### LibreTranslate

Choose **Add** or **Add another** beside LibreTranslate and name your instance. Use the managed service at `https://libretranslate.com` with your own API key, or enter a custom server. A custom server may work with or without a key, depending on how its operator set it up. **Save for later** keeps a new instance turned off and does not contact the server; saving edits preserves its existing on/off state.

Enter the server's base address, such as `http://localhost:5000`, `http://192.168.1.20:5000`, or `https://translate.example/libre/`. Leave off the `/translate` API path. The server must be reachable from this computer, and your browser must trust its HTTPS certificate. HTTP sends text and any key without encryption; settings show a warning when you use it.

Changing a saved server address clears its old key to avoid sending it to a different server. Save the new address before entering a new key. Renaming an instance keeps its key and other settings.

Enabling an existing custom server with **Enable**, or repairing its missing permission with **Grant access**, allows browser access and checks the server's connection. This first check sends no translation text or API key. Once access is allowed, the instance is active. If the check fails, a warning appears and your settings stay saved; the instance stays active and its key is not marked invalid. Allow local-network access if prompted, then choose **Test** to try again.

Your computer may ask separately whether the browser can access the local network. For example, [macOS may ask on the first connection](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), which can fail while you answer the prompt. The connection check lets you handle this during setup. The extension cannot approve it for you. Website permissions are separate; [Chrome extensions use their own host permissions](https://developer.chrome.com/blog/local-network-access).

**Add and enable** requests browser access without probing the server. Use the explicit **Test** action when you are ready to make contact. The optional **Test** checks supported languages and sends a fixed sample for translation. In the add editor, it checks the current values and releases the access it requested when the configuration remains unsaved or disabled; it does not save or enable the instance. For a saved server, enable it and allow access before choosing **Test**. Saving an address or key does not run a test, and a failed test does not turn the instance off. Servers differ in their languages, models, and text limits; if one cannot handle your request, the next active instance may be tried.

## Warnings and settings actions

If translation is blocked by missing access, a missing or rejected key, or no active instances, press Enter on the error to open settings and take a look.

When another instance succeeds, its translation stays as the main result. A separate warning may let you open settings for the instance that needs attention. Temporary network or service errors do not open settings when you press Enter, and leave your clipboard unchanged.

A failed translation or copy leaves your clipboard unchanged. Cancelling a request cannot recall text already sent to a provider or undo any charges it has incurred.

## Permissions and privacy

At installation, the extension requires only `storage` access. Other access is requested when you turn on the feature that needs it.

| Feature | Optional access |
| --- | --- |
| Google Translate Web | `https://translate.googleapis.com/*` |
| DeepL | Both `https://api-free.deepl.com/*` and `https://api.deepl.com/*` |
| LibreTranslate | The configured HTTP(S) host, requested when enabling, testing, or repairing access |
| Enter to copy in Chrome/Edge | `clipboardWrite` and `offscreen`, requested together |
| Enter to copy in Firefox | `clipboardWrite` |

Clipboard access lets the extension copy translations; it does not read your clipboard. Copying needs both **Enter to copy** and browser permission. If you sync the setting to another device, you may still need to allow access there. Turning copying off releases the clipboard permissions on that device.

Firefox's installation notice mentions translation text and authentication information because your chosen providers receive your text and any key they require. You still choose the providers, supply the keys, and allow access separately. This notice does not enable analytics.

Your text goes directly to the active instances that are tried, in the order you've chosen. If several are tried, each may receive the same text. API keys go to their corresponding provider for translation and tests you choose to run. Each provider's own privacy terms apply.

Bar Translator collects no usage analytics and does not create an analytics identity. Its production logs exclude your text, translations, credentials, and the contents of provider responses. The maintainer uses Chrome Web Store reporting separately from the extension.

### Settings storage

Choose **Local** or **Sync** for your whole setup: languages, named instances, server addresses, keys, translation order, and copying preference. New installations start with Local. Each device keeps its own storage choice and browser permissions.

> [!WARNING]
> API keys, tokens, and other credentials you save are stored as plain text in your browser profile. Anyone who gains access to that profile may be able to read and use them without your permission.

- **Local** keeps the setup you are using on this device.
- **Sync** shares the whole setup, including credentials, through your browser account. Browser sync must be on. Chrome, Firefox, and Edge do not sync with one another, and offline changes may take time to arrive.
- If a different setup is already saved in the destination, choose to use it or replace it with your current setup. The two are not merged. Your current setup stays active until the change succeeds, and you can retry a failed save.
- Switching to Local does not erase the earlier Sync copy that other devices may use.

> [!IMPORTANT]
> Choose Sync only if you want to share your credentials along with your settings. A localhost or LAN address may point to a different service on another computer.

### Upgrading an existing setup

The upgrade keeps your languages, instances, order, active credentials, and Local/Sync choice, including any instances you turned off. If you already use Local, your languages and translation order become local too. The initial copy setting follows this device's existing clipboard permission.

Older versions keep their own settings, so changes do not pass between old and upgraded installations. Old records, including credentials, are kept for recovery. If the upgrade finds a different saved setup, you can choose which one to use; translation keeps working with your current setup while you decide.

## Browser builds

To install a local build, use Node.js 24.15 or later in the 24.x series and pnpm 12.14.0. Install dependencies, then build for your browser:

```bash
pnpm install --frozen-lockfile
pnpm build          # Chrome 116+
pnpm build:firefox  # Firefox 140+
pnpm build:edge     # Edge 116+
```

In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, turn on developer mode, and load `.output/chrome-mv3` or `.output/edge-mv3` as an unpacked extension. In Firefox, open **about:debugging → This Firefox → Load Temporary Add-on** and select `.output/firefox-mv3/manifest.json`.

Firefox removes temporary installations when you restart the browser. Permanent installation in release Firefox requires Mozilla signing; a local build is not signed or published automatically. Keep the add-on ID `bar-translator@oovz` unchanged across upgrades so the browser recognizes its saved settings.

[Back to the README](README.md)
