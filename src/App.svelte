<script lang="ts">
    import { wrapAsync } from "./comlink-async";
    import type { Api } from './worker/worker';
    import { Button, Container, Input, Label } from "@sveltestrap/sveltestrap";

    let frameCount: number;
    let resultUrl: string;
    let tileWidth: number;
    let tileHeight: number;
    let approxFrameRate: number | undefined;

    const workerPromise = wrapAsync<Api>(
        new Worker(new URL("./worker/worker.ts", import.meta.url), {
            type: "module",
        }),
    );

    async function start(e: Event) {
        const file = (e.currentTarget as HTMLInputElement).files?.[0];
        if (!file) return;

        const api = await workerPromise;
        if (resultUrl) {
            URL.revokeObjectURL(resultUrl);
        }
        const result = await api.tilefy(file);

        tileWidth = result.tileWidth;
        tileHeight = result.tileHeight;
        frameCount = result.frames;
        approxFrameRate = result.approxFrameRate;
        resultUrl = URL.createObjectURL(result.file);
    }
</script>

<Input type="file" on:change={start} id="file" label="Input file:&nbsp;" />

{#if resultUrl}
<p>Tile size: {tileWidth}x{tileHeight}</p>
<p>Frames: {frameCount}</p>
<p>Approximate frame rate: {approxFrameRate}* <sup>*framerate may not be constant in the original GIF or video file</sup></p>
<img src={resultUrl} alt="Generated spritesheet" style="max-width: 100%;"/>
{/if}