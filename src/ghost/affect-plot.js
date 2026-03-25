const GREEN = '#33ff33';
const DIM_GREEN = '#1a3a1a';
const BG = '#0a0a0a';

export class AffectPlot {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.w = this.canvas.width;
    this.h = this.canvas.height;
  }

  draw(affect) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;

    // Clear
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = DIM_GREEN;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * w;
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Crosshair at origin
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Trail
    const trail = affect.trail;
    if (trail.length > 1) {
      const now = performance.now();
      const trailDuration = 30000; // 30 seconds of trail visible

      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1];
        const curr = trail[i];
        const age = now - curr.t;
        const alpha = Math.max(0, 1 - age / trailDuration);

        if (alpha <= 0) continue;

        const x0 = cx + prev.v * cx;
        const y0 = cy - prev.a * cy; // Y is inverted (up = positive arousal)
        const x1 = cx + curr.v * cx;
        const y1 = cy - curr.a * cy;

        ctx.strokeStyle = GREEN;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Current point
    const { valence, arousal } = affect.snapshot();
    const px = cx + valence * cx;
    const py = cy - arousal * cy;

    // Glow
    ctx.shadowColor = GREEN;
    ctx.shadowBlur = 8;
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Axis labels
    ctx.font = '8px Courier New';
    ctx.fillStyle = GREEN;
    ctx.globalAlpha = 0.4;

    // Valence — vertical axis (rotated label)
    ctx.save();
    ctx.translate(8, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('valence', 0, 0);
    ctx.restore();

    // Arousal — horizontal axis
    ctx.textAlign = 'center';
    ctx.fillText('arousal', cx, h - 3);

    ctx.globalAlpha = 1;
  }
}
