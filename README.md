<img src="public/icons/icon-128.png" width="64"/>

# Bar Translator

Quick translations directly from your browser's address bar (Omnibox).

Bar Translator is a simple, lightweight browser extension built with [WXT](https://wxt.dev/) that lets you translate text without leaving your current tab. Just type `t` followed by your text in the address bar.

## Downloads
<table cellspacing="0" cellpadding="0">
  <tr>
    <td valign="center">
      <a align="center" href="https://chromewebstore.google.com/detail/Bar%20Translator/edigfnmbafijmbnplkmddhemkghjkhno">
        <img src="https://user-images.githubusercontent.com/22908993/166417152-f870bfbd-1770-4c28-b69d-a7303aebc9a6.png" alt="Chrome Web Store" />
        <p align="center">Chrome Web Store</p>
      </a>
    </td>
  </tr>
</table>

## ✨ Features

- **Omnibox Integration**: Instantly translate by typing `t` in the address bar.
- **Language Overrides**: Prefix your query with a language code (e.g., `t fr hello`) to override your default target language on the fly.
- **Auto-Detection**: Automatically identifies the source language if not provided.
- **Regional Dialect Support**: Configure preferred regional variants for languages (e.g., map 'zh' to 'zh-TW').
- **Service Fallback**: Support for multiple translation providers with automatic fallback logic.
- **Chrome Sync Support**: Translation settings sync across your Chrome instances. Each device independently chooses local or synced API keys.
- **Clipboard Sync**: Press **Enter** to instantly copy the translation result to your clipboard.
- **Privacy First**: The extension collects no usage analytics. Text goes to your enabled translation providers in the order you choose.

## 🌍 Supported Services

Bar Translator offers these translation providers:

- **Google Translate**: Fast, reliable translation via web (no API key required).
- **Lingva Translate**: Privacy-focused alternative frontend for Google Translate (no API key required).
- **DeepL**: Industry-leading translation quality (requires Free or Pro API key).

In settings, enable the providers you allow to receive your text and drag them into order. The first available provider is tried first; later enabled providers may receive the same text if an earlier attempt fails. Disable every provider to pause translation. This choice persists when settings or the browser reopen.

Each provider attempt has a four-second deadline, including reading its response. The complete sequence has a ten-second budget, so later attempts receive only the remaining time. Attempts run sequentially, with each selected provider attempted once. A timeout aborts the active request and advances to the next available provider within the budget. Terminal failure shows an error and preserves the clipboard. Editing or abandoning the input cancels its pending work; cancellation cannot reverse text already received by a provider or any resulting billing.

DeepL's **Test** button checks the key with the authenticated [usage endpoint](https://developers.deepl.com/api-reference/usage-and-quota/check-usage-and-limits). Enable DeepL separately when you want to use it. Google Web and Lingva need no keys. Public web endpoints can be unavailable or change their response format.


API keys default to local storage. **API Key Storage** controls only the current device. Selecting sync copies this device's keys into shared storage, preserving credentials for other providers already stored there; this device's key takes precedence for the same provider. Selecting local copies shared keys to this device and keeps the shared copy available to other devices. Both storage areas hold readable credentials.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22 or later LTS)
- [pnpm](https://pnpm.io/)

### Development

1. Clone the repository:
   ```bash
   git clone https://github.com/oovz/bar-translator.git
   cd bar-translator
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start development server:
   ```bash
   pnpm dev
   ```
   *Note: This will automatically launch a browser instance with the extension pre-loaded.*

### Verification

Run the local checks after installing dependencies:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The build produces the Chrome extension in `.output/chrome-mv3/`.

## 📖 Usage

1. Focus the address bar (Ctrl+L or Cmd+L).
2. Type `t` followed by a space.
3. (Optional) Prefix with a target language code (e.g., `fr`, `es`, `ja`).
4. Type the text you want to translate.
5. After the preview appears, press Enter to copy it. Enter also works while a translation is pending.

Submitted translation and copy failures use Chrome notifications. Their visibility depends on your browser and OS notification settings.

**Example:**
- `t Hello world` -> Translates to your default target language.
- `t fr Hello world` -> Translates "Hello world" to French.

## 🛠️ Tech Stack

- **Framework**: [WXT](https://wxt.dev/) (Web Extension Toolbox)
- **UI Architecture**: [Preact](https://preactjs.com/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Testing**: [Vitest](https://vitest.dev/) (Unit) & [Playwright](https://playwright.dev/) (E2E)

## Privacy

> 1. **Data Processing**: Your translation requests are sent directly to your chosen translation service provider (e.g., Google or DeepL). Apart from the translation provider, translation content is not sent to any third party.
> 2. **Data Storage**: API keys and settings are stored locally in your browser or synced across your devices via Chrome Sync.
> 3. **Usage Analytics**: The extension collects no usage analytics and creates no analytics identity. Translation text, translated results, credentials, and provider response bodies are excluded from production logs. The maintainer uses Chrome Web Store reporting outside the extension.
> 4. **Provider Requests**: Enabled fallback providers may receive the same text after an earlier attempt fails. API keys are sent to their corresponding provider for translation and explicit key validation.

## 📄 License

MIT © 2025 [oovz](https://github.com/oovz)
