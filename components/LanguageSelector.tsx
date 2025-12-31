import { getSourceLanguages, getTargetLanguages, getLanguageName } from '@/utils/languages';
import type { LanguageInfo } from '@/src/types';

interface LanguageSelectorProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type: 'source' | 'target';
    disabled?: boolean;
}

export function LanguageSelector({
    label,
    value,
    onChange,
    type,
    disabled = false
}: LanguageSelectorProps) {
    const languages: LanguageInfo[] = type === 'source'
        ? getSourceLanguages()
        : getTargetLanguages();

    return (
        <div class="form-group">
            <label class="label">{label}</label>
            <select
                class="select"
                value={value}
                onChange={(e) => onChange(e.currentTarget.value)}
                disabled={disabled}
            >
                {languages.map((lang) => {
                    const displayName = getLanguageName(lang.code);
                    return (
                        <option key={lang.code} value={lang.code}>
                            {displayName} {lang.nativeName && lang.nativeName !== displayName ? `(${lang.nativeName})` : ''}
                        </option>
                    );
                })}
            </select>
        </div>
    );
}
