import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const mount = document.getElementById('ferrous-stage');
const loading = document.getElementById('ferrous-loading');
const fallback = document.getElementById('ferrous-fallback');
const caption = document.getElementById('ferrous-caption');
const soundToggle = document.getElementById('sound-toggle');

const TICK_RATE = 20;
const durations = {idle: 5.8, walk: 5, swingLeft: 2.5, swingRight: 2.5,
  vertical: 105 / TICK_RATE, hurt: 15 / TICK_RATE};
const clipNames = {idle:'idle_active',walk:'ferrous_walk_web',swingLeft:'attack',
  swingRight:'attack_variant_2',vertical:'vertical_attack',hurt:'hurt'};
const choices = ['idle','walk','swingLeft','swingRight','vertical'];
const soundEvents = {
  swingLeft: [[1,'pre_swing1',1.5,1],[6,'creak',.5,1],[25,'whoosh',1.2,1],[27,'swing1',1.5,1]],
  swingRight: [[1,'pre_swing1',1.5,1],[6,'creak',.5,1],[25,'whoosh',1.2,1],[27,'swing1',1.5,1]],
  vertical: [[1,'pre_swing2',1.5,1],[6,'creak',.5,1],[25,'whoosh',1.2,1],
    [27,'swing2',1.5,1],[28,'anvil_land',1,.5],[44,'pull1',1,1],[75,'pull5',1,1],[83,'release2',1,1]],
  hurt: [[1,'hurt1',1,1]],
};
const soundBase = 'assets/sounds/';
let audioEnabled = false;
let activeSounds = new Set();
let audioContext = null;
let masterGain = null;
function prepareAudio() {
  if (!audioContext) {
    const Constructor=window.AudioContext || window.webkitAudioContext;
    if (Constructor) {
      audioContext = new Constructor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.7; // Avoid clipping multiple simultaneous voices.
      masterGain.connect(audioContext.destination);
    }
  }
  if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
}
function setAudioEnabled(next) {
  audioEnabled = next;
  soundToggle.setAttribute('aria-pressed',String(next));
  soundToggle.textContent = next ? 'SOUND: ON' : 'SOUND: OFF';
  if (next) prepareAudio();
  if (!next) {
    for (const audio of activeSounds) audio.pause();
    activeSounds.clear();
  }
}
soundToggle.addEventListener('click', () => setAudioEnabled(!audioEnabled));
function playSound(id, volume=1, pitch=1) {
  if (!audioEnabled) return;
  // One independent voice per event, as in FerrousAgent.Audio.cs; pitch is playback rate.
  // The browser's 2D audio uses a fixed master gain (vs Unity's spatial attenuation).
  const player = new Audio(soundBase + id + '.ogg');
  player.preload = 'auto';
  player.playbackRate = Math.min(3, Math.max(0.1, pitch));
  player.preservesPitch = false;
  let disconnectVoice = () => {};
  if (audioContext && masterGain) {
    const voice = audioContext.createMediaElementSource(player);
    const gain = audioContext.createGain();
    gain.gain.value = Math.min(2,Math.max(0,volume));
    voice.connect(gain);gain.connect(masterGain);
    disconnectVoice = () => {voice.disconnect();gain.disconnect();};
  } else {
    player.volume=Math.min(1,Math.max(0,volume));
  }
  if (activeSounds.size>=6) {
    const oldest=activeSounds.values().next().value;
    oldest.pause(); activeSounds.delete(oldest);
  }
  activeSounds.add(player);
  const clear=()=>{activeSounds.delete(player);disconnectVoice();};
  player.addEventListener('ended',clear,{once:true});
  player.addEventListener('pause',clear,{once:true});
  player.addEventListener('error',clear,{once:true});
  player.play().catch(clear);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, 1, .1, 100);
