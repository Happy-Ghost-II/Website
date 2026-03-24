import { Affect } from './affect.js';
import { AffectAssessor } from './affect-assessor.js';
import { ResidualTrace } from './residual-trace.js';
import { ThoughtGenerator } from './thought-generator.js';
import { BehaviorBridge } from './behavior-bridge.js';
import ghostData from './ghost-data.json';

const samplingRanges = ghostData.sampling;

function lerp(min, max, t) {
  return min + (max - min) * t;
}

export class GhostMind {
  constructor() {
    this.affect = new Affect();
    this.assessor = new AffectAssessor();
    this.trace = new ResidualTrace();
    this.generator = new ThoughtGenerator();
    this.bridge = new BehaviorBridge();
    this.isRunning = false;
    this.thinkTimer = null;
  }

  async init(onProgress) {
    await this.generator.init((p) => {
      onProgress?.({ phase: 'brain', ...p });
    });
    await this.assessor.init((p) => {
      onProgress?.({ phase: 'affect', ...p });
    });
  }

  start() {
    this.isRunning = true;
    this.think();
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.thinkTimer);
  }

  update(dt) {
    this.affect.integrate(dt);
    this.bridge.updateFromAffect(this.affect);
  }

  scheduleNextThought() {
    if (!this.isRunning) return;
    const interval = this.affect.thinkIntervalMs;
    this.thinkTimer = setTimeout(() => this.think(), interval);
  }

  // Build prompt with minimal ChatML wrapping
  _buildPrompt() {
    const traces = this.trace.getActiveTraces(0.05);

    let stream;
    if (traces.length === 0) {
      stream = ghostData.seed;
    } else {
      const fragments = traces
        .slice(0, 4)
        .reverse()
        .map((t) => t.content.trim())
        .filter((t) => t.length > 5);
      stream = fragments.length > 0 ? fragments.join('\n') : ghostData.seed;
    }

    return `<|im_start|>system\n${ghostData.systemPrompt}<|im_end|>\n<|im_start|>user\n${stream}<|im_end|>\n<|im_start|>assistant\n`;
  }

  // Map affect to sampling parameters
  _getSamplingParams() {
    const { valence, arousal } = this.affect.snapshot();

    // Arousal (0 = center) maps to temperature: high arousal = more chaotic
    // Map from [-1,1] to [0,1] for lerp
    const arousalT = (arousal + 1) / 2;
    const temp = lerp(samplingRanges.temperature.min, samplingRanges.temperature.max, arousalT);

    // Valence maps to top_p: low valence = narrower, high = more exploratory
    const valenceT = (valence + 1) / 2;
    const top_p = lerp(samplingRanges.topP.min, samplingRanges.topP.max, valenceT);

    // Arousal maps to thought length: high arousal = shorter
    const nPredict = Math.round(lerp(samplingRanges.nPredict.max, samplingRanges.nPredict.min, arousalT));

    return { temp, top_p, nPredict };
  }

  async think() {
    if (!this.isRunning) return;

    // 1. Decay residual traces
    this.trace.decay();

    // 2. Build prompt from own thoughts
    const prompt = this._buildPrompt();

    // 3. Get affect-driven sampling parameters
    const samplingParams = this._getSamplingParams();

    // 4. Generate thought
    const text = await this.generator.generate(prompt, samplingParams);

    if (text) {
      // 5. Imprint as residual trace
      this.trace.imprint(text);

      // 6. Assess affect asynchronously
      this.assessor.assess(text).then(({ forceV, forceA }) => {
        this.affect.applySentiment(forceV, forceA);
      });
    }

    // 7. Schedule next thought
    this.scheduleNextThought();
  }

  get thoughtGenerator() {
    return this.generator;
  }

  get behaviorParams() {
    return this.bridge.params;
  }
}
