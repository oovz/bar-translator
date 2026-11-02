/** @vitest-environment jsdom */

import { act, cleanup, render, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { Combobox } from '@/entrypoints/options/components/Combobox';

afterEach(async () => { await act(() => cleanup()); });

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
    it('restores the selected language and closes when clicking outside an unfinished search', async () => {
        const onChange = vi.fn();
        render(<Combobox value="en" options={options} onChange={onChange} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.input(input, { target: { value: 'Fre' } });
        fireEvent.mouseDown(input);
        expect(screen.getByText('French')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(input.value).toBe('English'));
        expect(screen.queryByText('French')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('reports no results without replacing the stored selection', () => {
        const onChange = vi.fn();
        render(<Combobox value="en" options={options} onChange={onChange} />);
        fireEvent.input(screen.getByRole('textbox'), { target: { value: 'does-not-exist' } });
        expect(screen.getByText('noResults')).toBeTruthy();
        expect(screen.queryByText('French')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('finds a regional language by its code and displays unknown stored values', () => {
        const onChange = vi.fn();
        render(<Combobox value="unknown" options={options} onChange={onChange} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.value).toBe('unknown');
        fireEvent.input(input, { target: { value: 'ZH-cn' } });
        fireEvent.click(screen.getByText('Chinese (Simplified)'));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('zh-CN');
    });

    it('closes after a selection and highlights the saved choice when reopened', async () => {
        function Selection() {
            const [value, setValue] = useState('en');
            return <Combobox value={value} options={options} onChange={setValue} />;
        }
        render(<Selection />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.click(screen.getByText('French'));
        await waitFor(() => expect(input.value).toBe('French'));
        expect(screen.queryByText('French')).toBeNull();
        fireEvent.focus(input);
        expect(screen.getByText('French').closest('.combobox-option')?.classList.contains('selected')).toBe(true);
        expect(screen.getByText('English').closest('.combobox-option')?.classList.contains('selected')).toBe(false);
    });

});
