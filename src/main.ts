import * as THREE from 'three';
import { clamp, near2d } from './logic';
import './style.css';
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x163a29); scene.fog = new THREE.Fog(0x163a29,45,130);
const camera = new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.1,200);
const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);document.querySelector('#app')!.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xb7dcff,0x292032,2.1));const sunlight=new THREE.DirectionalLight(0xffffff,2);sunlight.position.set(-10,25,15);scene.add(sunlight);
function cube(w:number,h:number,d:number,color:number,x:number,y:number,z:number){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color}));m.position.set(x,y,z);scene.add(m);return m;}
function orb(r:number,color:number,x:number,y:number,z:number){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.18}));m.position.set(x,y,z);scene.add(m);return m;}
const player=orb(.85,0xb16eff,0,1,0);
const held={up:false,down:false,left:false,right:false,action:false};type Control=keyof typeof held;
for(const id of Object.keys(held) as Control[]){const el=document.getElementById(id)!;const set=(value:boolean)=>(e:Event)=>{e.preventDefault();held[id]=value;el.classList.toggle('active',value)};el.addEventListener('pointerdown',set(true));for(const name of ['pointerup','pointercancel','pointerleave'])el.addEventListener(name,set(false));}
const keymap:Record<string,Control>={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',' ':'action',Enter:'action'};
window.addEventListener('keydown',e=>{const k=keymap[e.key];if(k){e.preventDefault();held[k]=true}});window.addEventListener('keyup',e=>{const k=keymap[e.key];if(k){e.preventDefault();held[k]=false}});window.addEventListener('blur',()=>{for(const k of Object.keys(held) as Control[])held[k]=false});
const hud=document.querySelector<HTMLElement>('#hud')!;const message=document.querySelector<HTMLElement>('#message')!;let ended=false;
function finish(won:boolean,score:number){ended=true;message.hidden=false;message.innerHTML=`<h2>${won?'🏆 YOU WIN':'💥 GAME OVER'}</h2><p>Score: ${score}</p><button id="restart">RESTART</button>`;document.getElementById('restart')!.onclick=()=>location.reload()}
let last=performance.now();function loop(now:number){requestAnimationFrame(loop);const dt=Math.min((now-last)/1000,.05);last=now;if(!ended)update(dt);renderer.render(scene,camera)}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
cube(105,.25,105,0x286b3e,0,-.25,0);const crystals:THREE.Mesh[]=[];for(let i=0;i<12;i++){const a=i*Math.PI*2/12,r=8+(i%4)*6;crystals.push(orb(.65,0x49eeff,Math.cos(a)*r,1,Math.sin(a)*r))}
for(let i=0;i<24;i++){const a=i*2.399,r=12+(i*7%33),x=Math.cos(a)*r,z=Math.sin(a)*r;cube(1.5,4,1.5,0x805133,x,2,z);orb(2.2,0x2a9a42,x,4.6,z)}const portal=orb(2.1,0xd45aff,0,2,-34);let score=0,notice=0;
function update(dt:number){const dx=Number(held.right)-Number(held.left),dz=Number(held.down)-Number(held.up),len=Math.hypot(dx,dz)||1;player.position.x=clamp(player.position.x+dx/len*9*dt,-49,49);player.position.z=clamp(player.position.z+dz/len*9*dt,-49,49);
for(let i=crystals.length-1;i>=0;i--){const c=crystals[i];c.rotation.y+=dt*2;if(c.position.distanceTo(player.position)<1.7){scene.remove(c);crystals.splice(i,1);score++}}
portal.rotation.y+=dt;if(near2d(player.position.x,player.position.z,portal.position.x,portal.position.z,3)){if(score>=12)finish(true,score);else notice=2}notice=Math.max(0,notice-dt);hud.textContent=`KINGDOMS OF INFINITY · Crystals ${score}/12${notice>0?' · Collect all crystals to enter!':''}`;camera.position.lerp(new THREE.Vector3(player.position.x,15,player.position.z+17),.1);camera.lookAt(player.position)}
requestAnimationFrame(loop);