camera.position.set(3.2, 1.25, 7.6);
camera.lookAt(0,0,0);
const renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0,0);
mount.prepend(renderer.domElement);
const pivot = new THREE.Group();
scene.add(pivot);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const axis = {X:new THREE.Vector3(1,0,0),Y:new THREE.Vector3(0,1,0),Z:new THREE.Vector3(0,0,1)};
const tempQ = new THREE.Quaternion();
let model, mixer, clips, motion, bones={}, gaitData={}, originalTransforms=[];
let activeClipNames=[];
let state='idle', elapsed=0, previousTick=0, lastChoice='', animationAction=null;
let walkStepTimer=0, ambientTimer=7.5;
let hitFlash=0, modelReady=false;
const originalMaterials=new Set();
let modelsToHit=[];

function resize() {
  const width=Math.max(1,mount.clientWidth), height=Math.max(1,mount.clientHeight);
  renderer.setSize(width,height,false);
  camera.aspect=width/height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(mount);
resize();

function resetAnimationPose() {
  for (const {node,position,rotation,scale} of originalTransforms) {
    node.position.copy(position);node.quaternion.copy(rotation);node.scale.copy(scale);
  }
}
/* Each original GLB clip is intentionally sparse. The GLB rest pose is DORMANT.
   Extend every web clip with constant ACTIVE pose tracks for channels it does not
   animate. Unlike resetting the rig every frame, one complete clip owns each
   property at every sample; stopping an old action cannot leave T-pose gaps. */
function fillClipPose(gltfAnimations) {
  const rigNames=new Set();
  for(const clip of gltfAnimations)for(const track of clip.tracks){
    const match=track.name.match(/^(.+)\.(position|quaternion|scale)$/);
    if(match)rigNames.add(match[1]);
  }
  for(const name of Object.keys(gaitData))rigNames.add(name);
  const newClips={};
  for(const clip of gltfAnimations){
    const all=clip.tracks.slice();
    const present=new Set(all.map(t=>t.name));
    for(const name of rigNames){
      const node=bones[name];
      if(!node)continue;
      for(const [prop,Ctor] of [['position',THREE.VectorKeyframeTrack],
                                ['quaternion',THREE.QuaternionKeyframeTrack],
                                ['scale',THREE.VectorKeyframeTrack]]){
        const path=name+'.'+prop;
        if(present.has(path))continue;
        // Constant base pose: these tracks contain one sample and are held
        // for the complete action, with no interpolation from a previous clip.
        all.push(new Ctor(path,[0],node[prop].toArray()));
      }
    }
    newClips[clip.name]=new THREE.AnimationClip(clip.name,clip.duration,all);
  }
  return newClips;
}
function useState(next) {
  if (!modelReady || !clips[clipNames[next]]) return;
  state=next;elapsed=0;previousTick=0;
  // All transforms are owned by the *next* completed action. No per-frame
  // rest reset, overlapping actions, fade or dormant/active blending.
  if (animationAction)animationAction.stop();
  const clip=clips[clipNames[next]];
  animationAction=mixer.clipAction(clip);
  animationAction.reset();
  animationAction.enabled=true;
  animationAction.setEffectiveWeight(1);
  animationAction.setLoop(next==='walk'?THREE.LoopRepeat:THREE.LoopOnce, next==='walk'?Infinity:1);
  animationAction.clampWhenFinished=true;
  animationAction.play();
  // Important: synchronously evaluate frame zero before the next draw.
  // Otherwise stopping the last action briefly restores its cached bind pose.
  mixer.update(0);
  const descriptions={idle:'IDLE',walk:'WALK',swingLeft:'ATTACK · LEFT',swingRight:'ATTACK · RIGHT',vertical:'VERTICAL ATTACK',hurt:'HURT'};
  caption.textContent='FERROUS WROUGHTNAUT · '+descriptions[next];
  if(next==='walk')walkStepTimer=0;
}
function chooseNext() {
  let choice;
  do {choice=choices[Math.floor(Math.random()*choices.length)];}
  while(choice===lastChoice && choices.length>1);
  lastChoice=choice;
  useState(choice);
}

function initialModel() {
  modelReady=true;
  useState('idle');
  loading.hidden=true;
  fallback.hidden=true;
}

function sourceEulerQuaternion(source) {
  // Reference: GlbRuntime.Gait.cs, SourceEulerToUnity, converted to glTF axes.
  const qZ=new THREE.Quaternion().setFromAxisAngle(axis.Z,-source[2]);
  const qY=new THREE.Quaternion().setFromAxisAngle(axis.Y,+source[1]);
  const qX=new THREE.Quaternion().setFromAxisAngle(axis.X,-source[0]);
  return qZ.multiply(qY).multiply(qX);
}

/* Bake the exact TABS procedural walk into its OWN full-pose AnimationClip.
   GLB idle_active is only 0.05 seconds (a static pose), not a walking clip.
   Previously the website overlaid Euler offsets after mixer.update(), letting
   the mixer and gait compete for the same joints and producing broken frames.
   This sampled 40-tick (2 second) cycle stays within the mixer and loops
   seamlessly; no per-frame quaternion mutation or competing animation layers.
   Reference: TABS RC2 GlbRuntime.Animation.cs::OverlayWalk. */
function sourceWalkPose(tick) {
  const speed=Math.PI*.05, degree=.8, weight=1;
  const swingFrame=(4*Math.PI*tick-30*Math.sin(.1*Math.PI*(tick-9))-27*Math.PI)/(4*Math.PI)+5;
  const d={};
  function add(name,index,val){if(!d[name])d[name]=[0,0,0];d[name][index]+=val;}
  function cyc(sp,off){return Math.cos(sp*swingFrame+off);}
  function walk(name,sp,deg,invert,offset,wt){add(name,0,(invert?-1:1)*(cyc(sp,offset)*deg+wt)*weight);}
  function swing(name,sp,deg,invert,offset,wt){add(name,1,(invert?-1:1)*(cyc(sp,offset)*deg+wt)*weight);}
  function flap(name,sp,deg,invert,offset,wt){add(name,2,(invert?-1:1)*(cyc(sp,offset)*deg+wt)*weight);}
  swing('waist',speed,.3*degree,false,0,0);
  swing('stomachJoint',speed,.6*degree,true,0,0);
  swing('head',speed,.3*degree,false,0,0);
  swing('thighLeftJoint',speed,.4*degree,true,0,.5);
  walk('thighLeftJoint',speed,.4*degree,false,0,.3*degree);
  walk('calfLeftJoint',speed,.5*degree,false,-2.2,.1*degree);
  walk('footLeftJoint',speed,.4*degree,false,-2.1,.26*degree);
  swing('thighRightJoint',speed,.4*degree,true,0,-.5);
  walk('thighRightJoint',speed,.4*degree,true,0,-.3*degree);
  walk('calfRightJoint',speed,.5*degree,true,-2.2,-.1*degree);
  walk('footRightJoint',speed,.4*degree,true,-2.1,-.26*degree);
  walk('groinFront',2*speed,.2*degree,true,-.5,.1);
  walk('groinBack',2*speed,.2*degree,false,-.5,.1);
  walk('neck',2*speed,.1*degree,true,-.5,.1);
  flap('shoulderLeft',2*speed,.05*degree,false,-.5,0);
  flap('shoulderRight',2*speed,.05*degree,true,-.5,0);
  swing('shoulderLeft',speed,.1*degree,true,0,-.3);
  swing('shoulderRight',speed,.1*degree,true,0,-.3);
  flap('upperArmLeftJoint',2*speed,.05*degree,true,-1,0);
  flap('upperArmRightJoint',2*speed,.05*degree,true,-1,0);
  flap('handLeft',2*speed,.2,false,-.5,.5);
  walk('lowerArmLeftJoint',2*speed,.1,true,-.5,0);
  walk('handLeft',2*speed,.2,false,-.5,.6);
  add('lowerArmLeftJoint',1,-.65*weight);
  // The waist bob is in model units (16 model pixels per block).
  const bob=(Math.sin(2*speed*swingFrame)*2*weight-2*weight)/16;
  const z=-3*weight*Math.pow(Math.sin(speed*(tick-13)),2)/16;
  return {delta:d, waistY:-bob, waistZ:z};
}
function buildWalkClip(idlePose) {
  const cycleTicks=40;
  const seconds=cycleTicks/TICK_RATE;
  const ticks=Array.from({length:cycleTicks+1},(_,k)=>k);
  const times=ticks.map(k=>k/TICK_RATE);
  const poses=ticks.map(sourceWalkPose);
  // Precompute active Euler inverse per bone once, not per animation frame.
  const activeInv={};
  for(const [name,ref] of Object.entries(gaitData)) {
    activeInv[name]=sourceEulerQuaternion(ref.active).invert();
  }
  const newTracks=[];
  for(const track of idlePose.tracks) {
    const found=track.name.match(/^(.+)\.(position|quaternion|scale)$/);
    if(!found) {newTracks.push(track.clone());continue;}
    const [_,name,property]=found;
    const isGaitRotation=property==='quaternion' && gaitData[name];
    const isWaistTranslation=name==='waist' && property==='position';
    const staticSample=Array.from(track.createInterpolant().evaluate(idlePose.duration));
    if(!isGaitRotation && !isWaistTranslation) {
      // All other channels remain owned by the walk clip: never T-pose gaps.
      newTracks.push(new track.constructor(track.name,[0,seconds],[...staticSample,...staticSample]));
      continue;
    }
    const values=[];
    for(const pose of poses) {
      if(isGaitRotation) {
        const delta=pose.delta[name]||[0,0,0];
        const reference=gaitData[name];
        const euler=reference.active.map((v,i)=>v+delta[i]);
        const q=sourceEulerQuaternion(euler)
          .multiply(activeInv[name]).multiply(new THREE.Quaternion().fromArray(staticSample)).normalize();
        values.push(q.x,q.y,q.z,q.w);
      } else {
        values.push(staticSample[0],staticSample[1]+pose.waistY,staticSample[2]+pose.waistZ);
      }
    }
    newTracks.push(new track.constructor(track.name,times,values));
  }
  const clip=new THREE.AnimationClip('ferrous_walk_web',seconds,newTracks);
  clip.validate();
  return clip;
}
function applyExtras(frame) {
  // Java procedural controller: neck motion during the vulnerable vertical attack.
  if(state==='vertical'){
    const waistCtrl=bones.waistBendController;
    const neck=bones.neck;
    if(waistCtrl&&neck){
      const amp=waistCtrl.position.x*16;
      neck.quaternion.multiply(tempQ.setFromAxisAngle(axis.X,Math.sin(frame*2)*amp*.1));
    }
  }
}
function updateFlash(dt) {
  if (hitFlash<=0)return;
  hitFlash=Math.max(0,hitFlash-dt);
  if(hitFlash===0)for(const material of originalMaterials)material.color.setRGB(1,1,1);
}
function flashRed(){
  hitFlash=.45;
  for(const material of originalMaterials) material.color.setRGB(1,.38,.38);
}
function emitTimelineSounds(nowTick) {
  const events=soundEvents[state]||[];
  for(const [tick,id,volume,pitch] of events)
    if(tick>previousTick && tick<=nowTick)playSound(id,volume,pitch);
  previousTick=nowTick;
}
function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.08);
  if(modelReady){
    elapsed+=dt;
    mixer.update(dt);
    const nowTick=Math.floor(elapsed*TICK_RATE);
    emitTimelineSounds(nowTick);
    if(state==='walk'){
      // Full-body gait is already in the walk action. Only footsteps run here.
      walkStepTimer+=dt;
      if(walkStepTimer>=1){walkStepTimer-=1;playSound('step'+(1+Math.floor(Math.random()*3)),.5,.5);}
    }
    applyExtras(nowTick);
    updateFlash(dt);
    ambientTimer-=dt;
    if(ambientTimer<=0 && (state==='idle'||state==='walk')){
      const ids=['grunt1','grunt2','shout1','shout2'];
      playSound(ids[Math.floor(Math.random()*ids.length)],1,1);
      ambientTimer=8+Math.random()*7;
    }
    if(elapsed>=durations[state])chooseNext();
    // The body turns like a 3D museum display; it doesn't change his animation data.
    pivot.rotation.y+=dt*.26;
  }
  renderer.render(scene,camera);
}

