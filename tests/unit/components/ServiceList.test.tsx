import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { DEFAULT_PREFERENCES } from '@/src/types';
import type { TranslationService } from '@/src/types';

// Mock SortableJS since it needs DOM access
vi.mock('sortablejs', () => ({
    default: {
        create: vi.fn(() => ({
            destroy: vi.fn(),
        })),
    },
}));

describe('ServiceList Component', () => {
    const mockServices: TranslationService[] = [
        {
            id: 'google-web',
            name: 'Google Translate (Web)',
            type: 'web',
            requiresApiKey: false,
            authMethod: 'none',
            httpMethod: 'GET',
        },
        {
            id: 'deepl',
            name: 'DeepL',
            type: 'api',
            requiresApiKey: true,
            authMethod: 'header-auth-key',
            httpMethod: 'POST',
        },
    ];

    const mockProps = {
        services: mockServices,
        preferences: DEFAULT_PREFERENCES,
        apiKeys: {}, // StoredApiKeys
        updatePreferences: vi.fn(),
        saveApiKey: vi.fn(),
        updateKeyValidation: vi.fn(),
    };

    it('renders enabled services', () => {
        const { getByText } = render(<ServiceList {...mockProps} />);
        expect(getByText('Google Translate (Web)')).toBeTruthy();
        expect(getByText('primary')).toBeTruthy();
    });

    it('renders disabled services list when services are available', () => {
        const { getByText } = render(<ServiceList {...mockProps} />);
        // DeepL is not in DEFAULT_PREFERENCES.fallbackOrder
        expect(getByText('DeepL')).toBeTruthy();
        expect(getByText('keyRequired')).toBeTruthy();
    });

    it('toggling service calls updatePreferences', () => {
        const { getAllByTitle } = render(<ServiceList {...mockProps} />);
        const enableButtons = getAllByTitle('Enable service');
        fireEvent.click(enableButtons[0]);

        expect(mockProps.updatePreferences).toHaveBeenCalledWith({
            fallbackOrder: ['google-web', 'deepl'],
        });
    });

    it('shows api key input when expanded', () => {
        const { getAllByText, getByPlaceholderText } = render(<ServiceList {...mockProps} />);
        const apiKeyButtons = getAllByText('API Key');
        fireEvent.click(apiKeyButtons[0]); // Expand DeepL

        expect(getByPlaceholderText('enterApiKey')).toBeTruthy();
    });
});
