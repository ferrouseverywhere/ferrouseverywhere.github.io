import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const mount = document.getElementById('ferrous-stage');
const loading = document.getElementById('ferrous-loading');
const fallback = document.getElementById('ferrous-fallback');
const caption = document.getElementById('ferrous-caption');
const message = document.getElementById('ferrous-instruction');
const soundToggle = document.getElementById('sound-toggle');
const audioNote = document.getElementById('audio-note');

const TICK_RATE = 20;
const durations = {idle: 5.8, walk: 5, swingLeft: 2.5, swingRight: 2.5,
  vertical: 105 / TICK_RATE, hurt: 15 / TICK_RATE};
const clipNames = {idle:'idle_active',walk:'idle_active',swingLeft:'attack',
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
function setAudioEnabled(next) {
  audioEnabled = next;
  soundToggle.setAttribute('aria-pressed',String(next));
  soundToggle.textContent = next ? 'SOUND: ON' : 'SOUND: OFF';
  audioNote.textContent = next ? 'Original animation sounds enabled.' : 'Click the Ferrous or enable sound here.';
  if (!next) {
    for (const audio of activeSounds) audio.pause();
    activeSounds.clear();
  }
}
soundToggle.addEventListener('click', () => setAudioEnabled(!audioEnabled));
function playSound(id,volume=1,pitch=1) {
  if (!audioEnabled) return;
  const player = new Audio(soundBase + id + '.ogg');
  player.volume = Math.min(1,Math.max(0,volume/1.6));
  player.playbackRate = Math.min(3,Math.max(.5,pitch));
  player.preservesPitch = false;
  activeSounds.add(player);
  player.addEventListener('ended', () => activeSounds.delete(player), {once:true});
  player.addEventListener('error', () => activeSounds.delete(player), {once:true});
  player.play().catch(()=>activeSounds.delete(player));
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
let state='idle', elapsed=0, previousTick=0, lastChoice='', animationAction=null;
let walkTick=0, walkStepTimer=0, ambientTimer=7.5;
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
function useState(next) {
  if (!modelReady || !clips[clipNames[next]]) return;
  state=next;elapsed=0;previousTick=0;
  if (animationAction) animationAction.stop();
  resetAnimationPose();
  animationAction=mixer.clipAction(clips[clipNames[next]]);
  animationAction.reset();
  animationAction.setLoop(next==='idle'||next==='walk'?THREE.LoopRepeat:THREE.LoopOnce,Infinity);
  animationAction.clampWhenFinished=true;
  animationAction.play();
  const descriptions={idle:'IDLE',walk:'WALK',swingLeft:'ATTACK · LEFT',swingRight:'ATTACK · RIGHT',vertical:'VERTICAL ATTACK',hurt:'HURT'};
  caption.textContent='FERROUS WROUGHTNAUT · '+descriptions[next];
  message.textContent=next==='vertical'?'CLICK DURING HIS VULNERABLE WINDOW':'CLICK THE FERROUS TO STRIKE';
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
  // Same Z*Y*X Euler convention as GlbRuntime.Gait.cs, expressed in GLB coordinates.
  const qZ=new THREE.Quaternion().setFromAxisAngle(axis.Z,-source[2]);
  const qY=new THREE.Quaternion().setFromAxisAngle(axis.Y,+source[1]);
  const qX=new THREE.Quaternion().setFromAxisAngle(axis.X,-source[0]);
  return qZ.multiply(qY).multiply(qX);
}
function applyWalk(tick) {
  const speed=Math.PI*.05, degree=.8, blend=10;
  const swingFrame=(4*Math.PI*tick-30*Math.sin(.1*Math.PI*(tick-9))-27*Math.PI)/(4*Math.PI)+5;
  const weight=Math.pow(Math.sin(blend*Math.PI*.05),2);
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
  const waist=bones.waist;
  if(waist){
    const bob=(Math.sin(2*speed*swingFrame)*2*weight-2*weight)/16;
    waist.position.y-=bob;
    waist.position.z-=3*weight*Math.pow(Math.sin(speed*(tick-13)),2)/16;
  }
  for(const [name,delta] of Object.entries(d)){
    const b=bones[name], ref=gaitData[name];if(!b||!ref)continue;
    const e=ref.active.map((v,i)=>v+delta[i]);
    const orig=sourceEulerQuaternion(ref.active);
    const wanted=sourceEulerQuaternion(e);
    b.quaternion.premultiply(wanted.multiply(orig.invert()));
  }
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
    resetAnimationPose();
    mixer.update(dt);
    const nowTick=Math.floor(elapsed*TICK_RATE);
    emitTimelineSounds(nowTick);
    if(state==='walk'){
      walkTick+=dt*TICK_RATE;
      applyWalk(walkTick);
      walkStepTimer+=dt;
      if(walkStepTimer>=1){walkStepTimer-=1;playSound('step'+(1+Math.floor(Math.random()*3)),.5,.5);}
    }
    applyExtras(nowTick);
    updateFlash(dt);
    if(state==='vertical'){
      const vulnerable=nowTick>26&&nowTick<85;
      message.textContent=vulnerable?'VULNERABLE · CLICK TO HIT':'CLICK DURING HIS VULNERABLE WINDOW';
    }
    ambientTimer-=dt;
    if(ambientTimer<=0 && (state==='idle'||state==='walk')){
      const ids=['grunt1','grunt2','shout1','shout2'];
      playSound(ids[Math.floor(Math.random()*ids.length)],.7,1);
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
    playSound('anvil_land',1,.5);
  }
});

Promise.all([
  new GLTFLoader().loadAsync('assets/models/ferrous_web.glb?v=2'),
  fetch('assets/data/ferrous_walk_euler.json?v=2').then(r=>{if(!r.ok)throw Error('Walk JSON missing');return r.json();})
]).then(([gltf,walk])=>{
  model=gltf.scene;
  clips=Object.fromEntries(gltf.animations.map(c=>[c.name,c]));
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
  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  // Normalize from measured GLB bounds; keep head and feet in view.
  const norm=Math.min(1,3.0/Math.max(size.y,0.001));
  model.scale.multiplyScalar(norm);
  model.position.set(-center.x*norm,-center.y*norm,-center.z*norm);
  // The centered size is the permanent base pose, including after each mixer tick.
  const rootPose=originalTransforms.find(entry=>entry.node===model);
  if(rootPose){rootPose.position.copy(model.position);rootPose.scale.copy(model.scale);}
  pivot.add(model);
  mixer=new THREE.AnimationMixer(model);
  initialModel();
}).catch(error=>{
  console.error('Ferrous Everywhere web preview:',error);
  loading.hidden=true;
  fallback.hidden=false;
  fallback.textContent='3D PREVIEW UNAVAILABLE · CHECK MODEL FILES';
});
animate();
