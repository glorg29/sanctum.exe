'use strict';
// Sanctum.exe — Second Judgment, with a quieter interface and smooth movement.
const SIZE = 8, CELL = 70, SVGNS = 'http://www.w3.org/2000/svg';
const SPEED = [1, .85, .7];
const LASER_TIME = 280;
const row = i => ({row:true,i}), col = i => ({row:false,i});
// Each phrase lasts 16 beats: two four-hit barrages, each followed by a halo opening.
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
    addShape(group,'line',line.row
      ? {x1:0,y1:center,x2:560,y2:center,class:'laser'}
      : {x1:center,y1:0,x2:center,y2:560,class:'laser'});
    return;
  }
  for(let i=0;i<SIZE;i++) {
    const x=(line.row?i:line.i)*CELL,y=(line.row?line.i:i)*CELL;
    addShape(group,'rect',{x:x+3,y:y+3,width:64,height:64,class:'warn'});
    if(i===0||i===7)addShape(group,'text',{x:x+35,y:y+43,'text-anchor':'middle',class:'warning-mark'}).textContent='!';
  }
  addShape(group,'path',{d:line.row?`M70 ${center} H490`:`M${center} 70 V490`,class:'chain-warning'});
}
function bestScore(mode) {
  try {const value=Number(localStorage.getItem('sanctum-v2-best-'+mode));return Number.isFinite(value) && value>0 ? value : 0;} catch {return 0;}
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
  game={mode:m,x:4,y:6,wisps:m.wisps,hp:m.hp,score:0,phase:1,clean:true,beat:0,totalBeats:0,warn:[],flashes:[],feathers:[],pendingFeathers:[],halo:null,countdown:3,moveQueue:[],renderX:4,renderY:6,fromX:4,fromY:6,
    elapsed:0,nextBeat:m.beat,lastBeat:0,hurtUntil:0,lastMove:-Infinity,over:false,paused:false,flashUntil:0,bossHitUntil:0,noticeUntil:0};
  lastFrame=null;
  document.body.className='mode-'+mode;
  $('boss-image').src=m.image; $('boss-image').alt=m.form+', a corrupted angelic transmission';
  $('bname').textContent=m.form;
  $('overlay').hidden=true; $('pause').disabled=false; $('pause').innerHTML='Pause <kbd>Esc</kbd>';
  $('pause').focus({preventScroll:true});
  draw(); renderClock();
}
// Only active play advances this clock. Pausing freezes beats, halos and protection together.
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
  $('beat-fill').style.width=Math.min(100,Math.max(0,(game.elapsed-game.lastBeat)/(game.nextBeat-game.lastBeat)*100))+'%';
  $('ghost').classList.toggle('blink',game.elapsed<game.hurtUntil && !game.over);
  document.body.classList.toggle('hurt',game.elapsed<game.hurtUntil-1700 && !game.over);
  document.body.classList.toggle('hit',game.elapsed<game.bossHitUntil && !game.over);
  drawPlayer();
  drawProjectiles();
  $('phase-notice').classList.toggle('visible',game.elapsed<game.noticeUntil && !game.over);
  updateLasers();
}
// The thin beam widens on impact; its animation uses the pause-aware game clock.
function updateLasers() {
  const age=game.elapsed-(game.flashUntil-LASER_TIME);
  if(age<0 || age>=LASER_TIME){$('flashes').replaceChildren();return;}
  const width=reducedMotion.matches?30:2+28*Math.min(1,age/85);
  const opacity=reducedMotion.matches?1:Math.min(1,(LASER_TIME-age)/110);
  $('flashes').querySelectorAll('.laser').forEach(laser=>{
    laser.style.strokeWidth=width+'px';
    laser.style.opacity=opacity;
  });
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
  if(game.halo && --game.halo.left<=0){game.halo=null;}
  game.warn=PATTERNS[phase-1][step].map(line=>({...line}));
  // Feather entries are announced on their edge tile one full beat before they appear.
  if(phase>=2 && (step===0||step===8)) {
    game.pendingFeathers.push(step===0?{x:6,y:0,dx:0,dy:1}:{x:0,y:1,dx:1,dy:0});
    game.pendingFeathers.push(step===0?{x:0,y:6,dx:1,dy:0}:{x:1,y:0,dx:0,dy:1});
  }
  if(phase===3 && (step===2||step===10))game.pendingFeathers.push({x:7,y:step===2?5:2,dx:-1,dy:0});
  // A deliberate recovery window: clear every remaining hazard, then offer a counterattack.
  if(step===5||step===13) {
    game.feathers=[];game.pendingFeathers=[];game.flashes=[];
    placeHalo();
  }
  game.score+=10;draw();
}
// Find a short path avoiding current beams and the next two positions of every feather.
// This conservative search gives the player a reachable halo, not a random dangerous tile.
function placeHalo() {
  const unsafe=new Set();
  for(const line of [...game.warn,...game.flashes]) for(let i=0;i<SIZE;i++) unsafe.add(line.row?i+','+line.i:line.i+','+i);
  for(const f of game.feathers) for(let t=0;t<=2;t++) if(inBounds(f.x+f.dx*t,f.y+f.dy*t)) unsafe.add(Math.round(f.x+f.dx*t)+','+Math.round(f.y+f.dy*t));
  const queue=[{x:game.x,y:game.y,d:0}],seen=new Set([game.x+','+game.y]),candidates=[];
  const maxDistance=game.phase===3?3:4;
  for(let i=0;i<queue.length;i++) {
    const p=queue[i]; if(p.d>=2)candidates.push(p); if(p.d===maxDistance)continue;
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const x=p.x+dx,y=p.y+dy,key=x+','+y;
      if(!inBounds(x,y)||seen.has(key)||unsafe.has(key))continue;
      seen.add(key);queue.push({x,y,d:p.d+1});
    }
  }
  if(candidates.length) {
    const p=candidates[(game.totalBeats*7+game.phase*11)%candidates.length];
    game.halo={x:p.x,y:p.y,left:2};
  }
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
  if(!game.over && game.halo && game.halo.x===x && game.halo.y===y) hitBoss();
  draw();
}
function checkFeathers() {
  game.feathers=game.feathers.filter(f=>{
    if(Math.abs(f.x-game.x)<.4 && Math.abs(f.y-game.y)<.4){hurtPlayer();return false;} return true;
  });
}
function hurtPlayer() {
  if(game.over || game.elapsed<game.hurtUntil)return;
  game.wisps--;game.clean=false;game.hurtUntil=game.elapsed+2000;
  if(game.wisps<=0)endGame(false);
}
function hitBoss() {
  if(game.over)return;
  game.hp--;game.score+=500;game.halo=null;game.bossHitUntil=game.elapsed+250;
  const bonus=1000+(game.clean?300:0);
  if(game.hp<=0){game.score+=bonus;endGame(true);return;}
  const ratio=game.hp/game.mode.hp;
  const next=ratio>2/3?1:ratio>1/3?2:3;
  if(next>game.phase) {
    game.score+=bonus;game.phase=next;game.clean=true;game.beat=0;
    game.warn=[];game.flashes=[];game.feathers=[];game.pendingFeathers=[];game.countdown=2;game.moveQueue=[];
    game.lastBeat=game.elapsed;game.nextBeat=game.elapsed+beatDuration();
    game.noticeUntil=game.elapsed+beatDuration()*2;
    $('phase-notice').textContent='PHASE '+ROMAN[next-1];
  }
}
function rankFor(final,win) {
  // Rank thresholds scale with each mode's HP and multiplier. An unfinished run earns C.
  if(!win)return 'C';
  const base=game.mode.hp*500+3000;
  const normalized=final/game.mode.multiplier;
  return normalized>=base+1800?'S':normalized>=base+1000?'A':normalized>=base+400?'B':'C';
}
function endGame(win) {
  if(game.over)return;
  game.over=true;game.moveQueue=[];
  game.final=Math.round((game.score+(win?game.wisps*200:0))*game.mode.multiplier);
  const previous=bestScore(modeName), best=Math.max(previous,game.final);
  try{localStorage.setItem('sanctum-v2-best-'+modeName,String(best));}catch{/* Storage may be disabled; the game still works. */}
  game.rank=rankFor(game.final,win); $('pause').disabled=true;
  $('overlay').innerHTML=`<div class="rank">${game.rank}</div><h2 id="menu-title">${win?'Victory':'Try again'}</h2><div class="result-score">${formatScore(game.final)}</div><div class="result-actions"><button class="primary-button" data-action="retry">Retry</button><button class="secondary-button" data-action="menu">Modes</button></div>`;
  $('overlay').hidden=false;
  draw();renderClock();focusMenu();
}
function togglePause() {
  if(!game || game.over)return;
  game.paused=!game.paused;game.moveQueue=[];lastFrame=null;
  document.body.classList.toggle('is-paused',game.paused);
  if(game.paused) {
    $('overlay').innerHTML='<h2 id="menu-title">Paused</h2><div class="mode-list"><button class="primary-button" data-action="resume">Resume</button></div>';
    $('overlay').hidden=false; $('pause').innerHTML='Resume <kbd>Esc</kbd>';focusMenu();
  } else {$('overlay').hidden=true;$('pause').innerHTML='Pause <kbd>Esc</kbd>';$('pause').focus({preventScroll:true});}
}
function drawProjectiles() {
  $('projectiles').replaceChildren();
  game.feathers.forEach(f=>{
    const cx=f.x*CELL+35,cy=f.y*CELL+35,angle=f.dx===1?-90:f.dx===-1?90:0;
    addShape('projectiles','path',{d:`M${cx} ${cy-23} Q${cx+18} ${cy-4} ${cx} ${cy+23} Q${cx-12} ${cy+3} ${cx} ${cy-23}Z`,class:'feather',transform:`rotate(${angle} ${cx} ${cy})`});
    addShape('projectiles','path',{d:`M${cx} ${cy-14} V${cy+18}`,stroke:'#514049','stroke-width':2,transform:`rotate(${angle} ${cx} ${cy})`});
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
  if(game.halo) {
    const x=game.halo.x*CELL,y=game.halo.y*CELL;
    addShape('items','rect',{x:x+4,y:y+4,width:62,height:62,rx:4,class:'halo-tile'});
    for(const cls of ['halo-back','halo-front'])addShape('items','ellipse',{cx:x+35,cy:y+34,rx:21,ry:10,class:cls});
    addShape('items','text',{x:x+35,y:y+59,'text-anchor':'middle',fill:'#a69c88','font-size':10,'font-family':'monospace'}).textContent=game.halo.left+' BEAT'+(game.halo.left>1?'S':'');
  }
  drawPlayer();drawProjectiles();
  document.body.dataset.phase=game.phase;
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
  if(button.dataset.action==='retry')startGame(modeName);
  if(button.dataset.action==='menu')showMenu();
});
$('pause').addEventListener('click',togglePause);
const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
document.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',()=>requestMove(...directions[button.dataset.move])));
document.addEventListener('visibilitychange',()=>{if(document.hidden && game && !game.over && !game.paused)togglePause();});
window.addEventListener('blur',()=>{if(game && !game.over && !game.paused)togglePause();});
for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)addShape('tiles','rect',{x:x*CELL+2,y:y*CELL+2,width:CELL-4,height:CELL-4,rx:2,class:(x+y)%2?'tile-a':'tile-b'});
for(let i=0;i<16;i++){const dot=document.createElement('i');if(i===5||i===13)dot.className='opening';$('phrase-steps').appendChild(dot);}
showMenu();requestAnimationFrame(frame);
