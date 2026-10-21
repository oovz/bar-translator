import { useEffect } from 'preact/hooks';
import { usePreferences } from './hooks/usePreferences';
import { getAllServiceDefinitions } from '@/services/base';
import { getSourceLanguages, getTargetLanguages, OVERRIDABLE_LANGUAGES, fromUserInput } from '@/utils/languages';
import { ServiceList } from './components/ServiceList';
import { CopySettings } from './components/CopySettings';
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
        storageType,
        changingStorage,
        changeStorageType,
        loading,
        error,
        updatePreferences,
        saveApiKey,
        updateKeyValidation
    } = usePreferences();

    const services = getAllServiceDefinitions();
    const sourceLanguages = getSourceLanguages();
    const targetLanguages = getTargetLanguages();

    // Set document title
    useEffect(() => {
        document.title = t('extName') + ' ' + t('settings');
        // Remove data left by the retired analytics client from this extension's origin.
        const token = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
        const keys = [
            `ph_${token}_posthog`, `__ph_opt_in_out_${token}`,
            `ph_${token}_window_id`, `ph_${token}_primary_window_exists`,
        ];
        for (const storage of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) storage.removeItem(key);
        }
    }, []);

    useEffect(() => {
        if (loading) return;
        const focusSection = () => {
            const id = window.location.hash.slice(1);
            if (id === 'providers' || id === 'copy') {
                const section = document.getElementById(id);
                section?.focus();
                section?.scrollIntoView?.();
            }
        };
        focusSection();
        window.addEventListener('hashchange', focusSection);
        return () => window.removeEventListener('hashchange', focusSection);
    }, [loading]);

    if (loading) {
        return (
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                {t('loading')}
            </div>
        );
    }

    return (
        <div>
            {error && <div class="feedback feedback-error" role="alert">{error}</div>}
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
                <div class="section-description">
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
                                    const value = e.currentTarget.value;
                                    updatePreferences(current => {
                                        const overrides = { ...(current.languageOverrides || {}) };
                                        if (value) overrides[isoCode] = value;
                                        else delete overrides[isoCode];
                                        return { languageOverrides: overrides };
                                    });
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
            <fieldset disabled={changingStorage} style="border: 0; padding: 0; margin: 0; min-width: 0;">
                <ServiceList
                    services={services}
                    preferences={preferences}
                    apiKeys={apiKeys}
                    updatePreferences={updatePreferences}
                    saveApiKey={saveApiKey}
                    updateKeyValidation={updateKeyValidation}
                />
            </fieldset>

            <CopySettings />

            {/* Privacy & Storage */}
            <PrivacySettings
                storageType={storageType}
                changingStorage={changingStorage}
                changeStorageType={changeStorageType}
            />

            {/* Footer */}
            <div class="footer" dangerouslySetInnerHTML={{ __html: t('footerUsage') }} />
        </div>
    );
}
