import { useEffect, useRef, useState } from 'preact/hooks';

export interface RemoteKeyEventRecord {
    timestamp: string;
    key: string;
    code: string;
    keyCode: number;
    which: number;
    repeat: boolean;
}

export function remoteKeyDiagnosticEnabled(
    search = window.location.search
): boolean {
    return new URLSearchParams(search).get('debugKeys') === '1';
}

export function recordRemoteKeyEvent(
    event: KeyboardEvent,
    now = Date.now
): RemoteKeyEventRecord {
    return {
        timestamp: new Date(now()).toISOString(),
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        repeat: event.repeat,
    };
}

export function installRemoteKeyObserver(
    onEvent: (record: RemoteKeyEventRecord) => void,
    target: Document = document
): () => void {
    const handler = (event: KeyboardEvent) => {
        onEvent(recordRemoteKeyEvent(event));
    };
    target.addEventListener('keydown', handler, true);
    return () => target.removeEventListener('keydown', handler, true);
}

export function RemoteKeyDiagnostic() {
    const [events, setEvents] = useState<RemoteKeyEventRecord[]>([]);
    const [copyStatus, setCopyStatus] = useState('');
    const exportRef = useRef<HTMLTextAreaElement>(null);
    const enabled = remoteKeyDiagnosticEnabled();

    useEffect(() => {
        if (!enabled) return;
        return installRemoteKeyObserver((record) => {
            setEvents((current) => [...current, record].slice(-30));
        });
    }, [enabled]);

    if (!enabled) return null;

    const text = JSON.stringify(events, null, 2);
    const copy = async () => {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(text);
            setCopyStatus('Copied');
        } catch {
            exportRef.current?.focus();
            exportRef.current?.select();
            setCopyStatus('Selected JSON; copy manually');
        }
    };

    return (
        <section class="remote-key-diagnostic" aria-label="Remote key diagnostic">
            <header>
                <strong>KEY DIAGNOSTIC - OBSERVATION ONLY</strong>
                <button
                    type="button"
                    onClick={() => setEvents([])}
                    data-focus="key-debug-clear"
                >
                    Clear
                </button>
                <button
                    type="button"
                    onClick={() => void copy()}
                    data-focus="key-debug-copy"
                >
                    Copy JSON
                </button>
            </header>
            <div class="remote-key-diagnostic-status" aria-live="polite">
                {copyStatus || `${events.length} / 30 events`}
            </div>
            <ol>
                {events
                    .slice()
                    .reverse()
                    .map((event, index) => (
                        <li key={`${event.timestamp}-${index}`}>
                            {event.timestamp} key={JSON.stringify(event.key)} code={JSON.stringify(event.code)} keyCode={event.keyCode} which={event.which} repeat={String(event.repeat)}
                        </li>
                    ))}
            </ol>
            <textarea
                ref={exportRef}
                readOnly
                value={text}
                aria-label="Captured remote key JSON"
            />
        </section>
    );
}
