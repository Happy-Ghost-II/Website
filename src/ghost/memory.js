export class Memory {
  constructor({ shortTermCapacity = 5 } = {}) {
    this.shortTerm = [];
    this.capacity = shortTermCapacity;
  }

  addThought(text, emotionSnapshot) {
    this.shortTerm.push({
      text: text.trim(),
      timestamp: Date.now(),
      emotion: emotionSnapshot,
    });
    while (this.shortTerm.length > this.capacity) {
      this.shortTerm.shift();
    }
  }

  getRecent(n = 3) {
    return this.shortTerm.slice(-n);
  }

  getContextString() {
    const fragments = this.getRecent()
      .map((m) => m.text)
      .filter((t) => t.length > 10);
    if (fragments.length === 0) return '';
    // Use only the most recent complete thought to avoid mid-sentence cuts
    const last = fragments[fragments.length - 1];
    // Trim to last ~80 chars at a sentence/phrase boundary
    if (last.length <= 80) return last;
    const trimmed = last.slice(-80);
    const boundary = trimmed.search(/[.!?]\s/);
    if (boundary !== -1) return trimmed.slice(boundary + 2).trim();
    const space = trimmed.indexOf(' ');
    if (space !== -1) return trimmed.slice(space + 1).trim();
    return trimmed;
  }

  // Stubs for future long-term persistence
  saveToLongTerm() {}
  loadFromLongTerm() {}
}
