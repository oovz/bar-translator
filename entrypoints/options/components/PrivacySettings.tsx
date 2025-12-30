import { migrateApiKeys } from '@/utils/storage';
import { setTelemetryEnabled } from '@/utils/telemetry';

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

    const handleTelemetryChange = (enabled: boolean) => {
        setTelemetryEnabled(enabled);
        updatePreferences({ telemetryEnabled: enabled });
    };

    return (
        <div class="section">
            <div class="section-title">Privacy & Storage</div>

            {/* API Key Storage */}
            <div class="setting-row">
                <div class="setting-info">
                    <div class="setting-label">
                        API Key Storage
                        <span
                            title="Synced storage is unencrypted. API keys may be visible to other extensions or if your Google account is compromised. Use Local storage for better security."
                            style="margin-left: 6px; cursor: help; font-size: 12px;"
                        >
                            ℹ️
                        </span>
                    </div>
                    <div class="setting-hint">
                        {preferences.storageType === 'sync'
                            ? '⚠️ Keys sync across devices (less secure)'
                            : '🔒 Keys stored locally only (more secure)'}
                    </div>
                </div>
                <select
                    class="select select-sm"
                    value={preferences.storageType}
                    onChange={(e) => handleStorageTypeChange(e.currentTarget.value as 'sync' | 'local')}
                >
                    <option value="local">Local only</option>
                    <option value="sync">Sync across devices</option>
                </select>
            </div>

            {/* Telemetry */}
            <div class="setting-row">
                <div class="setting-info">
                    <div class="setting-label">Usage Analytics</div>
                    <div class="setting-hint">
                        Help improve Bar Translator with anonymous usage data
                    </div>
                </div>
                <label class="toggle-switch">
                    <input
                        type="checkbox"
                        checked={preferences.telemetryEnabled}
                        onChange={(e) => handleTelemetryChange(e.currentTarget.checked)}
                    />
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>
    );
}
