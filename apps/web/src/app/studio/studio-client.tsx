"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "./studio.css";
import { splitPreservingText } from "./studio-text";

type StudioLanguage = "fr" | "ar";
const STUDIO_AR: Record<string,string> = {
  "Choisir un fichier": "اختيار ملف",
  "Aucun fichier sélectionné": "لم يتم اختيار أي ملف",
  "Impossible de lire ce logo.": "تعذّرت قراءة ملف الشعار.",
  "Logo refusé : PNG ou JPEG uniquement, 2 Mo maximum.": "تم رفض الشعار: يُسمح بصيغتي PNG أو JPEG فقط، وبحجم أقصاه 2 ميغابايت.",
  "← Retour au catalogue": "→ العودة إلى الكتالوج",
  "CATALOGUE / ENSEIGNE LUMINEUSE / STUDIO": "الكتالوج / لافتة مضيئة / الاستوديو",
  "Imaginez votre enseigne.": "صمّم لوحتك الإعلانية",
  "Composez un aperçu indicatif de votre caisson lumineux rectangulaire. Aucun format industriel n’est confirmé.": "صمّم نموذجاً أولياً للوحة إعلانية مضيئة مستطيلة. المقاسات النهائية تخضع لتأكيد المصنع.",
  "Votre identité": "معلومات نشاطك التجاري",
  "Nom commercial": "الاسم التجاري",
  "Activité (facultatif)": "النشاط (اختياري)",
  "Téléphone (facultatif)": "الهاتف (اختياري)",
  "Slogan (facultatif)": "الشعار النصي (اختياري)",
  "Logo facultatif — PNG/JPEG, 2 Mo max.": "الشعار المصوّر اختياري — PNG/JPEG، بحد أقصى 2 ميغابايت",
  "Retirer le logo": "إزالة الشعار",
  "Votre aperçu": "معاينة اللافتة",
  "Aperçu indicatif · non BAT": "معاينة توضيحية · ليست موافقة على التصميم",
  "À plat": "عرض مسطح",
  "Façade jour": "العرض النهاري",
  "Façade nuit": "العرض الليلي",
  "Ambiance couleur": "تنسيق الألوان",
  "Fond de l'enseigne": "خلفية اللافتة",
  "Lettres": "الحروف",
  "Éclairage / accents illustratifs": "الإضاءة / اللمسات التوضيحية",
  "Choisissez une composition": "اختر تنسيقاً",
  "Modèle précédent": "التنسيق السابق",
  "Modèle suivant": "التنسيق التالي",
  "Modèle": "التنسيق",
  "sur 4": "من 4",
  "Vérification industrielle requise": "يلزم التأكد من إمكانية التصنيع",
  "Demander un devis — indisponible": "طلب عرض سعر — غير متاح",
  "Devis indisponible": "عرض السعر غير متاح",
  "Vert profond": "أخضر داكن",
  "Anthracite": "رمادي فحمي",
  "Bleu nuit": "أزرق ليلي",
  "Bordeaux": "خمري",
  "Ivoire": "عاجي",
  "Nom exact de votre établissement": "الاسم الكامل لمؤسستك",
  "Votre nom commercial": "اسم نشاطك التجاري",
  "Nom à adapter": "اسم يحتاج إلى تعديل",
  "Disposition": "التنسيق",
  "Mode de présentation": "طريقة العرض",
  "Couleur de l'enseigne": "لون اللافتة",
  "Personnalisation des trois couleurs": "تخصيص الألوان الثلاثة",
  "Informations de l'enseigne": "معلومات اللافتة",
  "Prévisualisation": "المعاينة",
  "Compositions, défilement horizontal sur mobile": "التنسيقات، مرّر أفقياً على الهاتف",
  "Aperçu agrandi, défilement horizontal": "معاينة مكبرة، مرّر أفقياً",
  "Personnalisation indicative : teintes, matériaux et éclairage réels à confirmer avec l’atelier avant fabrication.": "التخصيص توضيحي فقط: يجب تأكيد الألوان والمواد والإضاءة الفعلية مع الورشة قبل التصنيع.",
  "Aperçu agrandi : faites défiler horizontalement pour examiner les détails.": "معاينة مكبرة: مرّر أفقياً للاطلاع على التفاصيل.",
  "Façade illustrative, luminosité non mesurée. Ni BAT ni promesse de fabrication.": "واجهة توضيحية، شدة الإضاءة غير مقاسة. ليست موافقة على التصميم ولا تعهداً بالتصنيع.",
  "Sur mobile, faites défiler les compositions horizontalement pour voir les 4 modèles.": "على الهاتف، مرّر أفقياً لرؤية التنسيقات الأربعة.",
  "Renseignez votre nom commercial pour comparer les dispositions.": "أدخل اسم نشاطك التجاري لمقارنة التنسيقات.",
  "Le nom dépasse la zone recommandée : vérification humaine nécessaire avant tout BAT. Le texte original est conservé dans le champ.": "يتجاوز الاسم المساحة الموصى بها: يجب التحقق منه يدوياً قبل اعتماد التصميم. سيبقى النص الأصلي محفوظاً في الحقل.",
  "Formats, prix, devis, commande et export sont indisponibles tant que les données usine ne sont pas homologuées.": "المقاسات والأسعار وعروض الأسعار والطلبات والتصدير غير متاحة حتى اعتماد بيانات المصنع.",
  "Nom saisi intégralement :": "الاسم المدخل كاملاً:",
  "Slogan enregistré mais non représenté dans cet aperçu :": "تم حفظ الشعار النصي لكنه لا يظهر في هذه المعاينة:",
  "Revenir au modèle ": "العودة إلى النموذج "
};
function studioTranslate(lang: StudioLanguage, text: string): string { return lang === "ar" ? (STUDIO_AR[text] ?? text) : text; }

