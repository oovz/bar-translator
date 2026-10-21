import { useState } from 'preact/hooks';
import type { CredentialStorageType } from '@/src/types';
import { t } from '@/utils/i18n';

interface PrivacySettingsProps {
    readonly storageType: CredentialStorageType;
    readonly changingStorage: boolean;
    readonly changeStorageType: (storageType: CredentialStorageType) => Promise<void>;
}

export function PrivacySettings({ storageType, changingStorage, changeStorageType }: PrivacySettingsProps) {
    const [failedType, setFailedType] = useState<CredentialStorageType | null>(null);
    const handleStorageTypeChange = async (newType: CredentialStorageType) => {
        setFailedType(null);
        try {
            await changeStorageType(newType);
        } catch {
            setFailedType(newType);
        }
    };

    return (
        <div class="section">
            <div class="section-title">{t('sectionPrivacy')}</div>

            {/* API Key Storage */}
            <div class="setting-row">
                <div class="setting-info">
                    <div class="setting-label">
                        {t('labelStorage')}
                        <span
                            title={t('storageDesc')}
                            style="margin-left: 6px; cursor: help; font-size: 12px;"
                        >
                            ℹ️
                        </span>
                    </div>
                    <div class="setting-hint">
                        {storageType === 'sync'
                            ? t('storageSyncWarning')
                            : t('storageLocalHint')}
                    </div>
                </div>
                <select
                    class="select select-sm"
                    aria-label={t('labelStorage')}
                    disabled={changingStorage}
                    value={storageType}
                    onChange={(e) => {
                        const nextType = e.currentTarget.value as CredentialStorageType;
                        e.currentTarget.value = storageType;
                        void handleStorageTypeChange(nextType);
                    }}
                >
                    <option value="local">{t('storageLocal')}</option>
                    <option value="sync">{t('storageSync')}</option>
                </select>
            </div>

            {failedType && (
                <div class="feedback feedback-error" role="alert">
                    <span>{t('storageChangeFailed')}</span>
                    <button class="btn btn-sm" disabled={changingStorage} onClick={() => handleStorageTypeChange(failedType)}>
                        {t('retry')}
                    </button>
                </div>
            )}
            <div class="setting-hint">{t('privacyDesc')}</div>
        </div>
    );
}