mount.addEventListener('pointerdown',event=>{
  if(!modelReady)return;
  if(!audioEnabled)setAudioEnabled(true);
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(modelsToHit,true);
  if(!hits.length)return;
  const vulnerable=state==='vertical'&&elapsed*TICK_RATE>26&&elapsed*TICK_RATE<85;
  if(vulnerable){
    flashRed();
    useState('hurt');
    playSound('hurt1',1,1);
    previousTick=1; // This click already played the tick-1 hurt sound.
  }else{
    playSound('anvil_land',.4,2); // TABS RC2 BlockedHit: armour clang, pitch 2x.
  }
});


function upgradeSwordToRC2(sword) {
  const texture=sword.material?.map;
  const image=texture?.image;
  const source=sword.geometry?.attributes?.position;
  if(!image||!source||source.count<4) return;
  const W=image.width, H=image.height;
  if(!W||!H||W>64||H>64) return;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,W,H).data;
  const isSolid=(x,y)=>x>=0&&x<W&&y>=0&&y<H&&pixels[(y*W+x)*4+3]>=128;
  const b=new THREE.Box3().setFromBufferAttribute(source);
  const lo=b.min, hi=b.max;
  const dx=(hi.x-lo.x)/W,dy=(hi.y-lo.y)/H;
  const depth=(hi.x-lo.x)/16;
  if(dx<=0||dy<=0||depth<=0) return;
  const cx=(lo.x+hi.x)/2, cy=(lo.y+hi.y)/2;
  const verts=[],uvs=[];
  function vertex(x,y,z,u,v) {
    // RC2 RotateSwordSpriteClockwiseQuarterTurn in original local XY plane.
    verts.push(cx+(y-cy),cy-(x-cx),z);
    uvs.push(u,v);
  }
  function quad(a,b,c,d) {
    for(const v of [a,b,c,a,c,d]) vertex(...v);
  }
  const front=depth*.5,back=-front;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    if(!isSolid(x,y))continue;
    const x0=lo.x+x*dx,x1=x0+dx;
    const y0=lo.y+(H-1-y)*dy,y1=y0+dy;
    const u0=x/W,u1=(x+1)/W,v0=y/H,v1=(y+1)/H;
    const uc=(x+.5)/W,vc=(y+.5)/H;
    const A=[x0,y0,front,u0,v1],B=[x1,y0,front,u1,v1],
      C=[x1,y1,front,u1,v0],D=[x0,y1,front,u0,v0];
    quad(A,B,C,D);
    quad([x1,y0,back,u1,v1],[x0,y0,back,u0,v1],
      [x0,y1,back,u0,v0],[x1,y1,back,u1,v0]);
    if(!isSolid(x-1,y))quad([x0,y0,back,uc,vc],[x0,y0,front,uc,vc],
      [x0,y1,front,uc,vc],[x0,y1,back,uc,vc]);
    if(!isSolid(x+1,y))quad([x1,y0,front,uc,vc],[x1,y0,back,uc,vc],
      [x1,y1,back,uc,vc],[x1,y1,front,uc,vc]);
    if(!isSolid(x,y+1))quad([x0,y0,front,uc,vc],[x1,y0,front,uc,vc],
      [x1,y0,back,uc,vc],[x0,y0,back,uc,vc]);
    if(!isSolid(x,y-1))quad([x0,y1,back,uc,vc],[x1,y1,back,uc,vc],
      [x1,y1,front,uc,vc],[x0,y1,front,uc,vc]);
  }
  if(!verts.length)return;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
  sword.geometry.dispose();sword.geometry=geo;
}

