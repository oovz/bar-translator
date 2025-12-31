
import { render, fireEvent, screen } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { Combobox } from '@/entrypoints/options/components/Combobox';

describe('Combobox', () => {
    const options = [
        { code: 'en', name: 'English' },
        { code: 'fr', name: 'French' },
        { code: 'zh-CN', name: 'Chinese (Simplified)' },
    ];

    it('renders with initial selected value', () => {
        render(<Combobox value="en" options={options} onChange={() => { }} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.value).toBe('English');
    });

    it('shows all options on focus (not filtered by initial value)', async () => {
        render(<Combobox value="en" options={options} onChange={() => { }} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);

        // Should show all options, including English and French
        expect(await screen.findByText('English')).toBeTruthy();
        expect(screen.getByText('French')).toBeTruthy();
    });

    it('filters options only when typing', async () => {
        render(<Combobox value="en" options={options} onChange={() => { }} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        fireEvent.input(input, { target: { value: 'Fre' } }); // Filter for French

        const option = await screen.findByText('French');
        expect(option).toBeTruthy();
        expect(screen.queryByText('English')).toBeNull();
    });

    it('shows no results message when no match', async () => {
        render(<Combobox value="" options={options} onChange={() => { }} />);
        const input = screen.getByRole('textbox');

        fireEvent.input(input, { target: { value: 'Xyz' } });

        expect(await screen.findByText('noResults')).toBeTruthy();
    });

    it('calls onChange when selecting an option', () => {
        const handleChange = vi.fn();
        render(<Combobox value="" options={options} onChange={handleChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input); // Open dropdown
        fireEvent.click(screen.getByText('Chinese (Simplified)'));

        expect(handleChange).toHaveBeenCalledWith('zh-CN');
    });

    it('updates text when value prop changes', () => {
        const { rerender } = render(<Combobox value="en" options={options} onChange={() => { }} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.value).toBe('English');

        rerender(<Combobox value="fr" options={options} onChange={() => { }} />);
        expect(input.value).toBe('French');
    });
});
