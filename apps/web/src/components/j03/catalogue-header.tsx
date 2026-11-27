import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { catalogueText, type CatalogueLocale } from "@/lib/j03-catalogue";

export function CatalogueHeader({ locale }: { locale: CatalogueLocale }) {
  const t = catalogueText[locale];
  const here = locale === "ar" ? "fr" : "ar";
  const home = locale === "ar" ? "/ar" : "/";
  return (
    <header className="j03-header" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="j03-header__inner">
        <Link href={home} className="j03-logo" aria-label={locale === "ar" ? "PANOKIT — الصفحة الرئيسية" : "PANOKIT — accueil"}>
          <span className="j03-logo__word" dir="ltr">PANOKIT<span className="j03-logo__stroke" /></span>
          <span className="j03-logo__separator" aria-hidden="true" />
          <span className="j03-logo__description">{locale === "ar" ? "اللافتات و" : "SIGNALÉTIQUE &"}<br/> {locale === "ar" ? "التواصل البصري" : "COMMUNICATION VISUELLE"}</span>
        </Link>
        <nav aria-label={t.products} className="j03-header__navigation">
          <Link href={`${home}#familles`}>{t.products}</Link>
          <Link href={`${home}#comment-ca-marche`}>{locale === "ar" ? "كيف يعمل" : "Comment ça marche"}</Link>
        </nav>
        <div className="j03-header__actions">
          <a href={`?lang=${here}`} lang={here} hrefLang={here} className="j03-language" aria-label={here === "ar" ? "اللغة العربية" : "Français"}>
            {here === "ar" ? "العربية" : "FR"}
          </a>
          <Link href={`${home}#devis`} className="j03-quote"><FileText size={17} aria-hidden="true"/> {locale === "ar" ? "طلب عرض سعر" : "Demander un devis"}</Link>
        </div>
      </div>
      <div className="j03-return">
        <Link href={home} className="j03-return__link"><ArrowLeft size={16} aria-hidden="true"/>{t.backHome}</Link>
      </div>
    </header>
  );
}

export function CatalogueFooter({ locale }: { locale: CatalogueLocale }) {
  return <footer className="j03-footer" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><b>PANOKIT</b><span>{catalogueText[locale].legal}</span></footer>;
}
