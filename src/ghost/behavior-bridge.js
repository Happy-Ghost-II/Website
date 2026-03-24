function lerp(min, max, t) {
  return min + (max - min) * t;
}

export class BehaviorBridge {
  constructor() {
    this.params = {
      maxSpeed: 0.08,
      accelSmoothing: 3.0,
      arrivalDistance: 0.01,
      destinationMargin: 0.05,
      destinationRangeMin: 0.05,
      destinationRangeMax: 0.3,
      pauseMin: 2.0,
      pauseMax: 6.0,
      turnSmoothing: 4.0,
      turnThreshold: 0.1,
      idleLookInterval: 4.0,
      idleLookRange: 0.6,
      bobFreq1: 0.25,
      bobFreq2: 0.39,
      bobAmp1: 0.015,
      bobAmp2: 0.006,
      bobRatio: 0.4,
      swayFreq: 0.2,
      swayAmp: 0.03,
      depthFreq: 0.12,
      depthAmp: 0.008,
    };
  }

  updateFromAffect(affect) {
    const { valence, arousal } = affect.snapshot();
    const arousalT = (arousal + 1) / 2; // 0..1
    const valenceT = (valence + 1) / 2; // 0..1

    // Arousal → intensity / pacing
    this.params.maxSpeed = lerp(0.03, 0.12, arousalT);
    this.params.destinationRangeMin = lerp(0.02, 0.08, arousalT);
    this.params.destinationRangeMax = lerp(0.10, 0.40, arousalT);
    this.params.pauseMin = lerp(4.0, 1.0, arousalT);
    this.params.pauseMax = lerp(8.0, 3.0, arousalT);
    this.params.turnSmoothing = lerp(2.0, 6.0, arousalT);
    this.params.bobFreq1 = lerp(0.15, 0.4, arousalT);
    this.params.bobFreq2 = lerp(0.25, 0.6, arousalT);
    this.params.swayAmp = lerp(0.015, 0.06, arousalT);
    this.params.idleLookInterval = lerp(6.0, 2.0, arousalT);

    // Valence → quality / character
    this.params.bobAmp1 = lerp(0.008, 0.025, valenceT);
    this.params.bobAmp2 = lerp(0.003, 0.010, valenceT);
    this.params.accelSmoothing = lerp(1.5, 5.0, valenceT); // pleasant = snappier, unpleasant = sluggish
    this.params.idleLookRange = lerp(0.3, 0.9, valenceT); // pleasant = looks around more
  }
}
