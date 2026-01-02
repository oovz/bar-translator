# Bar Translator

Quick translations directly from your browser's address bar (Omnibox).

Bar Translator is a simple, lightweight browser extension built with [WXT](https://wxt.dev/) that lets you translate text without leaving your current tab. Just type `t` followed by your text in the address bar.

## ✨ Features

- **Omnibox Integration**: Instantly translate by typing `t` in the address bar.
- **Language Overrides**: Prefix your query with a language code (e.g., `t fr hello`) to override your default target language on the fly.
- **Auto-Detection**: Automatically identifies the source language if not provided.
- **Regional Dialect Support**: Configure preferred regional variants for languages (e.g., map 'zh' to 'zh-TW').
- **Service Fallback**: Support for multiple translation providers with automatic fallback logic.
- **Chrome Sync Support**: Your settings and API keys can be synced across all your Chrome instances using your Google account.
- **Clipboard Sync**: Press **Enter** to instantly copy the translation result to your clipboard.
- **Privacy First**: Telemetry is strictly limited to anonymous success/failure events and can be completely disabled in the options.

## 🌍 Supported Services

Bar Translator supports a wide range of translation services to ensure reliable results:

- **Google Translate**: Fast, reliable translation via web (no API key required).
- **Lingva Translate**: Privacy-focused alternative frontend for Google Translate (no API key required).
- **DeepL**: Industry-leading translation quality (requires Free or Pro API key).
- **Microsoft Translator**: Integrated Azure Cognitive Services (requires API key).
- **Google Cloud Translation**: Official Google Cloud API (requires API key).
- **Yandex Translate**: Popular service for Eastern European languages (requires API key).
- **Baidu Translate (百度翻译)**: Leading provider for Chinese language pairs (requires API key).
- **Youdao Translate (有道翻译)**: Specialized Chinese translation service (requires API key).

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

## 📖 Usage

1. Focus the address bar (Ctrl+L or Cmd+L).
2. Type `t` followed by a space.
3. (Optional) Prefix with a target language code (e.g., `fr`, `es`, `ja`).
4. Type the text you want to translate.

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
> 3. **Anonymous Statistics**: Anonymous technical usage data (such as provider errors) is collected to improve the extension. This data does not contain any personally identifiable information or translation text, and you can disable this feature at any time in the settings.

## 📄 License

MIT © 2025 [oovz](https://github.com/oovz)
