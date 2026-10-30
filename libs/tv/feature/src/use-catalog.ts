import { useEffect, useRef, useState } from 'preact/hooks';
import {
    Catalog,
    CatalogSort,
    ProviderClient,
    LatestRequest,
} from '@iptvnator/tv/util';
import { Route } from './navigation';
const empty = (): Catalog => ({ items: [], total: 0, page: 0, categories: [] });
export function coalesceLivePageRequest(
    cache: Map<string, Promise<Catalog | undefined>>,
    key: string,
    request: () => Promise<Catalog | undefined>
): Promise<Catalog | undefined> {
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = request();
    cache.set(key, promise);
    void promise.then(
        () => {
            if (cache.get(key) === promise) cache.delete(key);
        },
        () => {
            if (cache.get(key) === promise) cache.delete(key);
        }
    );
    return promise;
}
/** One active query survives detail navigation; a new query cancels its append lane. */
export function useCatalog(
    route: Route,
    provider: { current?: ProviderClient },
    ready: number,
    source: string,
    finishFocus: () => void,
    sort: CatalogSort,
    reportConnection: (message: string) => void = () => undefined
) {
    const active = ['movies', 'series', 'search', 'live'].includes(route.view);
    const key = JSON.stringify([
        source,
        route.kind,
        route.category,
        route.query,
        sort,
        ready,
    ]);
    const [state, setState] = useState({
        key: '',
        catalog: empty(),
        busy: false,
        error: '',
        more: false,
    });
    const lane = useRef(new LatestRequest());
    const snapshot = useRef(state);
    snapshot.current = state;
    const request = useRef(false);
    const navigation = useRef({
        generation: 0,
        requests: new Map<string, Promise<Catalog | undefined>>(),
        controllers: new Map<string, AbortController>(),
    });
    const latest = useRef({
        key,
        route,
        provider,
        source,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
    });
    latest.current = {
        key,
        route,
        provider,
        source,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
    };
    async function load(append: boolean) {
        const current = latest.current;
        if (
            !current.active ||
            !current.ready ||
            !current.provider.current ||
            request.current
        )
            return;
        const previous = snapshot.current;
        const page =
            append && previous.key === current.key
                ? previous.catalog.page + 1
                : 0;
        const job = lane.current.start();
        request.current = true;
        setState((s) => ({ ...s, busy: true, error: '' }));
        try {
            const result = await current.provider.current.catalog(
                current.route.kind,
                current.route.category,
                page,
                current.route.query,
                job.signal,
                current.sort
            );
            if (!lane.current.owns(job) || current.key !== latest.current.key)
                return;
            const items = page ? [...previous.catalog.items] : [];
            const seen = new Set(items.map((x) => x.id));
            result.items.forEach((item) => {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    items.push(item);
                }
            });
            const progressed =
                page === 0 || items.length > previous.catalog.items.length;
            const next = {
                key: current.key,
                catalog: { ...result, items },
                busy: false,
                error: '',
                more:
                    progressed &&
                    result.items.length > 0 &&
                    (page + 1) * (result.pageSize || 60) < result.total,
            };
            snapshot.current = next;
            setState(next);
            current.reportConnection('');
            if (!page) current.finishFocus();
        } catch {
            if (lane.current.owns(job)) {
                if (!append)
                    current.reportConnection(
                        'Could not load titles. Check the connection and retry.'
                    );
                setState((s) => ({
                    ...s,
                    busy: false,
                    error: 'Could not load titles. Check the connection and retry.',
                }));
            }
        } finally {
            if (lane.current.owns(job)) request.current = false;
        }
    }
    useEffect(() => {
        lane.current.cancel();
        request.current = false;
        if (!active || !ready) return;
        if (
            snapshot.current.key === key &&
            snapshot.current.catalog.items.length
        ) {
            setState((s) => ({ ...s, busy: false }));
            finishFocus();
            return;
        }
        const initial = {
            key,
            catalog: empty(),
            busy: true,
            error: '',
            more: false,
        };
        snapshot.current = initial;
        setState(initial);
        const timer = setTimeout(() => void load(false), route.query ? 180 : 0);
        return () => {
            clearTimeout(timer);
            lane.current.cancel();
            request.current = false;
        };
    }, [key, active]);
    useEffect(() => {
        navigation.current.generation++;
        navigation.current.requests.clear();
        navigation.current.controllers.forEach((controller) =>
            controller.abort()
        );
        navigation.current.controllers.clear();
        return () => {
            navigation.current.generation++;
            navigation.current.requests.clear();
            navigation.current.controllers.forEach((controller) =>
                controller.abort()
            );
            navigation.current.controllers.clear();
        };
    }, [source, key, ready]);
    function loadLivePage(
        category: string,
        page: number
    ): Promise<Catalog | undefined> {
        const current = latest.current;
        if (
            !current.ready ||
            !current.provider.current ||
            page < 0 ||
            !Number.isInteger(page)
        )
            return Promise.resolve(undefined);
        const client = current.provider.current;
        const generation = navigation.current.generation;
        const requestKey = JSON.stringify([source, category, page]);
        return coalesceLivePageRequest(
            navigation.current.requests,
            requestKey,
            async () => {
                const controller = new AbortController();
                navigation.current.controllers.set(requestKey, controller);
                try {
                    const result = await client.catalog(
                        'live',
                        category,
                        page,
                        '',
                        controller.signal,
                        'provider'
                    );
                    if (
                        controller.signal.aborted ||
                        generation !== navigation.current.generation ||
                        client !== latest.current.provider.current ||
                        source !== latest.current.source
                    )
                        return undefined;
                    return { ...result, page };
                } catch {
                    return undefined;
                } finally {
                    navigation.current.controllers.delete(requestKey);
                }
            }
        );
    }
    return {
        catalog: state.key === key ? state.catalog : empty(),
        catalogBusy: active && state.busy,
        catalogError: state.key === key ? state.error : '',
        hasMore: state.key === key && state.more,
        loadMore: () => void load(snapshot.current.catalog.items.length > 0),
        loadLivePage,
        catalogKey: key,
    };
}
