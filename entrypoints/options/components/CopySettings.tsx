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
            <p>{t('copySettingsDesc')}</p>
            <label>
                <input type="checkbox" checked={allowed} disabled={busy} onChange={toggle} />
                {' '}{t('enableCopy')}
            </label>
            {error && <div role="alert">{error}</div>}
        </div>
    );
}
