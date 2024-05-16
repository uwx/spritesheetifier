console.log('hi');

globalThis._scriptDir = undefined;

import LibAV from './libav';
import { exposeAsync } from '../comlink-async';
import { getStdout, restoreStdout, stdoutFile } from './libav-helpers';
import { MP4FileSink } from './mp4-demux';

import MediaInfoFactory, { type ReadChunkFunc, type MediaInfo, type FormatType } from 'mediainfo.js'
import MP4Box from 'mp4box';
import {
    initializeImageMagick,
    ImageMagick,
    Magick,
    MagickFormat,
    Quantum,
    MontageSettings,
} from '@imagemagick/magick-wasm';
import { fileTypeFromBlob, FileTypeParser, type FileTypeResult } from '@sgtpooki/file-type';
import { MagickColor, MagickGeometry, MagickImageCollection } from '@imagemagick/magick-wasm';
import { parseGIF, decompressFrames } from 'gifuct-js'

import { default as magickWasmLocation } from '@imagemagick/magick-wasm/magick.wasm?url';
import { default as mediaInfoWasmLocation } from 'mediainfo.js/MediaInfoModule.wasm?url';
import { default as fontLocation } from './KaushanScript-Regular.ttf?url';

let isMagickInitialized = false;
async function initMagickIfNotAlready() {
    if (isMagickInitialized) return;
    isMagickInitialized = true;

    await initializeImageMagick(await WebAssembly.compileStreaming(fetch(magickWasmLocation)));

    const buf = await fetch(fontLocation).then(e => e.arrayBuffer());
    Magick.addFont('kaushan script', new Uint8Array(buf));
}

let cachedMediaInfo: MediaInfo<'object'> | undefined;
async function getOrInitMediaInfo() {
    if (cachedMediaInfo) return cachedMediaInfo;

    return cachedMediaInfo = await MediaInfoFactory({
        format: 'object',
        locateFile(path, prefix) {
            if (path === 'MediaInfoModule.wasm') {
                return mediaInfoWasmLocation;
            }

            // defaultLocateFile
            try {
                const url = new URL(prefix);
                if (url.pathname === '/') {
                return `${prefix}mediainfo.js/dist/${path}`;
                }
            } catch {}
            return `${prefix}../${path}`;
        },
    });
}

function getMetadata<TFormat extends FormatType>(mi: MediaInfo<TFormat>, file: File) {
    const getSize = () => file.size;
    const readChunk: ReadChunkFunc = (chunkSize, offset) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event: ProgressEvent<FileReader>) => {
                if (event.target?.error) {
                    reject(event.target.error);
                }
                resolve(new Uint8Array(event.target?.result as ArrayBuffer));
            }
            reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        });

    return mi.analyzeData(getSize, readChunk)
}

function parseRational(rat: string): number {
    const [a, b] = rat.split('/');
    return +a / +b;
}

