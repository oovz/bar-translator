import { useEffect, useRef, useState } from 'preact/hooks';
import { hasCopyAccess, requestCopyAccess } from '@/utils/permissions';
import type { SetupUpdate } from '../hooks/usePreferences';
import { t } from '@/utils/i18n';
import { getSetup, reconcileSetupAccess } from '@/utils/storage';

interface CopySettingsProps {
    readonly copyEnabled: boolean;
    readonly updateSetup: (updater: SetupUpdate) => Promise<boolean>;
}

export function CopySettings({ copyEnabled, updateSetup }: CopySettingsProps) {
    const [allowed, setAllowed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    const setPending = (next: boolean) => { pending.current = next; setBusy(next); };

    useEffect(() => {
        let active = true;
        let revision = 0;
        const refresh = async () => {
            const request = ++revision;
            try {
                const granted = await hasCopyAccess();
                if (active && request === revision) setAllowed(granted);
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

    const grant = () => {
        if (pending.current) return;
        const operation = requestCopyAccess();
        setPending(true);
        setError('');
        void operation.then(async granted => {
            const actual = await hasCopyAccess();
            setAllowed(actual);
            if (!granted || !actual) throw new Error(t('permissionDenied'));
        }).catch(() => setError(t('permissionDenied'))).finally(() => setPending(false));
    };

    const toggle = () => {
        if (pending.current) return;
        // Start optional access while the enabling click still has its user gesture.
        const operation = !copyEnabled ? requestCopyAccess() : undefined;
        setPending(true);
        setError('');
        void (async () => {
            if (!copyEnabled) {
                if (!await operation) throw new Error(t('permissionDenied'));
                const actual = await hasCopyAccess();
                setAllowed(actual);
                if (!actual) throw new Error(t('permissionDenied'));
                if (!await updateSetup(async current => {
                    if (!await hasCopyAccess()) throw new Error(t('permissionDenied'));
                    return { ...current, copyEnabled: true };
                })) {
                    try {
                        await reconcileSetupAccess({ ...await getSetup(), copyEnabled: true });
                        setAllowed(await hasCopyAccess());
                    } catch { throw new Error(`${t('settingsSaveFailed')} ${t('permissionRemoveFailed')}`); }
                    throw new Error(t('settingsSaveFailed'));
                }
            } else {
                if (!await updateSetup(current => ({ ...current, copyEnabled: false }))) throw new Error(t('settingsSaveFailed'));
                await reconcileSetupAccess({ ...await getSetup(), copyEnabled: true });
                const actual = await hasCopyAccess();
                setAllowed(actual);
                if (actual && !(await getSetup()).copyEnabled) throw new Error(t('permissionRemoveFailed'));
            }
        })().catch(reason => setError(reason instanceof Error ? reason.message : t('permissionChangeFailed'))).finally(() => setPending(false));
    };

    return <div class="section" id="copy" tabIndex={-1}>
        <div class="section-title">{t('sectionCopy')}</div>
        <div class="setting-row">
            <div class="setting-info">
                <label class="setting-label" htmlFor="enable-copy">{t('enableCopy')}</label>
                <div class="setting-hint" id="copy-description">{t('copySettingsDesc')}</div>
                {copyEnabled && !allowed && <div class="setting-hint">{t('providerPermissionRequired')}</div>}
            </div>
            {copyEnabled && !allowed && <button class="btn btn-sm" disabled={busy} onClick={grant}>{t('grantAccess')}</button>}
            <label class="toggle-switch">
                <input id="enable-copy" type="checkbox" aria-describedby="copy-description" checked={copyEnabled} aria-disabled={busy} aria-busy={busy}
                    onClick={event => { if (pending.current) event.preventDefault(); }} onChange={toggle} />
                <span class="toggle-slider" aria-hidden="true" />
            </label>
        </div>
        {error && <div class="feedback feedback-error" role="alert">{error}</div>}
    </div>;
}
