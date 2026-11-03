import {
    DEFAULT_PREFERENCES, type ApiCredential, type DeepLInstance, type LibreTranslateInstance, type ServiceId,
    type TranslationInstance, type TranslationSetup,
} from '@/src/types';

export const MANAGED_LIBRETRANSLATE_ENDPOINT = 'https://libretranslate.com';

const PROVIDER_NAMES: Record<ServiceId, string> = {
    'google-web': 'Google Web',
    lingva: 'Lingva',
    deepl: 'DeepL',
    libretranslate: 'LibreTranslate',
};

export function supportsMultipleInstances(providerId: ServiceId): providerId is 'deepl' | 'libretranslate' {
    return providerId === 'deepl' || providerId === 'libretranslate';
}

export function getProviderName(providerId: ServiceId): string {
    return PROVIDER_NAMES[providerId];
}

export function getInstanceName(instance: TranslationInstance): string {
    return instance.providerId === 'deepl' || instance.providerId === 'libretranslate'
        ? instance.name : getProviderName(instance.providerId);
}

export function createInstance(providerId: 'deepl'): DeepLInstance;
export function createInstance(providerId: 'libretranslate'): LibreTranslateInstance;
export function createInstance(providerId: 'deepl' | 'libretranslate'): DeepLInstance | LibreTranslateInstance;
export function createInstance(providerId: 'deepl' | 'libretranslate'): DeepLInstance | LibreTranslateInstance {
    const id = `${providerId}:${crypto.randomUUID()}`;
    if (providerId === 'deepl') return { id, providerId, name: PROVIDER_NAMES[providerId] };
    return {
        id, providerId, name: PROVIDER_NAMES[providerId],
        endpoint: MANAGED_LIBRETRANSLATE_ENDPOINT, hosting: 'managed',
    };
}

