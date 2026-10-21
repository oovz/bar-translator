import { useRef, useEffect, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import Sortable from 'sortablejs';
import { getServiceDefinition } from '@/services/base';
import { DeepLTranslationService } from '@/services/deepl';
import { getPreferences } from '@/utils/storage';
import { hasProviderAccess, hasAnyProviderAccess, requestProviderAccess, removeProviderAccess, PROVIDER_ORIGINS } from '@/utils/permissions';
import type { PreferenceUpdate } from '../hooks/usePreferences';
import { SERVICE_TO_STORAGE_KEY, type ServiceId, type TranslationService } from '@/src/types';

interface ServiceListProps {
    readonly services: ReturnType<typeof import('@/services/base').getAllServiceDefinitions>;
    readonly preferences: import('@/src/types').UserPreferences;
    readonly apiKeys: import('@/src/types').StoredApiKeys;
    readonly updatePreferences: (prefs: PreferenceUpdate) => Promise<boolean>;
    readonly saveApiKey: (serviceId: ServiceId, key: string) => void;
    readonly updateKeyValidation: (serviceId: ServiceId, key: string, isValid: boolean) => Promise<void>;
}

type ValidationState = 'idle' | 'validating' | 'valid' | 'error';

export function ServiceList({
    services,
    preferences,
    apiKeys,
    updatePreferences,
    saveApiKey,
    updateKeyValidation,
}: ServiceListProps) {
    const serviceListRef = useRef<HTMLUListElement>(null);
    const sortableRef = useRef<Sortable | null>(null);
    const testedKeys = useRef<Partial<Record<ServiceId, string>>>({});
    const accessRevision = useRef(0);
    const keyTestAttempts = useRef<Partial<Record<ServiceId, symbol>>>({});
    const [expandedService, setExpandedService] = useState<ServiceId | null>(null);
    const [validationState, setValidationState] = useState<Record<string, ValidationState>>({});
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [anyAccess, setAnyAccess] = useState<Partial<Record<ServiceId, boolean>>>({});
    const [access, setAccess] = useState<Partial<Record<ServiceId, boolean>>>({});
    const [busy, setBusy] = useState<ServiceId | null>(null);
    const [permissionError, setPermissionError] = useState('');
    const [keyChangedSinceValidation, setKeyChangedSinceValidation] = useState<Record<string, boolean>>({});

    const enabledServices = preferences.fallbackOrder;
    const disabledServices = services.filter(s => !enabledServices.includes(s.id)).map(s => s.id);

    const getApiKeyForService = (serviceId: ServiceId) => {
        const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
        return storageKey === null ? null : apiKeys[storageKey];
    };

    const isServiceReady = (serviceId: ServiceId): boolean => {
        const service = services.find(s => s.id === serviceId);
        if (!service) return false;
        if (!access[serviceId]) return false;
        if (!service.requiresApiKey) return true;
        const creds = getApiKeyForService(serviceId);
        return Boolean(creds?.key.trim());
    };

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const current = ++accessRevision.current;
            try {
                const grants = await Promise.all(services.map(async service => {
                    const [all, any] = await Promise.all([hasProviderAccess(service.id), hasAnyProviderAccess(service.id)]);
                    return { id: service.id, all, any };
                }));
                if (active && current === accessRevision.current) {
                    setAccess(Object.fromEntries(grants.map(grant => [grant.id, grant.all])));
                    setAnyAccess(Object.fromEntries(grants.map(grant => [grant.id, grant.any])));
                }
            } catch {
                if (active && current === accessRevision.current) setPermissionError(t('permissionCheckFailed'));
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
    }, [services]);

    const changeService = async (serviceId: ServiceId, enabled: boolean, grant?: Promise<boolean>) => {
        setBusy(serviceId);
        setPermissionError('');
        try {
            let removalFailed = false;
            if (enabled) {
                if (!await grant) throw new Error(t('permissionDenied'));
                ++accessRevision.current;
                setAccess(previous => ({ ...previous, [serviceId]: true }));
                setAnyAccess(previous => ({ ...previous, [serviceId]: PROVIDER_ORIGINS[serviceId].length > 0 }));
            } else {
                try {
                    await removeProviderAccess(serviceId);
                    ++accessRevision.current;
                    setAccess(previous => ({ ...previous, [serviceId]: PROVIDER_ORIGINS[serviceId].length === 0 }));
                    setAnyAccess(previous => ({ ...previous, [serviceId]: false }));
                } catch {
                    removalFailed = true;
                }
            }
            const saved = await updatePreferences(current => {
                const order = current.fallbackOrder.filter(id => id !== serviceId);
                if (enabled) order.push(serviceId);
                return { fallbackOrder: order };
            });
            if (saved === false) {
                // Do not retain newly granted access for an enablement that did
                // not persist; another settings page may already have enabled it.
                if (enabled && !(await getPreferences()).fallbackOrder.includes(serviceId)) {
                    try {
                        await removeProviderAccess(serviceId);
                        ++accessRevision.current;
                        setAccess(previous => ({ ...previous, [serviceId]: PROVIDER_ORIGINS[serviceId].length === 0 }));
                        setAnyAccess(previous => ({ ...previous, [serviceId]: false }));
                    } catch {
                        throw new Error(`${t('settingsSaveFailed')} ${t('permissionRemoveFailed')}`);
                    }
                }
                throw new Error(t('settingsSaveFailed'));
            }
            if (removalFailed) setPermissionError(t('permissionRemoveFailed'));
        } catch (error) {
            setPermissionError(error instanceof Error ? error.message : t('permissionChangeFailed'));
        } finally {
            setBusy(null);
        }
    };

    const toggleService = (serviceId: ServiceId) => {
        const enabled = !preferences.fallbackOrder.includes(serviceId);
        // Permission request must run before the first await, during this user click.
        const grant = enabled ? requestProviderAccess(serviceId) : undefined;
        void changeService(serviceId, enabled, grant);
    };

    const grantAccess = (serviceId: ServiceId) => {
        const grant = requestProviderAccess(serviceId);
        setBusy(serviceId);
        setPermissionError('');
        void grant.then(granted => {
            if (!granted) throw new Error(t('permissionDenied'));
            ++accessRevision.current;
            setAccess(previous => ({ ...previous, [serviceId]: true }));
            setAnyAccess(previous => ({ ...previous, [serviceId]: PROVIDER_ORIGINS[serviceId].length > 0 }));
        }).catch(() => setPermissionError(t('permissionDenied'))).finally(() => setBusy(null));
    };

    const releaseAccess = async (serviceId: ServiceId) => {
        setBusy(serviceId);
        setPermissionError('');
        try {
            await removeProviderAccess(serviceId);
            ++accessRevision.current;
            setAccess(previous => ({ ...previous, [serviceId]: false }));
            setAnyAccess(previous => ({ ...previous, [serviceId]: false }));
        } catch {
            setPermissionError(t('permissionRemoveFailed'));
        } finally {
            setBusy(null);
        }
    };

    const handleApiKeyChange = (serviceId: ServiceId, key: string) => {
        saveApiKey(serviceId, key);
        setValidationErrors(previous => ({ ...previous, [serviceId]: '' }));
        setKeyChangedSinceValidation(prev => ({ ...prev, [serviceId]: true }));
        if (validationState[serviceId] === 'valid') {
            setValidationState(prev => ({ ...prev, [serviceId]: 'idle' }));
        }
    };

    const handleValidateKey = async (serviceId: ServiceId, key: string) => {
        const attempt = Symbol();
        keyTestAttempts.current[serviceId] = attempt;
        testedKeys.current[serviceId] = key;
        setValidationState(prev => ({ ...prev, [serviceId]: 'validating' }));
        setValidationErrors(prev => ({ ...prev, [serviceId]: '' }));

        try {
            if (!enabledServices.includes(serviceId) || !await hasProviderAccess(serviceId)) {
                setAccess(previous => ({ ...previous, [serviceId]: false }));
                throw new Error(t('testNeedsAccess'));
            }
            const service = new DeepLTranslationService(getServiceDefinition('deepl'));
            const result = await service.validateApiKey(key);
            if (keyTestAttempts.current[serviceId] !== attempt) return;
            await updateKeyValidation(serviceId, key, result.valid);
            if (keyTestAttempts.current[serviceId] !== attempt) return;

            if (result.valid) {
                setValidationState(prev => ({ ...prev, [serviceId]: 'valid' }));
                setKeyChangedSinceValidation(prev => ({ ...prev, [serviceId]: false }));
            } else {
                setValidationState(prev => ({ ...prev, [serviceId]: 'error' }));
                setValidationErrors(prev => ({ ...prev, [serviceId]: t('keyTestFailed') }));
            }
        } catch (e) {
            if (keyTestAttempts.current[serviceId] !== attempt) return;
            setValidationState(prev => ({ ...prev, [serviceId]: 'error' }));
            setValidationErrors(prev => ({
                ...prev,
                [serviceId]: e instanceof Error && e.message === 'API key changed. Test the current key again.' ? t('keyChangedDuringTest') : t('keyTestFailed')
            }));
        }
    };

    useEffect(() => {
        if (!serviceListRef.current) return;

        if (sortableRef.current) {
            sortableRef.current.destroy();
        }

        sortableRef.current = Sortable.create(serviceListRef.current, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            filter: '.disabled-item',
            onEnd: (evt) => {
                if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
                if (evt.oldIndex === evt.newIndex) return;

                const enabledServices = [...preferences.fallbackOrder];
                const [moved] = enabledServices.splice(evt.oldIndex, 1);
                if (moved === undefined) return;
                enabledServices.splice(evt.newIndex, 0, moved);

                updatePreferences(current => {
                    const ordered = enabledServices.filter(id => current.fallbackOrder.includes(id));
                    const added = current.fallbackOrder.filter(id => !enabledServices.includes(id));
                    return { fallbackOrder: [...ordered, ...added] };
                });
            },
        });

        return () => {
            if (sortableRef.current) {
                sortableRef.current.destroy();
                sortableRef.current = null;
            }
        };
    }, [preferences.fallbackOrder]);

    const renderApiKeyInput = (serviceId: ServiceId, svc: TranslationService) => {
        const creds = getApiKeyForService(serviceId);
        const apiKey = creds?.key || '';
        const state = testedKeys.current[serviceId] === apiKey ? validationState[serviceId] || 'idle' : 'idle';
        const keyChanged = keyChangedSinceValidation[serviceId];

        let buttonText = t('testKey');
        let buttonDisabled = !apiKey.trim() || state === 'validating' || !enabledServices.includes(serviceId) || !access[serviceId];
        let buttonClass = 'btn btn-sm btn-primary';

        if (state === 'validating') {
            buttonText = t('checking'); // ... or 'Checking...'
        } else if (state === 'valid' && !keyChanged) {
            buttonText = t('valid'); // '✓ Valid'
            buttonDisabled = true;
            buttonClass = 'btn btn-sm btn-success';
        } else if (state === 'error' && !keyChanged) {
            buttonText = t('retry');
        }

        return (
            <div class="api-key-section" id={`api-key-${serviceId}`}>
                <div class="api-key-input">
                    <input
                        {...(showKeys[serviceId] ? { type: 'text' as const } : { type: 'password' as const })}
                        class="input"
                        placeholder={t('enterApiKey', [svc.name])}
                        aria-label={t('enterApiKey', [svc.name])}
                        autoComplete="off"
                        spellcheck={false}
                        value={apiKey}
                        onInput={(e) => handleApiKeyChange(serviceId, e.currentTarget.value)}
                        disabled={state === 'validating'}
                    />
                    <button
                        class="btn btn-sm"
                        onClick={() => setShowKeys(prev => ({
                            ...prev,
                            [serviceId]: !prev[serviceId]
                        }))}
                    >
                        {showKeys[serviceId] ? t('hide') : t('show')}
                    </button>
                    <button
                        class={buttonClass}
                        onClick={() => handleValidateKey(serviceId, apiKey)}
                        disabled={buttonDisabled}
                    >
                        {buttonText}
                    </button>
                </div>
                {testedKeys.current[serviceId] === apiKey && validationErrors[serviceId] && (
                    <div class="feedback feedback-error" role="alert">
                        {validationErrors[serviceId]}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div class="section" id="providers" tabIndex={-1}>
            <div class="section-title">{t('sectionTranslationServices')}</div>
            {permissionError && <div class="feedback feedback-error" role="alert">{permissionError}</div>}
            <div class="section-description">
                {t('servicesDesc')}
            </div>

            <ul class="service-list" ref={serviceListRef}>
                {enabledServices.map((serviceId, idx) => {
                    const svc = services.find(s => s.id === serviceId);
                    if (!svc) return null;
                    const ready = isServiceReady(serviceId);
                    const isExpanded = expandedService === serviceId;

                    return (
                        <li key={serviceId} class="service-item enabled" data-id={serviceId}>
                            <div class="service-row">
                                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                                <span class="service-index">{idx + 1}</span>
                                <div class="service-info">
                                    <div class="service-heading">
                                        <span class="service-name">{svc.name}</span>
                                        {idx === 0 && <span class="badge badge-primary">{t('primary')}</span>}
                                        {ready && <span class="badge badge-success" aria-label={t('providerReady')}>✓</span>}
                                    </div>
                                    {!ready && <span class="setting-hint service-status">
                                        {!access[serviceId] ? t('providerPermissionRequired') : t('keyNeeded')}
                                    </span>}
                                </div>
                                <div class="service-actions">
                                    {!access[serviceId] && <button class="btn btn-sm" disabled={busy !== null} onClick={() => grantAccess(serviceId)}>{t('grantAccess')}</button>}
                                    {svc.requiresApiKey && (
                                        <button
                                            class="btn btn-sm"
                                            aria-expanded={isExpanded}
                                            aria-controls={`api-key-${serviceId}`}
                                            onClick={() => setExpandedService(isExpanded ? null : serviceId)}
                                        >
                                            {t('apiKeyLabel')}
                                        </button>
                                    )}
                                    <button
                                        class="btn btn-sm"
                                        onClick={() => toggleService(serviceId)}
                                        title="Disable service"
                                        aria-label="Disable service"
                                        disabled={busy !== null}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                            {svc.requiresApiKey && isExpanded && renderApiKeyInput(serviceId, svc)}
                        </li>
                    );
                })}
            </ul>

            {disabledServices.length > 0 && (
                <div style="margin-top: 12px;">
                    <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 6px;">
                        {t('availableServices')}
                    </div>
                    <ul class="service-list disabled-list">
                        {disabledServices.map(serviceId => {
                            const svc = services.find(s => s.id === serviceId);
                            if (!svc) return null;
                            const isExpanded = expandedService === serviceId;

                            return (
                                <li key={serviceId} class="service-item disabled-item" data-id={serviceId}>
                                    <div class="service-row">
                                        <div class="service-info service-heading">
                                            <span class="service-name">{svc.name}</span>
                                            {svc.requiresApiKey ? (
                                                <span class="badge badge-muted">{t('keyRequired')}</span>
                                            ) : (
                                                <span class="badge badge-success">{t('free')}</span>
                                            )}
                                        </div>
                                        <div class="service-actions">
                                            {anyAccess[serviceId] && PROVIDER_ORIGINS[serviceId].length > 0 && <button class="btn btn-sm" disabled={busy !== null} onClick={() => { void releaseAccess(serviceId); }}>{t('removeAccess')}</button>}
                                            {svc.requiresApiKey && (
                                                <button
                                                    class="btn btn-sm"
                                                    aria-expanded={isExpanded}
                                                    aria-controls={`api-key-${serviceId}`}
                                                    onClick={() => setExpandedService(isExpanded ? null : serviceId)}
                                                >
                                                    {t('apiKeyLabel')}
                                                </button>
                                            )}
                                            <button
                                                class="btn btn-sm btn-primary"
                                                onClick={() => toggleService(serviceId)}
                                                title="Enable service"
                                                aria-label="Enable service"
                                                disabled={busy !== null}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                    {svc.requiresApiKey && isExpanded && renderApiKeyInput(serviceId, svc)}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {enabledServices.length === 0 && (
                <div class="feedback feedback-warning">
                    {t('noServicesEnabled')}
                </div>
            )}
        </div>
    );
}
