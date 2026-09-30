// The 2D layer drawn on top of the 3D picture during Draw(). Coordinates
// are in screen pixels of the Graphics3D size, (0, 0) at the top-left.
// The layer is cleared before every Draw, so a program redraws its text
// each frame.
//
// The engine keeps the drawing state (colour, font size) and passes it
// with every call, so an overlay is a plain list of drawing primitives.

export class NullOverlay
{
  constructor()
  {
    this.ops = [];
    this.frames = 0;
  }

  begin(width, height)
  {
    this.ops = [];
  }

  end()
  {
    this.frames++;
  }

  rect(x, y, w, h, solid, style)
  {
    this.ops.push(['rect', x, y, w, h, solid, style.color]);
  }

  oval(x, y, w, h, solid, style)
  {
    this.ops.push(['oval', x, y, w, h, solid, style.color]);
  }

  line(x1, y1, x2, y2, style)
  {
    this.ops.push(['line', x1, y1, x2, y2, style.color]);
  }

  text(x, y, text, centerX, centerY, style)
  {
    this.ops.push(['text', x, y, text, style.color, style.fontSize]);
  }

  // Without a real font, assume an average glyph is 0.6 em wide.
  textWidth(text, style)
  {
    return Math.round(text.length * style.fontSize * 0.6);
  }
}

// Draws on a 2D canvas laid over the WebGL canvas. The canvas has as many
// pixels as the screen shows (device pixel ratio included) so text stays
// sharp; drawing is scaled from Graphics3D coordinates.
export class CanvasOverlay
{
  constructor(canvas)
  {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
  }

  // `scale` = canvas pixels per logical pixel.
  resize(width, height, scale)
  {
    this.scale = scale;
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
  }

  begin(width, height)
  {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  end()
  {
  }

  apply(style)
  {
    const [r, g, b] = style.color;
    const css = `rgb(${r}, ${g}, ${b})`;
    this.ctx.fillStyle = css;
    this.ctx.strokeStyle = css;
    this.ctx.lineWidth = 1;
    this.ctx.font = `${style.fontSize}px system-ui, sans-serif`;
  }

  rect(x, y, w, h, solid, style)
  {
    this.apply(style);
    if (solid) this.ctx.fillRect(x, y, w, h);
    else this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  oval(x, y, w, h, solid, style)
  {
    this.apply(style);
    this.ctx.beginPath();
    this.ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    if (solid) this.ctx.fill();
    else this.ctx.stroke();
  }

  line(x1, y1, x2, y2, style)
  {
    this.apply(style);
    this.ctx.beginPath();
    this.ctx.moveTo(x1 + 0.5, y1 + 0.5);
    this.ctx.lineTo(x2 + 0.5, y2 + 0.5);
    this.ctx.stroke();
  }

  text(x, y, text, centerX, centerY, style)
  {
    this.apply(style);
    this.ctx.textAlign = centerX ? 'center' : 'left';
    this.ctx.textBaseline = centerY ? 'middle' : 'top';
    this.ctx.fillText(text, x, y);
  }

  textWidth(text, style)
  {
    this.apply(style);
    return Math.round(this.ctx.measureText(text).width);
  }
}
