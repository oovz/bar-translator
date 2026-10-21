<img src="public/icons/icon-128.png" width="64" alt="Bar Translator logo" />

# Bar Translator

Translate in Chrome's address bar and keep your page in view. Type your text, read the translation, and optionally press Enter to copy it.

[![Available in the Chrome Web Store](https://user-images.githubusercontent.com/22908993/166417152-f870bfbd-1770-4c28-b69d-a7303aebc9a6.png)](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)

[User guide](docs/usage.md) · [Development and testing](docs/testing.md)

![Bar Translator: translate in your address bar](assets/chrome-web-store/marquee-1400x560.png)

## Translate with the languages you use

1. Choose your source and target languages in settings, then enable your preferred translation providers. Settings open when you first install the extension.
2. Focus the address bar with **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS. Type **`t`**, then **Space**.
3. Enter your text. The preview uses your saved languages.

For example, `t Hello world` translates “Hello world” to your saved target language. Choose **Auto-detect** as the source language if you want the provider to identify it.

Enable **Enter to copy** in settings to copy a completed translation with Enter. Optional language prefixes let you change languages for one translation; the [user guide](docs/usage.md#language-shortcuts) has examples.

## Small by design

- Read translations while your current page stays open.
- Keep the translation separate from copy instructions, warnings, and settings actions.
- Choose which providers receive your text and the order in which they are tried.
- Grant provider and clipboard access when you enable those features. Only extension storage is required at installation.

Fallback follows your chosen provider order, with status messages alongside the translation preview.

## Privacy you can understand

Bar Translator collects no usage analytics. Translation requests go directly to the providers you enable. Production logs exclude translation text and API keys.

API keys are stored locally by default. You can choose key syncing separately on each device. Read the [permissions and storage guide](docs/usage.md#permissions-and-privacy) for details.

## Choose your translation providers

| Provider | What to expect |
| --- | --- |
| Google Translate Web | Uses Google's mobile page without an API key. |
| Lingva | A public Google Translate proxy without an API key. |
| DeepL | Uses the official API with your own API key. Testing the key is optional. |

## Run locally

Use Node.js 24.15+ (24.x) and pnpm 12.14.0:

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

See [development and testing](docs/testing.md) for checks, browser coverage, and manual verification.
