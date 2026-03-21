export class BehaviorBridge {
  constructor() {
    this.params = {
      moveSpeed: 0.15,
      bobSpeed: 1.5,
      bobAmount: 0.02,
      pauseDuration: 2.0,
    };
  }

  updateFromState(emotionalState) {
    const e = emotionalState.snapshot();

    // Restless ghost moves faster, pauses less
    this.params.moveSpeed = 0.1 + e.restlessness * 0.2;
    this.params.pauseDuration = 1 + (1 - e.restlessness) * 4;

    // Melancholy ghost bobs slower
    this.params.bobSpeed = 1.0 + (1 - e.melancholy) * 1.5;

    // Curious ghost bobs more
    this.params.bobAmount = 0.015 + e.curiosity * 0.02;
  }
}
