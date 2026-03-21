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
      'bartowski/SmolLM2-135M-Instruct-GGUF',
      'SmolLM2-135M-Instruct-Q8_0.gguf',
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

  async generate(prompt, { displayPrefix = '', nPredict = 80, temp = 0.9, top_k = 40, top_p = 0.9 } = {}) {
    if (this.isGenerating || !this.wllama) return null;
    this.isGenerating = true;

    let fullText = '';
    const abortController = new AbortController();

    // Show the seed immediately so the thought starts complete
    if (displayPrefix) {
      for (const l of this.listeners) l.onToken?.(displayPrefix);
    }

    await this.wllama.createCompletion(prompt, {
      nPredict,
      sampling: { temp, top_k, top_p, penalty_repeat: 1.3, penalty_last_n: 64 },
      abortSignal: abortController.signal,
      onNewToken: (_token, _piece, currentText) => {
        fullText = currentText;
        for (const l of this.listeners) l.onToken?.(displayPrefix + currentText);

        // Stop at sentence-ending punctuation once we have enough text
        if (currentText.length > 30) {
          const trimmed = currentText.trimEnd();
          const lastChar = trimmed[trimmed.length - 1];
          if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
            abortController.abort();
          }
        }
      },
    }).catch((e) => {
      // AbortError is expected when we stop at punctuation
      if (e.name !== 'AbortError' && e.constructor?.name !== 'WllamaAbortError') throw e;
    });

    fullText = displayPrefix + fullText;
    this.isGenerating = false;
    for (const l of this.listeners) l.onComplete?.(fullText);
    return fullText;
  }
}
