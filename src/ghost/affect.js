import ghostData from './ghost-data.json';

const dyn = ghostData.affectDynamics;

// ── Affect as a damped oscillator following a drifting target ──
//
//   The system has two layers:
//
//   1. A TARGET POINT that represents accumulated emotional sentiment.
//      Each thought nudges the target. The target decays back to (0,0):
//
//        dx_target/dt = -λ · x_target
//        (with impulses from emotion assessments)
//
//   2. An OSCILLATOR that follows the target through a viscous medium.
//      Overdamped so it drifts smoothly without bouncing:
//
//        d²x/dt² = -2ζω₀·(dx/dt) - ω₀²·(x - x_target) + noise(t)
//
//   Output:
//      V = tanh(v),  A = tanh(a)   ∈ (-1, 1)
//
//   This produces:
//     - Gradual drift toward recent emotional sentiment
//     - Smooth wandering from noise
//     - Natural return to center as target decays
//     - No extremes unless sustained emotional pressure
//

const omega0 = dyn.naturalFrequency * Math.PI * 2;
const gamma = 2 * dyn.dampingRatio * omega0;
const k = omega0 * omega0;

export class Affect {
  constructor() {
    // Oscillator position (internal, unbounded)
    this._v = 0;
    this._a = 0;

    // Oscillator velocity
    this._dv = 0;
    this._da = 0;

    // Drifting target (what the oscillator is pulled toward)
    this._targetV = 0;
    this._targetA = 0;

    // Ornstein-Uhlenbeck noise state
    this._noiseV = 0;
    this._noiseA = 0;

    // Trail history for visualization
    this.trail = [];
    this._trailMaxLength = 300;
    this._trailSampleTimer = 0;
    this._trailSampleInterval = 0.1;
  }

  // ── Observable state ──

  get valence() { return Math.tanh(this._v); }
  get arousal() { return Math.tanh(this._a); }

  snapshot() {
    return { valence: this.valence, arousal: this.arousal };
  }

  // ── Sentiment input ──
  //
  // Each emotion assessment nudges the target point.
  // The target then slowly decays back to (0,0).
  //
  applySentiment(forceV, forceA) {
    this._targetV += forceV * dyn.sentimentStrength;
    this._targetA += forceA * dyn.sentimentStrength;
  }

  // Small nudge to target
  nudge(dv, da) {
    this._targetV += dv;
    this._targetA += da;
  }

  // ── Integration (called every frame) ──

  integrate(dt) {
    // --- Decay the target toward (0,0) ---
    const targetDecay = Math.exp(-dyn.targetDecayRate * dt);
    this._targetV *= targetDecay;
    this._targetA *= targetDecay;

    // --- Ornstein-Uhlenbeck noise ---
    const theta = 0.3;
    const sigma = dyn.noiseAmplitude;
    const sqrtDt = Math.sqrt(Math.abs(dt));
    this._noiseV += -theta * this._noiseV * dt + sigma * sqrtDt * (Math.random() - 0.5) * 2;
    this._noiseA += -theta * this._noiseA * dt + sigma * sqrtDt * (Math.random() - 0.5) * 2;

    // --- Oscillator follows target (symplectic Euler) ---
    // The spring pulls toward the TARGET, not toward (0,0) directly.
    // As the target decays, the oscillator is naturally drawn home.
    const accV = -gamma * this._dv - k * (this._v - this._targetV) + this._noiseV;
    this._dv += accV * dt;
    this._v += this._dv * dt;

    const accA = -gamma * this._da - k * (this._a - this._targetA) + this._noiseA;
    this._da += accA * dt;
    this._a += this._da * dt;

    // --- Record trail ---
    this._trailSampleTimer += dt;
    if (this._trailSampleTimer >= this._trailSampleInterval) {
      this._trailSampleTimer = 0;
      this.trail.push({
        v: this.valence,
        a: this.arousal,
        t: performance.now(),
      });
      while (this.trail.length > this._trailMaxLength) {
        this.trail.shift();
      }
    }
  }

  // ── Derived properties ──

  get thinkIntervalMs() {
    const base = 9000 - this.arousal * 5000;
    const jitter = (Math.random() - 0.5) * 4000;
    return Math.max(2000, base + jitter);
  }

}
