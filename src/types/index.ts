/**
 * Bar Translate - TypeScript Contracts
 *
 * These interfaces define the core types used throughout the extension.
 * They serve as the contract between different modules and for storage schemas.
 *
 * @version 1.0.0
 * @lastUpdated 2025-12-29
 * @typescript 5.7.x
 */

// =============================================================================
// Service Identifiers
// =============================================================================

/**
 * Valid translation service identifiers.
 * - google-scraper: Free, scrapes Google Translate (may be blocked in some regions)
 * - deepl: High quality, API key required, free tier available
 * - google-cloud: Official Google API, key required
 * - yandex: Russian service, good for CIS regions, key required
 * - microsoft: Azure Translator, 2M chars/month free, key required
 * - baidu: Chinese service, 1M chars/month free, key required
 * - youdao: Chinese service (有道翻译), key required
 * - lingva: Free proxy for Google Translate, works in restricted regions
 */
export type ServiceId =
  | 'google-scraper'
  | 'deepl'
  | 'google-cloud'
  | 'yandex'
  | 'microsoft'
  | 'baidu'
  | 'youdao'
  | 'lingva';

/**
 * Translation service integration type.
 */
export type ServiceType = 'scraping' | 'api';

/**
 * API tier for services with multiple tiers (e.g., DeepL).
 */
export type ApiTier = 'free' | 'pro';

/**
 * Authentication methods for API services.
 *
 * @remarks
 * As of March 2025, DeepL deprecated query parameter authentication.
 * Full deprecation deadline: January 15, 2026.
 */
export type AuthMethod =
  | 'none' // No authentication (scraping)
  | 'header-auth-key' // DeepL: Authorization: DeepL-Auth-Key {key}
  | 'header-bearer' // Standard: Authorization: Bearer {key}
  | 'api-key-header'; // X-API-Key header

/**
 * HTTP methods for service requests.
 */
export type HttpMethod = 'GET' | 'POST';

// =============================================================================
// Translation Service
// =============================================================================

/**
 * Defines a translation service provider.
 * Static definition - not persisted.
 */
export interface TranslationService {
  /** Unique service identifier */
  readonly id: ServiceId;

  /** Human-readable display name */
  readonly name: string;

  /** Integration method */
  readonly type: ServiceType;

  /** Whether this service requires an API key */
  readonly requiresApiKey: boolean;

  /**
   * Authentication method for API requests.
   * Required for API-based services.
   *
   * @remarks
   * DeepL changed to 'header-auth-key' in March 2025.
   * Query param auth fully deprecated January 15, 2026.
   */
  readonly authMethod: AuthMethod;

  /**
   * HTTP method for translation requests.
   * @default 'POST' for APIs, 'GET' for scraping
   */
  readonly httpMethod: HttpMethod;

  /** API endpoint for free tier (tiered services only) */
  readonly freeEndpoint?: string;

  /** API endpoint for pro tier (tiered services only) */
  readonly proEndpoint?: string;

  /** API endpoint for non-tiered services */
  readonly endpoint?: string;

  /** Supported languages (ISO 639-1 codes) */
  readonly supportedLanguages?: readonly string[];

  /** Maximum text length per request */
  readonly maxTextLength?: number;
}

/**
 * Translation service implementation interface.
 * Each service module must implement this.
 */
export interface TranslationServiceHandler {
  /** Service metadata */
  readonly service: TranslationService;

  /**
   * Perform translation.
   * @throws TranslationError on failure
   */
  translate(params: TranslateParams): Promise<TranslateResult>;

  /**
   * Validate an API key.
   * Only required for services where requiresApiKey is true.
   */
  validateApiKey?(apiKey: string): Promise<ValidationResult>;

  /**
   * Get list of supported languages.
   * Optional - used to populate language selectors.
   */
  getSupportedLanguages?(): Promise<LanguageInfo[]>;
}

// =============================================================================
// Translation Request/Response
// =============================================================================

/**
 * Parameters for a translation request.
 */
