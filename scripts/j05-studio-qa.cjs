const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");

(async () => {
  fs.mkdirSync("studio-qa", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const width of [320, 375, 390, 414, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("http://127.0.0.1:3000/studio", { waitUntil: "domcontentloaded", timeout: 30000 });
      assert.equal(await page.locator("h1").innerText(), "Imaginez votre enseigne.");
      if (width === 390) {
        await page.getByRole("button", { name: "العربية" }).click();
        assert.equal(await page.locator("main.studio-page").getAttribute("dir"), "rtl", "Arabic mode must enable RTL");
        assert.equal(await page.locator("main.studio-page").getAttribute("lang"), "ar", "Arabic mode must set language");
        assert.equal(await page.locator("h1").innerText(), "صمّم لوحتك الإعلانية", "Arabic heading must be translated");
        assert.equal(await page.locator(".studio-heading > p").last().innerText(), "صمّم نموذجاً أولياً للوحة إعلانية مضيئة مستطيلة. المقاسات النهائية تخضع لتأكيد المصنع.", "human-approved Arabic introduction");
        assert.equal(await page.locator(".studio-fields h2").innerText(), "معلومات نشاطك التجاري", "human-approved Arabic identity label");
        assert.equal(await page.locator(".studio-views button").nth(1).innerText(), "العرض النهاري", "human-approved day mode");
        assert.equal(await page.locator(".studio-views button").nth(2).innerText(), "العرض الليلي", "human-approved night mode");
        assert.equal(await page.locator(".studio-palette legend").innerText(), "تنسيق الألوان", "human-approved palette label");
        assert.equal(await page.locator(".studio-upload-button").innerText(), "اختيار ملف", "Arabic upload button must be localized");
        assert.equal(await page.locator(".studio-upload-name").innerText(), "لم يتم اختيار أي ملف", "Arabic empty file status must be localized");
        assert.equal(await page.locator("#studio-logo").getAttribute("type"), "file", "native file input must remain accessible");
        await page.locator("#studio-logo").setInputFiles({ name: "test-logo.png", mimeType: "image/png", buffer: Buffer.from("not-a-valid-image") });
        assert.equal(await page.locator(".studio-upload-name").innerText(), "test-logo.png", "selected filename must be displayed");
        await page.getByRole("button", { name: "إزالة الشعار" }).click();
        assert.equal(await page.locator(".studio-upload-name").innerText(), "لم يتم اختيار أي ملف", "remove logo resets selected file state");

        assert.match(await page.locator(".studio-main-sign-scroll > .studio-sign").getAttribute("aria-label"), /معاينة توضيحية/, "SVG accessible description must be Arabic");
        assert.match(await page.locator(".studio-main-sign-scroll > .studio-sign title").textContent(), /معاينة توضيحية/, "SVG title must be Arabic");
        assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign text").first().textContent(), "اسم نشاطك التجاري", "empty SVG placeholder must be Arabic");
        assert.equal(await page.getByText("يلزم التأكد من إمكانية التصنيع").count(), 1, "industrial gate must be localized");
        await page.locator("#studio-name").fill("عيادة طب الأسنان");
        assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign text").first().getAttribute("direction"), "rtl");
        await page.screenshot({ path: "studio-qa/studio-ui-ar-390.png", fullPage: true });
        await page.getByRole("button", { name: "FR", exact: true }).click();
        assert.equal(await page.locator("main.studio-page").getAttribute("dir"), "ltr", "French mode must restore LTR");
        assert.equal(await page.locator("h1").innerText(), "Imaginez votre enseigne.");
        assert.equal(await page.locator("#studio-name").inputValue(), "عيادة طب الأسنان", "language switch must preserve user data");
      }
      await page.locator("#studio-name").fill("CABINET DENTAIRE PANOKIT");
      await page.locator(".studio-template").nth(1).click();
      await page.getByRole("button", { name: "Façade nuit" }).click();
      assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign").count(), 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const mobileSign = await page.locator(".studio-main-sign-scroll").evaluate(el => ({
        clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
        svgWidth: el.querySelector("svg").getBoundingClientRect().width,
        hintVisible: getComputedStyle(document.querySelector(".studio-zoom-hint")).display !== "none"
      }));
      if (width <= 414) {
        assert.ok(mobileSign.scrollWidth <= mobileSign.clientWidth + 1, "entire sign must fit by default at " + width + "px");
        assert.equal(mobileSign.hintVisible, false, "normal mobile must not show zoom-only scroll hint at " + width + "px");
      }
      await page.screenshot({ path: "studio-qa/studio-" + width + ".png", fullPage: true });
      report.push({ width, overflow, errors, mobileSign });
      if (overflow) {
        const offenders = await page.evaluate(() => [...document.querySelectorAll("*")].map(el => ({tag:el.tagName,cls:typeof el.className === "string" ? el.className : "",x:Math.round(el.getBoundingClientRect().right),w:Math.round(el.getBoundingClientRect().width)})).filter(el=>el.x>innerWidth+1).slice(0,20));
        console.log("OVERFLOW DIAGNOSTIC", width, JSON.stringify(offenders));
      }
      assert.equal(overflow, false, "horizontal overflow at " + width);
      assert.deepEqual(errors, [], "JS errors at " + width);
      if (width === 390) {
        await page.locator("#studio-name").fill("عيادة طب الأسنان وتقويم الأسنان");
        const arabicTitle = page.locator(".studio-main-sign-scroll > .studio-sign text").first();
        assert.equal(await arabicTitle.getAttribute("direction"), "rtl", "Arabic SVG title must be RTL");
        assert.equal(await arabicTitle.getAttribute("unicode-bidi"), "plaintext", "Arabic SVG title must preserve bidi");
        assert.equal(await arabicTitle.getAttribute("font-family"), "Arial, Noto Sans, DejaVu Sans, sans-serif", "Arabic SVG font stack must match V4");
        assert.equal(await arabicTitle.getAttribute("font-weight"), "700", "Arabic SVG weight must match V4");
        await page.screenshot({ path: "studio-qa/studio-ar-390.png", fullPage: true });
        await page.locator("#studio-name").fill("NOM COMMERCIAL EXTRAORDINAIREMENT LONG SANS AUCUNE COUPURE ET UNE SECONDE LIGNE DE TEXTE");
        assert.equal(await page.getByText(/vérification humaine nécessaire/i).count(), 1);
        await page.screenshot({ path: "studio-qa/studio-long-390.png", fullPage: true });
        await page.locator("#studio-name").fill("CABINET SANS LOGO");
        await page.locator(".studio-template").nth(1).click();
        assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign image").count(), 0);
        const logoFree = page.locator(".studio-main-sign-scroll > .studio-sign");
        assert.equal(await logoFree.locator("text").filter({ hasText: "Espace logo" }).count(), 0, "V4 no-logo composition must not show placeholder");
        assert.equal(await logoFree.locator('rect[x="325"][y="210"]').count(), 1, "V4 no-logo template 02 needs centered orange underline");
        assert.equal(await logoFree.locator("text").first().getAttribute("x"), "420", "V4 no-logo template 02 must center title");
        const mobilePreviewOrder = await page.evaluate(() => {
          const preview = document.querySelector(".studio-main-sign-scroll");
          const palette = document.querySelector(".studio-palette");
          return Boolean(preview && palette && (preview.compareDocumentPosition(palette) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        assert.equal(mobilePreviewOrder, true, "sign preview must precede advanced color settings on mobile");
        assert.equal(await page.locator(".studio-gallery-hint").isVisible(), true, "mobile gallery must explain horizontal scrolling");
        await page.locator(".studio-template").first().click();
        assert.equal(await page.getByRole("button", { name: "Modèle précédent" }).isDisabled(), true, "first model disables previous control");
        assert.equal(await page.locator(".studio-gallery-controls span").innerText(), "Modèle 1 sur 4", "gallery progress must be explicit");
        await page.getByRole("button", { name: "Modèle suivant" }).click();
        assert.equal(await page.locator(".studio-template").nth(1).getAttribute("aria-pressed"), "true", "next gallery control selects second model");
        assert.equal(await page.locator(".studio-gallery-controls span").innerText(), "Modèle 2 sur 4");
        await page.getByRole("button", { name: "Modèle précédent" }).click();
        assert.equal(await page.locator(".studio-template").first().getAttribute("aria-pressed"), "true", "previous gallery control restores first model");
        // Logo is intentionally rendered only by composition 02; restore it after navigation tests.
        await page.locator(".studio-template").nth(1).click();
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
        await page.locator("#studio-logo").setInputFiles({ name: "logo-test.png", mimeType: "image/png", buffer: png });
        await page.locator(".studio-main-sign-scroll > .studio-sign image").waitFor({ state: "attached" });
        assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign image").count(), 1, "uploaded logo must render");
        await page.screenshot({ path: "studio-qa/studio-logo-390.png", fullPage: true });
        await page.getByRole("button", { name: "Retirer le logo" }).click();
        assert.equal(await page.locator(".studio-main-sign-scroll > .studio-sign image").count(), 0, "logo removal must work");
        await page.locator("#studio-logo").setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
        assert.equal(await page.getByRole("alert").filter({ hasText: /Logo refusé/ }).count(), 1, "SVG upload must be rejected");
        await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
        const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        await page.screenshot({ path: "studio-qa/studio-zoom200-390.png", fullPage: true });
        assert.equal(zoomOverflow, false, "horizontal overflow at 200% zoom");
        const enlargedPreview = await page.locator(".studio-main-sign-scroll").evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, svgWidth: el.querySelector("svg").getBoundingClientRect().width, tabIndex: el.tabIndex }));
        assert.ok(enlargedPreview.scrollWidth > enlargedPreview.clientWidth, "enlarged preview must scroll independently at 200% zoom");
        assert.ok(enlargedPreview.svgWidth >= 350, "enlarged preview must be at least 350 CSS pixels at 200% zoom");
        assert.equal(enlargedPreview.tabIndex, 0, "enlarged preview must be keyboard focusable");
        const quoteButton = page.locator(".studio-gate button");
        assert.equal(await quoteButton.isDisabled(), true, "quote request must stay disabled");
        const quoteLabel = await quoteButton.evaluate(el => {
          const short = el.querySelector(".studio-devis-short");
          const long = el.querySelector(".studio-devis-long");
          return { shortVisible: getComputedStyle(short).display !== "none", longVisible: getComputedStyle(long).display !== "none", text: short.textContent.trim(), accessibleName: el.getAttribute("aria-label") };
        });
        assert.equal(quoteLabel.shortVisible, true, "concise quote label must appear at 200% zoom");
        assert.equal(quoteLabel.longVisible, false, "long quote label must hide at 200% zoom");
        assert.equal(quoteLabel.text, "Devis indisponible");
        assert.equal(quoteLabel.accessibleName, "Demander un devis — indisponible");
        const gallery = await page.locator(".studio-templates").evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, previewWidth: el.querySelector(".studio-template")?.getBoundingClientRect().width || 0 }));
        assert.ok(gallery.scrollWidth > gallery.clientWidth, "composition gallery must scroll independently at 200% zoom");
        assert.ok(gallery.previewWidth >= 200, "composition preview must remain legible at 200% zoom");
        const zoomControls = await page.locator(".studio-views button").evaluateAll(nodes => nodes.map(el => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width })));
        assert.ok(zoomControls.every(box => box.height >= 44 && box.width >= 44), "zoom controls must be at least 44x44 CSS pixels");
        await page.evaluate(() => { document.documentElement.style.zoom = ""; });
        await page.locator("#studio-name").focus();
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "studio-activity", "keyboard Tab must reach activity field");
        await page.locator(".studio-template").first().focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(".studio-template").first().getAttribute("aria-pressed"), "true", "keyboard Enter must activate composition");
        const focusOutline = await page.locator(".studio-template").first().evaluate(el => getComputedStyle(el).outlineStyle);
        assert.notEqual(focusOutline, "none", "keyboard focus must be visible");
        const contrast = await page.locator(".studio-caption").first().evaluate(el => {
          const rgb = value => (value.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
          const luminance = c => { const x = c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * x[0] + .7152 * x[1] + .0722 * x[2]; };
          const foreground = luminance(rgb(getComputedStyle(el).color));
          const background = luminance([255,255,255]);
          return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        });
        assert.ok(contrast >= 4.5, "caption contrast must meet WCAG AA");
        report.push({ width: 390, scenario: "logo-zoom200-keyboard-and-contrast", overflow: zoomOverflow, errors, zoomControls, captionContrast: contrast, gallery, quoteLabel });
      }
      await page.close();
    }
    fs.writeFileSync("studio-qa/report.json", JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
