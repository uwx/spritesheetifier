// https://github.com/GoogleChromeLabs/comlink/issues/635

import { type Remote, wrap, expose, type Endpoint } from "comlink";

export async function wrapAsync<T>(worker: Worker): Promise<Remote<T>> {
    await new Promise<void>((resolve, reject) => {
        const controller = new AbortController();
        worker.addEventListener('message', (message) => {
            if (message?.data?.ready) {
                controller.abort();
                resolve();
            }
        }, { signal: controller.signal })
    })
    return wrap<T>(worker);
}

export function exposeAsync(object: any, ep?: Endpoint | undefined, allowedOrigins?: (string | RegExp)[] | undefined) {
    expose(object, ep, allowedOrigins);
    if (ep) ep.postMessage({ready: true});
    else postMessage({ready: true});
}