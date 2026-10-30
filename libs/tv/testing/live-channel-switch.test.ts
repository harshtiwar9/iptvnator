import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    adjacentLiveChannel,
    coalesceLivePageRequest,
    installLiveChannelSwitch,
    liveChannelDirection,
    liveChannelSwitchEligible,
    resolveAdjacentLiveChannel,
} from '@iptvnator/tv/feature';
import type { Catalog, Media } from '@iptvnator/tv/util';

function channel(id: string, category = 'sports'): Media {
    return {
        id,
        sourceId: 'source-1',
        providerId: id,
        kind: 'live',
        title: `Channel ${id}`,
        category,
        raw: {},
    };
}

function catalog(
    items: Media[],
    page = 0,
    total = items.length,
    pageSize = 60
): Catalog {
    return { items, total, page, pageSize, categories: [] };
}

test('recognizes LG Channel Up and Down without depending on event.code', () => {
    assert.equal(
        liveChannelDirection({ key: 'PageDown', keyCode: 34, repeat: false }),
        1
    );
    assert.equal(
        liveChannelDirection({ key: 'PageUp', keyCode: 33, repeat: false }),
        -1
    );
    assert.equal(
        liveChannelDirection({ key: '', keyCode: 34, repeat: false }),
        1
    );
    assert.equal(
        liveChannelDirection({ key: 'PageDown', keyCode: 34, repeat: true }),
        undefined
    );
});

test('applies fullscreen live playback guards and leaves overlays and editing untouched', () => {
    const eligible = {
        fullscreen: true,
        playingKind: 'live',
        routeView: 'live',
        overlayOpen: false,
        modalOpen: false,
        editable: false,
        repeat: false,
    };
    assert.equal(liveChannelSwitchEligible(eligible), true);
    assert.equal(
        liveChannelSwitchEligible({ ...eligible, overlayOpen: true }),
        false
    );
    assert.equal(
        liveChannelSwitchEligible({ ...eligible, modalOpen: true }),
        false
    );
    assert.equal(
        liveChannelSwitchEligible({ ...eligible, editable: true }),
        false
    );
    assert.equal(
        liveChannelSwitchEligible({ ...eligible, fullscreen: false }),
        false
    );
});

test('moves within loaded category context and preserves page boundaries', async () => {
    const items = [channel('1'), channel('2'), channel('3')];
    assert.equal(adjacentLiveChannel(items, '1', 1)?.id, '2');
    assert.equal(adjacentLiveChannel(items, '3', 1)?.id, undefined);
    assert.equal(adjacentLiveChannel(items, '1', -1)?.id, undefined);

    let requestedCategory = '';
    let requestedPage = -1;
    const next = await resolveAdjacentLiveChannel({
        direction: 1,
        playingId: '60',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [],
        loadedCatalog: catalog([], 0, 61, 60),
        hasMore: true,
        loadedItemsMatchCategory: false,
        loadPage: async (category, page) => {
            requestedCategory = category;
            requestedPage = page;
            return page === 0
                ? catalog(Array.from({ length: 60 }, (_, i) => channel(String(i + 1))), 0, 61, 60)
                : catalog([channel('61')], 1, 61, 60);
        },
    });
    assert.equal(next?.id, '61');
    assert.equal(requestedCategory, 'sports');
    assert.equal(requestedPage, 1);

    const first = await resolveAdjacentLiveChannel({
        direction: -1,
        playingId: '1',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('1')],
        loadedCatalog: catalog([channel('1')], 0, 1, 60),
        hasMore: false,
        loadedItemsMatchCategory: true,
        loadPage: async () => undefined,
    });
    assert.equal(first, undefined);
});

test('moves backward across a page boundary and selects the last valid channel', async () => {
    const wrongSource = { ...channel('57'), sourceId: 'source-2' };
    const wrongCategory = channel('59', 'news');
    const firstPage = catalog(
        [wrongSource, wrongCategory, channel('60')],
        0,
        61,
        60
    );
    let requestedPage = -1;
    const previous = await resolveAdjacentLiveChannel({
        direction: -1,
        playingId: '61',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('61')],
        loadedCatalog: catalog([channel('61')], 1, 61, 60),
        hasMore: false,
        loadedItemsMatchCategory: true,
        loadPage: async (category, page) => {
            assert.equal(category, 'sports');
            requestedPage = page;
            return firstPage;
        },
    });
    assert.equal(requestedPage, 0);
    assert.equal(previous?.id, '60');
});

test('Channel Down stops at the first page boundary without loading another page', async () => {
    let loadCalls = 0;
    const previous = await resolveAdjacentLiveChannel({
        direction: -1,
        playingId: '1',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('1')],
        loadedCatalog: catalog([channel('1')], 0, 61, 60),
        hasMore: true,
        loadedItemsMatchCategory: true,
        loadPage: async () => {
            loadCalls++;
            return catalog([]);
        },
    });
    assert.equal(previous, undefined);
    assert.equal(loadCalls, 0);
});

test('failed and empty previous-page requests leave the current channel unchanged', async () => {
    const failed = await resolveAdjacentLiveChannel({
        direction: -1,
        playingId: '61',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('61')],
        loadedCatalog: catalog([channel('61')], 1, 61, 60),
        hasMore: false,
        loadedItemsMatchCategory: true,
        loadPage: async () => undefined,
    });
    assert.equal(failed, undefined);

    const empty = await resolveAdjacentLiveChannel({
        direction: -1,
        playingId: '61',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('61')],
        loadedCatalog: catalog([channel('61')], 1, 61, 60),
        hasMore: false,
        loadedItemsMatchCategory: true,
        loadPage: async () => catalog([], 0, 61, 60),
    });
    assert.equal(empty, undefined);
});

test('page and playback failures leave the current channel unresolved', async () => {
    const failed = await resolveAdjacentLiveChannel({
        direction: 1,
        playingId: '1',
        sourceId: 'source-1',
        category: 'sports',
        loadedItems: [channel('1')],
        loadedCatalog: catalog([channel('1')], 0, 1, 60),
        hasMore: true,
        loadedItemsMatchCategory: true,
        loadPage: async () => undefined,
    });
    assert.equal(failed, undefined);
});

test('coalesces concurrent page requests and observer consumes eligible keys then cleans up', async () => {
    const cache = new Map<string, Promise<Catalog | undefined>>();
    let calls = 0;
    const promise = coalesceLivePageRequest(cache, 'page', async () => {
        calls++;
        return catalog([]);
    });
    assert.equal(
        coalesceLivePageRequest(cache, 'page', async () => {
            calls++;
            return catalog([]);
        }),
        promise
    );
    await promise;
    assert.equal(calls, 1);

    const dom = new JSDOM('<body></body>');
    let callsWithDirection = 0;
    const cleanup = installLiveChannelSwitch(
        () => {
            callsWithDirection++;
            return true;
        },
        dom.window.document as unknown as Document
    );
    const keydown = new dom.window.KeyboardEvent('keydown', {
        key: 'PageDown',
        keyCode: 34,
        cancelable: true,
        repeat: false,
    });
    dom.window.document.dispatchEvent(keydown);
    assert.equal(keydown.defaultPrevented, true);
    assert.equal(callsWithDirection, 1);
    cleanup();
    dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
            key: 'PageUp',
            keyCode: 33,
            cancelable: true,
        })
    );
    assert.equal(callsWithDirection, 1);
    dom.window.close();
});
