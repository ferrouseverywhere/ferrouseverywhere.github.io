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
    // 6px outer regions map to the 2x2 source pixels. Both middle strips are tiled.
    const border=scale*2, innerWidth=img.width-4, innerHeight=img.height-4;
    const px=new Int32Array(width), py=new Int32Array(height);
    for (let x=0;x<width;x++)
      px[x] = x<border ? Math.floor(x/scale) :
        x>=width-border ? img.width-2+Math.floor((x-(width-border))/scale) :
        2+(Math.floor((x-border)/scale)%innerWidth);
    for (let y=0;y<height;y++)
      py[y] = y<border ? Math.floor(y/scale) :
        y>=height-border ? img.height-2+Math.floor((y-(height-border))/scale) :
        2+(Math.floor((y-border)/scale)%innerHeight);
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
