/* Minecraft widget textures are copied pixel-by-pixel, never stretched.
   Borders retain original 2px source geometry at x3 scale; the 16px interior repeats. */
(() => {
  const normal = new Image();
  const hover = new Image();
  normal.src = 'assets/textures/mc_button.png';
  hover.src = 'assets/textures/mc_button_hover.png';
  const cards = Array.from(document.querySelectorAll('.game-link'));
  const scale = 3;
  function drawTiled(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (!dw || !dh) return;
    const tw = sw * scale, th = sh * scale;
    for (let y = 0; y < dh; y += th) {
      const oh = Math.min(th, dh - y), sampleH = oh / scale;
      for (let x = 0; x < dw; x += tw) {
        const ow = Math.min(tw, dw - x), sampleW = ow / scale;
        ctx.drawImage(img, sx, sy, sampleW, sampleH, dx + x, dy + y, ow, oh);
      }
    }
  }
  function nineSlice(canvas, img, width, height) {
    if (!img.complete || !img.naturalWidth || width < 18 || height < 18) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = width; canvas.height = height;
    ctx.imageSmoothingEnabled = false;
    const edge = 2, border = edge * scale;
    const innerW = Math.max(0, width - border * 2), innerH = Math.max(0, height - border * 2);
    const W = img.naturalWidth, H = img.naturalHeight;
    // Center comes from an original 16x16 area, repeated in X and Y.
    drawTiled(ctx, img, 92, 2, 16, 16, border, border, innerW, innerH);
    drawTiled(ctx, img, 92, 0, 16, 2, border, 0, innerW, border);
    drawTiled(ctx, img, 92, H - 2, 16, 2, border, height - border, innerW, border);
    drawTiled(ctx, img, 0, 2, 2, 16, 0, border, border, innerH);
    drawTiled(ctx, img, W - 2, 2, 2, 16, width - border, border, border, innerH);
    ctx.drawImage(img, 0, 0, 2, 2, 0, 0, border, border);
    ctx.drawImage(img, W - 2, 0, 2, 2, width - border, 0, border, border);
    ctx.drawImage(img, 0, H - 2, 2, 2, 0, height - border, border, border);
    ctx.drawImage(img, W - 2, H - 2, 2, 2, width - border, height - border, border, border);
  }
  function paint(card) {
    const canvas = card.querySelector('.mc-button-skin');
    const rect = card.getBoundingClientRect();
    const image = card.matches(':hover') ? hover : normal;
    nineSlice(canvas, image, Math.round(rect.width), Math.round(rect.height));
  }
  function updateAll() { cards.forEach(paint); }
  normal.addEventListener('load', updateAll);
  hover.addEventListener('load', updateAll);
  const observer = new ResizeObserver(entries => entries.forEach(e => paint(e.target)));
  cards.forEach(card => {
    observer.observe(card);
    card.addEventListener('mouseenter', () => paint(card));
    card.addEventListener('mouseleave', () => paint(card));
    card.addEventListener('focusin', () => paint(card));
    card.addEventListener('focusout', () => paint(card));
  });
  updateAll();
})();
