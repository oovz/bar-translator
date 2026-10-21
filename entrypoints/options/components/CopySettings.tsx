import { useEffect, useState } from 'preact/hooks';
import { hasCopyAccess, requestCopyAccess, removeCopyAccess } from '@/utils/permissions';
import { t } from '@/utils/i18n';

export function CopySettings() {
    const [allowed, setAllowed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        let revision = 0;
        const refresh = async () => {
            const current = ++revision;
            try {
                const granted = await hasCopyAccess();
                if (active && current === revision) setAllowed(granted);
            } catch {
                if (active) setError(t('permissionCheckFailed'));
            }
        };
        void refresh();
        chrome.permissions.onAdded.addListener(refresh);
        chrome.permissions.onRemoved.addListener(refresh);
        return () => {
            active = false;
            chrome.permissions.onAdded.removeListener(refresh);
            chrome.permissions.onRemoved.removeListener(refresh);
        };
    }, []);

    const toggle = () => {
        // Start the request synchronously to retain the browser's user gesture.
        const operation = allowed ? removeCopyAccess() : requestCopyAccess();
        const enabling = !allowed;
        setBusy(true);
        setError('');
        void operation.then(async granted => {
            const actual = await hasCopyAccess();
            setAllowed(actual);
            if (enabling && (!granted || !actual)) setError(t('permissionDenied'));
            if (!enabling && actual) setError(t('permissionRemoveFailed'));
        }).catch(() => setError(t('permissionChangeFailed'))).finally(() => setBusy(false));
    };

    return (
        <div class="section" id="copy" tabIndex={-1}>
            <div class="section-title">{t('sectionCopy')}</div>
            <div class="setting-row">
                <div class="setting-info">
                    <label class="setting-label" htmlFor="enable-copy">{t('enableCopy')}</label>
                    <div class="setting-hint" id="copy-description">{t('copySettingsDesc')}</div>
                </div>
                <label class="toggle-switch">
                    <input id="enable-copy" type="checkbox" aria-describedby="copy-description" checked={allowed} disabled={busy} onChange={toggle} />
                    <span class="toggle-slider" aria-hidden="true" />
                </label>
            </div>
            {error && <div class="feedback feedback-error" role="alert">{error}</div>}
        </div>
    );
}
