import { migrateApiKeys } from '@/utils/storage';
import { t } from '@/utils/i18n';

interface PrivacySettingsProps {
    readonly preferences: import('@/src/types').UserPreferences;
    readonly updatePreferences: (prefs: Partial<import('@/src/types').UserPreferences>) => void;
}

export function PrivacySettings({ preferences, updatePreferences }: PrivacySettingsProps) {
    const handleStorageTypeChange = async (newType: 'sync' | 'local') => {
        const oldType = preferences.storageType;
        if (oldType === newType) return;

        // Migrate API keys to new storage
        await migrateApiKeys(oldType, newType);
        await updatePreferences({ storageType: newType });
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
                        {preferences.storageType === 'sync'
                            ? t('storageSyncWarning')
                            : t('storageLocalHint')}
                    </div>
                </div>
                <select
                    class="select select-sm"
                    value={preferences.storageType}
                    onChange={(e) => handleStorageTypeChange(e.currentTarget.value as 'sync' | 'local')}
                >
                    <option value="local">{t('storageLocal')}</option>
                    <option value="sync">{t('storageSync')}</option>
                </select>
            </div>

            <div class="setting-hint">{t('privacyDesc')}</div>
        </div>
    );
}
