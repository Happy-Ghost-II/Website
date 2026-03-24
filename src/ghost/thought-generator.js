import { Wllama } from '@wllama/wllama';

const WASM_PATHS = {
  'single-thread/wllama.wasm': new URL(
    '@wllama/wllama/esm/single-thread/wllama.wasm',
    import.meta.url
  ).href,
  'multi-thread/wllama.wasm': new URL(
    '@wllama/wllama/esm/multi-thread/wllama.wasm',
    import.meta.url
  ).href,
};

export class ThoughtGenerator {
  constructor() {
    this.wllama = null;
    this.isGenerating = false;
    this.listeners = [];
  }

  async init(onProgress) {
    this.wllama = new Wllama(WASM_PATHS);
    await this.wllama.loadModelFromHF(
      'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
      'qwen2.5-0.5b-instruct-q4_k_m.gguf',
      {
        n_threads: 1,
        progressCallback: onProgress,
      }
    );
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  async generate(prompt, { nPredict = 40, temp = 0.8, top_k = 40, top_p = 0.85 } = {}) {
    if (this.isGenerating || !this.wllama) return null;
    this.isGenerating = true;

    let fullText = '';
    const abortController = new AbortController();

    await this.wllama.createCompletion(prompt, {
      nPredict,
      sampling: { temp, top_k, top_p, penalty_repeat: 1.5, penalty_last_n: 128 },
      abortSignal: abortController.signal,
      onNewToken: (_token, _piece, currentText) => {
        fullText = currentText;

        // Clean as we go — strip unwanted formatting
        const cleaned = this._clean(fullText);
        for (const l of this.listeners) l.onToken?.(cleaned);

        // Stop at sentence-ending punctuation once we have enough text
        if (cleaned.length > 15) {
          const trimmed = cleaned.trimEnd();
          const lastChar = trimmed[trimmed.length - 1];
          if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
            abortController.abort();
          }
        }
      },
    }).catch((e) => {
      if (e.name !== 'AbortError' && e.constructor?.name !== 'WllamaAbortError') throw e;
    });

    // Final cleanup
    fullText = this._clean(fullText);

    // Ensure it ends at a sentence boundary
    const lastEnd = Math.max(
      fullText.lastIndexOf('.'),
      fullText.lastIndexOf('!'),
      fullText.lastIndexOf('?')
    );
    if (lastEnd > 10) {
      fullText = fullText.slice(0, lastEnd + 1);
    }

    this.isGenerating = false;
    for (const l of this.listeners) l.onComplete?.(fullText);
    return fullText;
  }

  _clean(text) {
    return text
      .replace(/[""\u201C\u201D]/g, '')    // remove quotes
      .replace(/\([^)]*\)/g, '')            // remove parentheticals
      .replace(/\s{2,}/g, ' ')             // collapse whitespace
      .trim();
  }
}
