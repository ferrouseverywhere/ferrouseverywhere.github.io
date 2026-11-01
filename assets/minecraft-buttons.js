/* Source: vanilla 1.21.1 200x20 widget. Reconstruct 9-slice pixel-for-pixel.
   No drawImage interpolation, no floating point crop and no stretched texels. */
(() => {
  const cards = Array.from(document.querySelectorAll('.game-link'));
  const source = {};
  const scale = 3;
  function loadSkin(name, url) {
    const image = new Image();
    image.onload = () => {
      const c = document.createElement('canvas');
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      const ctx = c.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(image,0,0);
      source[name] = {width:c.width,height:c.height,pixels:ctx.getImageData(0,0,c.width,c.height).data};
      repaintAll();
    };
    image.src = url;
  }
  function render(card) {
    const canvas = card.querySelector('.mc-button-skin');
    if (!canvas) return;
    const img = source[card.matches(':hover, :focus-within')?'hover':'normal'];
    if (!img) return;
    const width = card.clientWidth, height = card.clientHeight;
    if (width<12 || height<12) return;
    if(canvas.width!==width) canvas.width=width;
    if(canvas.height!==height) canvas.height=height;
    const ctx=canvas.getContext('2d');
    const frame=ctx.createImageData(width,height), dst=frame.data;
    // Vanilla 200x20 widget has a 3-row TOP rim and 4-row BOTTOM rim.
    // Previous version tiled source rows 2..17, accidentally copying its
    // bottom bevel (row 17) *into the centre* at regular intervals.
    // The centre now repeats ONLY a clean 8x8 patch from the image interior.
    // Every pixel is copied; none is interpolated, resampled or stretched.
    const top=3*scale, bottom=4*scale;
    const left=3*scale, right=3*scale;
    const tileX=96, tileY=6, tileW=8, tileH=8;
    const px=new Int32Array(width), py=new Int32Array(height);
    for(let x=0;x<width;x++) {
      px[x]=x<left ? Math.floor(x/scale) :
        x>=width-right ? img.width-3+Math.floor((x-(width-right))/scale) :
        tileX+(Math.floor((x-left)/scale)%tileW);
    }
    for(let y=0;y<height;y++) {
      py[y]=y<top ? Math.floor(y/scale) :
        y>=height-bottom ? img.height-4+Math.floor((y-(height-bottom))/scale) :
        tileY+(Math.floor((y-top)/scale)%tileH);
    }
    for (let y=0;y<height;y++) {
      const sy=py[y]*img.width*4;
      for (let x=0;x<width;x++) {
        const from=sy+px[x]*4,to=(y*width+x)*4;
        dst[to]=img.pixels[from]; dst[to+1]=img.pixels[from+1];
        dst[to+2]=img.pixels[from+2]; dst[to+3]=img.pixels[from+3];
      }
    }
    ctx.putImageData(frame,0,0);
  }
  function repaintAll(){cards.forEach(render);}
  const ro = new ResizeObserver(entries=>entries.forEach(entry=>render(entry.target)));
  cards.forEach(card=>{
    ro.observe(card);
    for(const event of ['mouseenter','mouseleave','focusin','focusout'])
      card.addEventListener(event,()=>render(card));
  });
  loadSkin('normal','assets/textures/mc_button.png');
  loadSkin('hover','assets/textures/mc_button_hover.png');
})();
