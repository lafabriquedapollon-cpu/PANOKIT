import { splitPreservingText } from "./studio-text";

export type StudioLanguage = "fr" | "ar";
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

export type Template = 1 | 2 | 3 | 4;
export type View = "plat" | "jour" | "nuit";
export type Document = { name: string; activity: string; phone: string; slogan: string; logo: string | null };
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Visual simulations only; these combinations do not imply factory availability.
export const COLOR_PRESETS = [
  { id: "vert", label: "Vert profond", board: "#204947", night: "#16413e", lettering: "#fff9ef", accent: "#f49b48" },
  { id: "anthracite", label: "Anthracite", board: "#30343b", night: "#20242a", lettering: "#fff9ef", accent: "#e2ad64" },
  { id: "bleu", label: "Bleu nuit", board: "#173b60", night: "#112b46", lettering: "#ffffff", accent: "#e9b35f" },
  { id: "bordeaux", label: "Bordeaux", board: "#682b40", night: "#4c1f30", lettering: "#fff8ed", accent: "#f1bf79" },
  { id: "ivoire", label: "Ivoire", board: "#f4eddf", night: "#d7cfbf", lettering: "#22272a", accent: "#9b4a20" },
] as const;
export type ColorPreset = (typeof COLOR_PRESETS)[number];
export type SignColors = { board: string; night: string; lettering: string; accent: string };



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
export function tr(lang: StudioLanguage, key: string) { return lang === "ar" ? EXTRA_AR[key] ?? studioTranslate(lang,key) : key; }
export const TEMPLATES = [["Centrée","Symétrique"],["Logo à gauche","Logo facultatif"],["Typographique","Accent latéral"],["Hiérarchisée","Cadre graphique"]] as const;
export const PALETTE_LABELS = ["Vert","Anthracite","Bleu","Bordeaux","Ivoire"] as const;
const MASTER = {jour:"/studio-v4/STU-ENV-01-master-day.svg",nuit:"/studio-v4/STU-ENV-01-master-night.svg"} as const;
const FRONT = "matrix(1.068650,-0.050615,0,0.967848,100.675,97.449667)";
export function nameNeedsAdaptation(name: string) {
  const lines = splitPreservingText(name);
  return lines.length > 3 || lines.some(line => Array.from(line).length > 27);
}
function fit(line: string, desired: number, width: number) {
  return Math.min(desired, width / Math.max(1, Array.from(line).length) / 1.3);
}
export function Sign({data,template,view,palette,lang,thumb=false,defaultBoard=false,masterHref}: {data:Document;template:Template;view:View;palette:SignColors;lang:StudioLanguage;thumb?:boolean;defaultBoard?:boolean;masterHref?:string}) {
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
    {facade?<><image data-studio-master="true" href={masterHref??MASTER[view as "jour"|"nuit"]} width="880" height="430"/>{!defaultBoard&&<polygon data-studio-board="true" points="120.98,139.88 613.63,103.34 613.63,186.33 120.98,198.15" fill={night?palette.night:palette.board}/>}<g transform={FRONT}><g transform="translate(19 38)">{content}</g></g></>:thumb?<><rect width="200" height="70" rx="3" fill={palette.board}/>{content}</>:<><rect width="880" height="430" fill="#faf7f0"/><rect x="75" y="92" width="730" height="246" rx="4" fill={palette.board} stroke="#55534b" strokeWidth="3"/><rect x="83" y="100" width="714" height="230" fill="none" stroke="#cba775"/><g transform="translate(75 92)">{content}</g></>}
    <title>{label}</title>
  </svg>;
}