Promise.all([
  new GLTFLoader().loadAsync('assets/models/ferrous_web.glb?v=5'),
  fetch('assets/data/ferrous_walk_euler.json?v=3').then(r=>{if(!r.ok)throw Error('Walk JSON missing');return r.json();}),
  fetch('assets/data/ferrous_neutral_pose.json?v=3').then(r=>{if(!r.ok)throw Error('Active pose missing');return r.json();})
]).then(([gltf,walk,neutral])=>{
  model=gltf.scene;
  gaitData=walk.nodes;
  model.traverse(obj=>{
    if(obj.name)bones[obj.name]=obj;
    originalTransforms.push({node:obj,position:obj.position.clone(),rotation:obj.quaternion.clone(),scale:obj.scale.clone()});
    if(obj.isMesh){
      modelsToHit.push(obj);
      const prev=Array.isArray(obj.material)?obj.material[0]:obj.material;
      const eye=/^eye(Left|Right)$/.test(obj.parent?.name||obj.name);
      const image=prev?.map||null;
      if(image){image.magFilter=THREE.NearestFilter;image.minFilter=THREE.NearestFilter;
        image.generateMipmaps=false;image.colorSpace=THREE.SRGBColorSpace;image.needsUpdate=true;}
      const mat=new THREE.MeshBasicMaterial({map:eye?null:image,color:eye?0xee3838:0xffffff,
        transparent:false,alphaTest:eye?0:.5,side:THREE.DoubleSide,toneMapped:false});
      obj.material=mat;
      if(!eye)originalMaterials.add(mat);
    }
  });
  // GLB rest pose is DORMANT. Most idle_active channels are sparse, so an
  // active baseline must be applied before each isolated clip, otherwise dormant
  // limbs bleed into idle, walk and attacks. Source: original FWDK neutral pose.
  for (const [name,pose] of Object.entries(neutral.nodes)) {
    const b=bones[name];
    if(!b) continue;
    const base=originalTransforms.find(entry=>entry.node===b);
    if(!base) continue;
    if(pose.translation) base.position.fromArray(pose.translation);
    if(pose.rotation) base.rotation.fromArray(pose.rotation).normalize();
    if(pose.scale) base.scale.fromArray(pose.scale);
  }
  // Match RC2 TABS: extrude the actual 16x16 vanilla sword pixels and rotate
  // their mesh clockwise 90 degrees around the original pixel-quad center.
  const sword=bones.sword;
  if(sword?.isMesh) upgradeSwordToRC2(sword);
  resetAnimationPose();
  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  // The geometry AABB is pulled sideways by the sword. Spin around the
  // anatomical rootBox axis instead of that moving visual bounding center.
  // Keep the vertical centering from the AABB so the full body stays visible.
  const bodyAxis=new THREE.Vector3();
  if(bones.rootBox) bones.rootBox.getWorldPosition(bodyAxis);
  // Normalize from measured GLB bounds; keep head and feet in view.
  const norm=Math.min(1,3.0/Math.max(size.y,0.001));
  model.scale.multiplyScalar(norm);
  model.position.set(-bodyAxis.x*norm,-center.y*norm,-bodyAxis.z*norm);
  // The centered size is the permanent base pose, including after each mixer tick.
  const rootPose=originalTransforms.find(entry=>entry.node===model);
  if(rootPose){rootPose.position.copy(model.position);rootPose.scale.copy(model.scale);}
  pivot.add(model);
  // Compile the full pose clips AFTER the 18 Java constructor rest corrections
  // and root normalisation, but BEFORE any action starts playing.
  clips=fillClipPose(gltf.animations);
  clips.ferrous_walk_web=buildWalkClip(clips.idle_active);
  mixer=new THREE.AnimationMixer(model);
  initialModel();
}).catch(error=>{
  console.error('Ferrous Everywhere web preview:',error);
  loading.hidden=true;
  fallback.hidden=false;
  fallback.textContent='3D PREVIEW UNAVAILABLE · CHECK MODEL FILES';
});
animate();
