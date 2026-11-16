'use strict';
// Sanctum.exe — Second Judgment, with a quieter interface and smooth movement.
const SIZE = 8, CELL = 70, SVGNS = 'http://www.w3.org/2000/svg';
const SPEED = [1, .85, .7];
const LASER_TIME = 280;
const LASER_PAD = 14; // 14px each side of a 70px cell = the laser fills 60% of the lane
const row = i => ({row:true,i}), col = i => ({row:false,i});
// Each phrase lasts 16 beats: two four-hit barrages. Dodge every attack in a barrage and a strike window opens.
// Every entry below is a WARNING. Its lasers fire one complete beat later.
const PATTERNS = [
  [[row(1)],[row(2)],[row(3)],[row(4)], [],[],[],[], [col(6)],[col(5)],[col(4)],[col(3)], [],[],[],[]],
  [[row(0),row(7)],[row(1),row(6)],[row(2),row(5)],[row(3),row(4)], [],[],[],[], [col(0),col(7)],[col(1),col(6)],[col(2),col(5)],[col(3),col(4)], [],[],[],[]],
  [[row(1),col(6)],[row(2),col(5)],[row(3),col(4)],[row(4),col(3)], [],[],[],[], [row(6),col(1)],[row(5),col(2)],[row(4),col(3)],[row(3),col(4)], [],[],[],[]]
];
const ROMAN = ['I', 'II', 'III'];
const MODES = {
  easy: {name:'Easy', beat:700, wisps:5, hp:8, multiplier:1, form:'The Alternate', image:'easygab.png'},
  medium: {name:'Medium', beat:600, wisps:3, hp:10, multiplier:1.5, form:'Faceless Alternate', image:'medgab.png'},
  hard: {name:'Hard', beat:500, wisps:3, hp:12, multiplier:2, form:'True ???', image:'hardgab.png'}
};
let game = null, modeName = 'easy', lastFrame = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = id => document.getElementById(id);
const beatDuration = () => game.mode.beat * SPEED[game.phase - 1];
const formatScore = n => String(n).padStart(6, '0');
const inBounds = (x,y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
function addShape(group, tag, attrs) {
  const shape = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([key,value]) => shape.setAttribute(key,value));
  $(group).appendChild(shape); return shape;
}
function addLine(group, line, className) {
  const center=line.i*CELL+35;
  if(className==='flash') {
    addShape(group,'rect',line.row
      ? {x:0,y:line.i*CELL+LASER_PAD,width:560,height:CELL-LASER_PAD*2,class:'laser'}
      : {x:line.i*CELL+LASER_PAD,y:0,width:CELL-LASER_PAD*2,height:560,class:'laser'});
    return;
  }
  for(let i=0;i<SIZE;i++) {
    const x=(line.row?i:line.i)*CELL,y=(line.row?line.i:i)*CELL;
    addShape(group,'rect',{x:x+3,y:y+3,width:64,height:64,class:'warn'});
    addShape(group,'text',{x:x+35,y:y+46,'text-anchor':'middle',class:'warning-mark'}).textContent='!';
  }
}
function bestScore(mode) {
  try {const value=Number(localStorage.getItem('sanctum-v2-best-'+mode));return Number.isFinite(value) && value>0 ? value : 0;} catch {return 0;}
}

// ---- Sound effects (synthesized, so no extra files are needed) ----
let audioCtx = null;
function getAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return null;
    if(!audioCtx) audioCtx = new Ctx();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
function playHurtSound() {
  const ctx = getAudio(); if(!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(170, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + .22);
    gain.gain.setValueAtTime(.22, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now); osc.stop(now + .26);
    const noise = ctx.createBufferSource(), ng = ctx.createGain();
    noise.buffer = noiseBuffer(ctx, .15);
    ng.gain.setValueAtTime(.18, now);
    ng.gain.exponentialRampToValueAtTime(.001, now + .15);
    noise.connect(ng).connect(ctx.destination);
    noise.start(now);
  } catch { /* Audio is optional. */ }
}
function playJumpscareSound() {
  try { screamAudio.currentTime = 0; screamAudio.play().catch(() => {}); } catch { /* Audio is optional. */ }
}
function playAttackSound() {
  const ctx = getAudio(); if(!ctx) return;
  try {
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), ng = ctx.createGain();
    noise.buffer = noiseBuffer(ctx, .2);
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(5000, now + .15);
    ng.gain.setValueAtTime(.25, now);
    ng.gain.exponentialRampToValueAtTime(.001, now + .2);
    noise.connect(filter).connect(ng).connect(ctx.destination);
    noise.start(now);
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + .18);
    og.gain.setValueAtTime(.3, now);
    og.gain.exponentialRampToValueAtTime(.001, now + .2);
    osc.connect(og).connect(ctx.destination);
    osc.start(now); osc.stop(now + .21);
  } catch { /* Audio is optional. */ }
}
const screamAudio = new Audio('scream.mp3');

