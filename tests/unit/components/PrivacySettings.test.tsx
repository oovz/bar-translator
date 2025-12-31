import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { PrivacySettings } from '@/entrypoints/options/components/PrivacySettings';
import { DEFAULT_PREFERENCES } from '@/src/types';
import * as storageUtils from '@/utils/storage';
import * as telemetryUtils from '@/utils/telemetry';

// Mock utils
vi.mock('@/utils/storage', () => ({
    migrateApiKeys: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
    setTelemetryEnabled: vi.fn(),
}));

describe('PrivacySettings Component', () => {
    const mockProps = {
        preferences: DEFAULT_PREFERENCES,
        updatePreferences: vi.fn(),
    };

    it('renders storage type selector', () => {
        const { getByText, container } = render(<PrivacySettings {...mockProps} />);
        expect(getByText('labelStorage')).toBeTruthy();
        const select = container.querySelector('select');
        expect(select).toBeTruthy();
        expect(select?.value).toBe('local');
    });

    it('renders telemetry toggle', () => {
        const { getByText, container } = render(<PrivacySettings {...mockProps} />);
        expect(getByText('labelTelemetry')).toBeTruthy();
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox).toBeTruthy();
        expect((checkbox as HTMLInputElement).checked).toBe(true);
    });

    it('changing storage type triggers migration and update', async () => {
        const { container } = render(<PrivacySettings {...mockProps} />);
        const select = container.querySelector('select');

        if (select) {
            fireEvent.change(select, { target: { value: 'sync' } });

            // Wait for async operations
            await new Promise(r => setTimeout(r, 0));

            expect(storageUtils.migrateApiKeys).toHaveBeenCalledWith('local', 'sync');
            expect(mockProps.updatePreferences).toHaveBeenCalledWith({ storageType: 'sync' });
        } else {
            throw new Error('Select element not found');
        }
    });

    it('changing telemetry toggle calls utils', () => {
        const { container } = render(<PrivacySettings {...mockProps} />);
        const checkbox = container.querySelector('input[type="checkbox"]');

        if (checkbox) {
            fireEvent.click(checkbox);

            expect(telemetryUtils.setTelemetryEnabled).toHaveBeenCalledWith(false);
            expect(mockProps.updatePreferences).toHaveBeenCalledWith({ telemetryEnabled: false });
        } else {
            throw new Error('Checkbox element not found');
        }
    });

    it('shows security warning tooltip', () => {
        const { container } = render(<PrivacySettings {...mockProps} />);
        const tooltipIcon = container.querySelector('span[title*="storageDesc"]');
        expect(tooltipIcon).toBeTruthy();
    });
});
