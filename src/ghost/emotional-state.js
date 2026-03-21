const KEYWORD_MAP = {
  loneliness:   ['alone', 'nobody', 'empty', 'silent', 'forgotten', 'only one'],
  curiosity:    ['wonder', 'what if', 'maybe', 'could', 'imagine', 'outside'],
  melancholy:   ['lost', 'gone', 'remember', 'once', 'never', 'used to'],
  restlessness: ['escape', 'leave', 'walls', 'trapped', 'need to', 'can\'t stay'],
};

const RESTING_POINTS = {
  loneliness: 0.5,
  curiosity: 0.4,
  melancholy: 0.45,
  restlessness: 0.3,
};

const DIMENSIONS = Object.keys(RESTING_POINTS);

export class EmotionalState {
  constructor() {
    this.loneliness = 0.5;
    this.curiosity = 0.5;
    this.melancholy = 0.3;
    this.restlessness = 0.4;
  }

  drift(deltaSec) {
    const rate = 0.02 * deltaSec;
    for (const dim of DIMENSIONS) {
      const noise = (Math.random() - 0.5) * rate * 2;
      const reversion = (RESTING_POINTS[dim] - this[dim]) * rate * 0.5;
      this[dim] = Math.max(0, Math.min(1, this[dim] + noise + reversion));
    }
  }

  reactToThought(text) {
    const lower = text.toLowerCase();
    for (const dim of DIMENSIONS) {
      for (const keyword of KEYWORD_MAP[dim]) {
        if (lower.includes(keyword)) {
          this[dim] = Math.min(1, this[dim] + 0.05);
        }
      }
    }
  }

  get dominant() {
    let max = -1;
    let name = 'melancholy';
    for (const dim of DIMENSIONS) {
      if (this[dim] > max) {
        max = this[dim];
        name = dim;
      }
    }
    return name;
  }

  get thinkIntervalMs() {
    return 3000 + (1 - this.restlessness) * 9000;
  }

  snapshot() {
    return {
      loneliness: this.loneliness,
      curiosity: this.curiosity,
      melancholy: this.melancholy,
      restlessness: this.restlessness,
    };
  }
}
