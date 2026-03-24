import { pipeline } from '@huggingface/transformers';
import ghostData from './ghost-data.json';

const EMOTION_MAP = ghostData.emotionMap;

export class AffectAssessor {
  constructor() {
    this.classifier = null;
  }

  async init(onProgress) {
    this.classifier = await pipeline(
      'text-classification',
      'nicky48/emotion-english-distilroberta-base-ONNX',
      {
        dtype: 'q8',
        progress_callback: (event) => {
          if (event.status === 'progress' && event.loaded != null && event.total) {
            onProgress?.({ loaded: event.loaded, total: event.total });
          }
        },
      }
    );
  }

  async assess(text) {
    if (!this.classifier || !text) return { forceV: 0, forceA: 0, emotions: {} };

    const results = await this.classifier(text, { top_k: null });

    // Compute force vector from emotion scores
    let forceV = 0;
    let forceA = 0;
    const emotions = {};

    for (const result of results) {
      const label = result.label;
      const score = result.score;
      emotions[label] = score;

      const mapping = EMOTION_MAP[label];
      if (mapping) {
        forceV += score * mapping.v;
        forceA += score * mapping.a;
      }
    }

    return { forceV, forceA, emotions };
  }
}
