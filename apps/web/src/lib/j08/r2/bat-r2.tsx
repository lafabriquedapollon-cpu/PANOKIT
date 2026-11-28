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
 if(n.t==='button'||n.t==='input'||n.t==='textarea'||n.t==='fieldset')props.disabled=true;
 if(live&&d.state?.status==='approved'&&cls.includes('layout'))props.className='layout single';
 const children=n.c?.map((x,i)=>renderNode(x,`${key}-${i}`,lang,d))??[];
 return createElement(n.t,props,...children);
}
function Screen({id,lang,display}:{id:string;lang:Lang;display:Display}){
 const source=screens[`${id}-${lang}`]??screens[`11-invalide-${lang}`];
 return <div className="j08-lab" lang={lang} dir={lang==='ar'?'rtl':'ltr'} data-testid="j08-r2" data-mode={display.kind} data-state={display.kind==='live'?(display.pending?'loading':display.state?.status??'unavailable'):id}>
  {source.map((node,i)=>renderNode(node,`${id}-${i}`,lang,display))}
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
 return <div className="j08-lab" lang={lang} dir={lang==='ar'?'rtl':'ltr'}>
  {pending?<main className="shell" role="status" data-testid="j08-pending"><h1>{copy[lang].loading}</h1></main>:<Screen id={id} lang={lang} display={{kind:'live',state,url:current?.url,pending:false}}/>}
  <section className="runtime-status"><p className="runtime-note">{copy[lang].readonly}</p>{state?.status==='approved'&&<p className="runtime-note">{copy[lang].noPreview}</p>}<button type="button" className="button secondary runtime-refresh" onClick={refresh}>{copy[lang].refresh}</button></section>
 </div>;
}
