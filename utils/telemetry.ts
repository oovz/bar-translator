/**
 * PostHog Telemetry Utility
 *
 * Provides anonymous usage analytics using PostHog.
 * Respects user's telemetry opt-out preference.
 *
 * @see https://posthog.com/docs/libraries/browser-extensions
 * @module utils/telemetry
 */

import posthog from 'posthog-js';
import { getPreferences } from '@/utils/storage';

const POSTHOG_API_KEY = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Environment detection
const isUI = typeof window !== 'undefined' && typeof document !== 'undefined';

// Cache identity and state
let cachedDistinctId: string | null = null;
let telemetryEnabled = true; // Default to true until prefs loaded

/**
 * Initialize telemetry using official PostHog library.
 */
export async function initTelemetry(): Promise<void> {
    try {
        const prefs = await getPreferences();
        telemetryEnabled = prefs.telemetryEnabled;
        cachedDistinctId = prefs.distinctId;

        console.log('[Telemetry] Initializing', { enabled: telemetryEnabled, distinctId: cachedDistinctId, context: isUI ? 'UI' : 'Worker' });

        if (telemetryEnabled) {
            posthog.init(POSTHOG_API_KEY, {
                api_host: POSTHOG_HOST,
                // Enable debug logs for troubleshooting
                debug: true,
                // Use localStorage in UI for better persistence, memory in Service Worker
                persistence: isUI ? 'localStorage' : 'memory',
                // Disable autocapture to ensure no sensitive input (API keys) is tracked
                autocapture: false,
                // Enable page views only in UI
                capture_pageview: isUI,
                capture_pageleave: isUI,
                disable_session_recording: true,
                advanced_disable_decide: true,
                // Ensure we identify the user once loaded
                loaded: (ph) => {
                    if (cachedDistinctId) {
                        ph.identify(cachedDistinctId);
                    }
                },
            });
        }
    } catch (error) {
        console.error('[Telemetry] Failed to initialize:', error);
    }
}

/**
 * Check if telemetry is enabled.
 */
export function isTelemetryEnabled(): boolean {
    return telemetryEnabled;
}

/**
 * Update telemetry enabled state.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
    telemetryEnabled = enabled;
    if (enabled) {
        if (!posthog.__loaded) {
            await initTelemetry();
        } else {
            posthog.opt_in_capturing();
        }
    } else {
        posthog.opt_out_capturing();
    }
}

/**
 * Track an event using PostHog SDK.
 */
export function trackEvent(
    event: string,
    properties?: Record<string, any>
): void {
    if (!telemetryEnabled) {
        return;
    }

    try {
        console.log('[Telemetry] Tracking event:', event, properties);

        // Explicitly pass distinct_id to ensure attribution even if internal state is fresh
        posthog.capture(
            event,
            {
                distinct_id: cachedDistinctId,
                $lib: 'bar-translator-extension',
                context: isUI ? 'options_page' : 'background',
                ...properties,
            },
            // In Service Worker (background), we must send instantly as there is no loop/window to handle batching guarantees
            // @ts-ignore - send_instantly is a valid option in posthog-js
            { send_instantly: !isUI }
        );
    } catch (error) {
        console.error('[Telemetry] Failed to track event:', error);
    }
}



/**
 * Identify a user.
 */
export function identifyUser(_userId: string): void {
    if (cachedDistinctId) {
        posthog.identify(cachedDistinctId);
    }
}

// Event name constants
export const TelemetryEvents = {
    TRANSLATION_REQUESTED: 'translation_requested',
    TRANSLATION_SUCCEEDED: 'translation_succeeded',
    TRANSLATION_FAILED: 'translation_failed',
} as const;
