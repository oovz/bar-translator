import {
    DEFAULT_PREFERENCES, LOCAL_STORAGE_KEYS, SYNC_STORAGE_KEYS,
    type ApiCredential, type CredentialStorageType, type SetupConflict,
    type SetupResolution, type SetupState, type TranslationSetup,
} from '@/src/types';
import { createDefaultSetup, validateSetup } from './instances';
import { getEnabledOrigins, releaseInstanceOrigins, removeCopyAccess } from './permissions';

/** New records deliberately do not overlap the provider-keyed legacy format. */
export const SETUP_STORAGE_KEYS = {
    MANIFEST: 'translationSetup_v2',
    SELECTION: 'translationSetupStorage_v2',
    CHUNK_PREFIX: 'translationSetupChunk_v2:',
} as const;

const SETUP_LOCK = 'bar-translator-setup';
const ACCESS_STORAGE_KEY = 'translationSetupAccess_v2';
const CHUNK_LENGTH = 6000; // Base64 ASCII keeps every serialized item below 8 KiB.
const MAX_SETUP_BYTES = 262144;

interface Manifest {
    schemaVersion: 2;
    revision: string;
    chunkCount: number;
    hash: string;
}

interface Selection {
    schemaVersion: 2;
    storageType: CredentialStorageType;
    revision: string;
}

interface Snapshot {
    setup: TranslationSetup;
    revision: string;
}

interface LoadedState extends SetupState {
    selection?: Selection;
    sourceRevision: string;
}

let migrationCompleted = false;
let failedMigrationSignature: string | undefined;
const MIGRATION_SAVE_FAILED = 'The upgraded setup could not be saved. Current settings remain usable; retry migration.';

interface SetupAccess {
    origins: string[];
    copyEnabled: boolean;
}

function setupAccess(setup: TranslationSetup): SetupAccess {
    return { origins: getEnabledOrigins(setup), copyEnabled: setup.copyEnabled };
}

async function readSetupAccess(): Promise<SetupAccess | undefined> {
    const value: unknown = (await chrome.storage.local.get(ACCESS_STORAGE_KEY))[ACCESS_STORAGE_KEY];
    if (value === undefined) return;
    if (!isRecord(value) || !Array.isArray(value.origins) || typeof value.copyEnabled !== 'boolean' ||
        !value.origins.every((origin: unknown) => {
            if (typeof origin !== 'string' || origin.length > 4096) return false;
            try {
                const url = new URL(origin);
                return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
                    !url.hostname.includes('*') && origin === `${url.protocol}//${url.hostname}/*`;
            } catch { return false; }
        })) throw new Error('The saved access ownership is invalid. Its recovery data has been retained.');
    return { origins: value.origins as string[], copyEnabled: value.copyEnabled };
}

/** Retain cleanup obligations before committing a different active setup. No secrets are stored. */
async function rememberSetupAccess(...setups: TranslationSetup[]): Promise<void> {
    const previous = await readSetupAccess();
    const current = setups.map(setupAccess);
    const pending = {
        origins: [...new Set([...(previous?.origins ?? []), ...current.flatMap(access => access.origins)])],
        copyEnabled: !!previous?.copyEnabled || current.some(access => access.copyEnabled),
    };
    if (!previous || !sameSetupAccess(previous, pending)) {
        await chrome.storage.local.set({ [ACCESS_STORAGE_KEY]: pending });
    }
}

