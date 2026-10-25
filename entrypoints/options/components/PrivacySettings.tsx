import { useState } from 'preact/hooks';
import type { CredentialStorageType, SetupConflict, SetupResolution } from '@/src/types';
import { getInstanceName } from '@/utils/instances';
import { t } from '@/utils/i18n';

interface PrivacySettingsProps {
    readonly storageType: CredentialStorageType;
    readonly conflict?: SetupConflict;
    readonly changingStorage: boolean;
    readonly changeStorageType: (storageType: CredentialStorageType, resolution?: SetupResolution) => Promise<void>;
}

export function PrivacySettings({ storageType, conflict, changingStorage, changeStorageType }: PrivacySettingsProps) {
    const [failedType, setFailedType] = useState<CredentialStorageType | null>(null);
    const change = async (nextType: CredentialStorageType, resolution?: SetupResolution) => {
        setFailedType(null);
        try {
            await changeStorageType(nextType, resolution);
        } catch {
            setFailedType(nextType);
        }
    };
    const choose = (choice: SetupResolution['choice']) => {
        if (conflict) void change(conflict.destinationStorage, { token: conflict.token, choice });
    };
    const summary = (setup: SetupConflict['source']) => {
        const enabled = setup.preferences.fallbackOrder.map(id => setup.instances.find(instance => instance.id === id))
            .filter(instance => instance !== undefined).map(getInstanceName);
        return <div class="setting-hint">
            <div>{setup.preferences.defaultSourceLang} → {setup.preferences.defaultTargetLang}</div>
            <div>{enabled.length ? enabled.join(' → ') : t('noServicesEnabled')}</div>
        </div>;
    };

    return <div class="section" id="storage" tabIndex={-1}>
        <div class="section-title">{t('sectionPrivacy')}</div>
        <div class="setting-row">
            <div class="setting-info">
                <label class="setting-label" htmlFor="setup-storage">{t('labelStorage')}</label>
                <div class="setting-hint">{t('storageDesc')}</div>
                <div class="setting-hint">{storageType === 'sync' ? t('storageSyncWarning') : t('storageLocalHint')}</div>
            </div>
            <select id="setup-storage" class="select select-sm" disabled={changingStorage} value={storageType}
                onChange={event => {
                    const next = event.currentTarget.value as CredentialStorageType;
                    event.currentTarget.value = storageType;
                    void change(next);
                }}>
                <option value="local">{t('storageLocal')}</option>
                <option value="sync">{t('storageSync')}</option>
            </select>
        </div>
        {conflict && <div class="setup-conflict" role="region" aria-label={t('setupConflictTitle')}>
            <div class="setting-label">{t('setupConflictTitle')}</div>
            <p class="setting-hint">{t('setupConflictDesc')}</p>
            <div class="form-row">
                <div class="form-group"><strong>{t('currentSetup')}</strong>{summary(conflict.source)}</div>
                <div class="form-group"><strong>{t('savedSetup')}</strong>{summary(conflict.destination)}</div>
            </div>
            <div class="instance-editor-actions">
                <button class="btn btn-sm btn-primary" disabled={changingStorage} onClick={() => choose('use-destination')}>{t('useSavedSetup')}</button>
                <button class="btn btn-sm" disabled={changingStorage} onClick={() => choose('replace-destination')}>{t('replaceSavedSetup')}</button>
            </div>
        </div>}
        {failedType && <div class="feedback feedback-error" role="alert">
            <span>{t('storageChangeFailed')}</span>
            <button class="btn btn-sm" disabled={changingStorage} onClick={() => void change(failedType)}>{t('retry')}</button>
        </div>}
        <div class="setting-hint">{t('privacyDesc')}</div>
    </div>;
}
