export class ResidualTrace {
  constructor({ maxTraces = 6, decayRate = 0.15 } = {}) {
    this.traces = [];
    this.maxTraces = maxTraces;
    this.decayRate = decayRate;
  }

  imprint(content) {
    this.traces.push({
      content: content.trim(),
      activation: 1.0,
      timestamp: Date.now(),
    });
    while (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }
  }

  decay() {
    const factor = 1 - this.decayRate;
    for (const trace of this.traces) {
      trace.activation *= factor;
    }
    this.traces = this.traces.filter((t) => t.activation >= 0.05);
  }

  getActiveTraces(threshold = 0.1) {
    return this.traces
      .filter((t) => t.activation >= threshold)
      .sort((a, b) => b.activation - a.activation);
  }

  getStrongestTrace() {
    if (this.traces.length === 0) return null;
    let strongest = this.traces[0];
    for (const t of this.traces) {
      if (t.activation > strongest.activation) strongest = t;
    }
    return strongest.activation >= 0.05 ? strongest : null;
  }

  getRepetitionGuard() {
    const top = this.getActiveTraces(0.1).slice(0, 2);
    if (top.length === 0) return '';
    return top.map((t) => {
      const words = t.content.split(/\s+/).slice(0, 6).join(' ');
      return words;
    }).join('; ');
  }
}
