/**
 * Unit Tests for Telemetry Utility
 *
 * @module tests/unit/telemetry.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
    initTelemetry,
    trackEvent,
    setTelemetryEnabled,
} from '@/utils/telemetry';
import { getPreferences } from '@/utils/storage';

// Auto-mock storage
vi.mock('@/utils/storage');

// Mock posthog-js
const { mockCapture, mockIdentify, mockInit, mockOptOut, mockOptIn } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockIdentify: vi.fn(),
    mockInit: vi.fn(),
    mockOptOut: vi.fn(),
    mockOptIn: vi.fn(),
}));

vi.mock('posthog-js', () => ({
    default: {
        init: mockInit,
        capture: mockCapture,
        identify: mockIdentify,
        opt_out_capturing: mockOptOut,
        opt_in_capturing: mockOptIn,
        __loaded: false,
    },
}));

describe('Telemetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setTelemetryEnabled(true);
        // Default mock implementation
        (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: true });
    });

    describe('initTelemetry', () => {
        it('initializes PostHog when enabled in preferences', async () => {
            (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: true });

            await initTelemetry();

            trackEvent('test_event');
            expect(mockCapture).toHaveBeenCalled();
            expect(mockInit).toHaveBeenCalled();
        });

        it('does not initialize when disabled in preferences', async () => {
            (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: false });

            await initTelemetry();

            trackEvent('test_event');
            expect(mockCapture).not.toHaveBeenCalled();
        });
    });

    describe('trackEvent', () => {
        it('sends event when enabled', async () => {
            (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: true });
            await initTelemetry();

            trackEvent('test_event', { prop: 123 });

            expect(mockCapture).toHaveBeenCalledWith(
                'test_event',
                expect.objectContaining({ prop: 123 }),
                expect.any(Object)
            );
        });

        it('ignores event when disabled via function', async () => {
            (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: true });
            await initTelemetry();

            setTelemetryEnabled(false);
            trackEvent('test_event');

            expect(mockCapture).not.toHaveBeenCalled();
        });
    });

    describe('setTelemetryEnabled', () => {
        it('enables tracking dynamically', async () => {
            // Start disabled
            (getPreferences as Mock).mockResolvedValue({ telemetryEnabled: false });
            await initTelemetry();
            trackEvent('event1');
            expect(mockCapture).not.toHaveBeenCalled();

            // Enable
            setTelemetryEnabled(true);
            trackEvent('event2');
            expect(mockCapture).toHaveBeenCalledWith(
                'event2',
                expect.objectContaining({
                    distinct_id: undefined, // undefined because storage mock returns partial
                    context: 'options_page', // jsdom simulates UI
                }),
                expect.any(Object)
            );
        });
    });
});
