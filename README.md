<img src="public/icons/icon-128.png" width="64" alt="Bar Translator logo" />

# Bar Translator

Translate in Chrome's address bar and keep your page in view. Type your text, read the translation, and optionally press Enter to copy it.

**[Add Bar Translator to Chrome](https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno)** · [User guide](docs/usage.md) · [Development and testing](docs/testing.md)

![Bar Translator: translate in your address bar](assets/chrome-web-store/marquee-1400x560.png)

*Illustrative browser preview. Language shortcuts and copying are optional.*

## Translate with the languages you use

1. Choose your source and target languages in settings, then enable your preferred translation providers. Settings open when you first install the extension.
2. Focus the address bar with **Ctrl+L** on Windows/Linux or **Cmd+L** on macOS. Type **`t`**, then **Space**.
3. Enter your text. The preview uses your saved languages.

For example, `t Hello world` translates “Hello world” to your saved target language. Choose **Auto-detect** as the source language if you want the provider to identify it.

Wait for the completed translation before pressing Enter. Enable **Enter to copy** in settings when you want that shortcut; reading previews works on its own. Optional language prefixes let you change languages for one translation; the [user guide](docs/usage.md#language-shortcuts) has examples.

## Small by design

- Read translations while your current page stays open.
- Keep the translation separate from copy instructions, warnings, and settings actions.
- Choose which providers receive your text and the order in which they are tried.
- Grant provider and clipboard access when you enable those features. Only extension storage is required at installation.

Requests have time limits. If a provider fails, the extension tries the next one you enabled and shows a warning. A failed translation leaves your clipboard unchanged.

## Privacy you can understand

Bar Translator collects no usage analytics. Translation requests go directly to the providers you enable. Production logs exclude translation text and API keys.

API keys are stored locally by default. You can choose key syncing separately on each device. Read the [permissions and storage guide](docs/usage.md#permissions-and-privacy) for details.

## Choose your translation providers

| Provider | What to expect |
| --- | --- |
| Google Translate Web | Uses Google's mobile page without an API key. Google may require human verification on your network. |
| Lingva | A public Google Translate proxy without an API key. Availability varies. |
| DeepL | Uses the official API with your own API key. Testing the key is optional. |

Public web services can be unavailable or change their responses. The preview shows failures and offers settings actions for problems you can fix there.

## Run locally

Use Node.js 24.15+ (24.x) and pnpm 12.14.0:

```bash
git clone https://github.com/oovz/bar-translator.git
cd bar-translator
pnpm install
pnpm dev
```

See [development and testing](docs/testing.md) for checks, browser coverage, and manual verification.
