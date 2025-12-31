import { useState, useRef, useEffect } from 'preact/hooks';
import { t } from '@/utils/i18n';
import type { LanguageInfo } from '@/src/types';

interface ComboboxProps {
    value: string;
    options: readonly LanguageInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

export function Combobox({ value, options, onChange, placeholder }: ComboboxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [isFiltering, setIsFiltering] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sync input text with selected value when not editing
    useEffect(() => {
        if (!isOpen) {
            const selected = options.find(o => o.code === value);
            setSearch(selected ? selected.name : value); // Fallback to value if name not found
        }
    }, [value, options, isOpen]);

    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsFiltering(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const displayedOptions = isFiltering ? options.filter(opt =>
        opt.name.toLowerCase().includes(search.toLowerCase()) ||
        opt.code.toLowerCase().includes(search.toLowerCase())
    ) : options;

    return (
        <div class="combobox-container" ref={containerRef}>
            <input
                type="text"
                class="input"
                value={search}
                placeholder={placeholder}
                onFocus={(e) => {
                    setIsOpen(true);
                    setIsFiltering(false); // Show all options on focus
                    e.currentTarget.select(); // Select all text for easy replacement
                }}
                onInput={(e) => {
                    setSearch(e.currentTarget.value);
                    setIsFiltering(true); // Filter only when typing
                    setIsOpen(true);
                }}
            />
            {isOpen && (
                <div class="combobox-dropdown">
                    {displayedOptions.length === 0 ? (
                        <div class="combobox-option" style={{ color: 'var(--text-secondary)', cursor: 'default' }}>
                            {t('noResults')}
                        </div>
                    ) : (
                        displayedOptions.map(opt => (
                            <div
                                key={opt.code}
                                class={`combobox-option ${opt.code === value ? 'selected' : ''}`}
                                onClick={() => {
                                    onChange(opt.code);
                                    setIsOpen(false);
                                    setIsFiltering(false);
                                    // Search text update is handled by useEffect when isOpen becomes false
                                }}
                            >
                                <span>{opt.name}</span>
                                <span class="combobox-option-code">{opt.code}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
