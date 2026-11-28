'use client';

import {createElement, useEffect, useState, type ReactNode} from 'react';
import {readBatLabPreview,readBatLabStatus,type BatLabStatus,type BatLabState} from '../bat-lab-transport';
import {screens,type ScreenNode} from './screens';

type Lang='fr'|'ar';
type Display={kind:'fixture'}|{kind:'live';state?:BatLabState;url?:string;pending:boolean};
const mapping:Record<BatLabStatus,string>={waiting:'01-attente',review:'02-revue',approved:'04-approuve',refused:'05-refuse',expired:'06-expire',replaced:'07-remplace',locked:'08-verrouille'};
const closed=new Set<BatLabStatus>(['expired','replaced','locked']);
const copy={fr:{refresh:'Actualiser le statut',loading:'Vérification du statut…',readonly:'LAB en lecture seule : validation, refus, renouvellement et fabrication indisponibles.',alt:'Aperçu PNG vérifié du BAT',noPreview:'Aperçu indisponible pour cet état.',fixture:'MAQUETTE STATIQUE — aucune connexion ni action réelle.'},ar:{refresh:'تحديث الحالة',loading:'جارٍ التحقق من الحالة…',readonly:'بيئة اختبار للقراءة فقط: الموافقة والرفض والتجديد والتصنيع غير متاحة.',alt:'معاينة PNG تم التحقق منها',noPreview:'المعاينة غير متاحة في هذه الحالة.',fixture:'نموذج ثابت — لا اتصال ولا إجراء حقيقي.'}};

