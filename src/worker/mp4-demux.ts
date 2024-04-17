import { type ISOFile, type MP4ArrayBuffer } from 'mp4box';

// Wraps an MP4Box File as a WritableStream underlying sink.
export class MP4FileSink {
  offset = 0;

  constructor(private file: ISOFile, private setStatus?: (status: string, caption: string) => void) {
    this.file = file;
    this.setStatus = setStatus;
  }

  write(chunk: Uint8Array) {
    // MP4Box.js requires buffers to be ArrayBuffers, but we have a Uint8Array.
    const buffer: MP4ArrayBuffer = Object.assign(chunk.buffer, { fileStart: this.offset });

    // Inform MP4Box where in the file this chunk is from.
    this.offset += buffer.byteLength;

    // Append chunk.
    this.setStatus?.("fetch", (this.offset / (1024 ** 2)).toFixed(1) + " MiB");
    this.file.appendBuffer(buffer);
  }

  close() {
    this.setStatus?.("fetch", "Done");
    this.file.flush();
  }
}
