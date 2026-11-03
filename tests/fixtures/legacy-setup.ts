import { createDefaultSetup } from '@/utils/instances';

/** Explicit pre-redesign configuration for tests of existing installations. */
export function createLegacySetup(copyEnabled = false) {
    const setup = createDefaultSetup(copyEnabled);
    setup.instances.push({ id: 'lingva', providerId: 'lingva' }, { id: 'deepl', providerId: 'deepl', name: 'DeepL' });
    return setup;
}
