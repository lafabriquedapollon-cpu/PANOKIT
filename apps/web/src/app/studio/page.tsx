"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import "./studio.css";
import { splitPreservingText } from "./studio-text";

type StudioLanguage = "fr" | "ar";
const STUDIO_AR: Record<string,string> = {
  "Choisir un fichier": "اختيار ملف",
  "Aucun fichier sélectionné": "لم يتم اختيار أي ملف",
  "Impossible de lire ce logo.": "تعذّرت قراءة ملف الشعار.",
  "Logo refusé : PNG ou JPEG uniquement, 2 Mo maximum.": "تم رفض الشعار: يُسمح بصيغتي PNG أو JPEG فقط، وبحجم أقصاه 2 ميغابايت.",
  "← Retour au catalogue": "← العودة إلى الكتالوج",
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
  { id: "vert", label: "Vert profond", board: "#184843", night: "#15363a", lettering: "#fff9ef", accent: "#f46b0a" },
  { id: "anthracite", label: "Anthracite", board: "#30343b", night: "#20242a", lettering: "#fff9ef", accent: "#e2ad64" },
  { id: "bleu", label: "Bleu nuit", board: "#173b60", night: "#112b46", lettering: "#ffffff", accent: "#e9b35f" },
  { id: "bordeaux", label: "Bordeaux", board: "#682b40", night: "#4c1f30", lettering: "#fff8ed", accent: "#f1bf79" },
  { id: "ivoire", label: "Ivoire", board: "#f4eddf", night: "#d7cfbf", lettering: "#22272a", accent: "#9b4a20" },
] as const;
type ColorPreset = (typeof COLOR_PRESETS)[number];
type SignColors = { board: string; night: string; lettering: string; accent: string };