type Template = 1 | 2 | 3 | 4;
type View = "plat" | "jour" | "nuit";
type Document = { name: string; activity: string; phone: string; slogan: string; logo: string | null };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Visual simulations only; these combinations do not imply factory availability.
const COLOR_PRESETS = [
  { id: "vert", label: "Vert profond", board: "#204947", night: "#16413e", lettering: "#fff9ef", accent: "#f49b48" },
  { id: "anthracite", label: "Anthracite", board: "#30343b", night: "#20242a", lettering: "#fff9ef", accent: "#e2ad64" },
  { id: "bleu", label: "Bleu nuit", board: "#173b60", night: "#112b46", lettering: "#ffffff", accent: "#e9b35f" },
  { id: "bordeaux", label: "Bordeaux", board: "#682b40", night: "#4c1f30", lettering: "#fff8ed", accent: "#f1bf79" },
  { id: "ivoire", label: "Ivoire", board: "#f4eddf", night: "#d7cfbf", lettering: "#22272a", accent: "#9b4a20" },
] as const;
type ColorPreset = (typeof COLOR_PRESETS)[number];
type SignColors = { board: string; night: string; lettering: string; accent: string };



const EXTRA_AR: Record<string, string> = {
  "Catalogue":"الكتالوج","Imaginez votre":"صمّم","enseigne.":"لوحتك الإعلانية.",
  "Seul le nom commercial est obligatoire.":"الاسم التجاري هو المعلومة الإلزامية الوحيدة.",
  "01 / IDENTITÉ":"٠١ / الهوية","02 / OPTIONS":"٠٢ / الخيارات",
  "Informations facultatives":"معلومات اختيارية","Ajouter un logo · PNG/JPEG":"إضافة شعار · PNG/JPEG",
  "Activité, téléphone et slogan":"النشاط والهاتف والشعار النصي",
  "Personnaliser les trois couleurs":"تخصيص الألوان الثلاثة","Indicatif · non BAT":"توضيحية · غير معتمدة",
  "4 modèles":"٤ تنسيقات","Centrée":"مركزي","Symétrique":"متناظر",
  "Logo à gauche":"شعار على اليسار","Logo facultatif":"الشعار اختياري",
  "Typographique":"نصّي","Accent latéral":"لمسة جانبية","Hiérarchisée":"هرمي","Cadre graphique":"إطار زخرفي",
  "Vert":"أخضر","Bleu":"أزرق","Aide à la composition":"مساعدة في اختيار التنسيق",
  "Saisissez le nom exact, comparez les quatre compositions et vérifiez le texte et les couleurs. Toute adaptation nécessite une vérification humaine avant BAT.":"أدخل الاسم التجاري بدقة، وقارن التنسيقات الأربعة، وتحقق من النص والألوان. يلزم إجراء مراجعة بشرية قبل اعتماد أي تعديل.",
  "Aide fondée sur des règles, sans modification automatique du nom ou du logo.":"مساعدة مبنية على قواعد ثابتة، دون تعديل الاسم أو الشعار تلقائياً.",
  "Qualité du logo à vérifier avant BAT.":"يجب التحقق من جودة الشعار قبل اعتماد التصميم.",
  "Logo invalide ou dimensions excessives ; aucun nouveau logo appliqué.":"ملف شعار غير صالح أو أبعاده كبيرة جداً؛ لم يُضف شعار جديد.",
  "Vérification du fichier…":"جارٍ التحقق من الملف…",
  "Aperçu indicatif prêt à vérifier.":"المعاينة التوضيحية جاهزة للمراجعة.",
  "Les informations secondaires ne sont pas toutes représentées lorsque le nom occupe la zone disponible.":"قد لا تظهر جميع المعلومات الثانوية عندما يشغل الاسم المساحة المتاحة.",
  "PANOKIT · Aperçu indicatif · Non BAT":"PANOKIT · معاينة توضيحية · غير معتمدة",
  "Façade illustrative. Éclairage non mesuré ; aucune promesse de fabrication.":"واجهة توضيحية. شدة الإضاءة غير مقاسة، ولا يوجد تعهد بالتصنيع.",
  "Composez votre caisson rectangulaire. Aperçu indicatif, formats à confirmer.":"صمّم لافتتك المستطيلة. معاينة توضيحية، والمقاسات النهائية تحتاج إلى تأكيد.",
  "CATALOGUE / CAISSON LUMINEUX / STUDIO":"الكتالوج / لافتة مضيئة / الاستوديو",
  "Votre aperçu":"معاينة اللافتة","Couleur de l'enseigne":"لون اللافتة"
};
function tr(lang: StudioLanguage, key: string) { return lang === "ar" ? EXTRA_AR[key] ?? studioTranslate(lang,key) : key; }
const TEMPLATES = [["Centrée","Symétrique"],["Logo à gauche","Logo facultatif"],["Typographique","Accent latéral"],["Hiérarchisée","Cadre graphique"]] as const;
const PALETTE_LABELS = ["Vert","Anthracite","Bleu","Bordeaux","Ivoire"] as const;
const MASTER = {jour:"/studio-v4/STU-ENV-01-master-day.svg",nuit:"/studio-v4/STU-ENV-01-master-night.svg"} as const;
const FRONT = "matrix(1.068650,-0.050615,0,0.967848,100.675,97.449667)";
function nameNeedsAdaptation(name: string) {
  const lines = splitPreservingText(name);
  return lines.length > 3 || lines.some(line => Array.from(line).length > 27);
}
function fit(line: string, desired: number, width: number) {
  return Math.min(desired, width / Math.max(1, Array.from(line).length) / 1.3);
}
function Sign({data,template,view,palette,lang,thumb=false,defaultBoard=false}: {data:Document;template:Template;view:View;palette:SignColors;lang:StudioLanguage;thumb?:boolean;defaultBoard?:boolean}) {
  const facade=view!=="plat"&&!thumb, night=view==="nuit";
  const w=facade?461:thumb?200:730, h=facade?73:thumb?70:246;
  const lines=splitPreservingText(data.name), long=nameNeedsAdaptation(data.name);
  const hasLogo=template===2&&Boolean(data.logo), rtl=/[\u0600-\u06ff]/u.test(data.name);
  const center=template!==3||rtl, x=hasLogo?w*.64:center?w/2:w*.12;
  const available=hasLogo?w*.59:template===3?w*.73:w*.82;
  const textLines=long?[tr(lang,"Nom à adapter")]:lines.length?lines:[tr(lang,"Votre nom commercial")];
  const desired=facade?(textLines.length===1?39:textLines.length===2?23:16):thumb?(textLines.length===1?16:textLines.length===2?12:9):(textLines.length===1?51:textLines.length===2?41:32);
  const maxSize=hasLogo?desired*.78:desired;
  const size=Math.min(...textLines.map(line=>fit(line,maxSize,available)), h/(textLines.length+1.4));
  const step=size*1.16, secondary=!thumb&&!long&&lines.length===1;
  const showActivity=secondary&&!!data.activity.trim(), showPhone=secondary&&!facade&&!!data.phone.trim();
  const y=h*.5-(textLines.length-1)*step/2+(showActivity?-size*.12:size*.29);
  const content=(
    <g data-studio-content="true" data-width={w} data-height={h}>
      {template===1&&<><path d={'M'+(w*.37)+' '+(h*.79)+'Q'+w*.5+' '+h*.72+' '+w*.63+' '+h*.79} fill="none" stroke={palette.accent} strokeWidth={thumb?2.2:facade?3:5} strokeLinecap="round"/>{!facade&&<path d={'M'+w*.5+' '+h*.15+'V'+h*.24} stroke={palette.accent} strokeWidth={thumb?2.2:4}/>}</>}
      {template===2&&<><path d={hasLogo?'M'+w*.305+' '+h*.17+'V'+h*.83:'M'+w*.34+' '+h*.79+'H'+w*.66} stroke={palette.accent} strokeWidth={thumb?2:facade?2.2:4}/>{hasLogo&&<><rect x={w*.045} y={h*.14} width={w*.22} height={h*.72} rx={thumb?3:4} fill="#fff9ef"/><image data-studio-logo="true" href={data.logo!} x={w*.055} y={h*.19} width={w*.20} height={h*.62} preserveAspectRatio="xMidYMid meet"/></>}</>}
      {template===3&&<path d={'M'+w*.07+' '+h*.2+'V'+h*.82+'M'+w*.095+' '+h*.24+'V'+h*.77} stroke={palette.accent} strokeWidth={thumb?2:facade?2.2:5}/>}
      {template===4&&<path d={'M'+w*.11+' '+h*.18+'H'+w*.89+'M'+w*.11+' '+h*.18+'V'+h*.31+'M'+w*.89+' '+h*.18+'V'+h*.31+'M'+w*.2+' '+h*.83+'H'+w*.8+'M'+w*.2+' '+h*.69+'V'+h*.83+'M'+w*.8+' '+h*.69+'V'+h*.83} stroke={palette.accent} strokeWidth={thumb?1.4:facade?1.5:3} fill="none"/>}
      {textLines.map((line,i)=><text key={i} data-studio-name={long?"adapt":lines.length?"line":"placeholder"} x={x} y={y+i*step} textAnchor={center||hasLogo?"middle":"start"} direction={/[\u0600-\u06ff]/u.test(line)?"rtl":"ltr"} unicodeBidi="plaintext" fontFamily="Arial, Noto Sans Arabic, sans-serif" fontSize={size} fontWeight="700" fill={palette.lettering}>{line}</text>)}
      {showActivity&&<text data-studio-secondary="activity" x={x} y={h*.67} textAnchor="middle" direction={/[\u0600-\u06ff]/u.test(data.activity)?"rtl":"ltr"} fontSize={fit(data.activity,facade?11:18,available)} fill={palette.lettering}>{data.activity}</text>}
      {showPhone&&<text data-studio-secondary="phone" x={x} y={h*.91} textAnchor="middle" direction="ltr" fontSize={fit(data.phone,15,available)} fill={palette.lettering}>{data.phone}</text>}
      {long&&<rect x="2" y="2" width={w-4} height={h-4} rx="3" fill="none" stroke="#ffcf65" strokeWidth={thumb?1.5:2} strokeDasharray="7 4"/>}
    </g>
  );
  const label=lang==="ar"?"معاينة توضيحية، غير معتمدة":"Aperçu indicatif, non BAT";
  return <svg className="studio-sign" viewBox={thumb?"0 0 200 70":"0 0 880 430"} role="img" aria-label={label+" — "+tr(lang,TEMPLATES[template-1][0])+": "+data.name}>
    {facade?<><image data-studio-master="true" href={MASTER[view as "jour"|"nuit"]} width="880" height="430"/>{!defaultBoard&&<polygon data-studio-board="true" points="120.98,139.88 613.63,103.34 613.63,186.33 120.98,198.15" fill={night?palette.night:palette.board}/>}<g transform={FRONT}><g transform="translate(19 38)">{content}</g></g></>:thumb?<><rect width="200" height="70" rx="3" fill={palette.board}/>{content}</>:<><rect width="880" height="430" fill="#faf7f0"/><rect x="75" y="92" width="730" height="246" rx="4" fill={palette.board} stroke="#55534b" strokeWidth="3"/><rect x="83" y="100" width="714" height="230" fill="none" stroke="#cba775"/><g transform="translate(75 92)">{content}</g></>}
    <title>{label}</title>
  </svg>;
}

export default function StudioClient({initialLang="fr"}:{initialLang?:StudioLanguage}) {
  const [lang,setLang]=useState<StudioLanguage>(initialLang);
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
      <section className="card gate studio-gate"><strong>{t("Vérification industrielle requise")}</strong><p className="hint">{t("Formats, prix, devis, commande et export sont indisponibles tant que les données usine ne sont pas homologuées.")}</p><button type="button" disabled aria-label={t("Demander un devis — indisponible")} className="disabled">{t("Devis indisponible")}</button></section>
    </div><p className="foot">{t("PANOKIT · Aperçu indicatif · Non BAT")}</p></div>
  </main>;
}
