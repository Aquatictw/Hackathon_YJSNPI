'use client';

import {useCallback, useEffect, useRef, useState, type MouseEvent} from 'react';
import {useLocale} from '@/components/locale-provider';
import {createPortal} from 'react-dom';
import {ArrowLeft, ArrowRight, BookOpen, X} from 'lucide-react';
import {tourRoute, tourSteps, type TourRoute} from '@/lib/rtdi/tour-steps';
import './guided-tour.css';

const storageKey = 'rtdi-guided-tour-v1';
const visitKey = 'rtdi-guided-tour-visit-v1';
type VisitStatus = 'seen' | 'dismissed' | 'completed';
function readVisit():VisitStatus|null {
  for (const storage of ['localStorage','sessionStorage'] as const) {
    try {
      const saved = JSON.parse(window[storage].getItem(visitKey) ?? 'null');
      if (saved?.version === 1 && ['seen','dismissed','completed'].includes(saved.status)) return saved.status;
    } catch { /* A denied store must not prevent using the guide. */ }
  }
  return null;
}
function markVisit(status:VisitStatus) {
  const previous = readVisit();
  const value = JSON.stringify({version:1,status:previous === 'completed' ? previous : status === 'seen' && previous ? previous : status});
  for (const storage of ['localStorage','sessionStorage'] as const) {
    try { window[storage].setItem(visitKey,value); } catch { /* Session fallback, then this document's mounted state. */ }
  }
}
const chapters = [
  {route:'/' as const, name:'Replay analysis', description:'Wafer selection, alerts, imports and validation'},
  {route:'/workspace' as const, name:'Run workspace', description:'Evidence, Temperature, commands and investigations'},
  {route:'/sandbox' as const, name:'Sandbox', description:'Synthetic fixtures and rule-based analysis'},
];
type Box = {left:number; top:number; width:number; height:number};
type Placement = {hole:Box|null; left:number; top:number; attached:boolean};
const sameBox = (a:Placement, b:Placement) => JSON.stringify(a) === JSON.stringify(b);

function saveStep(index:number):boolean {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({version:1, id:tourSteps[index].id, expires:Date.now()+2*60*60*1000}));
    return true;
  } catch { return false; }
}
function clearStep() { try { sessionStorage.removeItem(storageKey); } catch { /* Tour still closes when storage is denied. */ } }

// Only view tabs are activated. Forms, evidence selection and model controls are never invoked.
function visibleElement(selector:string):HTMLElement|null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(el => el.getClientRects().length > 0 && !el.closest('[hidden]')) ?? null;
}
function activateTab(tab:HTMLElement) {
  if (tab.getAttribute('role') !== 'tab' || tab.getAttribute('aria-selected') === 'true') return;
  // Radix selects on mousedown; workspace tabs use a normal click handler.
  if (tab.dataset.slot === 'tabs-trigger') tab.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
  else tab.click();
}

function routeBlocker(route:TourRoute|null, initialInputs:string, dirtyInputs:boolean):string|null {
  if (document.querySelector('.dc-thinking,.thinking')) return 'An investigation is still running. Close the guide and wait for it before changing pages.';
  if (route === '/' && (document.querySelector('.replay-source[data-tour-local-import="true"]') || document.querySelector('.replay-source')?.textContent?.includes('Local import'))) return 'This page contains a local replay import. Leaving would replace it with the bundled snapshot. Close the guide to keep reviewing it; other chapters remain available from Guide later.';
  if (route === '/sandbox' && (document.querySelector('.inbox-item,.chat-message') || [...document.querySelectorAll<HTMLTextAreaElement>('main textarea')].some(el=>el.value.trim()))) return 'This sandbox contains local events, answers or a draft. Page navigation would discard them. Close the guide to keep working here; open another chapter after you have preserved your work.';
  if (route === '/workspace') {
    const inputs = JSON.stringify([...document.querySelectorAll<HTMLInputElement>('.dc-connect input')].map(el=>el.value));
    if (dirtyInputs || inputs !== initialInputs || document.querySelector<HTMLTextAreaElement>('.dc-composer textarea')?.value.trim()) return 'A run input or investigation draft is present. Close the guide to keep working in this scope. The guide will not navigate away from an unfinished draft.';
  }
  return null;
}