export interface TranslateParams {
  /** Text to translate (1-5000 characters, varies by service) */
  readonly text: string;

  /** Source language (ISO 639-1) or 'auto' for auto-detection */
  readonly sourceLang: string | 'auto';

  /** Target language (ISO 639-1, required) */
  readonly targetLang: string;

  /** API key (if required by service) */
  readonly apiKey?: string;

  /** API tier (for tiered services) */
  readonly tier?: ApiTier;
}

/**
 * Result of a translation request.
 */
export interface TranslateResult {
  /** Translated text */
  readonly translation: string;

  /** Detected source language if auto-detect was used */
  readonly detectedSourceLang?: string;

  /** Service that produced this result */
  readonly serviceId: ServiceId;
}

/**
 * Extended result including metadata about request handling.
 */
export interface TranslateResultWithMeta extends TranslateResult {
  /** Whether fallback was triggered */
  readonly usedFallback: boolean;

  /** Whether result came from cache */
  readonly cached: boolean;
}

// =============================================================================
// User Preferences
// =============================================================================

/**
 * User preferences stored in chrome.storage.sync.
 * Storage key: 'preferences'
 */
export interface UserPreferences {
  /** Preferred translation service (deprecated, use fallbackOrder[0]) */
  preferredServiceId: ServiceId;

  /** Ordered list of enabled services (first = primary, rest = fallbacks) */
  fallbackOrder: ServiceId[];

  /** Whether to attempt fallback on failure (deprecated, use fallbackOrder.length > 1) */
  fallbackEnabled: boolean;

  /** Default target language (ISO 639-1) */
  defaultTargetLang: string;

  /** Default source language (ISO 639-1) or 'auto' */
  defaultSourceLang: string | 'auto';

  /** Where to store API keys: 'local' (more secure) or 'sync' (cross-device) */
  storageType: 'local' | 'sync';

  /**
   * Overrides for language code resolution.
   * Map of 2-letter ISO code (e.g., 'zh') to specific BCP 47 code (e.g., 'zh-TW').
   */
  languageOverrides: Record<string, string>;

  /** Whether to send anonymous usage analytics via PostHog */
  telemetryEnabled: boolean;

  /** Anonymous stable ID for telemetry */
  distinctId: string;
}

/**
 * Default preferences for new installations.
 */
export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = {
  preferredServiceId: 'google-scraper',
  fallbackOrder: ['google-scraper'],
  fallbackEnabled: true,
  defaultTargetLang: 'en',
  defaultSourceLang: 'auto',
  storageType: 'local',
  languageOverrides: {},
  telemetryEnabled: true,
  distinctId: '', // Generated on first use
} as const;

// =============================================================================
// API Credentials
// =============================================================================

/**
 * Stored API credential for a single service.
 *
 * @security Chrome storage is NOT encrypted.
 * Users must be warned that API keys are stored in readable format.
 */
export interface ApiCredential {
  /** The API key value (masked in UI) */
  key: string;

  /** Detected tier (for tiered services like DeepL) */
  tier?: ApiTier;

  /** Whether this key passed validation */
  validated: boolean;

  /** Timestamp of last validation (Unix ms) */
  lastValidated?: number;
}

/**
 * Collection of API credentials stored in chrome.storage.sync.
 * Storage key: 'apiKeys'
 */
export interface StoredApiKeys {
  deepl?: ApiCredential;
  googleCloud?: ApiCredential;
  yandex?: ApiCredential;
  microsoft?: ApiCredential;
  baidu?: ApiCredential;
  youdao?: ApiCredential;
  // lingva is free, no key needed
}

/**
 * Result of API key validation.
 */
export interface ValidationResult {
  /** Whether the key is valid */
  readonly valid: boolean;

  /** Error message if invalid */
  readonly error?: string;

  /** Detected tier (for tiered services) */
  readonly tier?: ApiTier;

  /** Remaining quota if available */
  readonly quotaRemaining?: number;

