import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
    installRemoteKeyObserver,
    recordRemoteKeyEvent,
    remoteKeyDiagnosticEnabled,
    RemoteKeyDiagnostic,
} from '@iptvnator/tv/feature';

test('remote key diagnostic is disabled unless debugKeys equals 1', () => {
    assert.equal(remoteKeyDiagnosticEnabled(''), false);
    assert.equal(remoteKeyDiagnosticEnabled('?debugKeys=true'), false);
    assert.equal(remoteKeyDiagnosticEnabled('?debugKeys=0'), false);
    assert.equal(remoteKeyDiagnosticEnabled('?debugKeys=1'), true);
});

test('remote key observer records requested event fields without preventing dispatch', () => {
    const dom = new JSDOM('<body></body>');
    const previousDocument = globalThis.document;
    Object.assign(globalThis, { document: dom.window.document });
    const records: ReturnType<typeof recordRemoteKeyEvent>[] = [];
    try {
        const cleanup = installRemoteKeyObserver((record) => records.push(record));
        const event = new dom.window.KeyboardEvent('keydown', {
            key: 'ChannelUp',
            code: 'ChannelUp',
            repeat: true,
            cancelable: true,
        });
        assert.equal(dom.window.document.dispatchEvent(event), true);
        assert.equal(event.defaultPrevented, false);
        assert.equal(records.length, 1);
        assert.equal(records[0].key, 'ChannelUp');
        assert.equal(records[0].code, 'ChannelUp');
        assert.equal(records[0].repeat, true);
        assert.equal(typeof records[0].timestamp, 'string');
        assert.equal(typeof records[0].keyCode, 'number');
        assert.equal(typeof records[0].which, 'number');

        cleanup();
        dom.window.document.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' })
        );
        assert.equal(records.length, 1);
    } finally {
        Object.assign(globalThis, { document: previousDocument });
        dom.window.close();
    }
});

test('RemoteKeyDiagnostic is absent and installs no listener when debugKeys is absent', () => {
    const dom = new JSDOM('<body><div id="root"></div></body>', {
        url: 'http://tv.invalid/',
    });
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const root = dom.window.document.querySelector('#root');
    assert.ok(root);
    Object.assign(globalThis, {
        document: dom.window.document,
        window: dom.window,
    });
    const documentWithListener = dom.window.document as unknown as {
        addEventListener: typeof dom.window.document.addEventListener;
        removeEventListener: typeof dom.window.document.removeEventListener;
    };
    const originalAdd = documentWithListener.addEventListener;
    const originalRemove = documentWithListener.removeEventListener;
    let keydownAdds = 0;
    let keydownRemoves = 0;
    documentWithListener.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ) {
        if (type === 'keydown') keydownAdds++;
        originalAdd.call(dom.window.document, type, listener, options);
    } as typeof dom.window.document.addEventListener;
    documentWithListener.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions
    ) {
        if (type === 'keydown') keydownRemoves++;
        originalRemove.call(dom.window.document, type, listener, options);
    } as typeof dom.window.document.removeEventListener;
    try {
        act(() => {
            render(h(RemoteKeyDiagnostic, {}), root);
        });
        assert.equal(
            dom.window.document.querySelector('.remote-key-diagnostic'),
            null
        );
        assert.equal(keydownAdds, 0);
        dom.window.document.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' })
        );
        assert.equal(keydownRemoves, 0);
        act(() => render(null, root));
    } finally {
        documentWithListener.addEventListener = originalAdd;
        documentWithListener.removeEventListener = originalRemove;
        Object.assign(globalThis, {
            document: previousDocument,
            window: previousWindow,
        });
        dom.window.close();
    }
});

test('RemoteKeyDiagnostic records fields, limits history, clears, and cleans up on unmount', () => {
    const dom = new JSDOM('<body><div id="root"></div></body>', {
        url: 'http://tv.invalid/?debugKeys=1',
    });
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const root = dom.window.document.querySelector('#root');
    assert.ok(root);
    Object.assign(globalThis, {
        document: dom.window.document,
        window: dom.window,
    });
    const documentWithListener = dom.window.document as unknown as {
        removeEventListener: typeof dom.window.document.removeEventListener;
    };
    const originalRemove = documentWithListener.removeEventListener;
    let keydownRemoves = 0;
    documentWithListener.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions
    ) {
        if (type === 'keydown') keydownRemoves++;
        originalRemove.call(dom.window.document, type, listener, options);
    } as typeof dom.window.document.removeEventListener;
    try {
        act(() => {
            render(h(RemoteKeyDiagnostic, {}), root);
        });
        assert.ok(
            dom.window.document.querySelector('.remote-key-diagnostic')
        );

        act(() => {
            dom.window.document.dispatchEvent(
                new dom.window.KeyboardEvent('keydown', {
                    key: 'ChannelUp',
                    code: 'ChannelUp',
                    repeat: true,
                    cancelable: true,
                })
            );
        });
        const textarea = dom.window.document.querySelector(
            'textarea'
        ) as HTMLTextAreaElement | null;
        assert.ok(textarea);
        const first = JSON.parse(textarea.value);
        assert.equal(first.length, 1);
        assert.deepEqual(
            Object.keys(first[0]).sort(),
            ['code', 'key', 'keyCode', 'repeat', 'timestamp', 'which']
        );
        assert.equal(first[0].key, 'ChannelUp');
        assert.equal(first[0].code, 'ChannelUp');
        assert.equal(first[0].repeat, true);

        act(() => {
            for (let index = 0; index < 31; index++) {
                dom.window.document.dispatchEvent(
                    new dom.window.KeyboardEvent('keydown', {
                        key: `Key${index}`,
                        code: `Code${index}`,
                    })
                );
            }
        });
        assert.equal(
            dom.window.document.querySelectorAll(
                '.remote-key-diagnostic li'
            ).length,
            30
        );
        assert.equal(JSON.parse(textarea.value).length, 30);

        act(() => {
            (
                dom.window.document.querySelector(
                    '[data-focus="key-debug-clear"]'
                ) as HTMLButtonElement | null
            )?.click();
        });
        assert.equal(JSON.parse(textarea.value).length, 0);

        act(() => render(null, root));
        assert.equal(
            dom.window.document.querySelector('.remote-key-diagnostic'),
            null
        );
        assert.equal(keydownRemoves, 1);
    } finally {
        documentWithListener.removeEventListener = originalRemove;
        Object.assign(globalThis, {
            document: previousDocument,
            window: previousWindow,
        });
        dom.window.close();
    }
});
