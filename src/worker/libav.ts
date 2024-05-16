console.log('poop!');
import LibAV, { type LibAVWrapper } from '@uwx/libav.js-all';
export { LibAV as default };
export type * from '@uwx/libav.js-all';

declare module globalThis {
    export var LibAV: LibAVWrapper;
}

globalThis.LibAV = LibAV;

console.log('libav setup');

LibAV.factory = (async () => {
    console.log('importing libav');
    return (await import(`@uwx/libav.js-all/factory/all.wasm`)).default;
})();
LibAV.wasmurl = (await import(`@uwx/libav.js-all/backend/all.wasm?url`)).default;

console.log(LibAV);

export type LibAVInstance = Awaited<ReturnType<typeof LibAV['LibAV']>>;
