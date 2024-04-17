console.log('a');
import LibAV, { type LibAVWrapper } from '../libav.js/libav-5.1.6.1.1-d89883a-all';
export { LibAV };
export type * from 'libav.js';

console.log('b');

const libavVersion = '5.1.6.1.1-d89883a';
const libavVariant = 'all';

declare module globalThis {
    export var LibAV: LibAVWrapper;
}

globalThis.LibAV = LibAV;

console.log('libav setup');

LibAV.factory = (async () => {
    console.log('importing libav');
    return (await import(`../libav.js/libav-5.1.6.1.1-d89883a-all.wasm`)).default;
})();
LibAV.wasmurl = (await import(`../libav.js/libav-5.1.6.1.1-d89883a-all.wasm.wasm?url`)).default;

export type LibAVInstance = Awaited<ReturnType<typeof LibAV['LibAV']>>;
