import { useEffect } from 'preact/hooks';
import { usePreferences } from './hooks/usePreferences';
import { getAllServiceDefinitions } from '@/services/base';
import { getSourceLanguages, getTargetLanguages } from '@/utils/languages';
import { ServiceList } from './components/ServiceList';
import { PrivacySettings } from './components/PrivacySettings';

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
            updatePreferences({ fallbackOrder: ['google-scraper'] });
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
                        <select
                            class="select"
                            value={preferences.defaultSourceLang}
                            onChange={(e) => updatePreferences({ defaultSourceLang: e.currentTarget.value })}
                        >
                            {sourceLanguages.map(lang => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.code === 'auto' ? 'Auto-detect' : `${lang.code} → ${lang.name}`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Target</label>
                        <select
                            class="select"
                            value={preferences.defaultTargetLang}
                            onChange={(e) => updatePreferences({ defaultTargetLang: e.currentTarget.value })}
                        >
                            {targetLanguages.map(lang => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.code} → {lang.name}
                                </option>
                            ))}
                        </select>
                    </div>
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