export class Api {
    async tilefy(file: File) {
        const fileType = await fileTypeFromBlob(file) as FileTypeResult;

        if (fileType.mime.startsWith('video/')) {
            const libav = await LibAV.LibAV({ noworker: true });

            // https://stackoverflow.com/a/28376817
            let width: number | undefined;
            let height: number | undefined;
            let frameCount: number | undefined;
            let approxFrameRate: number | undefined;

            // common case: parse with mp4box
            if (fileType.mime === 'video/mp4') {
                const buf = await file.arrayBuffer();
                await new Promise<void>((resolve, reject) => {
                    const mp4File = MP4Box.createFile();
                    mp4File.onError = e => reject(e);
                    mp4File.onReady = info => {
                        ({ video: { width, height }, nb_samples: frameCount } = info.videoTracks[0]);
                        let { duration, timescale } = info.videoTracks[0];
                        approxFrameRate = frameCount/(duration/timescale);
                        resolve();
                    };

                    // Fetch the file and pipe the data through.
                    const fileSink = new MP4FileSink(mp4File);
                    // highWaterMark should be large enough for smooth streaming, but lower is
                    // better for memory usage.
                    file.stream().pipeTo(new WritableStream(fileSink, {highWaterMark: 2})).catch(reject);
                });
            }

            // alternate case: parse with mediainfo
            if ((frameCount === undefined || width === undefined || height === undefined) &&
                (fileType.mime === 'video/quicktime' ||
                fileType.mime === 'video/vnd.avi' ||
                fileType.mime === 'video/x-matroska' ||
                fileType.mime === 'video/webm' ||
                fileType.mime === 'video/mpeg' ||
                fileType.mime === 'video/MP2P' ||
                fileType.mime === 'video/mp2t' ||
                fileType.mime === 'video/MP1S' ||
                fileType.mime === 'video/x-m4v' ||
                fileType.mime === 'video/x-ms-asf' ||
                fileType.mime === 'video/ogg')) {

                const metadata = await getMetadata(await getOrInitMediaInfo(), file);

                width = metadata.media?.track.find(e => e.FrameCount)?.Width;
                height = metadata.media?.track.find(e => e.FrameCount)?.Height;
                frameCount = metadata.media?.track.find(e => e.FrameCount)?.FrameCount;
                approxFrameRate = metadata.media?.track.find(e => e.FrameRate)?.FrameRate;
            }

            await libav.mkreadaheadfile('input', file);

            // fallback: parse with ffprobe (slow)
            if (frameCount === undefined || width === undefined || height === undefined) {
                // count frames + get width+height
                await stdoutFile(libav);
                await libav.ffprobe('-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height,avg_frame_rate,r_frame_rate', '-print_format', 'json', 'input');
                await restoreStdout(libav);
                const ffprobeResult: {
                    programs: [],
                    streams: [{
                        width: number,
                        height: number,
                        r_frame_rate: string,
                        avg_frame_rate: string,
                        nb_read_frames: string,
                    }]
                } = JSON.parse(await getStdout(libav));

                const s = ffprobeResult.streams[0];
                ({ width, height } = s);
                frameCount = +s.nb_read_frames;
                approxFrameRate = parseRational(s.avg_frame_rate);
            }

            // https://video.stackexchange.com/a/28411
            // if resulting image is too big, shrink it until it fits
            let scale = 1;
            while (((Math.round(width * Math.floor(Math.sqrt(frameCount)) * scale) * 8) + 1024) * (Math.round(height * Math.ceil(Math.sqrt(frameCount)) * scale) + 128) >= 2_147_483_647) {
                scale -= 0.01;
            }

            await libav.ffmpeg('-i', 'input', '-vf', `scale=${Math.round(width * scale)}:${Math.round(height * scale)},tile=${Math.floor(Math.sqrt(frameCount))}x${Math.ceil(Math.sqrt(frameCount))}`, 'out.png'); // -r 1 -s 640x360
            const outFile = await libav.readFile('out.png');
            await libav.unlink('out.png');

            libav.terminate();

            return {
                file: new File([outFile], 'image.png', { type: 'image/png' }),
                tileWidth: Math.round(width * scale),
                tileHeight: Math.round(height * scale),
                frames: frameCount,
                approxFrameRate
            };
        } else if (fileType.mime === 'image/gif') {
            const buf = await file.arrayBuffer();

            const gif = parseGIF(buf);

            const frames = decompressFrames(gif, true);

            const { width: tileWidth, height: tileHeight } = frames[0].dims;

            let tilesX = Math.floor(Math.sqrt(frames.length));
            let tilesY = Math.ceil(Math.sqrt(frames.length));

            const canvas = new OffscreenCanvas(tileWidth * tilesX, tileHeight * tilesY);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not create canvas context');

            let i = 0;
            for (const frame of frames) {
                let tileX = (i % tilesX) * tileWidth;
                let tileY = Math.floor(i / tilesX) * tileHeight;

                const dims = frame.dims;

                ctx.putImageData(new ImageData(frame.patch, dims.width, dims.height), tileX + dims.left, tileY + dims.top);

                i++;
            }

            const outBlob = await canvas.convertToBlob({ type: 'image/png' });

            const totalTimeMs = frames.reduce((a, b) => a + b.delay, 0);

            return {
                file: new File([outBlob], 'image.png', { type: 'image/png' }),
                tileWidth,
                tileHeight,
                frames: frames.length,
                approxFrameRate: frames.length/(totalTimeMs/1000)
            };
        } else {
            await initMagickIfNotAlready();

            const buf = await file.arrayBuffer();

            console.log(Magick.imageMagickVersion);
            console.log('Delegates:', Magick.delegates);
            console.log('Features:', Magick.features);
            console.log('Quantum:', Quantum.depth);
            console.log('');

            return ImageMagick.readCollection(new Uint8Array(buf), images => {

                const montageSettings = new MontageSettings();

                montageSettings.font = 'kaushan script';
                montageSettings.tileGeometry = new MagickGeometry(0, 0);
                montageSettings.backgroundColor = new MagickColor(0, 0, 0, 0);

                return {
                    file: images.montage(montageSettings, image => {
                        return image.write(MagickFormat.Png, data => new File([data], 'image.png', { type: 'image/png' }));
                    }),
                    frames: images.length,
                    tileWidth: Math.max(...images.map(e => e.width)),
                    tileHeight: Math.max(...images.map(e => e.height)),
                    approxFrameRate: undefined
                };
            });
        }
    }
}

exposeAsync(new Api());
