import { useEffect } from 'preact/hooks';
import { usePreferences } from './hooks/usePreferences';
import { getAllServiceDefinitions } from '@/services/base';
import { getSourceLanguages, getTargetLanguages, OVERRIDABLE_LANGUAGES, fromUserInput } from '@/utils/languages';
import { ServiceList } from './components/ServiceList';
import { PrivacySettings } from './components/PrivacySettings';
import { Combobox } from './components/Combobox';
import { t } from '@/utils/i18n';

const VARIANT_KEY_MAP: Record<string, string> = {
    'zh-CN': 'lang_variant_simple',
    'zh-TW': 'lang_variant_traditional',
    'pt-PT': 'lang_variant_portugal',
    'pt-BR': 'lang_variant_brazil',
    'en-US': 'lang_variant_us',
    'en-GB': 'lang_variant_uk',
};

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

    // Set document title
    useEffect(() => {
        document.title = t('extName') + ' ' + t('settings');
    }, []);

    if (loading) {
        return (
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                {t('loading')}
            </div>
        );
    }

    return (
        <div>
            {/* Languages */}
            <div class="section">
                <div class="section-title">{t('sectionDefaultLanguages')}</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>{t('labelSource')}</label>
                        <Combobox
                            value={preferences.defaultSourceLang}
                            options={sourceLanguages}
                            onChange={(val) => updatePreferences({ defaultSourceLang: val })}
                        />
                    </div>
                    <div class="form-group">
                        <label>{t('labelTarget')}</label>
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
                <div class="section-title">{t('sectionRegionalDialects')}</div>
                <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 13px;">
                    {t('regionalDialectsDesc')}
                </div>
                <div class="form-row">
                    {Object.entries(OVERRIDABLE_LANGUAGES).map(([isoCode, config]) => (
                        <div class="form-group" key={isoCode}>
                            <label>{t(`lang_${isoCode}`)} ({isoCode})</label>
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
                                <option value="">{t('optionDefault', [fromUserInput(isoCode)])}</option>
                                {config.options.map(opt => (
                                    <option key={opt.code} value={opt.code}>
                                        {t(VARIANT_KEY_MAP[opt.code] || opt.name)}
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
            <div class="footer" dangerouslySetInnerHTML={{ __html: t('footerUsage') }} />
        </div>
    );
}