  /** Character limit for the tier (e.g., DeepL Free: 500000/month) */
  readonly characterLimit?: number;
}

// =============================================================================
// Translation Cache
// =============================================================================

/**
 * Cache key format: `{serviceId}:{sourceLang}:{targetLang}:{normalizedText}`
 * Used as Map key for in-memory cache.
 */
export type CacheKey = `${ServiceId}:${string}:${string}:${string}`;

/**
 * Single cache entry.
 */
export interface CacheEntry {
  /** Translated text */
  readonly result: string;

  /** When this was cached (Unix ms) */
  readonly timestamp: number;

  /** Service that produced this result */
  readonly serviceId: ServiceId;

  /** Detected source language if auto-detected */
  readonly detectedLang?: string;
}

/**
 * Cache configuration.
 */
export interface CacheConfig {
  /** Maximum number of entries */
  readonly maxSize: number;

  /** Time-to-live in milliseconds */
  readonly ttl: number;
}

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: Readonly<CacheConfig> = {
  maxSize: 500,
  ttl: 3600000, // 1 hour
} as const;

/**
 * Cache backup stored in chrome.storage.session.
 * Used to restore cache after service worker restart.
 */
export interface CacheBackup {
  /** Serialized cache entries (last 100) */
  entries: [string, CacheEntry][];

  /** Timestamp of last backup */
  lastBackup: number;
}

/**
 * Maximum entries to backup to session storage.
 */
export const MAX_CACHE_BACKUP_ENTRIES = 100;

// =============================================================================
// Language Info
// =============================================================================

/**
 * Language information for UI display.
 */
export interface LanguageInfo {
  /** ISO 639-1 code */
  readonly code: string;

  /** English name */
  readonly name: string;

  /** Native name */
  readonly nativeName?: string;

  /** Whether this language supports auto-detection as source */
  readonly supportsAutoDetect?: boolean;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for translation failures.
 */
export type TranslationErrorCode =
  | 'NETWORK_ERROR' // Retry with backoff
  | 'INVALID_API_KEY' // Don't retry, notify user
  | 'QUOTA_EXCEEDED' // Skip service, notify user
  | 'RATE_LIMITED' // Retry with longer backoff
  | 'SERVICE_UNAVAILABLE' // Skip to next service
  | 'INVALID_LANGUAGE' // Show error, don't fallback
  | 'TEXT_TOO_LONG' // Truncate or reject
  | 'SCRAPING_FAILED' // Skip to API services
  | 'AUTH_METHOD_DEPRECATED' // DeepL: update auth method
  | 'ALL_SERVICES_FAILED'; // Show final error

/**
 * Structured error for translation failures.
 */
export interface TranslationError {
  readonly code: TranslationErrorCode;
  readonly message: string;
  readonly serviceId?: ServiceId;
  readonly retryable: boolean;
  readonly httpStatus?: number;
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(code: TranslationErrorCode): boolean {
  return ['NETWORK_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'].includes(code);
}

/**
 * Check if an error should trigger fallback.
 */
export function shouldFallback(code: TranslationErrorCode): boolean {
  return code !== 'INVALID_LANGUAGE' && code !== 'TEXT_TOO_LONG';
}

// =============================================================================
// Messages (Service Worker <-> Offscreen Document)
// =============================================================================

/**
 * Message types for internal communication.
 */
export type MessageType =
  | 'COPY_TO_CLIPBOARD'
  | 'CLIPBOARD_COPIED'
  | 'CLIPBOARD_ERROR';

/**
 * Base message structure.
 */
export interface BaseMessage {
  readonly type: MessageType;
}

/**
 * Request to copy text to clipboard.
 */
export interface CopyToClipboardMessage extends BaseMessage {
  readonly type: 'COPY_TO_CLIPBOARD';
  readonly text: string;
}

/**
 * Response indicating successful clipboard copy.
 */
export interface ClipboardCopiedMessage extends BaseMessage {
  readonly type: 'CLIPBOARD_COPIED';
}

/**
 * Response indicating clipboard copy failure.
 */
export interface ClipboardErrorMessage extends BaseMessage {
  readonly type: 'CLIPBOARD_ERROR';
  readonly error: string;
}

export type ClipboardMessage =
  | CopyToClipboardMessage
  | ClipboardCopiedMessage
  | ClipboardErrorMessage;

// =============================================================================
// Storage Keys
// =============================================================================

/**
 * Keys used in chrome.storage.sync.
 * Total limit: 100KB, per-item: 8KB
 */
export const SYNC_STORAGE_KEYS = {
  PREFERENCES: 'preferences',
  API_KEYS: 'apiKeys',
} as const;

/**
 * Keys used in chrome.storage.session.
 * Total limit: 10MB
 */
export const SESSION_STORAGE_KEYS = {
  LAST_TRANSLATION: 'lastTranslation',
  CACHE_BACKUP: 'cacheBackup',
} as const;

// =============================================================================
// Omnibox Types
// =============================================================================

/**
 * Parsed omnibox input.
 */
export interface ParsedOmniboxInput {
  /** Target language code (if specified) */
  readonly targetLang?: string;

