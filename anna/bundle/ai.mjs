export class AiError extends Error {
  constructor(kind, message, partial = '') {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.partial = partial;
  }
}

const UNSUPPORTED = new Set([-32601, 'not_implemented', 'unknown_method']);

export function classify(error) {
  const code = error?.code;
  const text = String(error?.message || '');
  if (code === 'APP_QUOTA_EXCEEDED' || /quota|credit|insufficient/i.test(text)) return 'quota';
  if (code === 'APP_PROVIDER_ERROR' || /no eligible model/i.test(text)) return 'provider';
  if (/timed? ?out/i.test(text)) return 'timeout';
  return 'unavailable';
}

export function createAi(llm) {
  async function viaComplete(request) {
    const result = await llm.complete(request);
    return {text: result?.content?.text || '', model: result?.model || ''};
  }

  async function speak({system, messages, preferences, maxTokens = 600, onToken = () => {}, signal} = {}) {
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
    try {
      if (typeof llm.stream !== 'function') return await viaComplete(request);
      iterator = llm.stream(request)[Symbol.asyncIterator]();
      const aborted = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new AiError('aborted', 'aborted')), {once: true}));
      aborted.catch(() => {});
      while (true) {
        const {value: event, done} = await (signal ? Promise.race([iterator.next(), aborted]) : iterator.next());
        if (done) break;
        if (event?.event === 'model_token' && event.text) {
          text += event.text;
          onToken(text);
          if (signal?.aborted) throw new AiError('aborted', 'aborted');
        } else if (event?.event === 'complete') {
          return {text: event.content?.text || text, model: event.model || ''};
        } else if (event?.event === 'error') {
          if (!text && UNSUPPORTED.has(event.code)) return await viaComplete(request);
          throw Object.assign(new Error(event.message || 'stream failed'), {code: event.code});
        }
      }
      throw Object.assign(new Error('stream ended without a reply'), {code: 'stream_closed'});
    } catch (error) {
      if (error instanceof AiError) {
        error.partial = text;
        throw error;
      }
      throw new AiError(classify(error), error?.message || 'AI unavailable', text);
    } finally {
      iterator?.return?.().catch?.(() => {});
    }
  }

  return {speak};
}
