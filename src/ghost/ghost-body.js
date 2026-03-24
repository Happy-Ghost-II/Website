export class GhostBody {
  constructor(ghostObject, bounds, meshBottomOffset, meshTopOffset) {
    this._ghost = ghostObject;

    this._minX = bounds.min.x;
    this._maxX = bounds.max.x;
    this._floorY = bounds.min.y + meshBottomOffset;
    this._baseZ = (bounds.min.z + bounds.max.z) / 2;

    this._posX = (this._minX + this._maxX) / 2;
    this._currentSpeed = 0;

    // The ghost always has a destination — it's either moving toward it or resting near it
    this._destinationX = this._posX;
    this._restTimer = 2 + Math.random() * 3; // time until picking a new destination
    this._isResting = true;

    // Rotation
    this._facingAngle = 0;

    // Idle looking
    this._idleLookTarget = 0;
    this._idleLookTimer = 3 + Math.random() * 3;

    // Oscillator phases
    this._bobPhase1 = 0;
    this._bobPhase2 = Math.random() * Math.PI * 2;
    this._swayPhase = Math.random() * Math.PI * 2;
    this._depthPhase = Math.random() * Math.PI * 2;

    // Attractors (future-ready)
    this._attractors = [];
    this._nextAttractorId = 0;

    this.p = {
      maxSpeed: 0.08,
      accelSmoothing: 2.0,
      decelDistance: 0.06,
      arrivalDistance: 0.008,
      destinationMargin: 0.04,
      destinationRangeMin: 0.05,
      destinationRangeMax: 0.3,
      restMin: 2.0,
      restMax: 6.0,
      turnSmoothing: 5.0,
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

  syncParams(bridgeParams) {
    for (const key in bridgeParams) {
      if (key in this.p) this.p[key] = bridgeParams[key];
    }
  }

  addAttractor({ position, strength, radius }) {
    const id = this._nextAttractorId++;
    this._attractors.push({ id, position, strength, radius });
    return id;
  }

  removeAttractor(id) {
    this._attractors = this._attractors.filter((a) => a.id !== id);
  }

  _pickGoodDestination() {
    const p = this.p;
    const margin = p.destinationMargin;
    const safeMin = this._minX + margin;
    const safeMax = this._maxX - margin;
    const safeRange = safeMax - safeMin;

    // Pick a random point in the safe range, biased away from current position
    // Ensure minimum travel distance
    let dest;
    let attempts = 0;
    do {
      dest = safeMin + Math.random() * safeRange;
      attempts++;
    } while (Math.abs(dest - this._posX) < p.destinationRangeMin && attempts < 10);

    return dest;
  }

  // Pick a direction to look during rest — toward where there's more space
  _pickIdleLookAngle() {
    const spaceLeft = this._posX - this._minX;
    const spaceRight = this._maxX - this._posX;
    const total = spaceLeft + spaceRight;

    // Can look in any direction — full circle
    // Bias toward the side with more space, but can face any way
    const biasRight = spaceRight / total;
    const angle = (Math.random() - 0.5) * 2 * Math.PI; // full -π to π
    // Nudge toward open space
    const nudge = (biasRight - 0.5) * 1.0;
    return angle + nudge;
  }

  update(dt) {
    const p = this.p;
    const dx = this._destinationX - this._posX;
    const distRemaining = Math.abs(dx);

    // ── Destination management ──

    if (this._isResting) {
      this._restTimer -= dt;
      if (this._restTimer <= 0) {
        this._destinationX = this._pickGoodDestination();
        console.log('Ghost moving from', this._posX.toFixed(3), 'to', this._destinationX.toFixed(3), 'dist', Math.abs(this._destinationX - this._posX).toFixed(3));
        this._isResting = false;
      }
    } else if (distRemaining < p.arrivalDistance) {
      // Arrived — start resting, look toward open space
      this._isResting = true;
      this._restTimer = p.restMin + Math.random() * (p.restMax - p.restMin);
      this._idleLookTarget = this._pickIdleLookAngle();
      this._idleLookTimer = p.idleLookInterval * (0.5 + Math.random());
    }

    // ── Speed (always computed, smooth transitions) ──

    let targetSpeed = 0;
    if (!this._isResting && distRemaining > p.arrivalDistance) {
      // Ease out as we approach destination
      const rampDown = Math.min(1, distRemaining / p.decelDistance);
      targetSpeed = p.maxSpeed * rampDown;
    }

    // Smooth acceleration/deceleration — never abrupt
    this._currentSpeed += (targetSpeed - this._currentSpeed) * p.accelSmoothing * dt;

    // ── Movement ──

    if (this._currentSpeed > 0.0001 && distRemaining > 0) {
      const direction = dx > 0 ? 1 : -1;
      this._posX += direction * this._currentSpeed * dt;
      this._posX = Math.max(this._minX, Math.min(this._maxX, this._posX));
    }

    // ── Rotation ──

    // One target angle — either facing destination or idle look direction
    let targetAngle;
    if (!this._isResting && distRemaining > p.arrivalDistance) {
      // Moving — face the destination fully
      targetAngle = dx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    } else {
      // Resting — face the idle look direction
      this._idleLookTimer -= dt;
      if (this._idleLookTimer <= 0) {
        this._idleLookTimer = p.idleLookInterval * (0.5 + Math.random());
        this._idleLookTarget = this._pickIdleLookAngle();
      }
      targetAngle = this._idleLookTarget;
    }

    // Smoothly rotate toward target
    let angleDiff = targetAngle - this._facingAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this._facingAngle += angleDiff * p.turnSmoothing * dt;

    // ── Oscillators ──

    this._bobPhase1 += dt * p.bobFreq1 * Math.PI * 2;
    this._bobPhase2 += dt * p.bobFreq2 * Math.PI * 2;
    this._swayPhase += dt * p.swayFreq * Math.PI * 2;
    this._depthPhase += dt * p.depthFreq * Math.PI * 2;

    const bob = (Math.sin(this._bobPhase1) + 1) * 0.5 * p.bobAmp1
      + (Math.sin(this._bobPhase2) + 1) * 0.5 * p.bobAmp2 * p.bobRatio;
    const sway = Math.sin(this._swayPhase) * p.swayAmp;
    const depthDrift = Math.sin(this._depthPhase) * p.depthAmp;

    // ── Apply ──

    this._ghost.position.x = this._posX;
    this._ghost.position.y = this._floorY + bob;
    this._ghost.position.z = this._baseZ + depthDrift;
    this._ghost.rotation.y = this._facingAngle;
    this._ghost.rotation.z = sway;
  }
}