function renderNode(n:ScreenNode,key:string,lang:Lang,d:Display):ReactNode {
 if(typeof n==='string')return n;
 const a=n.a??{}, cls=typeof a.className==='string'?a.className.split(/\s+/):[];
 const live=d.kind==='live';
 // Never surface a synthetic SVG or fixture case facts in the live surface.
 if(live&&(cls.includes('facts')||cls.includes('statusmeta')||cls.includes('caption')))return null;
 if(live&&Object.hasOwn(a,'data-preview')){
  if(d.state?.status!=='review'||!d.url)return null;
  return <div key={key} className="preview" data-preview="verified"><img className="verified-image" src={d.url} alt={copy[lang].alt} /></div>; // eslint-disable-line @next/next/no-img-element
 }
 if(live&&n.t==='section'&&d.state?.status==='approved'&&n.c?.some(x=>typeof x!=='string'&&Object.hasOwn(x.a??{},'data-preview')))return null;
 if(live&&n.t==='bdi'&&n.c?.every(x=>typeof x==='string')&&/^V\d+$/.test(n.c.join('')))return d.state&&!closed.has(d.state.status)?<bdi key={key}>V{String(d.state.version).padStart(2,'0')}</bdi>:null;
 const props:Record<string,unknown>={...a,key};
 // The live toolbar is the only usable control; remove duplicate status-only CTAs.
 if(live&&n.t==='button'&&d.state&&['waiting','approved','refused'].includes(d.state.status))return null;
 if(n.t==='button'||n.t==='input'||n.t==='textarea'||n.t==='fieldset')props.disabled=true;
 if(live&&d.state?.status==='approved'&&cls.includes('layout'))props.className='layout single';
 const children=n.c?.map((x,i)=>renderNode(x,`${key}-${i}`,lang,d))??[];
 return createElement(n.t,props,...children);
}
const runtimeCopy={
 fr:{title:'Consultation en lecture seule',detail:'Validation, refus, renouvellement et fabrication indisponibles dans le LAB.',footer:'© PANOKIT · Consultation LAB',privacy:'Aucune opération réelle'},
 ar:{title:'عرض للقراءة فقط',detail:'الموافقة والرفض والتجديد والتصنيع غير متاحة في بيئة الاختبار.',footer:'© PANOKIT · عرض تجريبي',privacy:'لا عمليات حقيقية'}
};
function RuntimeToolbar({lang,pending,refresh}:{lang:Lang;pending:boolean;refresh:()=>void}){
 const label=runtimeCopy[lang];
 return <section className="runtime-status" aria-label={label.title} data-testid="j08-runtime-toolbar">
  <div className="runtime-inner">
   <div className="runtime-message">
    <svg className="runtime-lock" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    <div><strong>{label.title}</strong><p>{label.detail}</p></div>
   </div>
   <button type="button" className="button secondary runtime-refresh" aria-disabled={pending} onClick={()=>{if(!pending)refresh();}}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/></svg>{copy[lang].refresh}
   </button>
  </div>
 </section>;
}
function Screen({id,lang,display,runtime}:{id:string;lang:Lang;display:Display;runtime?:ReactNode}){
 const source=screens[`${id}-${lang}`]??screens[`11-invalide-${lang}`];
 return <div className="j08-lab" lang={lang} dir={lang==='ar'?'rtl':'ltr'} data-testid="j08-r2" data-mode={display.kind} data-state={display.kind==='live'?(display.pending?'loading':display.state?.status??'unavailable'):id}>
  {display.kind==='fixture'?source.map((node,i)=>renderNode(node,`${id}-${i}`,lang,display)):<>
   {source.filter(n=>typeof n!=='string'&&n.t==='header').map((n,i)=>renderNode(n,`header-${i}`,lang,display))}
   {runtime}
   {display.pending?<main className="shell runtime-pending" role="status" data-testid="j08-pending"><h1>{copy[lang].loading}</h1></main>:source.filter(n=>typeof n!=='string'&&n.t==='main').map((n,i)=>renderNode(n,`${id}-main-${i}`,lang,display))}
   {display.state?.status==='approved'&&<p className="runtime-preview-note">{copy[lang].noPreview}</p>}
   <footer className="footer"><span>{runtimeCopy[lang].footer}</span><span>{runtimeCopy[lang].privacy}</span></footer>
  </>}
 </div>;
}
/** Explicitly separate fixture review. Never import this component into a public page. */
export function BatR2Fixture({id,lang}:{id:string;lang:Lang}){
 return <><p className="j08-fixture-note" lang={lang} dir={lang==='ar'?'rtl':'ltr'}>{copy[lang].fixture}</p><Screen id={id} lang={lang} display={{kind:'fixture'}}/></>;
}
type Result={generation:number;state?:BatLabState;url?:string};
/** Only the existing authenticated loopback broker can supply live state. No mutation API. */
export function BatR2ReadOnly({lang}:{lang:Lang}){
 const [generation,setGeneration]=useState(0);
 const [result,setResult]=useState<Result|null>(null);
 const [visible,setVisible]=useState(true);
 const refresh=()=>setGeneration(x=>x+1);
 useEffect(()=>{
  const visibility=()=>{setVisible(document.visibilityState==='visible');setGeneration(x=>x+1);};
  const hide=()=>{setVisible(false);setGeneration(x=>x+1);};
  const show=()=>{setVisible(document.visibilityState==='visible');setGeneration(x=>x+1);};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
 },[]);
 useEffect(()=>{
  if(!visible)return;
  const controller=new AbortController();let url:string|undefined;
  const run=async()=>{
   const unavailable=()=>{if(!controller.signal.aborted)setResult({generation});};
   try{
    const first=await readBatLabStatus(controller.signal);
    if(first.status!=='ok')return unavailable();
    if(first.value.status!=='review'){
     if(!controller.signal.aborted)setResult({generation,state:first.value});return;
    }
    const image=await readBatLabPreview(controller.signal);
    if(image.status!=='ok')return unavailable();
    const bitmap=await createImageBitmap(image.value.blob);try{if(bitmap.width<1||bitmap.height<1||bitmap.width>2048||bitmap.height>2048||bitmap.width*bitmap.height>2_000_000)return unavailable();}finally{bitmap.close();}
    const last=await readBatLabStatus(controller.signal);
    if(last.status!=='ok'||controller.signal.aborted)return unavailable();
    if(last.value.version!==first.value.version||last.value.status!=='review'){
     if(last.value.status!=='review')setResult({generation,state:last.value});else unavailable();return;
    }
    url=URL.createObjectURL(image.value.blob);
    if(!controller.signal.aborted)setResult({generation,state:last.value,url});else URL.revokeObjectURL(url);
   }catch{unavailable();}
  };
  // Delay the initial request until React StrictMode's rehearsal cleanup has run.
  const start=window.setTimeout(()=>{void run();},0);
  // Bounded display lifetime; previously delivered pixels cannot be remotely revoked.
  const expiry=window.setTimeout(()=>{setGeneration(x=>x+1);},15000);
  return()=>{controller.abort();window.clearTimeout(start);window.clearTimeout(expiry);if(url)URL.revokeObjectURL(url);};
 },[generation,visible]);
 const current=visible&&result?.generation===generation?result:null;
 const pending=visible&&!current;
 const state=current?.state;
 const id=state?mapping[state.status]:'11-invalide';
 return <Screen id={id} lang={lang} display={{kind:'live',state,url:current?.url,pending}} runtime={<RuntimeToolbar lang={lang} pending={pending} refresh={refresh}/>}/>;
}
