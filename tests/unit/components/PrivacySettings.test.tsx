import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { PrivacySettings } from '@/entrypoints/options/components/PrivacySettings';
import { DEFAULT_PREFERENCES } from '@/src/types';
import * as storageUtils from '@/utils/storage';

// Mock utils
vi.mock('@/utils/storage', () => ({
    migrateApiKeys: vi.fn(),
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

    it('explains privacy without an analytics control', () => {
        const { getByText, container } = render(<PrivacySettings {...mockProps} />);
        expect(getByText('privacyDesc')).toBeTruthy();
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox).toBeNull();
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

    it('shows security warning tooltip', () => {
        const { container } = render(<PrivacySettings {...mockProps} />);
        const tooltipIcon = container.querySelector('span[title*="storageDesc"]');
        expect(tooltipIcon).toBeTruthy();
    });
});
