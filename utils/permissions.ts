import type { ServiceId } from '@/src/types';

/** All domains needed by a provider, independent of subscription or credential. */
export const PROVIDER_ORIGINS: Record<ServiceId, string[]> = {
    'google-web': ['https://translate.google.com/*'],
    lingva: [],
    deepl: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'],
};

export const COPY_PERMISSIONS: chrome.runtime.ManifestPermission[] = ['clipboardWrite', 'offscreen'];

export function hasProviderAccess(serviceId: ServiceId): Promise<boolean> {
    const origins = PROVIDER_ORIGINS[serviceId];
    return origins.length ? chrome.permissions.contains({ origins }) : Promise.resolve(true);
}

/** Used for cleanup controls: incomplete access must still be removable. */
export async function hasAnyProviderAccess(serviceId: ServiceId): Promise<boolean> {
    return (await Promise.all(PROVIDER_ORIGINS[serviceId].map(origin => chrome.permissions.contains({ origins: [origin] })))).some(Boolean);
}

// Call directly from the click handler, before awaiting other work.
export function requestProviderAccess(serviceId: ServiceId): Promise<boolean> {
    const origins = PROVIDER_ORIGINS[serviceId];
    return origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
}

export async function removeProviderAccess(serviceId: ServiceId): Promise<void> {
    const origins = PROVIDER_ORIGINS[serviceId];
    if (origins.length && !await chrome.permissions.remove({ origins }) && await hasAnyProviderAccess(serviceId)) {
        throw new Error('Could not release provider access.');
    }
}

export function hasCopyAccess(): Promise<boolean> {
    return chrome.permissions.contains({ permissions: COPY_PERMISSIONS });
}

export function requestCopyAccess(): Promise<boolean> {
    return chrome.permissions.request({ permissions: COPY_PERMISSIONS });
}

export async function removeCopyAccess(): Promise<void> {
    // Close the document while we still have the offscreen API permission.
    if (await chrome.permissions.contains({ permissions: ['offscreen'] })) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
        if (contexts.length) await chrome.offscreen.closeDocument();
    }
    if (!await chrome.permissions.remove({ permissions: COPY_PERMISSIONS }) &&
        (await Promise.all(COPY_PERMISSIONS.map(permission => chrome.permissions.contains({ permissions: [permission] })))).some(Boolean)) {
        throw new Error('Could not release clipboard access.');
    }
}
