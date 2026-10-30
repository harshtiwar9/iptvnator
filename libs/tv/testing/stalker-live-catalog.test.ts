import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Source } from '@iptvnator/tv/util';
import {
    createProvider,
    ProviderTransport,
} from '@iptvnator/tv/data-access';

class Transport extends ProviderTransport {
    readonly calls: Record<string, string | number>[] = [];

    constructor(
        private respond: (params: Record<string, string | number>) => unknown
    ) {
        super('https://backend.invalid');
    }

    async request(
        _source: Source,
        _route: 'stalker' | 'xtream' | 'parse',
        params: Record<string, string | number>
    ) {
        this.calls.push(params);
        return this.respond(params);
    }
}

const source = (): Source => ({
    id: 'stalker-source',
    provider: 'stalker',
    name: 'Test portal',
    url: 'https://portal.invalid/server/load.php',
    endpoint: 'https://portal.invalid/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    full: true,
    token: 'persisted',
});

test('Stalker live rows use the first usable title and supported artwork fields', async () => {
    const transport = new Transport((params) => {
        if (params.action === 'handshake')
            return { js: { token: 'persisted', random: 'random' } };
        if (params.action === 'get_profile') return { js: { status: 0 } };
        if (params.action === 'get_genres')
            return {
                js: [
                    { category_id: '1', title: 'English CA' },
                    { category_id: '2', title: 'English USA' },
                    { category_id: '3', title: 'English UK' },
                ],
            };
        if (params.action === 'get_ordered_list')
            return {
                js: {
                    data: [
                        {
                            id: '101',
                            o_name: 'Live Channel',
                            name: 'English UK One',
                            cover: '-',
                            logo: '/icons/uk-one.png',
                            tv_genre_id: '3',
                        },
                        {
                            id: '102',
                            o_name: '-',
                            title: 'English UK Two',
                            screenshot_uri: '/icons/uk-two.png',
                            tv_genre_id: '3',
                        },
                        {
                            id: '103',
                            name: 'English UK No Artwork',
                            cover: '-',
                            logo: 'ftp://portal.invalid/no-art.png',
                            poster_url: 'N/A',
                            tv_genre_id: '3',
                        },
                    ],
                    total_items: 3,
                    max_page_items: 60,
                },
            };
        return { js: [] };
    });
    const provider = createProvider(
        source(),
        transport,
        async () => undefined
    );
    try {
        await provider.connect(new AbortController().signal);
        const result = await provider.catalog(
            'live',
            '3',
            0,
            '',
            new AbortController().signal
        );
        assert.equal(result.items[0].title, 'English UK One');
        assert.equal(result.items[1].title, 'English UK Two');
        assert.equal(
            result.items[0].poster,
            'https://portal.invalid/icons/uk-one.png'
        );
        assert.equal(
            result.items[1].poster,
            'https://portal.invalid/icons/uk-two.png'
        );
        assert.equal(result.items[2].poster, undefined);
        const ordered = transport.calls.find(
            (call) => call.action === 'get_ordered_list'
        );
        assert.equal(ordered?.category, '3');
        assert.equal(ordered?.genre, '3');
    } finally {
        provider.dispose();
    }
});

test('English CA and USA category requests preserve string IDs', async () => {
    const transport = new Transport((params) => {
        if (params.action === 'handshake')
            return { js: { token: 'persisted', random: 'random' } };
        if (params.action === 'get_profile') return { js: { status: 0 } };
        if (params.action === 'get_genres')
            return {
                js: [
                    { category_id: '1', title: 'English CA' },
                    { category_id: '2', title: 'English USA' },
                ],
            };
        if (params.action === 'get_ordered_list')
            return {
                js: {
                    data: [
                        {
                            id: String(params.genre),
                            o_name:
                                params.genre === '1'
                                    ? 'Live Channel'
                                    : '',
                            name:
                                params.genre === '1'
                                    ? 'English CA Actual Name'
                                    : 'English USA Channel',
                            title:
                                params.genre === '1'
                                    ? '-'
                                    : '',
                            cover:
                                params.genre === '1'
                                    ? '/icons/ca-cover.png'
                                    : '/icons/usa-cover.png',
                            logo:
                                params.genre === '1'
                                    ? '/icons/ca.png'
                                    : '/icons/usa.png',
                            tv_genre_id: String(params.genre),
                        },
                    ],
                    total_items: 1,
                    max_page_items: 60,
                },
            };
        return { js: [] };
    });
    const provider = createProvider(
        source(),
        transport,
        async () => undefined
    );
    try {
        await provider.connect(new AbortController().signal);
        for (const category of ['1', '2']) {
            const result = await provider.catalog(
                'live',
                category,
                0,
                '',
                new AbortController().signal
            );
            assert.equal(result.items.length, 1);
            assert.equal(
                result.items[0].title,
                category === '1'
                    ? 'English CA Actual Name'
                    : 'English USA Channel'
            );
            assert.equal(
                result.items[0].poster,
                `https://portal.invalid/icons/${category === '1' ? 'ca' : 'usa'}.png`
            );
        }
        const ordered = transport.calls.filter(
            (call) => call.action === 'get_ordered_list'
        );
        assert.deepEqual(
            ordered.map((call) => [call.category, call.genre]),
            [
                ['1', '1'],
                ['2', '2'],
            ]
        );
    } finally {
        provider.dispose();
    }
});