function Sign({ data, template, view, palette, lang = "fr" }: { data: Document; template: Template; view: View; palette: SignColors; lang?: StudioLanguage }) {
  const lines = splitPreservingText(data.name);
  const long = lines.length > 3 || lines.some((line) => Array.from(line).length > 27);
  const isRtl = /[\u0600-\u06ff]/u.test(data.name);
  const hasLogo = Boolean(data.logo);
  const mainX = template === 2 && hasLogo ? 555 : 420;
  const center = template !== 3 || isRtl;
  const visibleLines = long ? [] : lines;
  const titleY = visibleLines.length === 1 ? 158 : visibleLines.length === 2 ? 137 : 111;
  const titleSize = lines.length > 2 ? 29 : lines.length > 1 ? 35 : 43;
  const night = view === "nuit";
  const board = night ? palette.night : palette.board;
  return (
    <svg viewBox="0 0 840 300" role="img" aria-label={lang === "ar" ? `معاينة توضيحية، ${view === "plat" ? "عرض مسطح" : view === "jour" ? "واجهة نهارية" : "واجهة ليلية"}، التنسيق ${template}: ${data.name || "لم يُدخل الاسم"}` : `Aperçu indicatif ${view}, disposition ${template} : ${data.name || "nom non renseigné"}`} className="studio-sign">
      <rect width="840" height="300" fill={view === "plat" ? "#f8f6f1" : night ? "#202c32" : "#e9e1d5"} />
      {view !== "plat" && <><path d="M0 255 840 235V300H0Z" fill={night ? "#303a3e" : "#d8cbbd"} /><path d="M20 55 150 20H810V247H20Z" fill={night ? "#344148" : "#d1c6b8"} /><path d="M20 55 150 20H810" fill="none" stroke={night ? "#748186" : "#afa295"} strokeWidth="3" /></>}
      <rect x="25" y="42" width="790" height="215" rx="7" fill={board} stroke={night ? "#f7aa54" : "#d7a477"} strokeWidth="5" />
      {night && <rect x="31" y="48" width="778" height="203" rx="3" fill="none" stroke="#ffe8bb" strokeWidth="2" opacity=".75" />}
      {template === 1 && <><path d="M230 215H610" stroke={palette.accent} strokeWidth="5" strokeLinecap="round" /><path d="M420 70V95" stroke={palette.accent} strokeWidth="4" /></>}
      {template === 3 && <><path d="M76 83V219" stroke={palette.accent} strokeWidth="7" /><rect x="88" y="90" width="5" height="120" fill={palette.accent} opacity=".35" /></>}
      {template === 4 && <><path d="M120 72H720" stroke={palette.accent} strokeWidth="3" /><path d="M170 225H670" stroke={palette.accent} strokeWidth="2" opacity=".8" /><path d="M120 72V102M720 72V102M170 195V225M670 195V225" stroke={palette.accent} strokeWidth="3" /></>}
      {template === 2 && hasLogo && <><rect x="75" y="75" width="180" height="150" rx="6" fill={palette.night} stroke={palette.accent} strokeWidth="2" /><path d="M268 86V214" stroke={palette.accent} strokeWidth="4" /></>}{template === 2 && !hasLogo && <rect x="325" y="210" width="190" height="5" rx="2" fill={palette.accent} />}{template === 2 && hasLogo && <><rect x="109" y="99" width="112" height="112" rx="10" fill="#fff" /><image href={data.logo!} x="115" y="105" width="100" height="100" preserveAspectRatio="xMidYMid meet" /></>}
      {long ? <text data-studio-name="adapt" x={mainX} y="154" textAnchor="middle" fontSize={template === 2 && hasLogo ? 25 : 30} fill={palette.lettering}>{studioTranslate(lang, "Nom à adapter")}</text> : lines.length === 0 ? <text x="420" y="154" textAnchor="middle" fontSize="30" fill={palette.lettering}>{lang === "ar" ? "اسم نشاطك التجاري" : "Votre nom commercial"}</text> : (
        <g direction={isRtl ? "rtl" : "ltr"} lang={isRtl ? "ar" : "fr"}>
          {visibleLines.map((line, index) => <text data-studio-name="line" key={index} x={template === 3 && !isRtl ? 105 : mainX} y={titleY + index * 39} textAnchor={center ? "middle" : "start"} fontSize={template === 2 && hasLogo ? Math.min(titleSize, 27) : titleSize} fontWeight={isRtl ? "700" : "800"} fontFamily={isRtl ? "Arial, Noto Sans, DejaVu Sans, sans-serif" : "Arial, Helvetica, sans-serif"} fill={palette.lettering} direction={/[\u0600-\u06ff]/u.test(line) ? "rtl" : "ltr"} unicodeBidi="plaintext">{line}</text>)}
        </g>
      )}
      {lines.length <= 2 && data.activity && <text x="420" y="208" fontSize="17" fill={palette.lettering} textAnchor="middle">{data.activity.slice(0, 58)}</text>}
      {lines.length <= 1 && data.phone && <text x="420" y="233" fontSize="15" fill={palette.lettering} textAnchor="middle">{data.phone.slice(0, 30)}</text>}
      {long && <rect x="25" y="42" width="790" height="215" rx="7" fill="none" stroke="#ffcf65" strokeWidth="5" strokeDasharray="10 6" />}
      <title>{lang === "ar" ? (long ? "النص طويل جداً: التحقق قبل اعتماد التصميم إلزامي" : "معاينة توضيحية، وليست تصميماً معتمداً") : (long ? "Texte trop long : vérification obligatoire" : "Aperçu indicatif non BAT")}</title>
    </svg>
  );
}

