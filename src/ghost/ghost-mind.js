import { EmotionalState } from './emotional-state.js';
import { Memory } from './memory.js';
import { PromptBuilder } from './prompt-builder.js';
import { ThoughtGenerator } from './thought-generator.js';
import { BehaviorBridge } from './behavior-bridge.js';

export class GhostMind {
  constructor() {
    this.emotion = new EmotionalState();
    this.memory = new Memory({ shortTermCapacity: 5 });
    this.promptBuilder = new PromptBuilder();
    this.generator = new ThoughtGenerator();
    this.bridge = new BehaviorBridge();
    this.isRunning = false;
    this.thinkTimer = null;
  }

  async init(onProgress) {
    await this.generator.init(onProgress);
  }

  start() {
    this.isRunning = true;
    this.think();
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.thinkTimer);
  }

  scheduleNextThought() {
    if (!this.isRunning) return;
    const interval = this.emotion.thinkIntervalMs;
    this.thinkTimer = setTimeout(() => this.think(), interval);
  }

  async think() {
    if (!this.isRunning) return;

    // Drift emotions
    this.emotion.drift(this.emotion.thinkIntervalMs / 1000);

    // Build prompt from current state
    const { prompt, displayPrefix } = this.promptBuilder.build(this.emotion, this.memory);

    // Generate thought
    const text = await this.generator.generate(prompt, { displayPrefix });

    if (text) {
      // React emotionally to the generated text
      this.emotion.reactToThought(text);

      // Store in memory
      this.memory.addThought(text, this.emotion.snapshot());

      // Update behavior bridge
      this.bridge.updateFromState(this.emotion);
    }

    // Schedule next thought
    this.scheduleNextThought();
  }

  get thoughtGenerator() {
    return this.generator;
  }

  get behaviorParams() {
    return this.bridge.params;
  }
}