function sameSetupAccess(left: SetupAccess, right: SetupAccess): boolean {
    return left.copyEnabled === right.copyEnabled && stableJSON([...left.origins].sort()) === stableJSON([...right.origins].sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function storage(area: CredentialStorageType): chrome.storage.StorageArea {
    return chrome.storage[area];
}

function stableJSON(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

async function digest(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function sameSetup(left: TranslationSetup, right: TranslationSetup): boolean {
    return stableJSON(left) === stableJSON(right);
}

function chunkKeys(manifest: Manifest): string[] {
    return Array.from({ length: manifest.chunkCount }, (_, i) =>
        `${SETUP_STORAGE_KEYS.CHUNK_PREFIX}${manifest.revision}:${i}`);
}

function parseManifest(value: unknown): Manifest {
    if (!isRecord(value) || value.schemaVersion !== 2 || typeof value.revision !== 'string' ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(value.revision) || typeof value.chunkCount !== 'number' ||
        !Number.isInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > 64 ||
        typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) {
        throw new Error('The saved setup is incomplete or invalid. Its recovery data has been retained.');
    }
    return value as unknown as Manifest;
}

async function readManifest(area: CredentialStorageType): Promise<Manifest | undefined> {
    const result = await storage(area).get(SETUP_STORAGE_KEYS.MANIFEST);
    const value = result[SETUP_STORAGE_KEYS.MANIFEST];
    return value === undefined ? undefined : parseManifest(value);
}

async function readSnapshot(area: CredentialStorageType): Promise<Snapshot | undefined> {
    const manifest = await readManifest(area);
    if (!manifest) return;
    const keys = chunkKeys(manifest);
    const stored = await storage(area).get(keys);
    const parts = keys.map(key => {
        const value = stored[key];
        if (typeof value !== 'string' || value.length > CHUNK_LENGTH || !/^[A-Za-z0-9+/=]*$/.test(value)) {
            throw new Error('The saved setup is incomplete. Wait for sync or restore its saved configuration.');
        }
        return value;
    });
    let serialized: string;
    try {
        const binary = atob(parts.join(''));
        if (binary.length > MAX_SETUP_BYTES) throw new Error('Too large');
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Error('The saved setup cannot be decoded. Its recovery data has been retained.');
    }
    if (await digest(serialized) !== manifest.hash) {
        throw new Error('The saved setup is incomplete or damaged. Its recovery data has been retained.');
    }
    if ((await readManifest(area))?.revision !== manifest.revision) {
        throw new Error('The saved setup changed while loading. Please retry.');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(serialized); }
    catch { throw new Error('The saved setup is invalid. Its recovery data has been retained.'); }
    return { setup: validateSetup(parsed), revision: manifest.revision };
}

class SetupChangedError extends Error {
    constructor() { super('The setup changed. Review the current configurations and choose again.'); }
}

/** Publish immutable chunks before their pointer, leaving the active snapshot intact on failure. */
async function writeSnapshot(
    area: CredentialStorageType,
    setup: TranslationSetup,
    expectedRevision: string | undefined,
    beforeCommit: () => Promise<void>,
): Promise<Snapshot> {
    const serialized = stableJSON(validateSetup(setup));
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.length > MAX_SETUP_BYTES) throw new Error('The setup is too large to save.');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);
    const revision = crypto.randomUUID();
    const manifest: Manifest = {
        schemaVersion: 2, revision,
        chunkCount: Math.ceil(encoded.length / CHUNK_LENGTH), hash: await digest(serialized),
    };
    const keys = chunkKeys(manifest);
    const previous = await readManifest(area);
    if (previous?.revision !== expectedRevision) throw new SetupChangedError();
    try {
        await storage(area).set(Object.fromEntries(keys.map((key, i) => [
            key, encoded.slice(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH),
        ])));
        await beforeCommit();
        if ((await readManifest(area))?.revision !== expectedRevision) throw new SetupChangedError();
        await storage(area).set({ [SETUP_STORAGE_KEYS.MANIFEST]: manifest });
    } catch (error) {
        try {
            if ((await readManifest(area))?.revision !== revision) await storage(area).remove(keys);
        } catch { /* Keep orphaned recovery data if cleanup is unavailable. */ }
        throw error;
    }
    if (previous) {
        try { await storage(area).remove(chunkKeys(previous)); }
        catch { /* A committed setup remains usable if old-snapshot cleanup fails. */ }
    }
    return { setup: validateSetup(setup), revision };
}

async function readSelection(): Promise<Selection | undefined> {
    const values = await chrome.storage.local.get(SETUP_STORAGE_KEYS.SELECTION);
    const value = values[SETUP_STORAGE_KEYS.SELECTION];
    if (value === undefined) return;
    if (!isRecord(value) || value.schemaVersion !== 2 ||
        (value.storageType !== 'local' && value.storageType !== 'sync') || typeof value.revision !== 'string') {
        throw new Error('The setup storage selection is invalid. Its recovery data has been retained.');
    }
    return value as unknown as Selection;
}

async function selectStorage(area: CredentialStorageType): Promise<Selection> {
    // Provider-only installations predate ownership records. Capture their
    // former Google grant before activating v2, then let normal reconciliation
    // retain any current shared owner or release it. No permission is requested.
    if (!await readSelection()) {
        const origin = 'https://translate.google.com/*';
        if (await chrome.permissions.contains({ origins: [origin] })) {
            const access = await readSetupAccess();
            if (!access?.origins.includes(origin)) {
                await chrome.storage.local.set({ [ACCESS_STORAGE_KEY]: {
                    origins: [...(access?.origins ?? []), origin],
                    copyEnabled: access?.copyEnabled ?? false,
                } });
            }
        }
    }
    const selection: Selection = { schemaVersion: 2, storageType: area, revision: crypto.randomUUID() };
    await chrome.storage.local.set({ [SETUP_STORAGE_KEYS.SELECTION]: selection });
    migrationCompleted = true;
    failedMigrationSignature = undefined;
    return selection;
}

/** Legacy records remain untouched for older installations and recovery. */
async function readLegacy(): Promise<{ setup: TranslationSetup; storageType: CredentialStorageType }> {
    const local = await chrome.storage.local.get([
        LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE, LOCAL_STORAGE_KEYS.API_KEYS,
    ]);
    const synced = await chrome.storage.sync.get([SYNC_STORAGE_KEYS.PREFERENCES, SYNC_STORAGE_KEYS.API_KEYS]);
    const storageType = local[LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE] === 'sync' ? 'sync' : 'local';
    const keys: unknown = storageType === 'sync'
        ? synced[SYNC_STORAGE_KEYS.API_KEYS] : local[LOCAL_STORAGE_KEYS.API_KEYS];
    const granted = await chrome.permissions.contains({
        permissions: import.meta.env.FIREFOX ? ['clipboardWrite'] : ['clipboardWrite', 'offscreen'],
    });
    const setup = createDefaultSetup(granted);
    const stored: unknown = synced[SYNC_STORAGE_KEYS.PREFERENCES];
    if (isRecord(stored)) {
        const prefs = { ...DEFAULT_PREFERENCES, ...stored };
        const legacyIds = ['google-web', 'lingva', 'deepl'];
        setup.preferences = {
            defaultSourceLang: typeof prefs.defaultSourceLang === 'string' && prefs.defaultSourceLang ? prefs.defaultSourceLang : DEFAULT_PREFERENCES.defaultSourceLang,
            defaultTargetLang: typeof prefs.defaultTargetLang === 'string' && prefs.defaultTargetLang ? prefs.defaultTargetLang : DEFAULT_PREFERENCES.defaultTargetLang,
            fallbackOrder: Array.isArray(prefs.fallbackOrder)
                ? [...new Set(prefs.fallbackOrder.filter((id: unknown): id is string => typeof id === 'string' && legacyIds.includes(id)))] : [],
            languageOverrides: isRecord(prefs.languageOverrides)
                ? Object.fromEntries(Object.entries(prefs.languageOverrides).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : {},
        };
    }
    if (isRecord(keys) && isRecord(keys.deepl)) {
        const legacy = keys.deepl;
        if (typeof legacy.key === 'string') {
            const credential: ApiCredential = {
                key: legacy.key,
                validated: legacy.validated === true,
                ...(legacy.tier === 'free' || legacy.tier === 'pro' ? { tier: legacy.tier } : {}),
                ...(typeof legacy.lastValidated === 'number' && Number.isFinite(legacy.lastValidated) ? { lastValidated: legacy.lastValidated } : {}),
            };
            setup.instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential } : instance);
        }
    }
    return { setup: validateSetup(setup), storageType };
}

async function conflictFor(
    source: LoadedState,
    destination: Snapshot,
    destinationStorage: CredentialStorageType,
    reason: SetupConflict['reason'],
): Promise<SetupConflict> {
    return {
        token: await digest(stableJSON({
            source: source.setup, sourceRevision: source.sourceRevision,
            selection: source.selection ?? null,
            destinationRevision: destination.revision, destination: destination.setup,
            destinationStorage, reason,
        })),
        source: structuredClone(source.setup), destination: structuredClone(destination.setup),
        destinationStorage, reason,
    };
}

async function assertSourceUnchanged(source: LoadedState): Promise<void> {
    const selection = await readSelection();
    if (stableJSON(selection ?? null) !== stableJSON(source.selection ?? null)) throw new SetupChangedError();
    if (source.selection) {
        const current = await readManifest(source.storageType);
        if (current?.revision !== source.sourceRevision) throw new SetupChangedError();
    } else {
        const legacy = await readLegacy();
        if (legacy.storageType !== source.storageType || !sameSetup(legacy.setup, source.setup)) throw new SetupChangedError();
    }
}

async function legacySignature(source: LoadedState): Promise<string> {
    // A different context may have committed the destination since a previous
    // failed attempt. Re-read its pointer before suppressing repeated writes.
    const values = await storage(source.storageType).get(SETUP_STORAGE_KEYS.MANIFEST);
    const pointer = await digest(stableJSON(values[SETUP_STORAGE_KEYS.MANIFEST] ?? null));
    return `${source.storageType}:${source.sourceRevision}:${pointer}`;
}

/** Never turn an unsuccessful upgrade write into loss of a valid legacy setup. */
async function pendingMigrationAfterFailure(cacheWrites = true): Promise<LoadedState> {
    // A rejected API call may still have persisted its final selector. Respect
    // that authoritative record if it exists rather than reviving old settings.
    if (await readSelection()) return loadState(true);
    const legacy = await readLegacy();
    const source: LoadedState = { ...legacy, sourceRevision: await digest(stableJSON(legacy.setup)) };
    failedMigrationSignature = cacheWrites ? await legacySignature(source) : undefined;
    return { ...source, migrationError: MIGRATION_SAVE_FAILED };
}

async function loadState(reload = false): Promise<LoadedState> {
    const selection = await readSelection();
    if (selection) {
        migrationCompleted = true;
        failedMigrationSignature = undefined;
        const snapshot = await readSnapshot(selection.storageType);
        if (!snapshot) throw new Error('The selected setup is unavailable. Wait for sync or restore its saved configuration.');
        return { setup: snapshot.setup, storageType: selection.storageType, selection, sourceRevision: snapshot.revision };
    }
    const legacy = await readLegacy();
    const source: LoadedState = { ...legacy, sourceRevision: await digest(stableJSON(legacy.setup)) };
    // Storage events caused by a partly written migration must not create an
    // automatic write/retry loop. Keep reading live legacy values while the
    // same migration awaits the explicit Retry action.
    if (failedMigrationSignature && failedMigrationSignature === await legacySignature(source)) {
        return { ...source, migrationError: MIGRATION_SAVE_FAILED };
    }
    let destination: Snapshot | undefined;
    try { destination = await readSnapshot(legacy.storageType); }
    catch { return pendingMigrationAfterFailure(false); }
    if (destination && !sameSetup(destination.setup, source.setup)) {
        return { ...source, conflict: await conflictFor(source, destination, legacy.storageType, 'migration') };
    }
    try {
        let snapshot = destination;
        if (!snapshot) {
            snapshot = await writeSnapshot(legacy.storageType, source.setup, undefined, () => assertSourceUnchanged(source));
        }
        await assertSourceUnchanged(source);
        const selected = await selectStorage(legacy.storageType);
        return { ...legacy, selection: selected, sourceRevision: snapshot.revision };
    } catch (error) {
        if (error instanceof SetupChangedError && !reload) return loadState(true);
        return pendingMigrationAfterFailure();
    }
}

function publicState(state: LoadedState): SetupState {
    return {
        setup: structuredClone(state.setup), storageType: state.storageType,
        ...(state.conflict ? { conflict: structuredClone(state.conflict) } : {}),
        ...(state.migrationError ? { migrationError: state.migrationError } : {}),
    };
}

export function getSetupState(): Promise<SetupState> {
    return navigator.locks.request(SETUP_LOCK, async () => publicState(await loadState()));
}

export async function getSetup(): Promise<TranslationSetup> {
    return (await getSetupState()).setup;
}

/** Reconcile known device ownership after startup/sync, serialized with setup commits. */
export function reconcileSetupAccess(previousSetup?: TranslationSetup): Promise<void> {
    return navigator.locks.request(SETUP_LOCK, async () => {
        const state = await loadState();
        if (previousSetup) await rememberSetupAccess(previousSetup);
        const next = setupAccess(state.setup);
        const previous = await readSetupAccess();
        if (previous) {
            await releaseInstanceOrigins(previous.origins, next.origins);
            if (previous.copyEnabled && !next.copyEnabled) await removeCopyAccess();
        }
        if (!previous || !sameSetupAccess(previous, next)) {
            await chrome.storage.local.set({ [ACCESS_STORAGE_KEY]: next });
        }
    });
}

/** Explicit retry avoids repeated writes from omnibox reads and storage events. */
export function retrySetupMigration(): Promise<SetupState> {
    return navigator.locks.request(SETUP_LOCK, async () => {
        failedMigrationSignature = undefined;
        return publicState(await loadState());
    });
}

export function updateSetup(updater: (current: TranslationSetup) => TranslationSetup | Promise<TranslationSetup>): Promise<TranslationSetup> {
    return navigator.locks.request(SETUP_LOCK, async () => {
        const source = await loadState();
        if (source.conflict) throw new Error('Choose the setup to keep before editing settings.');
        if (!source.selection) throw new Error(MIGRATION_SAVE_FAILED);
        const next = validateSetup(await updater(structuredClone(source.setup)));
        next.instances = next.instances.map(instance => {
            const previous = source.setup.instances.find(saved => saved.id === instance.id);
            if (instance.providerId === 'libretranslate' && previous?.providerId === 'libretranslate' &&
                instance.endpoint !== previous.endpoint) {
                const changed = { ...instance };
                // Save the new recipient first, then enter the key bound to that recipient.
                delete changed.credential;
                return changed;
            }
            return instance;
        });
        if (sameSetup(next, source.setup)) return structuredClone(source.setup);
        await rememberSetupAccess(source.setup, next);
        await writeSnapshot(source.storageType, next, source.sourceRevision, () => assertSourceUnchanged(source));
        return structuredClone(next);
    });
}

export function switchSetupStorage(to: CredentialStorageType, resolution?: SetupResolution): Promise<SetupState> {
    return navigator.locks.request(SETUP_LOCK, async () => {
        if ((to !== 'local' && to !== 'sync') || (resolution && (
            typeof resolution.token !== 'string' ||
            (resolution.choice !== 'use-destination' && resolution.choice !== 'replace-destination')
        ))) throw new Error('The setup storage choice is invalid.');
        const source = await loadState();
        if (source.selection && source.storageType === to) return publicState(source);
        const destination = await readSnapshot(to);
        if (destination && !sameSetup(source.setup, destination.setup)) {
            const conflict = await conflictFor(source, destination, to, source.selection ? 'switch' : 'migration');
            if (!resolution || resolution.token !== conflict.token) return publicState({ ...source, conflict });
            if (resolution.choice === 'use-destination') {
                await assertSourceUnchanged(source);
                if ((await readManifest(to))?.revision !== destination.revision) {
                    const refreshed = await readSnapshot(to);
                    if (!refreshed) throw new SetupChangedError();
                    return publicState({ ...source, conflict: await conflictFor(source, refreshed, to, conflict.reason) });
                }
                await rememberSetupAccess(source.setup, destination.setup);
                const selection = await selectStorage(to);
                return publicState({ setup: destination.setup, storageType: to, selection, sourceRevision: destination.revision });
            }
        } else if (resolution) {
            throw new SetupChangedError();
        }
        try {
            await assertSourceUnchanged(source);
            await rememberSetupAccess(source.setup);
            let saved = destination;
            if (!saved || !sameSetup(source.setup, saved.setup)) {
                saved = await writeSnapshot(to, source.setup, destination?.revision, () => assertSourceUnchanged(source));
            }
            await assertSourceUnchanged(source);
            const selection = await selectStorage(to);
            return publicState({ setup: saved.setup, storageType: to, selection, sourceRevision: saved.revision });
        } catch (error) {
            if (!(error instanceof SetupChangedError)) throw error;
            const current = await loadState();
            const updatedDestination = await readSnapshot(to);
            if (!updatedDestination) throw error;
            return publicState({ ...current, conflict: await conflictFor(current, updatedDestination, to, current.selection ? 'switch' : 'migration') });
        }
    });
}

export function isSetupStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string): boolean {
    if (areaName !== 'local' && areaName !== 'sync') return false;
    return Object.keys(changes).some(key =>
        key === SETUP_STORAGE_KEYS.MANIFEST || key.startsWith(SETUP_STORAGE_KEYS.CHUNK_PREFIX) ||
        (areaName === 'local' && key === SETUP_STORAGE_KEYS.SELECTION) ||
        (!migrationCompleted && [
            SYNC_STORAGE_KEYS.PREFERENCES, SYNC_STORAGE_KEYS.API_KEYS,
            LOCAL_STORAGE_KEYS.API_KEYS, LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE,
        ].some(legacy => legacy === key)));
}
