import type { ApiCredential, CredentialStorageType, InstanceId, UserPreferences } from './index';

export interface SingletonInstance {
    id: InstanceId;
    providerId: 'google-web' | 'lingva';
}

export interface DeepLInstance {
    id: InstanceId;
    providerId: 'deepl';
    name: string;
    credential?: ApiCredential;
}

export interface LibreTranslateInstance {
    id: InstanceId;
    providerId: 'libretranslate';
    name: string;
    endpoint: string;
    hosting: 'managed' | 'custom';
    credential?: ApiCredential;
}

export type TranslationInstance = SingletonInstance | DeepLInstance | LibreTranslateInstance;

/** All user configuration shares one storage selection. Browser grants do not. */
export interface TranslationSetup {
    schemaVersion: 2;
    preferences: UserPreferences;
    instances: TranslationInstance[];
    copyEnabled: boolean;
}

export interface SetupConflict {
    /** Opaque comparison token; do not display it or log its contents. */
    token: string;
    source: TranslationSetup;
    destination: TranslationSetup;
    destinationStorage: CredentialStorageType;
    reason: 'migration' | 'switch';
}

export interface SetupResolution {
    token: string;
    choice: 'use-destination' | 'replace-destination';
}

export interface SetupState {
    setup: TranslationSetup;
    storageType: CredentialStorageType;
    conflict?: SetupConflict;
    /** Migration is pending; the returned legacy-derived setup remains usable. */
    migrationError?: string;
}
