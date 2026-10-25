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

export function getInstanceName(instance: TranslationInstance): string {
    return instance.providerId === 'deepl' || instance.providerId === 'libretranslate'
        ? instance.name : PROVIDER_NAMES[instance.providerId];
}

export function createInstance(providerId: 'deepl'): DeepLInstance;
export function createInstance(providerId: 'libretranslate'): LibreTranslateInstance;
export function createInstance(providerId: 'deepl' | 'libretranslate'): DeepLInstance | LibreTranslateInstance;
export function createInstance(providerId: 'deepl' | 'libretranslate'): DeepLInstance | LibreTranslateInstance {
    if (!supportsMultipleInstances(providerId)) throw new Error('This provider has one fixed instance.');
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
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hostname.includes('*') ||
        url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
        throw new Error('Use an HTTP or HTTPS base URL without credentials, a query or a fragment.');
    }
    return url.href.replace(/\/+$/, '');
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function parseCredential(value: unknown): ApiCredential | undefined {
    if (value === undefined) return;
    if (!object(value) || typeof value.key !== 'string' || value.key.length > 8192 ||
        typeof value.validated !== 'boolean' ||
        (value.tier !== undefined && value.tier !== 'free' && value.tier !== 'pro') ||
        (value.lastValidated !== undefined && (typeof value.lastValidated !== 'number' || !Number.isFinite(value.lastValidated)))) {
        throw new Error('The saved instance credential is invalid.');
    }
    return {
        key: value.key,
        validated: value.validated,
        ...(value.tier !== undefined ? { tier: value.tier } : {}),
        ...(value.lastValidated !== undefined ? { lastValidated: value.lastValidated } : {}),
    };
}

/** Reject damaged saved state; never turn a damaged selection into fresh defaults. */
export function validateSetup(value: unknown): TranslationSetup {
    if (!object(value) || value.schemaVersion !== 2 || !object(value.preferences) ||
        !Array.isArray(value.instances) || typeof value.copyEnabled !== 'boolean') {
        throw new Error('The saved setup is invalid.');
    }
    const prefs = value.preferences;
    if (!boundedString(prefs.defaultSourceLang, 32) || !boundedString(prefs.defaultTargetLang, 32) ||
        !Array.isArray(prefs.fallbackOrder) || !object(prefs.languageOverrides)) {
        throw new Error('The saved language or fallback settings are invalid.');
    }
    const ids = new Set<string>();
    const singletons = new Set<string>();
    const instances = value.instances.map((entry: unknown): TranslationInstance => {
        if (!object(entry) || !boundedString(entry.id, 128) || ids.has(entry.id)) {
            throw new Error('Saved instances must have unique identities.');
        }
        ids.add(entry.id);
        if (entry.providerId === 'google-web' || entry.providerId === 'lingva') {
            if (singletons.has(entry.providerId) || entry.id !== entry.providerId ||
                entry.name !== undefined || entry.credential !== undefined || entry.endpoint !== undefined) {
                throw new Error('This provider has one fixed instance.');
            }
            singletons.add(entry.providerId);
            return { id: entry.id, providerId: entry.providerId };
        }
        if ((entry.providerId !== 'deepl' && entry.providerId !== 'libretranslate') ||
            !boundedString(entry.name, 128) || !entry.name.trim() || hasControlCharacters(entry.name)) {
            throw new Error('The saved instance provider or name is invalid.');
        }
        const common = {
            id: entry.id, name: entry.name.trim(),
            ...(entry.credential !== undefined ? { credential: parseCredential(entry.credential) } : {}),
        };
        if (entry.providerId === 'deepl') return { ...common, providerId: 'deepl' };
        if (typeof entry.endpoint !== 'string' || (entry.hosting !== 'managed' && entry.hosting !== 'custom')) {
            throw new Error('The saved LibreTranslate endpoint is invalid.');
        }
        const endpoint = normalizeEndpoint(entry.endpoint);
        if (entry.hosting === 'managed' && endpoint !== MANAGED_LIBRETRANSLATE_ENDPOINT) {
            throw new Error('The managed LibreTranslate instance must use its official endpoint.');
        }
        return { ...common, providerId: 'libretranslate', endpoint, hosting: entry.hosting };
    });
    if (!singletons.has('google-web') || !singletons.has('lingva')) {
        throw new Error('The saved setup is missing a fixed provider instance.');
    }
    const enabled = new Set<string>();
    const fallbackOrder = prefs.fallbackOrder.map((id: unknown) => {
        if (typeof id !== 'string' || !ids.has(id) || enabled.has(id)) {
            throw new Error('The saved enabled order refers to an unavailable or repeated instance.');
        }
        enabled.add(id);
        return id;
    });
    const languageOverrides: Record<string, string> = {};
    for (const [language, variant] of Object.entries(prefs.languageOverrides)) {
        if (!boundedString(language, 32) || !boundedString(variant, 32)) {
            throw new Error('The saved language override is invalid.');
        }
        Object.defineProperty(languageOverrides, language, { value: variant, enumerable: true, configurable: true, writable: true });
    }
    return {
        schemaVersion: 2,
        preferences: {
            defaultSourceLang: prefs.defaultSourceLang, defaultTargetLang: prefs.defaultTargetLang,
            fallbackOrder, languageOverrides,
        },
        instances, copyEnabled: value.copyEnabled,
    };
}

export function createDefaultSetup(copyEnabled = false): TranslationSetup {
    return {
        schemaVersion: 2,
        preferences: structuredClone(DEFAULT_PREFERENCES),
        instances: [
            { id: 'google-web', providerId: 'google-web' },
            { id: 'lingva', providerId: 'lingva' },
            { id: 'deepl', providerId: 'deepl', name: 'DeepL' },
        ],
        copyEnabled,
    };
}