export function GuidedTour() { const {t}=useLocale();
  // null = closed; -1 = welcome and chapter chooser.
  const [index,setIndex] = useState<number|null>(null);
  const [ready,setReady] = useState(false);
  const [notice,setNotice] = useState('');
  const [missing,setMissing] = useState(false);
  const [placement,setPlacement] = useState<Placement>({hole:null,left:16,top:16,attached:false});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const originalFocus = useRef<HTMLElement|null>(null);
  const originalTab = useRef<HTMLElement|null>(null);
  const initialInputs = useRef('');
  const dirtyInputs = useRef(false);
  const initialized = useRef(false);
  const originalScroll = useRef({x:0,y:0});
  const open = index !== null;
  const step = index !== null && index >= 0 ? tourSteps[index] : null;

  const close = useCallback(() => {
    markVisit('dismissed');
    clearStep(); setIndex(null); setNotice('');
  },[]);
  const finish = useCallback(() => {
    markVisit('completed');
    clearStep(); setIndex(null); setNotice('');
  },[]);

  useEffect(() => {
    const input = (event:Event) => { if (event.target instanceof Element && event.target.matches('.dc-connect input')) dirtyInputs.current=true; };
    const submit = (event:Event) => { if (event.target instanceof Element && event.target.matches('.dc-connect')) dirtyInputs.current=false; };
    document.addEventListener('input',input,true);
    document.addEventListener('submit',submit,true);
    const timer = window.setTimeout(() => {
      if (initialized.current) return;
      initialized.current = true;
      setReady(true);
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        if (saved?.version === 1 && typeof saved.expires === 'number' && saved.expires >= Date.now()) {
          const restored = tourSteps.findIndex(item=>item.id===saved.id);
          if (restored >= 0 && tourSteps[restored].route === tourRoute(location.pathname)) { markVisit('seen'); setIndex(restored); return; }
        }
        clearStep();
      } catch { clearStep(); }
      if (!readVisit()) { markVisit('seen'); setIndex(-1); }
    },0);
    return () => { clearTimeout(timer); document.removeEventListener('input',input,true); document.removeEventListener('submit',submit,true); };
  },[]);

  // Keep the modal isolated from page controls, and restore their prior inert state exactly.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const focus = originalFocus.current ?? trigger;
    originalScroll.current = {x:window.scrollX,y:window.scrollY};
    initialInputs.current = JSON.stringify([...document.querySelectorAll<HTMLInputElement>('.dc-connect input')].map(el=>el.value));
    originalTab.current = document.querySelector<HTMLElement>('main [role="tab"][aria-selected="true"]');
    const previous = new Map<HTMLElement,boolean>();
    const isolate = () => {
      for (const element of Array.from(document.body.children)) {
        if (!(element instanceof HTMLElement) || element.contains(rootRef.current) || previous.has(element)) continue;
        previous.set(element,element.inert); element.inert = true;
      }
    };
    isolate();
    const observer = new MutationObserver(isolate);
    observer.observe(document.body,{childList:true});
    const trap = (event:KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]') ?? [])].filter(el=>el.getClientRects().length);
      const first = controls[0], last = controls[controls.length-1];
      if (!first) { event.preventDefault(); titleRef.current?.focus(); return; }
      if (!cardRef.current?.contains(document.activeElement) || document.activeElement === titleRef.current || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown',trap,true);
    return () => {
      observer.disconnect(); document.removeEventListener('keydown',trap,true);
      for (const [element,inert] of previous) element.inert = inert;
      if (originalTab.current?.isConnected) activateTab(originalTab.current);
      window.scrollTo({...{left:originalScroll.current.x,top:originalScroll.current.y},behavior:'instant'});
      (focus?.isConnected ? focus : trigger)?.focus({preventScroll:true});
      originalFocus.current = null;
    };
  },[open,close]);

  useEffect(() => {
    if (!open) return;
    let frame = 0, scrolled:HTMLElement|null = null, selectedTab:HTMLElement|null = null;
    let settled = false;
    const measure = () => {
      frame = 0;
      if (step?.tab) {
        const tab = visibleElement(step.tab);
        if (tab && tab !== selectedTab) { selectedTab = tab; activateTab(tab); }
      }
      const target = step ? visibleElement(step.target) : null;
      if (target && target !== scrolled) {
        scrolled = target;
        target.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
      }
      const viewport = window.visualViewport;
      const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
      const ox = viewport?.offsetLeft ?? 0, oy = viewport?.offsetTop ?? 0;
      const card = cardRef.current;
      if (!card) return;
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
      let left = ox + Math.max(gap,(vw-cw)/2), top = oy + Math.max(gap,(vh-ch)/2), hole:Box|null = null, attached = false;
      if (target) {
        const r = target.getBoundingClientRect();
        const l = Math.max(ox,r.left-6), t = Math.max(oy,r.top-6);
        const right = Math.min(ox+vw,r.right+6), bottom = Math.min(oy+vh,r.bottom+6);
        if (right>l && bottom>t) hole = {left:l,top:t,width:right-l,height:bottom-t};
        if (vw >= 760 && right + gap + cw <= ox+vw-gap) { left=right+gap; top=Math.max(oy+gap,Math.min(t,oy+vh-ch-gap)); attached=true; }
        else if (vw >= 760 && l-gap-cw >= ox+gap) { left=l-gap-cw; top=Math.max(oy+gap,Math.min(t,oy+vh-ch-gap)); attached=true; }
        else if (bottom+gap+ch <= oy+vh-gap) { top=bottom+gap; left=Math.max(ox+gap,Math.min(l,ox+vw-cw-gap)); attached=true; }
        else if (t-gap-ch >= oy+gap) { top=t-gap-ch; left=Math.max(ox+gap,Math.min(l,ox+vw-cw-gap)); attached=true; }
        else {
          // Keep the entire visible target lit; the card can overlay a large panel.
          left=vw>=760?Math.max(ox+gap,Math.min(right-cw-gap,ox+vw-cw-gap)):ox+Math.max(gap,(vw-cw)/2);
          top=Math.max(oy+gap,Math.min(bottom-ch-gap,oy+vh-ch-gap));
          attached=Boolean(hole);
        }
      }
      const next = {hole,left,top,attached};
      setPlacement(current=>sameBox(current,next)?current:next);
      setMissing(Boolean(step && !target && settled));
    };
    const schedule = () => { if (!frame) frame=requestAnimationFrame(measure); };
    const focusFrame = requestAnimationFrame(()=>{ titleRef.current?.focus({preventScroll:true}); schedule(); });
    const timer = window.setTimeout(()=>{settled=true;schedule();},1200);
    const mutations = new MutationObserver(schedule);
    const main = document.querySelector('main');
    if (main) mutations.observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-state','aria-selected']});
    const sizes = new ResizeObserver(schedule);
    if (cardRef.current) sizes.observe(cardRef.current);
    if (main) sizes.observe(main);
    window.addEventListener('resize',schedule); window.addEventListener('scroll',schedule,true);
    window.visualViewport?.addEventListener('resize',schedule); window.visualViewport?.addEventListener('scroll',schedule);
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); clearTimeout(timer); mutations.disconnect(); sizes.disconnect();
      window.removeEventListener('resize',schedule); window.removeEventListener('scroll',schedule,true);
      window.visualViewport?.removeEventListener('resize',schedule); window.visualViewport?.removeEventListener('scroll',schedule);
    };
  },[open,step]);

  function start() {
    markVisit('seen');
    originalFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    setNotice(''); setIndex(-1); clearStep();
  }
  function move(next:number,event:MouseEvent<HTMLAnchorElement|HTMLButtonElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { event.preventDefault(); setNotice('Use a normal click to continue this guide in the same browser tab.'); return; }
    const route = tourRoute(location.pathname);
    if (tourSteps[next].route !== route) {
      const blocker = routeBlocker(route,initialInputs.current,dirtyInputs.current);
      if (blocker) { event.preventDefault(); setNotice(blocker); return; }
      if (!saveStep(next)) { event.preventDefault(); setNotice('Browser session storage is unavailable. This chapter still works. Close the guide, navigate to another page, and reopen Guide there to continue.'); return; }
      // The anchor performs a full document navigation; Vinext client routing is not used.
      return;
    }
    event.preventDefault(); saveStep(next); setNotice(''); setMissing(false); setIndex(next);
  }
  function navigation(next:number,label:string,className='') {
    return <a className={className} href={tourSteps[next].route} onClick={event=>move(next,event)}>{t(label)}</a>;
  }
  const hole = placement.hole;
  return <>
    <button type="button" className="app-guide" ref={triggerRef} disabled={!ready} onClick={start} aria-haspopup="dialog" aria-expanded={open}><BookOpen size={16} aria-hidden="true"/><span>{t("Guide")}</span></button>
    {open && createPortal(<div className="rtdi-tour" ref={rootRef}>
      <div className="rtdi-tour-shade" aria-hidden="true" style={hole?{left:0,top:0,width:'100%',height:hole.top}:{inset:0}}/>
      {hole && <>
        <div className="rtdi-tour-shade" aria-hidden="true" style={{left:0,top:hole.top,width:hole.left,height:hole.height}}/>
        <div className="rtdi-tour-shade" aria-hidden="true" style={{left:hole.left+hole.width,top:hole.top,right:0,height:hole.height}}/>
        <div className="rtdi-tour-shade" aria-hidden="true" style={{left:0,top:hole.top+hole.height,bottom:0,width:'100%'}}/>
        <div className="rtdi-tour-spotlight" aria-hidden="true" style={hole}/>
      </>}
      <section className="rtdi-tour-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="rtdi-tour-title" aria-describedby="rtdi-tour-description" data-step={step?.id ?? 'chapters'} data-attached={placement.attached} style={{left:placement.left,top:placement.top}}>
        <div className="rtdi-tour-top"><span>{t(step ? step.chapter : 'RTDI product guide')}</span><button type="button" onClick={close} aria-label={t("Close guide")}><X size={20} aria-hidden="true"/></button></div>
        <div className="rtdi-tour-content">
          <h2 id="rtdi-tour-title" tabIndex={-1} ref={titleRef}>{t(step?.title ?? 'Explore the interface')}</h2>
          <p id="rtdi-tour-description">{t(step?.body ?? 'Choose a chapter, or start with Replay analysis and continue through all three pages. The guide never submits model requests or changes your data.')}</p>
          {step?.detail && <p className="rtdi-tour-detail">{t(step.detail)}</p>}
          {!step && <nav aria-label={t("Guide chapters")} className="rtdi-tour-chapters">{chapters.map(chapter=>{
            const first=tourSteps.findIndex(item=>item.route===chapter.route);
            return <a key={chapter.route} href={chapter.route} onClick={event=>move(first,event)}><strong>{t(chapter.name)}<ArrowRight size={16} aria-hidden="true"/></strong><span>{t(chapter.description)}</span></a>;
          })}</nav>}
          {step?.preview && <aside className="rtdi-tour-preview" aria-label={t("Static synthetic tutorial example")}><strong>{t("Static synthetic example · tutorial only")}</strong><span>{t(step.preview.label)}</span><dl>{step.preview.rows.map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{t(value)}</dd></div>)}</dl><p>{t("Not server data. No request is sent.")}</p></aside>}
          {missing && <p className="rtdi-tour-notice" role="status">{t("This target is not available in the current page state. Its panel may be collapsed, or it may need a loaded snapshot or a selected alert. The guide has left your data unchanged; continue to the next step or close it to explore.")}</p>}
          {notice && <p className="rtdi-tour-notice" role="alert">{t(notice)}</p>}
        </div>
        <div className="rtdi-tour-footer">
          {step && index !== null ? <>
            <div className="rtdi-tour-progress"><button type="button" onClick={()=>{clearStep();setIndex(-1);setNotice('');}}>{t("Chapters")}</button><span>{t('Step {0} of {1}',index+1,tourSteps.length)}</span><button type="button" onClick={close}>{t("Skip tour")}</button></div>
            <div className="rtdi-tour-actions">{index>0?navigation(index-1,'Back','rtdi-tour-back'):<button type="button" disabled><ArrowLeft size={16} aria-hidden="true"/>{t("Back")}</button>}{index<tourSteps.length-1?navigation(index+1,tourSteps[index+1].route!==step.route?t('Next: {0}',t(tourSteps[index+1].chapter)):'Next','rtdi-tour-next'):<button type="button" className="rtdi-tour-next" onClick={finish}>{t("Finish")}</button>}</div>
          </>:<><div className="rtdi-tour-actions"><button type="button" onClick={close}>{t("Skip tour")}</button>{navigation(0,'Start tour','rtdi-tour-next')}</div><p>{t("Keyboard: Tab to move between controls. Escape closes the guide.")}</p></>}
        </div>
      </section>
    </div>,document.body)}
  </>;
}
