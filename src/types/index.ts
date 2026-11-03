export const SERVICE_IDS = ['google-web', 'lingva', 'deepl', 'libretranslate'] as const;
export type ServiceId = typeof SERVICE_IDS[number];
export type InstanceId = string;
export type ApiTier = 'free' | 'pro';

export interface TranslationService {
  readonly id: ServiceId;
  readonly name: string;
  readonly endpoint?: string;
}

export interface TranslationServiceHandler {
  readonly service: TranslationService;
  translate(params: TranslateParams): Promise<TranslateResult>;
}

export interface TranslateParams {
  /** LibreTranslate base URL, including any deployment path prefix. */
  readonly endpoint?: string;
  readonly signal?: AbortSignal;
  readonly text: string;
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly apiKey?: string;
  readonly tier?: ApiTier;
}

export interface TranslateResult {
  readonly translation: string;
  readonly detectedSourceLang?: string;
  readonly serviceId: ServiceId;
}

export interface TranslateResultWithMeta extends TranslateResult {
  readonly instanceId: InstanceId;
  readonly instanceName: string;
  readonly usedFallback: boolean;
  /** Earlier enabled instances that could not translate this input. */
  readonly warnings: readonly TranslationWarning[];
}

export interface TranslationWarning {
  readonly code: TranslationErrorCode;
  readonly serviceId?: ServiceId;
  readonly instanceId?: InstanceId;
  readonly instanceName?: string;
}

export interface UserPreferences {
  fallbackOrder: InstanceId[];
  defaultTargetLang: string;
  defaultSourceLang: string;
  /** Short language code to preferred regional variant. */
  languageOverrides: Record<string, string>;
}

export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = {
  fallbackOrder: ['google-web'],
  defaultTargetLang: 'en',
  defaultSourceLang: 'auto',
  languageOverrides: {},
} as const;

export type CredentialStorageType = 'local' | 'sync';

export interface ApiCredential {
  key: string;
  tier?: ApiTier;
  validated: boolean;
  lastValidated?: number;
}

/** Provider-keyed credentials from installations before whole-setup storage. */
export interface StoredApiKeys {
  deepl?: ApiCredential;
  googleCloud?: ApiCredential;
  yandex?: ApiCredential;
  microsoft?: ApiCredential;
  baidu?: ApiCredential;
  youdao?: ApiCredential;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly tier?: ApiTier;
}

export interface LanguageInfo {
  readonly code: string;
  readonly name: string;
  readonly nativeName?: string;
}

export type TranslationErrorCode =
  | 'PERMISSION_REQUIRED'
  | 'API_KEY_REQUIRED'
  | 'NO_SERVICES_ENABLED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_API_KEY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_LANGUAGE'
  | 'INSTANCE_LANGUAGE_UNSUPPORTED'
  | 'INSTANCE_TEXT_TOO_LONG'
  | 'TEXT_TOO_LONG'
  | 'WEB_REQUEST_FAILED'
  | 'ALL_SERVICES_FAILED';

export interface CopyToClipboardMessage {
  readonly type: 'COPY_TO_CLIPBOARD';
  readonly text: string;
}

/** Legacy storage records remain readable during migration. */
export const SYNC_STORAGE_KEYS = {
  PREFERENCES: 'preferences',
  API_KEYS: 'apiKeys',
} as const;

export const LOCAL_STORAGE_KEYS = {
  CREDENTIAL_STORAGE_TYPE: 'credentialStorageType',
  API_KEYS: 'apiKeys_local',
} as const;

export interface ParsedOmniboxInput {
  readonly targetLang?: string;
  readonly sourceLang?: string;
  readonly text: string;
  readonly isLanguageQuery: boolean;
}

export type {
  TranslationInstance, DeepLInstance, LibreTranslateInstance, SingletonInstance,
  TranslationSetup, SetupState, SetupConflict, SetupResolution,
} from './setup';
