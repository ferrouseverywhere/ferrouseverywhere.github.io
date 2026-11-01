/* Match the helmet vector-font glyph to the actual Press Start 2P letter O.
   Preserve the O's advance, ink bounds and baseline at all responsive sizes. */
(() => {
  const slot=document.querySelector('.helmet-slot');
  if (!slot) return;
  const reference=slot.querySelector('.helmet-reference');
  const glyph=slot.querySelector('.helmet-glyph');
  const baseline=slot.querySelector('.helmet-baseline');
  const glyphBaseline=slot.querySelector('.helmet-glyph-baseline');
  const ctx=document.createElement('canvas').getContext('2d');
  const inkWidth=m=>m.actualBoundingBoxLeft+m.actualBoundingBoxRight;
  const inkHeight=m=>m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
  function align(){
    const style=getComputedStyle(reference);
    const size=parseFloat(style.fontSize);
    if (!Number.isFinite(size)||size<1) return;
    const fontFace=style.fontFamily.split(',')[0];
    ctx.font=`${size}px ${fontFace}`;
    const om=ctx.measureText('O');
    const oWidth=inkWidth(om), oHeight=inkHeight(om);
    if(oWidth<=0||oHeight<=0) return;
    ctx.font=`100px "Ferrous Helmet"`;
    const first=ctx.measureText('\uE000');
    const hHeight=inkHeight(first);
    if(hHeight<=0)return;
    const hSize=100*oHeight/hHeight;
    glyph.style.fontSize=hSize+'px';
    ctx.font=`${hSize}px "Ferrous Helmet"`;
    const hm=ctx.measureText('\uE000');
    const hWidth=inkWidth(hm), sx=oWidth/Math.max(hWidth,.001);
    glyph.style.transform=`scaleX(${sx})`;
    // CSS position is relative to the parent's border box. Measure the O and
    // the two zero-height baseline sentinels instead of guessing font ascenders.
    const root=slot.getBoundingClientRect();
    const rr=reference.getBoundingClientRect();
    const oInkLeft=rr.left-root.left-om.actualBoundingBoxLeft;
    const targetLeft=oInkLeft+hm.actualBoundingBoxLeft*sx;
    const baselineY=baseline.getBoundingClientRect().top-root.top;
    const glyphBaselineOffset=glyphBaseline.getBoundingClientRect().top-glyph.getBoundingClientRect().top;
    const targetTop=baselineY-glyphBaselineOffset;
    glyph.style.left=targetLeft.toFixed(3)+'px';
    glyph.style.top=targetTop.toFixed(3)+'px';
  }
  let lock=false;
  const safeAlign=()=>{if(lock)return;lock=true;requestAnimationFrame(()=>{lock=false;align()})};
  // The final glyph font and title font must both be loaded before measurement.
  document.fonts.ready.then(safeAlign).catch(safeAlign);
  const ro=new ResizeObserver(safeAlign);
  ro.observe(document.querySelector('.site-title'));
  window.addEventListener('resize',safeAlign,{passive:true});
  safeAlign();
})();
