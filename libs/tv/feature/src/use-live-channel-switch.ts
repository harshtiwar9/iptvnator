import { useEffect, useRef } from 'preact/hooks';
import type { Catalog, Media } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

export type LiveChannelDirection = -1 | 1;

export interface LiveChannelEligibility {
    fullscreen: boolean;
    playingKind?: string;
    routeView: string;
    overlayOpen: boolean;
    modalOpen: boolean;
    editable: boolean;
    repeat: boolean;
}

export function liveChannelDirection(
    event: Pick<KeyboardEvent, 'key' | 'keyCode' | 'repeat'>
): LiveChannelDirection | undefined {
    if (event.repeat) return undefined;
    if (event.key === 'PageDown' || event.keyCode === 34) return 1;
    if (event.key === 'PageUp' || event.keyCode === 33) return -1;
    return undefined;
}

export function liveChannelSwitchEligible(
    state: LiveChannelEligibility
): boolean {
    return (
        !state.repeat &&
        state.fullscreen &&
        state.playingKind === 'live' &&
        state.routeView === 'live' &&
        !state.overlayOpen &&
        !state.modalOpen &&
        !state.editable
    );
}

export function adjacentLiveChannel(
    items: Media[],
    currentId: string,
    direction: LiveChannelDirection
): Media | undefined {
    const index = items.findIndex((item) => item.id === currentId);
    if (index < 0) return undefined;
    return items[index + direction];
}

export interface ResolveLiveChannelParams {
    direction: LiveChannelDirection;
    playingId: string;
    sourceId: string;
    category: string;
    loadedItems: Media[];
    loadedCatalog: Catalog;
    hasMore: boolean;
    loadedItemsMatchCategory: boolean;
    loadPage: (
        category: string,
        page: number
    ) => Promise<Catalog | undefined>;
}

function belongsToActiveContext(
    item: Media,
    sourceId: string,
    category: string
): boolean {
    return (
        item.sourceId === sourceId &&
        (!category || item.category === category)
    );
}

function lastValidChannel(
    catalog: Catalog,
    sourceId: string,
    category: string
): Media | undefined {
    for (let index = catalog.items.length - 1; index >= 0; index--) {
        const item = catalog.items[index];
        if (belongsToActiveContext(item, sourceId, category)) return item;
    }
    return undefined;
}

function firstValidChannel(
    catalog: Catalog,
    sourceId: string,
    category: string
): Media | undefined {
    return catalog.items.find((item) =>
        belongsToActiveContext(item, sourceId, category)
    );
}

function catalogBoundary(
    catalog: Catalog
): { pageSize: number; total: number; lastPage: number } | undefined {
    const pageSize =
        catalog.pageSize !== undefined &&
        Number.isInteger(catalog.pageSize) &&
        catalog.pageSize > 0
            ? catalog.pageSize
            : 60;
    if (
        !Number.isInteger(catalog.total) ||
        catalog.total < 0 ||
        !Number.isInteger(pageSize) ||
        pageSize <= 0
    )
        return undefined;
    return {
        pageSize,
        total: catalog.total,
        lastPage:
            catalog.total === 0 ? 0 : Math.floor((catalog.total - 1) / pageSize),
    };
}

