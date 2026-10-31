// Static code only: report values stay in escaped HTML attributes, never script literals.
export const themeScript = `
(function(){var theme;try{theme=localStorage.getItem('token-leak-theme');}catch(e){}if(theme!=='light'&&theme!=='dark'){theme=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';}document.documentElement.dataset.theme=theme;})();`;
export const reportScript = `
(function(){
var root=document.documentElement,theme=document.getElementById('theme-toggle');
function themeLabel(){var light=root.dataset.theme==='light';theme.textContent=light?'Dark':'Light';theme.setAttribute('aria-label','Switch to '+(light?'dark':'light')+' mode');theme.setAttribute('aria-pressed',String(light));}
themeLabel();theme.addEventListener('click',function(){root.dataset.theme=root.dataset.theme==='light'?'dark':'light';try{localStorage.setItem('token-leak-theme',root.dataset.theme);}catch(e){}themeLabel();});
var tooltip=document.getElementById('chart-tooltip'),active=null,revealFocused=function(){};
function hide(){tooltip.hidden=true;active=null;}
function show(mark,event){active=mark;tooltip.textContent=mark.dataset.tip;tooltip.hidden=false;var box=mark.getBoundingClientRect(),rect=tooltip.getBoundingClientRect();var x=event&&event.clientX!==undefined?event.clientX:box.left+box.width/2;var y=event&&event.clientY!==undefined?event.clientY:box.bottom;tooltip.style.left=Math.max(12,Math.min(innerWidth-rect.width-12,x+12))+'px';tooltip.style.top=Math.max(12,Math.min(innerHeight-rect.height-12,y+14))+'px';}
// Delegated listeners keep even long analysed windows inexpensive to initialise.
function markOf(event){return event.target.closest&&event.target.closest('[data-tip]');}
document.addEventListener('pointerover',function(e){var m=markOf(e);if(m)show(m,e);});
document.addEventListener('pointermove',function(e){if(active&&markOf(e)===active)show(active,e);});
document.addEventListener('pointerout',function(e){var m=markOf(e);if(m&&!m.contains(e.relatedTarget))hide();});
document.addEventListener('focusin',function(e){revealFocused(e.target);var m=markOf(e);if(m){m.classList.remove('reveal-pending');show(m);}});
document.addEventListener('focusout',hide);document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});window.addEventListener('scroll',hide,{passive:true});window.addEventListener('resize',hide);
document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',async function(){var target=document.getElementById(button.dataset.copy);try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(target.textContent);}else{var field=document.createElement('textarea');field.value=target.textContent;document.body.appendChild(field);field.select();var copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('copy');}button.textContent='Copied';document.getElementById('copy-status').textContent='Suggested fix copied.';}catch(e){button.textContent='Select fix to copy';var range=document.createRange();range.selectNodeContents(target);var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.getElementById('copy-status').textContent='Fix selected. Copy it with your keyboard.';}});});
var reduced=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion:reduce)'):null;
if(reduced&&reduced.matches||typeof requestAnimationFrame!=='function')return;
root.classList.add('motion');
var total=document.getElementById('headline-total'),percent=document.getElementById('headline-percent'),finalTotal=total.textContent,finalPercent=percent.textContent,sweep=document.getElementById('sweep-path'),start=null,raf,sweepRaf,observer;
var fullSweep='M120 120 L120 -60 A180 180 0 1 1 119.99 -60 Z';
function compact(n){return n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':Math.round(n).toLocaleString('en-US');}
function finish(){cancelAnimationFrame(raf);cancelAnimationFrame(sweepRaf);root.classList.remove('motion');total.textContent=finalTotal;percent.textContent=finalPercent;sweep.setAttribute('d',fullSweep);if(observer)observer.disconnect();document.querySelectorAll('.reveal-pending').forEach(function(el){el.classList.remove('reveal-pending');});}
// Preserve the headline sequence, with each count settling in 900ms.
function frame(now){if(start===null)start=now;var t=Math.min(1,(now-start)/900),ease=1-Math.pow(1-t,3);total.textContent=t===1?finalTotal:compact(Number(total.dataset.count)*ease);var p=Math.min(1,Math.max(0,(now-start-900)/900));percent.textContent=p===1?finalPercent:'~'+(Number(percent.dataset.count)*(1-Math.pow(1-p,3))).toFixed(1)+'%';if(p<1)raf=requestAnimationFrame(frame);}
raf=requestAnimationFrame(frame);
// Solve the same cubic-bezier(.2,.7,.2,1) used by CSS chart reveals.
function chartEase(t){if(t===0||t===1)return t;var lo=0,hi=1,u=t;for(var i=0;i<12;i++){u=(lo+hi)/2;var x=3*(1-u)*(1-u)*u*.2+3*(1-u)*u*u*.2+u*u*u;if(x<t)lo=u;else hi=u;}return 3*(1-u)*(1-u)*u*.7+3*(1-u)*u*u+u*u*u;}
function drawDonut(){var began=null;sweep.setAttribute('d','M120 120 L120 -60 Z');function draw(now){if(began===null)began=now;var t=Math.min(1,(now-began)/650),ease=chartEase(t),angle=ease*Math.PI*2-Math.PI/2;var x=120+180*Math.cos(angle),y=120+180*Math.sin(angle);sweep.setAttribute('d',t===1?fullSweep:'M120 120 L120 -60 A180 180 0 '+(ease>.5?1:0)+' 1 '+x+' '+y+' Z');if(t<1)sweepRaf=requestAnimationFrame(draw);}sweepRaf=requestAnimationFrame(draw);}
function reveal(panel){if(panel.classList.contains('is-revealed'))return;panel.classList.remove('reveal-pending');panel.classList.add('is-revealed');if(panel.querySelector('#sweep-path'))drawDonut();if(observer)observer.unobserve(panel);}
if(typeof IntersectionObserver==='function'){try{
observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting)reveal(entry.target);});},{threshold:.06});
document.querySelectorAll('.chart,.context,.leak').forEach(function(panel){
var marks=panel.querySelectorAll('.grow-y,.grow-x,.water-step,.area-fill,.spark-line');
// 50ms cadence for short series; grouped marks cap the final delay at 500ms.
var group=Math.max(1,Math.ceil(marks.length/11));marks.forEach(function(mark,i){mark.style.setProperty('--delay',Math.min(500,Math.floor(i/group)*50)+'ms');});
if(!panel.classList.contains('leak')||panel.getBoundingClientRect().top>innerHeight){panel.classList.add('reveal-pending');observer.observe(panel);}else reveal(panel);
});
revealFocused=function(target){var panel=target.closest('.chart,.context,.leak');if(panel&&panel.classList.contains('reveal-pending'))reveal(panel);};
}catch(e){finish();}}
if(reduced){var onReduce=function(e){if(e.matches){finish();}};if(reduced.addEventListener)reduced.addEventListener('change',onReduce);else if(reduced.addListener)reduced.addListener(onReduce);}
})();`;