  /** Source language code (if specified) */
  readonly sourceLang?: string;

  /** Text to translate */
  readonly text: string;

  /** Whether input is a language-only query (no text) */
  readonly isLanguageQuery: boolean;
}

/**
 * Omnibox suggestion to display.
 */
export interface OmniboxSuggestion {
  /** Content to use when selected (translation result) */
  readonly content: string;

  /** Description shown in dropdown (formatted with XML-like tags) */
  readonly description: string;

  /** Whether this came from fallback */
  readonly usedFallback?: boolean;

  /** Service that produced this */
  readonly serviceId?: ServiceId;
}

// =============================================================================
// DeepL-Specific Types (December 2025 API)
// =============================================================================

/**
 * DeepL API request body (POST only as of March 2025).
 *
 * @see https://www.deepl.com/docs-api/translate-text
 */
export interface DeepLTranslateRequest {
  /** Array of texts to translate */
  text: string[];

  /** Target language (uppercase ISO 639-1) */
  target_lang: string;

  /** Source language (uppercase ISO 639-1, omit for auto-detect) */
  source_lang?: string;
}

/**
 * DeepL API response.
 */
export interface DeepLTranslateResponse {
  translations: Array<{
    detected_source_language: string;
    text: string;
  }>;
}

/**
 * Build Authorization header for DeepL API.
 *
 * @remarks
 * As of March 2025, DeepL requires Authorization header.
 * Query param auth deprecated, fully removed January 15, 2026.
 */
export function buildDeepLAuthHeader(apiKey: string): string {
  return `DeepL-Auth-Key ${apiKey}`;
}

/**
 * Get DeepL endpoint based on API key tier.
 */
export function getDeepLEndpoint(apiKey: string): string {
  const isFree = apiKey.endsWith(':fx');
  return isFree
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

// =============================================================================
// Service Registry Types
// =============================================================================

/**
 * Mapping of service IDs to storage keys.
 */
export const SERVICE_TO_STORAGE_KEY: Record<ServiceId, keyof StoredApiKeys | null> = {
  'google-scraper': null,
  'deepl': 'deepl',
  'google-cloud': 'googleCloud',
  'yandex': 'yandex',
  'microsoft': 'microsoft',
  'baidu': 'baidu',
  'youdao': 'youdao',
  'lingva': null, // Free, no key
} as const;

/**
 * Service-specific text length limits.
 */
export const SERVICE_TEXT_LIMITS: Record<ServiceId, number> = {
  'google-scraper': 5000,
  'deepl': 5000, // Free tier; Pro allows 10000
  'google-cloud': 30000,
  'yandex': 10000,
  'microsoft': 50000, // Azure limit per request
  'baidu': 6000,
  'youdao': 5000,
  'lingva': 5000,
} as const;
