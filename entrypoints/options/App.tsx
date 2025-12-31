import { useEffect } from 'preact/hooks';
import { usePreferences } from './hooks/usePreferences';
import { getAllServiceDefinitions } from '@/services/base';
import { getSourceLanguages, getTargetLanguages, OVERRIDABLE_LANGUAGES, fromUserInput } from '@/utils/languages';
import { ServiceList } from './components/ServiceList';
import { PrivacySettings } from './components/PrivacySettings';
import { Combobox } from './components/Combobox';

export default function App() {
    const {
        preferences,
        apiKeys,
        loading,
        updatePreferences,
        saveApiKey,
        updateKeyValidation
    } = usePreferences();

    const services = getAllServiceDefinitions();
    const sourceLanguages = getSourceLanguages();
    const targetLanguages = getTargetLanguages();

    // Initialize with Google Translate enabled by default
    useEffect(() => {
        if (loading) return;
        if (preferences.fallbackOrder.length === 0) {
            updatePreferences({ fallbackOrder: ['google-web'] });
        }
    }, [loading]);

    if (loading) {
        return (
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                Loading...
            </div>
        );
    }

    return (
        <div>
            {/* Languages */}
            <div class="section">
                <div class="section-title">Default Languages</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Source</label>
                        <Combobox
                            value={preferences.defaultSourceLang}
                            options={sourceLanguages}
                            onChange={(val) => updatePreferences({ defaultSourceLang: val })}
                        />
                    </div>
                    <div class="form-group">
                        <label>Target</label>
                        <Combobox
                            value={preferences.defaultTargetLang}
                            options={targetLanguages}
                            onChange={(val) => updatePreferences({ defaultTargetLang: val })}
                        />
                    </div>
                </div>
            </div>

            {/* Regional Dialects */}
            <div class="section">
                <div class="section-title">Regional Dialects</div>
                <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 13px;">
                    Choose which specific variant to use when typing short codes (e.g., 'zh' → 'zh-TW').
                </div>
                <div class="form-row">
                    {Object.entries(OVERRIDABLE_LANGUAGES).map(([isoCode, config]) => (
                        <div class="form-group" key={isoCode}>
                            <label>{config.name} ({isoCode})</label>
                            <select
                                class="select"
                                value={preferences.languageOverrides?.[isoCode] || ''}
                                onChange={(e) => {
                                    const newOverrides = { ...(preferences.languageOverrides || {}) };
                                    if (e.currentTarget.value) {
                                        newOverrides[isoCode] = e.currentTarget.value;
                                    } else {
                                        delete newOverrides[isoCode];
                                    }
                                    updatePreferences({ languageOverrides: newOverrides });
                                }}
                            >
                                <option value="">Default ({fromUserInput(isoCode)})</option>
                                {config.options.map(opt => (
                                    <option key={opt.code} value={opt.code}>
                                        {opt.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            </div>

            {/* Translation Services */}
            <ServiceList
                services={services}
                preferences={preferences}
                apiKeys={apiKeys}
                updatePreferences={updatePreferences}
                saveApiKey={saveApiKey}
                updateKeyValidation={updateKeyValidation}
            />

            {/* Privacy & Storage */}
            <PrivacySettings
                preferences={preferences}
                updatePreferences={updatePreferences}
            />

            {/* Footer */}
            <div class="footer">
                Type <code>t hello</code> in address bar to translate
            </div>
        </div>
    );
}
