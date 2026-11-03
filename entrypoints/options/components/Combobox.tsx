import { useState, useRef, useEffect, useId } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { t } from '@/utils/i18n';
import type { LanguageInfo } from '@/src/types';

interface ComboboxProps {
    id?: string;
    value: string;
    options: readonly LanguageInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

export function Combobox({ id, value, options, onChange, placeholder }: ComboboxProps) {
    const listId = useId();
    const state = useComboboxState(value, options, onChange);
    const activeId = state.highlighted === undefined ? undefined : `${listId}-${state.highlighted}`;
    return <div class="combobox-container">
        <input id={id} type="text" role="combobox" aria-autocomplete="list"
            aria-expanded={state.isOpen} aria-controls={state.isOpen ? listId : undefined}
            aria-activedescendant={activeId} class="input" value={state.text} placeholder={placeholder}
            onFocus={event => state.open(event.currentTarget)}
            onClick={event => { if (!state.isOpen) state.open(event.currentTarget); }}
            onInput={event => state.search(event.currentTarget.value)}
            onKeyDown={event => handleComboboxKey(event, state)} onBlur={state.close} />
        {state.isOpen && <LanguageOptions id={listId} options={state.options} value={value}
            highlighted={state.highlighted} onSelect={state.select} />}
    </div>;
}

function useComboboxState(value: string, options: readonly LanguageInfo[], onChange: (value: string) => void) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState<string | null>(null);
    const [highlighted, setHighlighted] = useState<string>();
    const selectedText = options.find(option => option.code === value)?.name ?? value;
    const displayedOptions = query === null ? options : filterLanguages(options, query);
    const close = () => {
        setIsOpen(false);
        setQuery(null);
        setHighlighted(undefined);
    };
    const open = (input: HTMLInputElement) => {
        setIsOpen(true);
        setQuery(null);
        input.select();
    };
    const search = (text: string) => {
        setQuery(text);
        setHighlighted(undefined);
        setIsOpen(true);
    };
    const move = (direction: number) => {
        setIsOpen(true);
        const current = displayedOptions.findIndex(option => option.code === highlighted);
        const next = nextOptionIndex(current, displayedOptions.length, direction);
        setHighlighted(displayedOptions[next]?.code);
    };
    const select = (code: string) => { onChange(code); close(); };
    return { isOpen, highlighted, text: query ?? selectedText, options: displayedOptions, close, open, search, move, select };
}

function handleComboboxKey(event: TargetedKeyboardEvent<HTMLInputElement>, state: ReturnType<typeof useComboboxState>) {
    if (event.isComposing) return;
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
            event.preventDefault();
            state.move(event.key === 'ArrowDown' ? 1 : -1);
            break;
        case 'Enter':
            if (state.highlighted === undefined) return;
            event.preventDefault();
            state.select(state.highlighted);
            break;
        case 'Escape':
            event.preventDefault();
            state.close();
            break;
    }
}

function LanguageOptions({ id, options, value, highlighted, onSelect }: {
    id: string;
    options: readonly LanguageInfo[];
    value: string;
    highlighted: string | undefined;
    onSelect: (code: string) => void;
}) {
    const activeRef = useRef<HTMLDivElement>(null);
    useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [highlighted]);
    return <div class="combobox-dropdown" id={id} role="listbox">
        {options.length === 0 && <div class="combobox-option" style={{ color: 'var(--text-secondary)', cursor: 'default' }}>
            {t('noResults')}
        </div>}
        {options.map(option => <div key={option.code} id={`${id}-${option.code}`} role="option"
            aria-selected={option.code === value} ref={option.code === highlighted ? activeRef : undefined}
            class={`combobox-option ${option.code === value ? 'selected' : ''} ${option.code === highlighted ? 'active' : ''}`}
            onMouseDown={event => event.preventDefault()} onClick={() => onSelect(option.code)}>
            <span>{option.name}</span><span class="combobox-option-code">{option.code}</span>
        </div>)}
    </div>;
}

function nextOptionIndex(current: number, length: number, direction: number) {
    if (current < 0) return direction > 0 ? 0 : length - 1;
    return Math.max(0, Math.min(length - 1, current + direction));
}

function filterLanguages(options: readonly LanguageInfo[], search: string) {
    const query = search.toLowerCase();
    return options.filter(option => option.name.toLowerCase().includes(query) || option.code.toLowerCase().includes(query));
}