// ---- Jumpscare: shown when the player loses, then the result screen appears ----
const JUMPSCARE_MS = 5500;
let jumpscareTimer = null;
function cancelJumpscare() {
  clearTimeout(jumpscareTimer); jumpscareTimer = null;
  $('jumpscare').hidden = true;
  $('jumpscare').classList.remove('on');
  screamAudio.pause();
}
function playJumpscare(done) {
  const scare = $('jumpscare');
  $('jumpscare-image').src = game.mode.image;
  scare.hidden = false;
  scare.classList.remove('on'); void scare.offsetWidth; // restart the CSS animation
  scare.classList.add('on');
  playJumpscareSound();
  clearTimeout(jumpscareTimer);
  jumpscareTimer = setTimeout(() => { cancelJumpscare(); done(); }, JUMPSCARE_MS);
}
function focusMenu() { $('overlay').querySelector('button')?.focus({preventScroll:true}); }
function showMenu() {
  $('pause').disabled=true;
  $('overlay').innerHTML=`<h2 id="menu-title">Sanctum<small>.exe</small></h2><div class="mode-list">${Object.entries(MODES).map(([key,m])=>`<button class="mode-button" data-mode="${key}">${m.name}<span aria-hidden="true">→</span></button>`).join('')}</div>`;
  $('overlay').hidden=false; focusMenu();
}
function startGame(mode) {
  if(!MODES[mode]) return;
  modeName=mode;
  const m=MODES[mode];
  game={mode:m,x:4,y:6,wisps:m.wisps,hp:m.hp,score:0,phase:1,clean:true,beat:0,totalBeats:0,warn:[],flashes:[],feathers:[],pendingFeathers:[],strike:null,barrageClean:true,countdown:3,moveQueue:[],renderX:4,renderY:6,fromX:4,fromY:6,
    elapsed:0,nextBeat:m.beat,lastBeat:0,hurtUntil:0,lastMove:-Infinity,over:false,paused:false,flashUntil:0,bossHitUntil:0,noticeUntil:0};
  lastFrame=null;
  cancelJumpscare(); $('boss').classList.remove('defeated');
  document.body.className='mode-'+mode;
  $('boss-image').src=m.image; $('boss-image').alt=m.form+', a corrupted angelic transmission';
  $('bname').textContent=m.form;
  $('overlay').hidden=true; $('pause').disabled=false; $('pause').innerHTML='Pause <kbd>Esc</kbd>';
  $('pause').focus({preventScroll:true});
  draw(); renderClock();
}
// Only active play advances this clock. Pausing freezes beats, strike windows and protection together.
function frame(timestamp) {
  const dt=lastFrame===null?0:Math.min(timestamp-lastFrame,100); lastFrame=timestamp;
  if(game && !game.over && !game.paused) {
    game.elapsed+=dt;
    if(game.moveQueue.length && game.elapsed-game.lastMove>=90) {
      const move=game.moveQueue.shift();
      if(game.elapsed<=move.until)movePlayer(move.dx,move.dy);
    }
    const healthBefore=game.wisps;
    advanceProjectiles(dt);
    if(game.wisps!==healthBefore)draw();
    if(!game.over && game.elapsed>=game.nextBeat) {
      game.lastBeat=game.nextBeat; game.nextBeat+=beatDuration(); onBeat();
    }
    renderClock();
  }
  requestAnimationFrame(frame);
}
function renderClock() {
  if(!game) return;
  $('ghost').classList.toggle('blink',game.elapsed<game.hurtUntil && !game.over);
  document.body.classList.toggle('hurt',game.elapsed<game.hurtUntil-1700 && !game.over);
  document.body.classList.toggle('dmg',game.elapsed<game.hurtUntil-1600);
  document.body.classList.toggle('hit',game.elapsed<game.bossHitUntil && !game.over);
  drawPlayer();
  drawProjectiles();
  $('phase-notice').classList.toggle('visible',game.elapsed<game.noticeUntil && !game.over);
  $('strike-notice').classList.toggle('visible',!!game.strike && !game.paused && !game.over);
  updateLasers();
}
// The laser is a solid box that fades out; its animation uses the pause-aware game clock.
function updateLasers() {
  const age=game.elapsed-(game.flashUntil-LASER_TIME);
  if(age<0 || age>=LASER_TIME){$('flashes').replaceChildren();return;}
  const opacity=reducedMotion.matches?1:Math.min(1,(LASER_TIME-age)/110);
  $('flashes').querySelectorAll('.laser').forEach(laser=>{laser.style.opacity=opacity;});
}
function onBeat() {
  if(!game || game.over || game.paused)return;
  if(game.countdown>0) {
    game.countdown--;
    draw();return;
  }
  const n=game.beat++,step=n%16,phase=game.phase;
  game.totalBeats++;
  game.flashes=game.warn;game.warn=[];game.flashUntil=game.elapsed+LASER_TIME;
  for(const line of game.flashes)if(line.row?game.y===line.i:game.x===line.i)hurtPlayer();
  if(game.over){draw();return;}
  game.feathers.push(...game.pendingFeathers);game.pendingFeathers=[];
  checkFeathers();if(game.over){draw();return;}
  if(game.strike && --game.strike.left<=0){game.strike=null;}
  game.warn=PATTERNS[phase-1][step].map(line=>({...line}));
  // Feather entries are announced on their edge tile one full beat before they appear.
  if(phase>=2 && (step===0||step===8)) {
    game.pendingFeathers.push(step===0?{x:6,y:0,dx:0,dy:1}:{x:0,y:1,dx:1,dy:0});
    game.pendingFeathers.push(step===0?{x:0,y:6,dx:1,dy:0}:{x:1,y:0,dx:0,dy:1});
  }
  if(phase===3 && (step===2||step===10))game.pendingFeathers.push({x:7,y:step===2?5:2,dx:-1,dy:0});
  // End of a barrage: clear every remaining hazard. If nothing hit the player, the boss is open to a strike.
  if(step===5||step===13) {
    game.feathers=[];game.pendingFeathers=[];game.flashes=[];
    if(game.barrageClean)game.strike={left:2};
    game.barrageClean=true;
  }
  game.score+=10;draw();
}
// Attack input: only works while the strike window is open (earned by dodging a whole barrage).
function attack() {
  if(!game||game.over||game.paused||!game.strike)return;
  hitBoss();draw();
}
// Keep up to two quick taps in order instead of replacing an earlier tap.
function requestMove(dx,dy) {
  if(!game||game.over||game.paused)return;
  if(game.elapsed-game.lastMove>=90 && !game.moveQueue.length){movePlayer(dx,dy);return;}
  if(game.moveQueue.length<2)game.moveQueue.push({dx,dy,until:game.elapsed+240});
}
function drawPlayer() {
  const t=reducedMotion.matches?1:Math.min(1,(game.elapsed-game.lastMove)/65);
  const ease=1-Math.pow(1-t,3);
  game.renderX=game.fromX+(game.x-game.fromX)*ease;
  game.renderY=game.fromY+(game.y-game.fromY)*ease;
  $('ghost').setAttribute('transform',`translate(${game.renderX*CELL} ${game.renderY*CELL})`);
}
// Projectiles move every frame, independently of player movement and beat redraws.
function advanceProjectiles(dt) {
  const distance=dt/beatDuration();
  game.feathers=game.feathers.filter(f=>{
    const oldX=f.x,oldY=f.y;
    f.x+=f.dx*distance;f.y+=f.dy*distance;
    const hit=f.dx
      ? Math.abs(f.y-game.y)<.4 && Math.min(oldX,f.x)<=game.x+.4 && Math.max(oldX,f.x)>=game.x-.4
      : Math.abs(f.x-game.x)<.4 && Math.min(oldY,f.y)<=game.y+.4 && Math.max(oldY,f.y)>=game.y-.4;
    if(hit){hurtPlayer();return false;}
    return f.x>-.6&&f.x<SIZE-.4&&f.y>-.6&&f.y<SIZE-.4;
  });
}
function movePlayer(dx,dy) {
  if(!game || game.over || game.paused || game.elapsed-game.lastMove<90)return;
  const x=game.x+dx,y=game.y+dy;if(!inBounds(x,y))return;
  game.fromX=game.renderX;game.fromY=game.renderY;
  game.lastMove=game.elapsed;game.x=x;game.y=y;
  checkFeathers();
  draw();
}
function checkFeathers() {
  game.feathers=game.feathers.filter(f=>{
    if(Math.abs(f.x-game.x)<.4 && Math.abs(f.y-game.y)<.4){hurtPlayer();return false;} return true;
  });
}
function hurtPlayer() {
  if(game.over || game.elapsed<game.hurtUntil)return;
  game.wisps--;game.clean=false;game.barrageClean=false;game.hurtUntil=game.elapsed+2000;
  if(game.wisps<=0){endGame(false);return;}
  playHurtSound();
}
function hitBoss() {
  if(game.over)return;
  playAttackSound();
  game.hp--;game.score+=500;game.strike=null;game.bossHitUntil=game.elapsed+250;
  const bonus=1000+(game.clean?300:0);
  if(game.hp<=0){game.score+=bonus;endGame(true);return;}
  const ratio=game.hp/game.mode.hp;
  const next=ratio>2/3?1:ratio>1/3?2:3;
  if(next>game.phase) {
    game.score+=bonus;game.phase=next;game.clean=true;game.beat=0;
    game.warn=[];game.flashes=[];game.feathers=[];game.pendingFeathers=[];game.barrageClean=true;game.countdown=2;game.moveQueue=[];
    game.lastBeat=game.elapsed;game.nextBeat=game.elapsed+beatDuration();
    game.noticeUntil=game.elapsed+beatDuration()*2;
    $('phase-notice').textContent='PHASE '+ROMAN[next-1];
  }
}
function endGame(win) {
  if(game.over)return;
  game.over=true;game.moveQueue=[];
  game.final=Math.round((game.score+(win?game.wisps*200:0))*game.mode.multiplier);
  const previous=bestScore(modeName), best=Math.max(previous,game.final);
  try{localStorage.setItem('sanctum-v2-best-'+modeName,String(best));}catch{/* Storage may be disabled; the game still works. */}
  $('pause').disabled=true;
  if(win)$('boss').classList.add('defeated');
  $('overlay').innerHTML=`<h2 id="menu-title">${win?'Victory':'Try again'}</h2><div class="result-score">${formatScore(game.final)}</div><div class="result-actions"><button class="primary-button" data-action="retry">Retry</button><button class="secondary-button" data-action="menu">Modes</button></div>`;
  draw();renderClock();
  if(win){$('overlay').hidden=false;focusMenu();return;}
  // On a loss the jumpscare plays first, then the result screen appears.
  $('overlay').hidden=true;
  const thisGame=game;
  playJumpscare(()=>{if(game!==thisGame)return;$('overlay').hidden=false;focusMenu();});
}
// Leave the current run and return to the mode select screen.
function goHome() {
  cancelJumpscare();
  game=null;lastFrame=null;
  document.body.className='mode-'+modeName;
  document.body.dataset.phase='1';
  $('boss').classList.remove('defeated');
  $('pause').innerHTML='Pause <kbd>Esc</kbd>';
  showMenu();
}
function togglePause() {
  if(!game || game.over)return;
  game.paused=!game.paused;game.moveQueue=[];lastFrame=null;
  document.body.classList.toggle('is-paused',game.paused);
  if(game.paused) {
    $('overlay').innerHTML='<h2 id="menu-title">Paused</h2><div class="mode-list"><button class="primary-button" data-action="resume">Resume</button><button class="secondary-button" data-action="home">Home</button></div>';
    $('overlay').hidden=false; $('pause').innerHTML='Resume <kbd>Esc</kbd>';focusMenu();
  } else {$('overlay').hidden=true;$('pause').innerHTML='Pause <kbd>Esc</kbd>';$('pause').focus({preventScroll:true});}
}
function drawProjectiles() {
  $('projectiles').replaceChildren();
  game.feathers.forEach(f=>{
    addShape('projectiles','circle',{cx:f.x*CELL+35,cy:f.y*CELL+35,r:15,class:'feather'});
  });
}
function draw() {
  $('warnings').replaceChildren();$('flashes').replaceChildren();$('items').replaceChildren();$('spawns').replaceChildren();
  game.warn.forEach(line=>addLine('warnings',line,'warn'));
  if(game.elapsed<game.flashUntil)game.flashes.forEach(line=>addLine('flashes',line,'flash'));
  for(const f of game.pendingFeathers){
    const cx=f.x*CELL+35,cy=f.y*CELL+35,angle=f.dx===1?-90:f.dx===-1?90:0;
    addShape('spawns','rect',{x:cx-26,y:cy-26,width:52,height:52,rx:3,class:'spawn-warn'});
    addShape('spawns','path',{d:`M${cx-12} ${cy-8} L${cx} ${cy+9} L${cx+12} ${cy-8}Z`,class:'spawn-arrow',transform:`rotate(${angle} ${cx} ${cy})`});
  }
  drawPlayer();drawProjectiles();
  document.body.dataset.phase=game.phase;
  document.body.classList.toggle('strike-open',!!game.strike && !game.over);
  $('countdown').hidden=game.countdown===0||game.over;
  $('countdown').textContent=game.countdown;
  $('score').textContent=formatScore(game.over?game.final:game.score);
  updateLasers();
  $('phrase-steps').setAttribute('aria-label','Attack sequence, beat '+(game.beat?((game.beat-1)%16+1):0)+' of 16');
  [...$('phrase-steps').children].forEach((dot,i)=>dot.classList.toggle('active',game.countdown===0&&game.beat>0&&i===(game.beat-1)%16));
  $('phase').textContent='PHASE '+ROMAN[game.phase-1]+' / III';
  $('wisps').innerHTML='●'.repeat(game.wisps)+'<span class="lost-wisp">'+'○'.repeat(game.mode.wisps-game.wisps)+'</span>';
  $('wisps').setAttribute('aria-label',game.wisps+' health remaining');
  $('hp').style.width=game.hp/game.mode.hp*100+'%';$('hp-text').textContent=game.hp+' / '+game.mode.hp;
  $('health-bar').setAttribute('aria-valuemax',game.mode.hp);$('health-bar').setAttribute('aria-valuenow',game.hp);
}
const KEYS={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const key=e.key.length===1?e.key.toLowerCase():e.key;
  if(KEYS[key]){e.preventDefault();if(!e.repeat)requestMove(...KEYS[key]);}
  else if((key===' '||key==='Enter'||key==='j') && !e.repeat && $('overlay').hidden){e.preventDefault();attack();}
  else if((key==='p'||key==='Escape')&&!e.repeat){e.preventDefault();togglePause();}
  else if(key==='r'&&!e.repeat&&game?.over)startGame(modeName);
  // Keep keyboard focus in the active menu.
  if(e.key==='Tab'&&!$('overlay').hidden){
    const buttons=[...$('overlay').querySelectorAll('button')],first=buttons[0],last=buttons.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
$('overlay').addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.mode)startGame(button.dataset.mode);
  if(button.dataset.action==='resume')togglePause();
  if(button.dataset.action==='home')goHome();
  if(button.dataset.action==='retry')startGame(modeName);
  if(button.dataset.action==='menu')showMenu();
});
$('pause').addEventListener('click',togglePause);
$('attack').addEventListener('click',attack);
const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
document.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',()=>requestMove(...directions[button.dataset.move])));
document.addEventListener('visibilitychange',()=>{if(document.hidden && game && !game.over && !game.paused)togglePause();});
window.addEventListener('blur',()=>{if(game && !game.over && !game.paused)togglePause();});
for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)addShape('tiles','rect',{x:x*CELL+2,y:y*CELL+2,width:CELL-4,height:CELL-4,rx:2,class:(x+y)%2?'tile-a':'tile-b'});
for(let i=0;i<16;i++){const dot=document.createElement('i');if(i===5||i===13)dot.className='opening';$('phrase-steps').appendChild(dot);}
showMenu();requestAnimationFrame(frame);
