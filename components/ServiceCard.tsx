// import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { TranslationService } from '@/src/types';

interface ServiceCardProps {
    service: TranslationService;
    isPreferred: boolean;
    apiKey: string;
    isKeyValid: boolean;
    onSetPreferred: () => void;
    onApiKeyChange: (key: string) => void;
    onValidateKey: () => void;
    loading?: boolean;
    error?: string;
    isFallback?: boolean;
    onToggleFallback?: (enabled: boolean) => void;
}

export function ServiceCard({
    service,
    isPreferred,
    apiKey,
    isKeyValid,
    onSetPreferred,
    onApiKeyChange,
    onValidateKey,
    loading = false,
    error,
}: ServiceCardProps) {
    const [showKey, setShowKey] = useState(false);

    return (
        <div class={`card ${isPreferred ? 'border-primary' : ''}`} style={isPreferred ? 'border-color: var(--primary-color); border-width: 2px;' : ''}>
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div>
                    <h3 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                        {service.name}
                        {isPreferred && (
                            <span style="background: var(--primary-color); color: white; font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 999px;">
                                Preferred
                            </span>
                        )}
                    </h3>
                    <p style="margin: 0.25rem 0 0; color: var(--text-secondary); font-size: 0.875rem;">
                        Type: {service.type === 'api' ? 'Official API' : 'Web Scraper'}
                        {service.requiresApiKey && ' • Requires API Key'}
                    </p>
                </div>

                {!isPreferred && (
                    <button
                        class="btn"
                        onClick={onSetPreferred}
                        style="color: var(--primary-color); border: 1px solid var(--primary-color); background: transparent;"
                    >
                        Make Preferred
                    </button>
                )}
            </div>

            {service.requiresApiKey && (
                <div class="api-key-section" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <div class="form-group">
                        <label class="label">API Key</label>
                        <div style="display: flex; gap: 0.5rem;">
                            <input
                                type={showKey ? 'text' : 'password'}
                                class="input"
                                value={apiKey}
                                onInput={(e) => onApiKeyChange(e.currentTarget.value)}
                                placeholder={`Enter ${service.name} API Key`}
                                disabled={loading}
                            />
                            <button
                                class="btn"
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                style="background: var(--bg-color); border: 1px solid var(--border-color);"
                                title={showKey ? "Hide key" : "Show key"}
                            >
                                {showKey ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <button
                            class="btn btn-primary"
                            onClick={onValidateKey}
                            disabled={loading || !apiKey}
                        >
                            {loading ? 'Checking...' : (isKeyValid ? 'Re-validate' : 'Validate Key')}
                        </button>

                        {isKeyValid && (
                            <span style="color: var(--success-color); font-size: 0.875rem; font-weight: 500;">
                                ✓ Validated
                            </span>
                        )}
                        {error && (
                            <span style="color: var(--danger-color); font-size: 0.875rem; font-weight: 500;">
                                {error}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
