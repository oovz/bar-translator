<img src="public/icons/icon-128.png" width="64" alt="Bar Translator logo" />

# Bar Translator

Translate in your browser's address bar and keep your page in view. Type your text, read the translation, and optionally press Enter to copy it.

[![Available in the Chrome Web Store](https://user-images.githubusercontent.com/22908993/166417152-f870bfbd-1770-4c28-b69d-a7303aebc9a6.png)](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)

[User guide](docs/usage.md)

Desktop builds are available for **Chrome, Firefox, and Microsoft Edge**. Firefox and Edge can be built locally using the [browser setup instructions](docs/usage.md#browser-builds). Safari is unsupported because it does not provide the extension address-bar API this workflow needs.

![Bar Translator: translate in your address bar](assets/chrome-web-store/marquee-1400x560.png)

## Translate with the languages you use

1. Choose your source and target languages in settings, then enable your preferred translation instances. Settings open when you first install the extension.
2. Focus the address bar with **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS. Type **`t`**, then **Space**.
3. Enter your text. The preview uses your saved languages.

For example, `t Hello world` translates “Hello world” to your saved target language. Choose **Auto-detect** as the source language if you want the provider to identify it.

Enable **Enter to copy** in settings to copy a completed translation with Enter. Optional language prefixes let you change languages for one translation; the [user guide](docs/usage.md#language-shortcuts) has examples.

## Small by design

- Read translations while your current page stays open.
- Keep the translation separate from copy instructions, warnings, and settings actions.
- Choose which translation instances receive your text and the order in which they are tried.
- Grant provider and clipboard access when you enable those features. Only the storage API permission is required at installation; Firefox also declares transmission of translation text and credentials to your chosen providers.

Fallback follows your chosen instance order, with status messages alongside the translation preview. LibreTranslate and DeepL support multiple configurations with custom names; Google Web and Lingva each use one configuration with their fixed provider name.

## Privacy you can understand

Bar Translator collects no usage analytics. Translation requests go directly to the providers you enable. Production logs exclude translation text and API keys.

All settings and API keys are stored locally by default. Each device can choose to sync the whole setup, including languages, instances, API keys, fallback order and copy preference. Browser permissions still need to be granted on each device. Read the [permissions and storage guide](docs/usage.md#permissions-and-privacy) for details.

> [!WARNING]
> API keys, tokens, and other credentials you save are stored as plain text in your browser profile. Anyone who gains access to that profile may be able to read and use them without your permission.

## Choose your translation providers

| Provider | What to expect |
| --- | --- |
| Google Translate Web | Uses Google's keyless web JSON endpoint. Availability and rate limits can vary. |
| Lingva | A public Google Translate proxy without an API key. |
| DeepL | Uses the official API with your own API key. Add named instances for different keys or tiers. Testing is optional. |
| LibreTranslate | Use the managed service or your own HTTP(S) server, including localhost and LAN deployments. Add multiple named instances with separate URLs and keys. |

## Run locally

Use Node.js 24.15+ (24.x) and pnpm 12.14.0:

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

See the [browser setup instructions](docs/usage.md#browser-builds) to build and install each supported desktop target.
