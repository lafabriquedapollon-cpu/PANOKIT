"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import "./studio.css";
import { splitPreservingText } from "./studio-text";
import PriceReview from "../prix-livraison/price-review";
import type { LabReviewProps } from "../../lab/j07/guest-checkout";

import {Sign,tr,nameNeedsAdaptation,COLOR_PRESETS,TEMPLATES,PALETTE_LABELS,MAX_LOGO_BYTES,type StudioLanguage,type Template,type View,type ColorPreset,type SignColors} from "./studio-renderer";

export default function StudioClient({initialLang="fr",labReview:LabReview}:{initialLang?:StudioLanguage;labReview?:ComponentType<LabReviewProps>}) {
  const [lang,setLang]=useState<StudioLanguage>(initialLang);
  const [review,setReview]=useState(false);
  const openedReview=useRef(false);
  useEffect(()=>{if(!review&&openedReview.current){document.getElementById("studio-price-review")?.focus();}},[review]);
  const t=(key:string)=>tr(lang,key);
  const [name,setName]=useState(""), [activity,setActivity]=useState(""), [phone,setPhone]=useState(""), [slogan,setSlogan]=useState("");
  const [logo,setLogo]=useState<string|null>(null), [logoFileName,setLogoFileName]=useState(""), [logoError,setLogoError]=useState(""), [logoPending,setLogoPending]=useState(false);
  const logoEpoch=useRef(0), fileInput=useRef<HTMLInputElement>(null);
  const [template,setTemplate]=useState<Template>(1), [view,setView]=useState<View>("jour");
  const [paletteId,setPaletteId]=useState<ColorPreset["id"]>("vert");
  const preset=COLOR_PRESETS.find(item=>item.id===paletteId)??COLOR_PRESETS[0];
  const [customColors,setCustomColors]=useState<{board:string;lettering:string;accent:string}|null>(null);
  const colors=customColors??{board:preset.board,lettering:preset.lettering,accent:preset.accent};
  const palette:SignColors={...colors,night:customColors?colors.board:preset.night};
  const data=useMemo(()=>({name,activity,phone,slogan,logo}),[name,activity,phone,slogan,logo]);
  const warning=nameNeedsAdaptation(name);
  useEffect(()=>{
    const root=document.documentElement, oldLang=root.lang, oldDir=root.dir;
    root.lang=lang;root.dir=lang==="ar"?"rtl":"ltr";
    return()=>{root.lang=oldLang;root.dir=oldDir;};
  },[lang]);
  useEffect(()=>()=>{logoEpoch.current+=1},[]);
  function changeLanguage(next:StudioLanguage) {
    setLang(next);
    const url=new URL(window.location.href);url.searchParams.set("lang",next);
    window.history.replaceState(null,"",url);
  }
  function selectPreset(id:ColorPreset["id"]){setPaletteId(id);setCustomColors(null);}
  function updateColor(key:"board"|"lettering"|"accent",value:string){
    if(!/^#[0-9a-fA-F]{6}$/.test(value))return;
    setCustomColors(previous=>({...previous??{board:preset.board,lettering:preset.lettering,accent:preset.accent},[key]:value}));
  }
  function removeLogo(){
    logoEpoch.current+=1;setLogo(null);setLogoFileName("");setLogoError("");setLogoPending(false);
    if(fileInput.current)fileInput.current.value="";
  }
  async function onLogo(file?:File){
    if(!file)return;
    const epoch=++logoEpoch.current;
    setLogoError("");setLogoPending(false);
    const reject=(message:string)=>{if(epoch===logoEpoch.current){setLogoError(message);setLogoPending(false);if(fileInput.current)fileInput.current.value="";}};
    if(!["image/png","image/jpeg"].includes(file.type)||file.size===0||file.size>MAX_LOGO_BYTES){reject("Logo refusé : PNG ou JPEG uniquement, 2 Mo maximum.");return;}
    setLogoPending(true);
    try{
      const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
      const png=bytes.length===8&&[137,80,78,71,13,10,26,10].every((byte,i)=>byte===bytes[i]);
      const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if((file.type==="image/png"&&!png)||(file.type==="image/jpeg"&&!jpeg))throw Error("signature");
      const url=await new Promise<string>((resolve,rejectRead)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):rejectRead(Error("read"));reader.onerror=()=>rejectRead(Error("read"));reader.readAsDataURL(file);});
      const img=new Image();img.src=url;await img.decode();
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>4096||img.naturalHeight>4096)throw Error("size");
      if(epoch!==logoEpoch.current)return;
      setLogo(url);setLogoFileName(file.name);setTemplate(2);setLogoPending(false);
    }catch{reject("Logo invalide ou dimensions excessives ; aucun nouveau logo appliqué.");}
  }
  // No public route, environment flag or URL parameter supplies this component; only the isolated CI harness.
  if(review&&LabReview)return <LabReview configuration={{data,template,view,palette,lang,defaultBoard:paletteId==="vert"&&!customColors}} lang={lang} onLanguage={changeLanguage} onBack={()=>setReview(false)} preview={<Sign data={data} template={template} view={view} palette={palette} lang={lang} defaultBoard={paletteId==="vert"&&!customColors}/>}/>;
  if(review)return <PriceReview lang={lang} onLanguage={changeLanguage} onBack={()=>setReview(false)} preview={<Sign data={data} template={template} view={view} palette={palette} lang={lang} defaultBoard={paletteId==="vert"&&!customColors}/>} name={name} needsAdaptation={warning} />;
  return <main className="studio-page" lang={lang} dir={lang==="ar"?"rtl":"ltr"}>
    <header className="studio-header"><Link href={lang==="ar"?"/ar":"/"} className="brand studio-brand">PANOKIT</Link><div className="nav studio-header-actions"><Link href={"/catalogue/enseignes/lumineuses?lang="+lang} className="back studio-back"><span aria-hidden="true">{lang==="ar"?"→":"←"}</span><span>{t("Catalogue")}</span></Link><div className="lang studio-language" role="group" aria-label="Langue / اللغة"><button type="button" aria-pressed={lang==="fr"} onClick={()=>changeLanguage("fr")}>FR</button><button type="button" aria-pressed={lang==="ar"} onClick={()=>changeLanguage("ar")}>العربية</button></div></div></header>
    <div className="studio-shell"><div className="studio-heading"><p className="eyebrow">{t("CATALOGUE / CAISSON LUMINEUX / STUDIO")}</p><h1>{t("Imaginez votre")} <span>{t("enseigne.")}</span></h1><p className="intro">{t("Composez votre caisson rectangulaire. Aperçu indicatif, formats à confirmer.")}</p></div>
    <div className="layout studio-layout">
      <section className="card identity studio-fields" aria-label={t("Informations de l'enseigne")}><div className="kicker">{t("01 / IDENTITÉ")}</div><h2>{t("Votre identité")}</h2><label htmlFor="studio-name">{t("Nom commercial")} <span aria-hidden="true">*</span></label><textarea className="field" id="studio-name" value={name} onChange={e=>setName(e.target.value)} rows={1} maxLength={240} placeholder={t("Nom exact de votre établissement")} dir="auto" required aria-required="true"/><p className="hint">{t("Seul le nom commercial est obligatoire.")}</p></section>
      <section className="card preview studio-preview" aria-label={t("Prévisualisation")}><div className="previewhead studio-preview-head"><h2>{t("Votre aperçu")}</h2><span className="status">{t("Indicatif · non BAT")}</span></div>
        <div className="tabs studio-views" role="group" aria-label={t("Mode de présentation")}>{(["plat","jour","nuit"] as const).map(v=><button type="button" key={v} className={"tab"+(view===v?" sel":"")} aria-pressed={view===v} onClick={()=>setView(v)}>{t(v==="plat"?"À plat":v==="jour"?"Façade jour":"Façade nuit")}</button>)}</div>
        <div className="scene studio-main-sign-scroll" tabIndex={0} role="region" aria-label={t("Prévisualisation")}><Sign data={data} template={template} view={view} palette={palette} lang={lang} defaultBoard={paletteId==="vert"&&!customColors}/></div>
        <p className="caption studio-caption">{t("Façade illustrative. Éclairage non mesuré ; aucune promesse de fabrication.")}</p>
        {warning&&<><p className="statecallout studio-warning" role="alert">{t("Le nom dépasse la zone recommandée : vérification humaine nécessaire avant tout BAT. Le texte original est conservé dans le champ.")}</p><p className="original studio-original"><b>{t("Nom saisi intégralement :")}</b> <span dir="auto">{name}</span></p></>}
        {!warning&&name.trim()&&<p className="hint studio-original"><b>{t("Nom saisi intégralement :")}</b> <span dir="auto">{name}</span></p>}
        {!warning&&name.trim()&&<p className="hint" role="status">{t("Aperçu indicatif prêt à vérifier.")}</p>}
        {(activity||phone)&&splitPreservingText(name).length!==1&&<p className="hint">{t("Les informations secondaires ne sont pas toutes représentées lorsque le nom occupe la zone disponible.")}</p>}
        {slogan.trim()&&<p className="caption">{t("Slogan enregistré mais non représenté dans cet aperçu :")} <span dir="auto">{slogan}</span></p>}
        <div className="choices"><div className="sub"><h3>{t("Choisissez une composition")}</h3><small>{t("4 modèles")}</small></div><div className="templates studio-templates" role="group" aria-label={t("Choisissez une composition")}>{([1,2,3,4] as const).map(i=><button type="button" key={i} className={"tile studio-template"+(template===i?" selected":"")} aria-pressed={template===i} onClick={()=>setTemplate(i)}><Sign data={data} template={i} view="plat" palette={palette} lang={lang} thumb/><span className="tilelabel">{t(TEMPLATES[i-1][0])}</span><small>{t(TEMPLATES[i-1][1])}</small></button>)}</div></div>
        <fieldset className="palette studio-palette" aria-label={t("Couleur de l'enseigne")}><legend>{t("Ambiance couleur")}</legend><div className="swatches studio-palette-options">{COLOR_PRESETS.map((p,i)=><button key={p.id} type="button" className={"swatch studio-palette-option"+(!customColors&&paletteId===p.id?" selected":"")} aria-pressed={!customColors&&paletteId===p.id} onClick={()=>selectPreset(p.id)}><span className="dot" aria-hidden="true" style={{background:p.board}}/><span>{t(PALETTE_LABELS[i])}</span></button>)}</div></fieldset>
        <details className="assistpanel"><summary>{t("Aide à la composition")}</summary><p>{t("Saisissez le nom exact, comparez les quatre compositions et vérifiez le texte et les couleurs. Toute adaptation nécessite une vérification humaine avant BAT.")}</p><p className="hint">{t("Aide fondée sur des règles, sans modification automatique du nom ou du logo.")}</p></details>
      </section>
      <section className="card options studio-options-panel"><div className="kicker">{t("02 / OPTIONS")}</div><h2>{t("Informations facultatives")}</h2>
        <details id="studio-logo-panel"><summary className="rowline"><span>{t("Ajouter un logo · PNG/JPEG")}</span><span className="plus" aria-hidden="true"/></summary><div className="statepanel"><label htmlFor="studio-logo">{t("Logo facultatif — PNG/JPEG, 2 Mo max.")}</label><input ref={fileInput} id="studio-logo" className="studio-upload-input" type="file" accept="image/png,image/jpeg" onChange={e=>void onLogo(e.target.files?.[0])}/><span className="studio-upload-name" dir="auto" aria-live="polite">{logoFileName||t("Aucun fichier sélectionné")}</span>{logoPending&&<p role="status" className="hint">{t("Vérification du fichier…")}</p>}{logo&&<><button type="button" className="studio-text-button" onClick={removeLogo}>{t("Retirer le logo")}</button><p className="statecallout">{t("Qualité du logo à vérifier avant BAT.")}</p></>}{logoError&&<p role="alert" className="statecallout reject studio-warning">{t(logoError)}</p>}</div></details>
        <details id="studio-info-panel"><summary className="rowline"><span>{t("Activité, téléphone et slogan")}</span><span className="plus" aria-hidden="true"/></summary><div className="statepanel"><label htmlFor="studio-activity">{t("Activité (facultatif)")}</label><input className="field" id="studio-activity" value={activity} onChange={e=>setActivity(e.target.value)} maxLength={80} dir="auto"/><label htmlFor="studio-phone">{t("Téléphone (facultatif)")}</label><input className="field" id="studio-phone" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={40} dir="ltr"/><label htmlFor="studio-slogan">{t("Slogan (facultatif)")}</label><input className="field" id="studio-slogan" value={slogan} onChange={e=>setSlogan(e.target.value)} maxLength={100} dir="auto"/></div></details>
        <details id="studio-colors-panel"><summary className="rowline"><span>{t("Personnaliser les trois couleurs")}</span><span className="plus" aria-hidden="true"/></summary><div className="statepanel colorspec studio-custom-colors">{([["board","Fond de l'enseigne"],["lettering","Lettres"],["accent","Éclairage / accents illustratifs"]] as const).map(([key,label])=><label key={key} htmlFor={"studio-color-"+key}>{t(label)}<span><input id={"studio-color-"+key} type="color" value={colors[key]} onChange={e=>updateColor(key,e.target.value)}/><output>{colors[key].toUpperCase()}</output></span></label>)}{customColors&&<button type="button" className="studio-color-reset" onClick={()=>setCustomColors(null)}>{t("Revenir au modèle ")}{t(preset.label)}</button>}<p className="hint">{t("Personnalisation indicative : teintes, matériaux et éclairage réels à confirmer avec l’atelier avant fabrication.")}</p></div></details>
      </section>
      <section className="card gate studio-gate"><strong>{t("Vérification industrielle requise")}</strong><p className="hint">{t("Formats, prix, devis, commande et export sont indisponibles tant que les données usine ne sont pas homologuées.")}</p><button type="button" disabled aria-label={t("Demander un devis — indisponible")} className="disabled">{t("Devis indisponible")}</button><Link id="studio-price-review" className="studio-price-review-link" href={"/prix-livraison?lang="+lang} onClick={e=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(logoPending)return;openedReview.current=true;setReview(true);}} aria-disabled={logoPending}>{lang==="ar"?"الاطلاع على شروط السعر والتوصيل — دون طلب":"Consulter prix et livraison — sans commande"}</Link></section>
    </div><p className="foot">{t("PANOKIT · Aperçu indicatif · Non BAT")}</p></div>
  </main>;
}
