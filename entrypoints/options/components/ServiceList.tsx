import { useRef, useEffect, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import Sortable from 'sortablejs';
import { getServiceDefinition } from '@/services/base';
import { DeepLTranslationService } from '@/services/deepl';
import type { ServiceId } from '@/src/types';

interface ServiceListProps {
    readonly services: ReturnType<typeof import('@/services/base').getAllServiceDefinitions>;
    readonly preferences: import('@/src/types').UserPreferences;
    readonly apiKeys: import('@/src/types').StoredApiKeys;
    readonly updatePreferences: (prefs: Partial<import('@/src/types').UserPreferences>) => void;
    readonly saveApiKey: (serviceId: ServiceId, key: string) => void;
    readonly updateKeyValidation: (serviceId: ServiceId, isValid: boolean) => Promise<void>;
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
    const [expandedService, setExpandedService] = useState<ServiceId | null>(null);
    const [validationState, setValidationState] = useState<Record<string, ValidationState>>({});
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [keyChangedSinceValidation, setKeyChangedSinceValidation] = useState<Record<string, boolean>>({});

    const enabledServices = preferences.fallbackOrder;
    const disabledServices = services.filter(s => !enabledServices.includes(s.id)).map(s => s.id);

    const getApiKeyForService = (serviceId: ServiceId) => {
        if (serviceId === 'google-web' || serviceId === 'lingva') return null;
        if (serviceId === 'google-cloud') return (apiKeys as any).googleCloud;
        return (apiKeys as any)[serviceId];
    };

    const isServiceEnabled = (serviceId: ServiceId): boolean => preferences.fallbackOrder.includes(serviceId);

    const isServiceReady = (serviceId: ServiceId): boolean => {
        const service = services.find(s => s.id === serviceId);
        if (!service) return false;
        if (!service.requiresApiKey) return true;
        const creds = getApiKeyForService(serviceId);
        return creds?.validated === true;
    };

    const toggleService = (serviceId: ServiceId) => {
        const currentOrder = [...preferences.fallbackOrder];
        const idx = currentOrder.indexOf(serviceId);
        if (idx >= 0) {
            currentOrder.splice(idx, 1);
        } else {
            currentOrder.push(serviceId);
        }
        updatePreferences({ fallbackOrder: currentOrder });
    };

    const handleApiKeyChange = (serviceId: ServiceId, key: string) => {
        saveApiKey(serviceId, key);
        setKeyChangedSinceValidation(prev => ({ ...prev, [serviceId]: true }));
        if (validationState[serviceId] === 'valid') {
            setValidationState(prev => ({ ...prev, [serviceId]: 'idle' }));
        }
    };

    const handleValidateKey = async (serviceId: ServiceId, key: string) => {
        setValidationState(prev => ({ ...prev, [serviceId]: 'validating' }));
        setValidationErrors(prev => ({ ...prev, [serviceId]: '' }));

        try {
            let valid = false;
            let error = '';

            if (serviceId === 'deepl') {
                const def = getServiceDefinition('deepl');
                const service = new DeepLTranslationService(def);
                const result = await service.validateApiKey(key);
                valid = result.valid;
                if (!valid) error = t('invalidApiKey');
            } else {
                valid = key.length > 0;
                if (!valid) error = t('apiKeyRequired');
                await new Promise(r => setTimeout(r, 500));
            }

            if (valid) {
                await updateKeyValidation(serviceId, true);
                setValidationState(prev => ({ ...prev, [serviceId]: 'valid' }));
                setKeyChangedSinceValidation(prev => ({ ...prev, [serviceId]: false }));
                if (!isServiceEnabled(serviceId)) {
                    toggleService(serviceId);
                }
            } else {
                setValidationState(prev => ({ ...prev, [serviceId]: 'error' }));
                setValidationErrors(prev => ({ ...prev, [serviceId]: error }));
                await updateKeyValidation(serviceId, false);
            }
        } catch (e) {
            setValidationState(prev => ({ ...prev, [serviceId]: 'error' }));
            setValidationErrors(prev => ({
                ...prev,
                [serviceId]: e instanceof Error ? e.message : 'Validation error'
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

                const enabledServices = preferences.fallbackOrder.filter(id => isServiceEnabled(id));
                const [moved] = enabledServices.splice(evt.oldIndex, 1);
                enabledServices.splice(evt.newIndex, 0, moved);

                updatePreferences({ fallbackOrder: enabledServices });
            },
        });

        return () => {
            if (sortableRef.current) {
                sortableRef.current.destroy();
                sortableRef.current = null;
            }
        };
    }, [preferences.fallbackOrder.length]);

    const renderApiKeyInput = (serviceId: ServiceId, svc: any) => {
        const creds = getApiKeyForService(serviceId);
        const apiKey = creds?.key || '';
        const state = validationState[serviceId] || 'idle';
        const keyChanged = keyChangedSinceValidation[serviceId];

        let buttonText = 'Test';
        let buttonDisabled = !apiKey || state === 'validating';
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
            <div class="api-key-section">
                <div class="api-key-input">
                    <input
                        type={showKeys[serviceId] ? 'text' : 'password'}
                        class="input"
                        placeholder={t('enterApiKey', [svc.name])}
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
                {validationErrors[serviceId] && (
                    <div style="color: var(--danger-color); font-size: 10px; margin-top: 4px;">
                        {validationErrors[serviceId]}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div class="section">
            <div class="section-title">{t('sectionTranslationServices')}</div>
            <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 8px;">
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
                                    <span class="service-name">{svc.name}</span>
                                    {idx === 0 && <span class="badge badge-primary">{t('primary')}</span>}
                                    {ready ? (
                                        <span class="badge badge-success">✓</span>
                                    ) : svc.requiresApiKey ? (
                                        <span class="badge badge-warning">{t('keyNeeded')}</span>
                                    ) : null}
                                </div>
                                <div class="service-actions">
                                    {svc.requiresApiKey && (
                                        <button
                                            class="btn btn-sm"
                                            onClick={() => setExpandedService(isExpanded ? null : serviceId)}
                                        >
                                            {isExpanded ? '▲' : 'API Key'}
                                        </button>
                                    )}
                                    <button
                                        class="btn btn-sm"
                                        onClick={() => toggleService(serviceId)}
                                        title="Disable service"
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
                                        <div class="service-info" style="flex: 1;">
                                            <span class="service-name">{svc.name}</span>
                                            {svc.requiresApiKey ? (
                                                <span class="badge badge-muted">{t('keyRequired')}</span>
                                            ) : (
                                                <span class="badge badge-success">{t('free')}</span>
                                            )}
                                        </div>
                                        <div class="service-actions">
                                            {svc.requiresApiKey && (
                                                <button
                                                    class="btn btn-sm"
                                                    onClick={() => setExpandedService(isExpanded ? null : serviceId)}
                                                >
                                                    {isExpanded ? '▲' : 'API Key'}
                                                </button>
                                            )}
                                            <button
                                                class="btn btn-sm btn-primary"
                                                onClick={() => toggleService(serviceId)}
                                                title="Enable service"
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
                <div style="padding: 12px; background: rgba(245,158,11,0.1); border-radius: 4px; font-size: 11px; color: var(--warning-color);">
                    {t('noServicesEnabled')}
                </div>
            )}
        </div>
    );
}
