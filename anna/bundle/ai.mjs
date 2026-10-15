export class AiError extends Error {
  constructor(kind, message, partial = '') {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.partial = partial;
  }
}

const UNSUPPORTED = new Set([-32601, 'not_implemented', 'unknown_method', 'permission_denied', 'forbidden']);

export function classify(error) {
  const code = error?.code;
  const text = String(error?.message || '');
  if (error?.name === 'AbortError') return 'aborted';
  if (code === 'APP_QUOTA_EXCEEDED') return 'quota';
  if (code === 'APP_PROVIDER_ERROR') return 'provider';
  if (/quota|credit|insufficient/i.test(text)) return 'quota';
  if (/no eligible model/i.test(text)) return 'provider';
  if (/timed? ?out/i.test(text)) return 'timeout';
  return 'unavailable';
}

export function createAi(llm) {
  async function viaComplete(request) {
    const result = await llm.complete(request);
    return {text: result?.content?.text || '', model: result?.model || ''};
  }

  async function speak({system, messages, preferences, maxTokens = 600, onToken = () => {}, signal, timeoutMs = 120000} = {}) {
    const request = {
      systemPrompt: system,
      messages: messages.map(m => ({role: m.role, content: {type: 'text', text: m.text}})),
      maxTokens,
      temperature: 0.7,
      modelPreferences: preferences,
    };
    if (signal?.aborted) throw new AiError('aborted', 'aborted');
    let text = '';
    let iterator = null;
    let onAbort;
    let timer;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new AiError('aborted', 'aborted'));
      signal?.addEventListener('abort', onAbort, {once: true});
      timer = setTimeout(() => reject(new AiError('timeout', 'timed out', text)), timeoutMs);
    });
    aborted.catch(() => {});
    const raced = promise => Promise.race([promise, aborted]);
    const fallback = error => !text && UNSUPPORTED.has(error?.code);
    try {
      if (typeof llm.stream !== 'function') return await raced(viaComplete(request));
      let frame;
      try {
        iterator = llm.stream(request)[Symbol.asyncIterator]();
        frame = await raced(iterator.next());
      } catch (error) {
        if (!fallback(error)) throw error;
        return await raced(viaComplete(request));
      }
      while (true) {
        if (signal?.aborted) throw new AiError('aborted', 'aborted');
        const {value: event, done} = frame;
        if (done) break;
        if (event?.event === 'model_token' && event.text) {
          text += event.text;
          onToken(text);
        } else if (event?.event === 'complete') {
          return {text: event.content?.text || text, model: event.model || ''};
        } else if (event?.event === 'error') {
          if (fallback(event)) return await raced(viaComplete(request));
          throw Object.assign(new Error(event.message || 'stream failed'), {code: event.code});
        }
        frame = await raced(iterator.next());
      }
      throw Object.assign(new Error('stream ended without a reply'), {code: 'stream_closed'});
    } catch (error) {
      if (error instanceof AiError) {
        error.partial = text;
        throw error;
      }
      throw new AiError(classify(error), error?.message || 'AI unavailable', text);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        iterator?.return?.()?.catch?.(() => {});
      } catch {}
    }
  }

  return {speak};
}
