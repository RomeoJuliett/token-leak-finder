// Static code only: report values stay in escaped HTML attributes, never script literals.
export const themeScript = `
(function(){var theme;try{theme=localStorage.getItem('token-leak-theme');}catch(e){}if(theme!=='light'&&theme!=='dark'){theme=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';}document.documentElement.dataset.theme=theme;})();`;
export const reportScript = `
(function(){
var root=document.documentElement,theme=document.getElementById('theme-toggle');
function themeLabel(){var light=root.dataset.theme==='light';theme.textContent=light?'Dark mode':'Light mode';theme.setAttribute('aria-label','Switch to '+(light?'dark':'light')+' mode');theme.setAttribute('aria-pressed',String(light));}
themeLabel();theme.addEventListener('click',function(){root.dataset.theme=root.dataset.theme==='light'?'dark':'light';try{localStorage.setItem('token-leak-theme',root.dataset.theme);}catch(e){}themeLabel();});
var tooltip=document.getElementById('chart-tooltip'),active=null;
function hide(){tooltip.hidden=true;active=null;}
function show(mark,event){active=mark;tooltip.textContent=mark.dataset.tip;tooltip.hidden=false;var box=mark.getBoundingClientRect(),rect=tooltip.getBoundingClientRect();var x=event&&event.clientX!==undefined?event.clientX:box.left+box.width/2;var y=event&&event.clientY!==undefined?event.clientY:box.bottom;tooltip.style.left=Math.max(12,Math.min(innerWidth-rect.width-12,x+12))+'px';tooltip.style.top=Math.max(12,Math.min(innerHeight-rect.height-12,y+14))+'px';}
// Delegated listeners keep even long analysed windows inexpensive to initialise.
function markOf(event){return event.target.closest&&event.target.closest('[data-tip]');}
document.addEventListener('pointerover',function(e){var m=markOf(e);if(m)show(m,e);});
document.addEventListener('pointermove',function(e){if(active&&markOf(e)===active)show(active,e);});
document.addEventListener('pointerout',function(e){var m=markOf(e);if(m&&!m.contains(e.relatedTarget))hide();});
document.addEventListener('focusin',function(e){var m=markOf(e);if(m){m.classList.remove('reveal-pending');show(m);}});
document.addEventListener('focusout',hide);document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});window.addEventListener('scroll',hide,{passive:true});window.addEventListener('resize',hide);
document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',async function(){var target=document.getElementById(button.dataset.copy);try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(target.textContent);}else{var field=document.createElement('textarea');field.value=target.textContent;document.body.appendChild(field);field.select();var copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('copy');}button.textContent='Copied';document.getElementById('copy-status').textContent='Suggested fix copied.';}catch(e){button.textContent='Select fix to copy';var range=document.createRange();range.selectNodeContents(target);var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.getElementById('copy-status').textContent='Fix selected. Copy it with your keyboard.';}});});
var reduced=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion:reduce)'):null;
if(reduced&&reduced.matches||typeof requestAnimationFrame!=='function')return;
root.classList.add('motion');
var total=document.getElementById('headline-total'),percent=document.getElementById('headline-percent'),finalTotal=total.textContent,finalPercent=percent.textContent,sweep=document.getElementById('sweep-path'),start=null,raf;
function compact(n){return n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':Math.round(n).toLocaleString('en-US');}
function finish(){root.classList.remove('motion');total.textContent=finalTotal;percent.textContent=finalPercent;sweep.setAttribute('d','M120 120 L120 -60 A180 180 0 1 1 119.99 -60 Z');document.querySelectorAll('.reveal-pending').forEach(function(el){el.classList.remove('reveal-pending');});}
function frame(now){if(start===null)start=now;var t=Math.min(1,(now-start)/1400),ease=1-Math.pow(1-t,3);total.textContent=t===1?finalTotal:compact(Number(total.dataset.count)*ease);var p=Math.min(1,Math.max(0,(now-start-1400)/1300));percent.textContent=p===1?finalPercent:'~'+(Number(percent.dataset.count)*(1-Math.pow(1-p,3))).toFixed(1)+'%';if(t<1){var angle=ease*Math.PI*2-Math.PI/2;var x=120+180*Math.cos(angle),y=120+180*Math.sin(angle);sweep.setAttribute('d','M120 120 L120 -60 A180 180 0 '+(ease>.5?1:0)+' 1 '+x+' '+y+' Z');}else{sweep.setAttribute('d','M120 120 L120 -60 A180 180 0 1 1 119.99 -60 Z');}if(p<1)raf=requestAnimationFrame(frame);}
raf=requestAnimationFrame(frame);
if(typeof IntersectionObserver==='function'){try{var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.remove('reveal-pending');observer.unobserve(entry.target);}});},{threshold:.06});document.querySelectorAll('.leak').forEach(function(card){if(card.getBoundingClientRect().top>innerHeight){card.classList.add('reveal-pending');observer.observe(card);}});document.addEventListener('focusin',function(e){var card=e.target.closest('.leak');if(card){card.classList.remove('reveal-pending');observer.unobserve(card);}});}catch(e){document.querySelectorAll('.reveal-pending').forEach(function(card){card.classList.remove('reveal-pending');});}}
if(reduced){var onReduce=function(e){if(e.matches){cancelAnimationFrame(raf);finish();}};if(reduced.addEventListener)reduced.addEventListener('change',onReduce);else if(reduced.addListener)reduced.addListener(onReduce);}
})();`;