function hasControlCharacters(value: string): boolean {
    return Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** A base URL is a recipient, never a place to embed authentication information. */
export function normalizeEndpoint(value: string): string {
    if (value.length > 2048) throw new Error('Endpoint URL is too long.');
    if (hasControlCharacters(value) || value.includes('\\')) throw new Error('Enter a valid endpoint URL.');
    let url: URL;
    try { url = new URL(value.trim()); }
    catch { throw new Error('Enter a complete HTTP or HTTPS endpoint URL.'); }
    if (!isRecipientURL(url)) {
        throw new Error('Use an HTTP or HTTPS base URL without credentials, a query or a fragment.');
    }
    return url.href.replace(/\/+$/, '');
}

function isRecipientURL(url: URL): boolean {
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.hostname.includes('*') &&
        !url.username && !url.password && !url.href.includes('?') && !url.href.includes('#');
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validCredentialTier(value: unknown): value is ApiCredential['tier'] {
    return value === undefined || value === 'free' || value === 'pro';
}

function validValidationTime(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function parseCredentialRecord(value: unknown) {
    if (!object(value) || typeof value.key !== 'string' || value.key.length > 8192 ||
        typeof value.validated !== 'boolean' ||
        !validCredentialTier(value.tier) || !validValidationTime(value.lastValidated)) {
        throw new Error('The saved instance credential is invalid.');
    }
    return { key: value.key, validated: value.validated, tier: value.tier, lastValidated: value.lastValidated };
}

function parseCredential(value: unknown): ApiCredential | undefined {
    if (value === undefined) return;
    const credential = parseCredentialRecord(value);
    return {
        key: credential.key,
        validated: credential.validated,
        ...(credential.tier !== undefined ? { tier: credential.tier } : {}),
        ...(credential.lastValidated !== undefined ? { lastValidated: credential.lastValidated } : {}),
    };
}

function parseSingleton(entry: Record<string, unknown>, id: string, providerId: 'google-web' | 'lingva', singletons: Set<string>): TranslationInstance {
    if (singletons.has(providerId) || id !== providerId ||
        entry.name !== undefined || entry.credential !== undefined || entry.endpoint !== undefined) {
        throw new Error('This provider has one fixed instance.');
    }
    singletons.add(providerId);
    return { id, providerId };
}

function parseLibreEndpoint(entry: Record<string, unknown>): Pick<LibreTranslateInstance, 'endpoint' | 'hosting'> {
    if (typeof entry.endpoint !== 'string' || (entry.hosting !== 'managed' && entry.hosting !== 'custom')) {
        throw new Error('The saved LibreTranslate endpoint is invalid.');
    }
    const endpoint = normalizeEndpoint(entry.endpoint);
    if (entry.hosting === 'managed' && endpoint !== MANAGED_LIBRETRANSLATE_ENDPOINT) {
        throw new Error('The managed LibreTranslate instance must use its official endpoint.');
    }
    return { endpoint, hosting: entry.hosting };
}

function parseInstanceName(value: unknown): string {
    if (!boundedString(value, 128) || !value.trim() || hasControlCharacters(value)) {
        throw new Error('The saved instance provider or name is invalid.');
    }
    return value.trim();
}

function parseInstance(entry: Record<string, unknown>, id: string, singletons: Set<string>): TranslationInstance {
    if (entry.providerId === 'google-web' || entry.providerId === 'lingva') {
        return parseSingleton(entry, id, entry.providerId, singletons);
    }
    if (entry.providerId !== 'deepl' && entry.providerId !== 'libretranslate') {
        throw new Error('The saved instance provider or name is invalid.');
    }
    const common = {
        id, name: parseInstanceName(entry.name),
        ...(entry.credential !== undefined ? { credential: parseCredential(entry.credential) } : {}),
    };
    if (entry.providerId === 'deepl') return { ...common, providerId: 'deepl' };
    return { ...common, providerId: 'libretranslate', ...parseLibreEndpoint(entry) };
}

function parseInstances(entries: unknown[]): { instances: TranslationInstance[]; ids: Set<string> } {
    const ids = new Set<string>();
    const singletons = new Set<string>();
    const instances = entries.map(entry => {
        if (!object(entry) || !boundedString(entry.id, 128) || ids.has(entry.id)) {
            throw new Error('Saved instances must have unique identities.');
        }
        ids.add(entry.id);
        return parseInstance(entry, entry.id, singletons);
    });
    return { instances, ids };
}

function parseFallbackOrder(order: unknown[], ids: Set<string>): string[] {
    const enabled = new Set<string>();
    const fallbackOrder = order.map((id: unknown) => {
        if (typeof id !== 'string' || !ids.has(id) || enabled.has(id)) {
            throw new Error('The saved enabled order refers to an unavailable or repeated instance.');
        }
        enabled.add(id);
        return id;
    });
    return fallbackOrder;
}

/** Read old setups without changing their active priority or discarding disabled accounts. */
export function getInstanceOrder(setup: TranslationSetup): string[] {
    return setup.instanceOrder ?? [...setup.preferences.fallbackOrder,
        ...setup.instances.map(instance => instance.id).filter(id => !setup.preferences.fallbackOrder.includes(id))];
}

function parseInstanceOrder(value: unknown, ids: Set<string>, fallbackOrder: string[]): string[] {
    if (value === undefined) return [...fallbackOrder, ...ids].filter((id, index, order) => order.indexOf(id) === index);
    if (!Array.isArray(value) || value.length !== ids.size ||
        value.some(id => typeof id !== 'string' || !ids.has(id)) || new Set(value).size !== ids.size) {
        throw new Error('The saved instance order is incomplete or invalid.');
    }
    const enabled = value.filter(id => fallbackOrder.includes(id));
    if (enabled.some((id, index) => id !== fallbackOrder[index])) {
        throw new Error('The saved instance order contradicts its enabled priority.');
    }
    return [...value];
}

function parseLanguageOverrides(overrides: Record<string, unknown>): Record<string, string> {
    const languageOverrides: Record<string, string> = {};
    for (const [language, variant] of Object.entries(overrides)) {
        if (!boundedString(language, 32) || !boundedString(variant, 32)) {
            throw new Error('The saved language override is invalid.');
        }
        Object.defineProperty(languageOverrides, language, { value: variant, enumerable: true, configurable: true, writable: true });
    }
    return languageOverrides;
}

function parsePreferences(prefs: Record<string, unknown>) {
    if (!boundedString(prefs.defaultSourceLang, 32) || !boundedString(prefs.defaultTargetLang, 32) ||
        !Array.isArray(prefs.fallbackOrder) || !object(prefs.languageOverrides)) {
        throw new Error('The saved language or fallback settings are invalid.');
    }
    return {
        defaultSourceLang: prefs.defaultSourceLang, defaultTargetLang: prefs.defaultTargetLang,
        fallbackOrder: prefs.fallbackOrder, languageOverrides: prefs.languageOverrides,
    };
}

/** Reject damaged saved state; never turn a damaged selection into fresh defaults. */
export function validateSetup(value: unknown): TranslationSetup {
    if (!object(value) || value.schemaVersion !== 2 || !object(value.preferences) ||
        !Array.isArray(value.instances) || typeof value.copyEnabled !== 'boolean') {
        throw new Error('The saved setup is invalid.');
    }
    const prefs = parsePreferences(value.preferences);
    const { instances, ids } = parseInstances(value.instances);
    const fallbackOrder = parseFallbackOrder(prefs.fallbackOrder, ids);
    const languageOverrides = parseLanguageOverrides(prefs.languageOverrides);
    return {
        schemaVersion: 2,
        preferences: {
            defaultSourceLang: prefs.defaultSourceLang, defaultTargetLang: prefs.defaultTargetLang,
            fallbackOrder, languageOverrides,
        },
        instances, instanceOrder: parseInstanceOrder(value.instanceOrder, ids, fallbackOrder), copyEnabled: value.copyEnabled,
    };
}

export function createDefaultSetup(copyEnabled = false): TranslationSetup {
    return {
        schemaVersion: 2,
        preferences: structuredClone(DEFAULT_PREFERENCES),
        instances: [
            { id: 'google-web', providerId: 'google-web' },
        ],
        copyEnabled,
    };
}
