/**
 * Fallback Order List Component
 *
 * Drag-and-drop sortable list for configuring fallback service order.
 * Uses SortableJS for the drag-drop functionality.
 *
 * @module components/FallbackOrderList
 */

import { useEffect, useRef } from 'preact/hooks';
import { t } from '@/utils/i18n';
import Sortable from 'sortablejs';
import type { ServiceId, TranslationService } from '@/src/types';

interface FallbackOrderListProps {
    /** All available services */
    services: readonly TranslationService[];
    /** Current fallback order (service IDs) */
    fallbackOrder: ServiceId[];
    /** Currently preferred service (excluded from fallback) */
    preferredServiceId: ServiceId;
    /** Whether fallback is enabled */
    fallbackEnabled: boolean;
    /** Callback when fallback order changes */
    onOrderChange: (newOrder: ServiceId[]) => void;
    /** Callback when fallback enabled/disabled */
    onToggleFallback: (enabled: boolean) => void;
}

export function FallbackOrderList({
    services,
    fallbackOrder,
    preferredServiceId,
    fallbackEnabled,
    onOrderChange,
    onToggleFallback,
}: FallbackOrderListProps) {
    const listRef = useRef<HTMLUListElement>(null);
    const sortableRef = useRef<Sortable | null>(null);

    // Get services available for fallback (exclude preferred)
    const availableForFallback = services.filter(
        (s) => s.id !== preferredServiceId
    );

    // Initialize/update fallback order if needed
    useEffect(() => {
        // If fallbackOrder is empty but we have available services, initialize it
        const availableIds = availableForFallback.map((s) => s.id);
        const currentOrderValid = fallbackOrder.every((id) =>
            availableIds.includes(id)
        );

        if (!currentOrderValid && availableForFallback.length > 0) {
            // Build new order: keep existing valid ones in order, add new ones at end
            const validExisting = fallbackOrder.filter((id) =>
                availableIds.includes(id)
            );
            const missing = availableIds.filter(
                (id) => !fallbackOrder.includes(id)
            );
            onOrderChange([...validExisting, ...missing]);
        }
    }, [preferredServiceId, services]);

    // Initialize SortableJS
    useEffect(() => {
        if (!listRef.current || !fallbackEnabled) return;

        sortableRef.current = Sortable.create(listRef.current, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                if (evt.oldIndex === undefined || evt.newIndex === undefined)
                    return;

                const newOrder = [...fallbackOrder];
                const [moved] = newOrder.splice(evt.oldIndex, 1);
                newOrder.splice(evt.newIndex, 0, moved);
                onOrderChange(newOrder);
            },
        });

        return () => {
            sortableRef.current?.destroy();
        };
    }, [fallbackEnabled, fallbackOrder.length]);

    // Update sortable when order changes externally
    useEffect(() => {
        if (sortableRef.current) {
            sortableRef.current.sort(fallbackOrder);
        }
    }, [fallbackOrder]);

    const getServiceName = (id: ServiceId): string => {
        return services.find((s) => s.id === id)?.name ?? id;
    };

    const getServiceType = (id: ServiceId): string => {
        const service = services.find((s) => s.id === id);
        return service?.type === 'api' ? t('serviceTypeApi') : t('serviceTypeWeb');
    };

    return (
        <div class="fallback-config">
            {/* Toggle Section */}
            <div
                class="fallback-toggle"
                style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;"
            >
                <label class="toggle-label" style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input
                        type="checkbox"
                        checked={fallbackEnabled}
                        onChange={(e) => onToggleFallback(e.currentTarget.checked)}
                        style="width: 1.25rem; height: 1.25rem; cursor: pointer;"
                    />
                    <span style="font-weight: 500;">{t('enableFallback')}</span>
                </label>
                <span style="color: var(--text-secondary); font-size: 0.875rem;">
                    {t('fallbackDesc')}
                </span>
            </div>

            {/* Fallback Order List */}
            {fallbackEnabled && (
                <div class="fallback-order-section">
                    <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.75rem;">
                        {t('dragToReorder')}
                    </p>
                    <ul
                        ref={listRef}
                        class="fallback-list"
                        style="list-style: none; padding: 0; margin: 0;"
                    >
                        {fallbackOrder.map((serviceId, index) => (
                            <li
                                key={serviceId}
                                data-id={serviceId}
                                class="fallback-item"
                                style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 0.375rem; margin-bottom: 0.5rem; transition: background-color 0.15s;"
                            >
                                <span
                                    class="drag-handle"
                                    style="cursor: grab; color: var(--text-secondary); font-size: 1.25rem; user-select: none;"
                                    title="Drag to reorder"
                                >
                                    ⋮⋮
                                </span>
                                <span
                                    class="fallback-index"
                                    style="color: var(--text-secondary); font-size: 0.875rem; min-width: 1.5rem;"
                                >
                                    #{index + 1}
                                </span>
                                <span class="fallback-name" style="flex: 1; font-weight: 500;">
                                    {getServiceName(serviceId)}
                                </span>
                                <span
                                    class="fallback-type"
                                    style="color: var(--text-secondary); font-size: 0.75rem; background: var(--surface-color); padding: 0.125rem 0.5rem; border-radius: 999px;"
                                >
                                    {getServiceType(serviceId)}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {fallbackOrder.length === 0 && (
                        <p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 1rem;">
                            {t('noFallbackAvailable')}
                        </p>
                    )}
                </div>
            )}

            {/* Styles */}
            <style>{`
                .fallback-item:hover {
                    background: var(--surface-color) !important;
                }
                .fallback-item.sortable-ghost {
                    opacity: 0.4;
                    background: var(--primary-color) !important;
                }
                .drag-handle:active {
                    cursor: grabbing;
                }
            `}</style>
        </div>
    );
}