export default function StudioPage() {
  const [lang, setLang] = useState<StudioLanguage>("fr");
  const t = (text: string) => studioTranslate(lang, text);
  const [name, setName] = useState("");
  const [activity, setActivity] = useState("");
  const [phone, setPhone] = useState("");
  const [slogan, setSlogan] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [template, setTemplate] = useState<Template>(1);
  const [view, setView] = useState<View>("plat");
  const [paletteId, setPaletteId] = useState<ColorPreset["id"]>("vert");
  const preset = COLOR_PRESETS.find((item) => item.id === paletteId) ?? COLOR_PRESETS[0];
  const [customColors, setCustomColors] = useState<{ board: string; lettering: string; accent: string } | null>(null);
  const colors = customColors ?? { board: preset.board, lettering: preset.lettering, accent: preset.accent };
  const palette: SignColors = { ...colors, night: customColors ? colors.board : preset.night };
  function selectPreset(id: ColorPreset["id"]) { setPaletteId(id); setCustomColors(null); }
  function updateColor(key: "board" | "lettering" | "accent", value: string) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    setCustomColors((previous) => ({ ...(previous ?? { board: preset.board, lettering: preset.lettering, accent: preset.accent }), [key]: value }));
  }
  const data = useMemo(() => ({ name, activity, phone, slogan, logo }), [name, activity, phone, slogan, logo]);
  const lines = splitPreservingText(name);
  const warning = lines.length > 3 || lines.some((line) => Array.from(line).length > 27);
  function onLogo(file?: File) {
    setLogoError("");
    if (!file) return;
    setLogoFileName("");
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setLogoError(t("Logo refusé : PNG ou JPEG uniquement, 2 Mo maximum."));
      return;
    }
    setLogoFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setLogo(reader.result); };
    reader.onerror = () => setLogoError(t("Impossible de lire ce logo."));
    reader.readAsDataURL(file);
  }
  return (
    <main className="studio-page" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <header className="studio-header"><Link href={lang === "ar" ? "/ar" : "/"} className="studio-brand">PANOKIT<span className="studio-stroke" /></Link><div className="studio-header-actions"><div className="studio-language" role="group" aria-label="Langue / اللغة"><button type="button" aria-pressed={lang === "fr"} onClick={() => setLang("fr")}>FR</button><button type="button" aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>العربية</button></div><Link href={`/catalogue/enseignes/lumineuses?lang=${lang}`} className="studio-back">{t("← Retour au catalogue")}</Link></div></header>
      <div className="studio-shell">
        <div className="studio-heading"><p>{t("CATALOGUE / ENSEIGNE LUMINEUSE / STUDIO")}</p><h1>{t("Imaginez votre enseigne.")}</h1><p>{t("Composez un aperçu indicatif de votre caisson lumineux rectangulaire. Aucun format industriel n’est confirmé.")}</p></div>
        <div className="studio-layout">
          <section className="studio-panel studio-fields" aria-label={t("Informations de l'enseigne")}>
            <h2>{t("Votre identité")}</h2>
            <label htmlFor="studio-name">{t("Nom commercial")} <span aria-hidden="true">*</span></label>
            <textarea id="studio-name" value={name} onChange={(e) => setName(e.target.value)} rows={3} maxLength={240} placeholder={t("Nom exact de votre établissement")} dir="auto" />
            <label htmlFor="studio-activity">{t("Activité (facultatif)")}</label>
            <input id="studio-activity" value={activity} onChange={(e) => setActivity(e.target.value)} maxLength={80} dir="auto" />
            <label htmlFor="studio-phone">{t("Téléphone (facultatif)")}</label>
            <input id="studio-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} dir="ltr" />
            <label htmlFor="studio-slogan">{t("Slogan (facultatif)")}</label>
            <input id="studio-slogan" value={slogan} onChange={(e) => setSlogan(e.target.value)} maxLength={100} dir="auto" />
            <label htmlFor="studio-logo">{t("Logo facultatif — PNG/JPEG, 2 Mo max.")}</label>
            <div className="studio-upload"><input id="studio-logo" className="studio-upload-input" type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} /><label htmlFor="studio-logo" className="studio-upload-button">{t("Choisir un fichier")}</label><span className="studio-upload-name" dir="auto" aria-live="polite">{logoFileName || t("Aucun fichier sélectionné")}</span></div>
            {logo && <button type="button" className="studio-text-button" onClick={() => { setLogo(null); setLogoFileName(""); const input = document.getElementById("studio-logo") as HTMLInputElement | null; if (input) input.value = ""; }}>{t("Retirer le logo")}</button>}
            {logoError && <p role="alert" className="studio-warning">{logoError}</p>}
          </section>
          <section className="studio-preview" aria-label={t("Prévisualisation")}>
            <div className="studio-preview-head"><h2>{t("Votre aperçu")}</h2><span>{t("Aperçu indicatif · non BAT")}</span></div>
            <div className="studio-views" role="group" aria-label={t("Mode de présentation")}>{(["plat","jour","nuit"] as const).map((v) => <button type="button" aria-pressed={view === v} key={v} onClick={() => setView(v)}>{t(v === "plat" ? "À plat" : v === "jour" ? "Façade jour" : "Façade nuit")}</button>)}</div>
            <p className="studio-zoom-hint">{t("Aperçu agrandi : faites défiler horizontalement pour examiner les détails.")}</p>
            <div className="studio-main-sign-scroll" tabIndex={0} role="region" aria-label={t("Aperçu agrandi, défilement horizontal")}><Sign data={data} template={template} view={view} palette={palette} lang={lang} /></div>
            <p className="studio-caption">{t("Façade illustrative, luminosité non mesurée. Ni BAT ni promesse de fabrication.")}</p>
            <fieldset className="studio-palette" aria-label={t("Couleur de l'enseigne")}><legend>{t("Ambiance couleur")}</legend><div className="studio-palette-options">{COLOR_PRESETS.map((option) => <button key={option.id} type="button" aria-pressed={!customColors && paletteId === option.id} onClick={() => selectPreset(option.id)} className="studio-palette-option"><span className="studio-palette-swatch" style={{ background: option.board, color: option.lettering, borderColor: option.accent }} aria-hidden="true">Aa</span><span>{t(option.label)}</span></button>)}</div><div className="studio-custom-colors" role="group" aria-label={t("Personnalisation des trois couleurs")}>{([
              ["board", "Fond de l'enseigne"],
              ["lettering", "Lettres"],
              ["accent", "Éclairage / accents illustratifs"],
            ] as const).map(([key, label]) => <label key={key} htmlFor={`studio-color-${key}`}><span>{t(label)}</span><span className="studio-color-control"><input id={`studio-color-${key}`} type="color" value={colors[key]} onChange={(event) => updateColor(key, event.target.value)} /><output>{colors[key].toUpperCase()}</output></span></label>)}</div>{customColors && <button type="button" className="studio-color-reset" onClick={() => setCustomColors(null)}>{t("Revenir au modèle ")}{t(preset.label)}</button>}<p>{t("Personnalisation indicative : teintes, matériaux et éclairage réels à confirmer avec l’atelier avant fabrication.")}</p></fieldset>
            {name.trim() && <p className="studio-original"><strong>{t("Nom saisi intégralement :")}</strong> <span dir="auto">{name}</span></p>}
            {slogan.trim() && <p className="studio-caption">{t("Slogan enregistré mais non représenté dans cet aperçu :")} <span dir="auto">{slogan}</span></p>}
            <h2>{t("Choisissez une composition")}</h2>
            <div className="studio-gallery-navigation"><p className="studio-gallery-hint">{t("Sur mobile, faites défiler les compositions horizontalement pour voir les 4 modèles.")}</p><div className="studio-gallery-controls"><button type="button" aria-label={t("Modèle précédent")} disabled={template === 1} onClick={() => { const next = (template - 1) as Template; setTemplate(next); document.querySelectorAll(".studio-template")[next - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }); }}>‹</button><span aria-live="polite">{t("Modèle")} {template} {t("sur 4")}</span><button type="button" aria-label={t("Modèle suivant")} disabled={template === 4} onClick={() => { const next = (template + 1) as Template; setTemplate(next); document.querySelectorAll(".studio-template")[next - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }); }}>›</button></div></div><div className="studio-templates" aria-label={t("Compositions, défilement horizontal sur mobile")}>{([1,2,3,4] as const).map((templateIndex) => <button type="button" key={templateIndex} aria-pressed={template === templateIndex} onClick={() => setTemplate(templateIndex)} className="studio-template"><Sign data={data} template={templateIndex} view="plat" palette={palette} lang={lang} /><span>{studioTranslate(lang, "Disposition")} {String(templateIndex).padStart(2,"0")}</span></button>)}</div>
            {!name.trim() && <p role="status" className="studio-info">{t("Renseignez votre nom commercial pour comparer les dispositions.")}</p>}
            {warning && <p role="alert" className="studio-warning">{t("Le nom dépasse la zone recommandée : vérification humaine nécessaire avant tout BAT. Le texte original est conservé dans le champ.")}</p>}
            <div className="studio-gate"><strong>{t("Vérification industrielle requise")}</strong><p>{t("Formats, prix, devis, commande et export sont indisponibles tant que les données usine ne sont pas homologuées.")}</p><button type="button" disabled aria-label={t("Demander un devis — indisponible")}><span className="studio-devis-long">{t("Demander un devis — indisponible")}</span><span className="studio-devis-short" aria-hidden="true">{t("Devis indisponible")}</span></button></div>
          </section>
        </div>
      </div>
    </main>
  );
}