export async function resolveAdjacentLiveChannel(
    params: ResolveLiveChannelParams
): Promise<Media | undefined> {
    const {
        direction,
        playingId,
        sourceId,
        category,
        loadedItems,
        loadedCatalog,
        hasMore,
        loadedItemsMatchCategory,
        loadPage,
    } = params;

    if (loadedItemsMatchCategory) {
        const index = loadedItems.findIndex((item) => item.id === playingId);
        if (index >= 0) {
            const adjacent = loadedItems[index + direction];
            if (
                adjacent &&
                belongsToActiveContext(adjacent, sourceId, category)
            )
                return adjacent;

            if (
                direction === 1 &&
                index === loadedItems.length - 1 &&
                hasMore
            ) {
                const next = await loadPage(
                    category,
                    loadedCatalog.page + 1
                );
                if (!next?.items.length) return undefined;
                const boundary = catalogBoundary(next);
                if (boundary && next.page > boundary.lastPage)
                    return undefined;
                return firstValidChannel(next, sourceId, category);
            }
            if (direction === -1 && index === 0 && loadedCatalog.page > 0) {
                const previous = await loadPage(
                    category,
                    loadedCatalog.page - 1
                );
                if (!previous?.items.length) return undefined;
                return lastValidChannel(previous, sourceId, category);
            }
            return undefined;
        }
    }

    const first = await loadPage(category, 0);
    if (!first?.items.length) return undefined;
    const pages = new Map<number, Catalog>([[0, first]]);
    let page = 0;
    let current: Media | undefined;

    const boundary = catalogBoundary(first);
    while (true) {
        const catalog = pages.get(page);
        if (!catalog) return undefined;
        const index = catalog.items.findIndex((item) => item.id === playingId);
        if (index >= 0) {
            current = catalog.items[index];
            break;
        }
        if (boundary && page >= boundary.lastPage) return undefined;
        if (!catalog.items.length) return undefined;
        page++;
        const next = await loadPage(category, page);
        if (!next?.items.length) return undefined;
        const nextBoundary = catalogBoundary(next);
        if (nextBoundary && page > nextBoundary.lastPage)
            return undefined;
        pages.set(page, next);
    }

    if (!current) return undefined;
    const currentCatalog = pages.get(page);
    if (!currentCatalog) return undefined;
    const index = currentCatalog.items.findIndex(
        (item) => item.id === current.id
    );
    if (index + direction >= 0 && index + direction < currentCatalog.items.length)
    {
        const adjacent = currentCatalog.items[index + direction];
        return belongsToActiveContext(adjacent, sourceId, category)
            ? adjacent
            : undefined;
    }

    if (direction === -1 && index === 0 && page > 0) {
        const previous = await loadPage(category, page - 1);
        if (!previous?.items.length) return undefined;
        return lastValidChannel(previous, sourceId, category);
    }
    if (direction === 1 && index === currentCatalog.items.length - 1) {
        const nextBoundary = catalogBoundary(currentCatalog);
        if (
            nextBoundary &&
            page < nextBoundary.lastPage
        ) {
            const next = await loadPage(category, page + 1);
            return next ? firstValidChannel(next, sourceId, category) : undefined;
        }
    }
    return undefined;
}

export function installLiveChannelSwitch(
    onDirection: (
        direction: LiveChannelDirection,
        event: KeyboardEvent
    ) => boolean,
    target: Document = document
): () => void {
    const handler = (event: KeyboardEvent) => {
        if (event.repeat) return;
        const direction = liveChannelDirection(event);
        if (!direction) return;
        if (!onDirection(direction, event)) return;
        event.preventDefault();
        event.stopPropagation();
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
}

export function useLiveChannelSwitch(
    tv: TvModel,
    overlayOpen = false
) {
    const latest = useRef({ tv, overlayOpen });
    latest.current = { tv, overlayOpen };
    const navigation = useRef(0);
    useEffect(
        () =>
            installLiveChannelSwitch((direction) => {
                const current = latest.current;
                const state = current.tv;
                const activeElement =
                    document.activeElement as HTMLElement | null;
                const editable =
                    !!activeElement &&
                    (activeElement.matches(
                        'input,textarea,select,[contenteditable="true"]'
                    ) ||
                        activeElement.isContentEditable);
                if (
                    !liveChannelSwitchEligible({
                        fullscreen: state.fullscreen,
                        playingKind: state.playing?.kind,
                        routeView: state.route.view,
                        overlayOpen: current.overlayOpen,
                        modalOpen:
                            !!document.querySelector('[data-tv-modal]'),
                        editable,
                        repeat: false,
                    })
                )
                    return false;

                eventJump(direction);
                return true;

                async function eventJump(nextDirection: LiveChannelDirection) {
                    const job = ++navigation.current;
                    const sourceId = state.data.activeId;
                    const category = state.playingCategory;
                    const playing = state.playing;
                    if (!playing) return;
                    const playingId = playing.id;
                    const target = await resolveAdjacentLiveChannel({
                        direction: nextDirection,
                        playingId,
                        sourceId,
                        category,
                        loadedItems: state.catalog.items,
                        loadedCatalog: state.catalog,
                        hasMore: state.hasMore,
                        loadedItemsMatchCategory:
                            state.route.category === category &&
                            state.catalog.items.some(
                                (item) => item.id === playingId
                            ),
                        loadPage: state.loadLivePage,
                    });
                    if (
                        job !== navigation.current ||
                        sourceId !== latest.current.tv.data.activeId ||
                        category !== latest.current.tv.playingCategory ||
                        latest.current.tv.fullscreen === false ||
                        latest.current.tv.playing?.kind !== 'live' ||
                        latest.current.tv.playing?.id !== playingId ||
                        latest.current.tv.route.view !== 'live' ||
                        latest.current.overlayOpen ||
                        document.querySelector('[data-tv-modal]') ||
                        !target
                    )
                        return;
                    await state.play(target, category, 'live-channel-switch');
                }
            }),
        []
    );
}
