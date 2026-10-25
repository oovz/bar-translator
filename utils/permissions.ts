import type { ServiceId, TranslationInstance, TranslationSetup } from '@/src/types';

/** Static provider integrations may require more than one subscription host. */
export const PROVIDER_ORIGINS: Record<ServiceId, string[]> = {
    'google-web': ['https://translate.googleapis.com/*'],
    lingva: [],
    deepl: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'],
    libretranslate: ['https://libretranslate.com/*'],
};

export const COPY_PERMISSIONS: chrome.runtime.ManifestPermission[] = import.meta.env.FIREFOX
    ? ['clipboardWrite'] : ['clipboardWrite', 'offscreen'];

/** Host grants apply to the scheme and host, including all its ports and paths. */
export function getInstanceOrigins(instance: TranslationInstance): string[] {
    if (instance.providerId !== 'libretranslate') return [...PROVIDER_ORIGINS[instance.providerId]];
    const endpoint = new URL(instance.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new Error('Invalid translation endpoint.');
    }
    return [`${endpoint.protocol}//${endpoint.hostname}/*`];
}

function containsOrigins(origins: string[]): Promise<boolean> {
    return origins.length ? chrome.permissions.contains({ origins }) : Promise.resolve(true);
}

export function hasInstanceAccess(instance: TranslationInstance): Promise<boolean> {
    return containsOrigins(getInstanceOrigins(instance));
}

export async function hasAnyInstanceAccess(instance: TranslationInstance): Promise<boolean> {
    return (await Promise.all(getInstanceOrigins(instance).map(origin => containsOrigins([origin])))).some(Boolean);
}

// Invoke directly from the click handler, before awaiting persistence or other work.
export function requestInstanceAccess(instance: TranslationInstance): Promise<boolean> {
    const origins = getInstanceOrigins(instance);
    return origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
}

export function getEnabledOrigins(setup: TranslationSetup): string[] {
    const enabled = new Set(setup.preferences.fallbackOrder);
    return [...new Set(setup.instances.filter(instance => enabled.has(instance.id)).flatMap(getInstanceOrigins))];
}

/** Release only grants no longer owned by an enabled instance in the active setup. */
export async function releaseUnusedInstanceAccess(previous: TranslationSetup, next: TranslationSetup): Promise<void> {
    return releaseInstanceOrigins(getEnabledOrigins(previous), getEnabledOrigins(next));
}

/** Release recorded ownership, preserving hosts still needed by the current setup. */
export async function releaseInstanceOrigins(previous: string[], next: string[]): Promise<void> {
    const retained = new Set(next);
    const origins = previous.filter(origin => !retained.has(origin));
    if (origins.length && !await chrome.permissions.remove({ origins }) &&
        (await Promise.all(origins.map(origin => containsOrigins([origin])))).some(Boolean)) {
        throw new Error('Could not release translation access.');
    }
}

/** Static provider access is useful for direct official API credential tests. */
export function hasProviderAccess(serviceId: ServiceId): Promise<boolean> {
    return containsOrigins(PROVIDER_ORIGINS[serviceId]);
}

export function hasCopyAccess(): Promise<boolean> {
    return chrome.permissions.contains({ permissions: COPY_PERMISSIONS });
}

export function requestCopyAccess(): Promise<boolean> {
    return chrome.permissions.request({ permissions: COPY_PERMISSIONS });
}

export async function removeCopyAccess(): Promise<void> {
    // Close the document while the device still has the offscreen permission.
    if (!import.meta.env.FIREFOX && await chrome.permissions.contains({ permissions: ['offscreen'] })) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
        if (contexts.length) await chrome.offscreen.closeDocument();
    }
    if (!await chrome.permissions.remove({ permissions: COPY_PERMISSIONS }) &&
        (await Promise.all(COPY_PERMISSIONS.map(permission => chrome.permissions.contains({ permissions: [permission] })))).some(Boolean)) {
        throw new Error('Could not release clipboard access.');
    }
}
