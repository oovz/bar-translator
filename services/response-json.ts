/** Bounded JSON transport shared by providers with untrusted streaming bodies. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

function decodeChunks(chunks: Uint8Array[], length: number): unknown {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

async function readChunks(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    oversizedBody: () => Error,
    signal?: AbortSignal,
): Promise<unknown> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => undefined);
            throw oversizedBody();
        }
        chunks.push(value);
    }
    return decodeChunks(chunks, length);
}

export async function readBoundedJson(
    response: Response,
    missingBody: string,
    oversizedBody: () => Error,
    signal?: AbortSignal,
): Promise<unknown> {
    signal?.throwIfAborted();
    const reader = response.body?.getReader();
    if (!reader) throw new SyntaxError(missingBody);
    const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        return await readChunks(reader, oversizedBody, signal);
    } finally {
        signal?.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}
