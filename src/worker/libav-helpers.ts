import { type LibAVInstance as LibAV } from "./libav";

export const NULL = 0;
export const PIPE = {
    STDIN: 0,
    STDOUT: 1,
    STDERR: 2
} as const;

let stdoutCopy: number;

export async function stdoutFile(libav: LibAV) {
    stdoutCopy = await libav.dup(1);
    await libav.writeFile("stdout", new Uint8Array(0));
    const stdoutFd = await libav.open("stdout", 1, NULL);
    await libav.dup2(stdoutFd, PIPE.STDOUT);
    await libav.close(stdoutFd);
    // const stderrFd = await libav.open("/dev/null", 1, NULL);
    // await libav.dup2(stderrFd, PIPE.STDERR);
    // await libav.close(stderrFd);
}

export async function restoreStdout(libav: LibAV) {
    await libav.dup2(stdoutCopy, PIPE.STDOUT);
}

export async function getStdout(libav: LibAV) {
    try {
        return new TextDecoder().decode(await libav.readFile("stdout"));
    } catch (ex) {
        console.error(ex);
        throw ex;
    }
}