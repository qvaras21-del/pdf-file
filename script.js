"use strict";

/* ---------- Config ---------- */
const MAX_MB = 25, MAX_FILES = 30;
const CAT = {
  jpg: "img", jpeg: "img", png: "img", webp: "img", gif: "img", bmp: "img",
  txt: "text", md: "text", log: "text", json: "text",
  html: "html", htm: "html", docx: "docx",
  xlsx: "sheet", xls: "sheet", csv: "sheet", pptx: "pptx", pdf: "pdf",
};
const TARGETS = {
  img: ["pdf", "png", "jpg", "webp"], text: ["pdf", "docx", "html"], html: ["pdf", "docx", "txt"],
  docx: ["pdf", "html", "txt"], sheet: ["pdf", "xlsx", "csv", "html", "json"], pptx: ["pdf", "txt", "docx"], pdf: ["docx", "txt", "png", "jpg"],
};
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp", html: "text/html", txt: "text/plain",
  csv: "text/csv", json: "application/json", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const PREVIEWABLE = ["pdf", "png", "jpg", "webp", "txt"];
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const LEGACY = ["doc", "ppt", "odt", "rtf", "odp", "ods", "pages", "key", "numbers"];
const PAGE = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], a5: [148, 210] };

/* ---------- State & helpers ---------- */
const $ = (id) => document.getElementById(id);
const files = [];          // {id, file, ext, cat, status, progress, error, blob, url, els}
const history = [];        // {id, name, size, time, url}
let uid = 0, busy = false;

const fmtSize = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const outName = (it) => it.file.name.replace(/\.[^.]+$/, "") + "." + (it.outExt || it.target);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  [].concat(kids).forEach((c) => c && n.append(c));
  return n;
}
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "ico");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", "#i-" + name);
  s.append(u);
  return s;
}
function iconBtn(name, label, onClick) {
  const b = el("button", { class: "icon-btn", type: "button", "aria-label": label, title: label }, icon(name));
  b.addEventListener("click", onClick);
  return b;
}
function toast(msg, isErr = false) {
  const t = el("div", { class: "toast" + (isErr ? " err" : ""), text: msg });
  $("toasts").append(t);
  setTimeout(() => t.remove(), 4500);
}
function download(url, name) {
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
}

/* ---------- Theme ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $("themeIcon").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
  $("themeBtn").setAttribute("aria-pressed", t === "dark");
  $("themeBtn").setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  try { localStorage.setItem("foldr-theme", t); } catch (e) { /* storage unavailable */ }
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("foldr-theme"); } catch (e) { /* ignore */ }
  setTheme(t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("themeBtn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
})();

/* ---------- Adding files ---------- */
function addFiles(list) {
  if (busy) return toast("Wait for the current conversion to finish.", true);
  let added = 0;
  for (const file of list) {
    if (files.length >= MAX_FILES) { toast(`Limit reached: ${MAX_FILES} files at a time.`, true); break; }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const item = { id: ++uid, file, ext, cat: CAT[ext], target: (TARGETS[CAT[ext]] || [])[0] || "pdf", outExt: "", status: "ready", progress: 0, error: "", blob: null, url: null, invalid: false };
    if (!item.cat) {
      item.invalid = true; item.status = "error";
      item.error = LEGACY.includes(ext)
        ? `.${ext} files need a server-side converter such as LibreOffice. Re-save as DOCX, XLSX or PPTX and try again.`
        : `.${ext || "unknown"} is not a supported format.`;
    } else if (file.size > MAX_MB * 1048576) {
      item.invalid = true; item.status = "error"; item.error = `Too large (${fmtSize(file.size)}). The limit is ${MAX_MB} MB.`;
    } else if (file.size === 0) {
      item.invalid = true; item.status = "error"; item.error = "This file is empty.";
    }
    files.push(item); buildRow(item); added++;
  }
  if (added) refresh();
}

function buildRow(item) {
  const thumb = el("div", { class: "thumb" });
  if (item.cat === "img" && !item.invalid) {
    item.thumbUrl = URL.createObjectURL(item.file);
    thumb.append(el("img", { src: item.thumbUrl, alt: "" }));
  } else thumb.textContent = item.ext.slice(0, 4) || "?";

  const status = el("span", { class: "status" });
  const err = el("div", { class: "ferr", role: "alert" });
  const fill = el("i");
  const bar = el("div", { class: "fbar", hidden: "" }, fill);
  const sel = el("select", { class: "tsel", "aria-label": `Output format for ${item.file.name}` });
  (TARGETS[item.cat] || []).forEach((t) => sel.append(el("option", { value: t, text: t.toUpperCase() })));
  sel.value = item.target;
  sel.addEventListener("change", () => setTarget(item, sel.value));
  const meta = el("div", { class: "fmeta" }, [
    el("span", { text: fmtSize(item.file.size) }),
    el("span", { text: item.ext ? item.ext.toUpperCase() : "FILE" }), status,
    item.invalid ? null : el("span", {}, ["Convert to ", sel]),
  ]);
  const prev = iconBtn("eye", `Preview ${item.file.name}`, () => openPreview(item.url, outName(item)));
  const dl = iconBtn("down", `Download converted ${item.file.name}`, () => download(item.url, outName(item)));
  const rm = iconBtn("x", `Remove ${item.file.name}`, () => removeFile(item));
  const btns = el("div", { class: "fbtns" }, [prev, dl, rm]);
  const name = el("div", { class: "fname", title: item.file.name, text: item.file.name });
  const li = el("li", { class: "file" }, [thumb, el("div", { class: "fmain" }, [name, meta, err, bar]), btns]);
  item.els = { li, status, err, bar, fill, prev, dl, rm, sel };
  $("fileList").append(li);
  updateRow(item);
}

function updateRow(item) {
  const e = item.els, labels = { ready: "Ready", converting: "Converting…", done: "Done", error: "Failed" };
  e.status.className = "status " + item.status;
  e.status.textContent = "";
  if (item.status === "converting") e.status.append(el("span", { class: "spinner" }));
  e.status.append(labels[item.status]);
  e.err.textContent = item.error;
  e.bar.hidden = item.status !== "converting";
  e.fill.style.width = item.progress + "%";
  e.dl.hidden = item.status !== "done";
  e.prev.hidden = e.dl.hidden || !PREVIEWABLE.includes(item.outExt);
  e.rm.disabled = item.status === "converting";
}

function removeFile(item) {
  const i = files.indexOf(item);
  if (i < 0 || item.status === "converting") return;
  files.splice(i, 1);
  item.els.li.remove();
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  refresh();
}

function clearAll() {
  if (busy) return;
  files.splice(0).forEach((it) => it.thumbUrl && URL.revokeObjectURL(it.thumbUrl));
  $("fileList").textContent = "";
  $("overall").hidden = true;
  refresh();
}

function refresh() {
  $("count").textContent = files.length;
  files.forEach((f) => { f.els.sel.disabled = busy; });
  $("empty").hidden = files.length > 0;
  const pending = files.some((f) => !f.invalid && f.status !== "done");
  $("convertBtn").disabled = busy || !pending;
  $("zipBtn").disabled = busy || !files.some((f) => f.status === "done");
  $("clearBtn").disabled = busy || files.length === 0;
  $("histCount").textContent = history.length;
  $("histEmpty").hidden = history.length > 0;
  $("histClear").disabled = history.length === 0;
}

/* ---------- Settings ---------- */
const getSettings = () => ({ size: $("size").value, orient: $("orient").value, margin: +$("margin").value, lang: $("trLang").value, src: $("trSrc").value, online: $("trOnline").checked, server: !!TRANSLATE_ENDPOINT && $("trServer").checked });
const newDoc = (s, o) => new window.jspdf.jsPDF({ unit: "mm", format: s.size, orientation: o, compress: true });
const pickOrient = (s, auto) => (s.orient === "auto" ? auto : s.orient);

/* ---------- Converters ---------- */
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("The image is corrupt or its format can't be decoded by this browser."));
    img.src = url;
  });
}

async function imageToPdf(file, s) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = el("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    const png = file.type === "image/png";
    const data = c.toDataURL(png ? "image/png" : "image/jpeg", 0.92);
    const doc = newDoc(s, pickOrient(s, w > h ? "l" : "p"));
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    const r = Math.min((pw - 2 * s.margin) / w, (ph - 2 * s.margin) / h);
    doc.addImage(data, png ? "PNG" : "JPEG", (pw - w * r) / 2, (ph - h * r) / 2, w * r, h * r);
    return doc;
  } finally { URL.revokeObjectURL(url); }
}

/* Removes scripts, event handlers, external resources and unsafe URLs from untrusted HTML. */
function sanitize(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script,style,link,meta,iframe,object,embed,form,base,noscript,video,audio,svg,template").forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((n) => {
    for (const a of [...n.attributes]) {
      const k = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      const urlAttr = ["src", "href", "xlink:href", "background", "poster"].includes(k);
      const okUrl = v.startsWith("data:image/") || v.startsWith("#") || (k === "href" && /^(https?:|mailto:)/.test(v));
      if (k.startsWith("on") || k === "srcset" || (urlAttr && !okUrl) || (k === "style" && /url\(|expression|@import/i.test(v))) n.removeAttribute(a.name);
    }
  });
  const frag = document.createDocumentFragment();
  [...d.body.childNodes].forEach((n) => frag.append(document.importNode(n, true)));
  return frag;
}

async function htmlToPdf(html, s, orient, onProgress) {
  const doc = newDoc(s, orient);
  const mmW = doc.internal.pageSize.getWidth() - 2 * s.margin;
  const px = Math.round((mmW * 96) / 25.4);
  const host = el("div", { class: "pdf-sheet" });
  host.style.width = px + "px";
  host.append(sanitize(html));
  const wrap = el("div", { class: "pdf-wrap", "aria-hidden": "true" }, host);
  document.body.append(wrap);
  let p = 55;
  onProgress(p);
  const timer = setInterval(() => { p += (88 - p) * 0.06; onProgress(Math.round(p)); }, 400);
  try {
    await tick(60);
    await doc.html(host, {
      margin: [s.margin, s.margin, s.margin, s.margin], autoPaging: "text", width: mmW, windowWidth: px,
      html2canvas: { scale: 2, useCORS: false, allowTaint: false, backgroundColor: "#ffffff", logging: false },
    });
  } finally { clearInterval(timer); wrap.remove(); }
  return doc;
}

async function pptxToHtml(buf) {
  const zip = await JSZip.loadAsync(buf);
  const num = (n) => +n.match(/slide(\d+)\.xml$/)[1];
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!names.length) throw new Error("No slides were found in this presentation.");
  let html = "";
  for (let i = 0; i < names.length; i++) {
    const xml = new DOMParser().parseFromString(await zip.file(names[i]).async("string"), "application/xml");
    const paras = [...xml.getElementsByTagName("a:p")]
      .map((p) => [...p.getElementsByTagName("a:t")].map((t) => t.textContent).join("")).filter((t) => t.trim());
    html += `<section class="slide"><h2>Slide ${i + 1}</h2>${paras.map((p) => `<p>${esc(p)}</p>`).join("") || "<p><em>(no text)</em></p>"}</section>`;
  }
  return html;
}

const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xmlEsc = (t) => String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* Minimal valid DOCX: one paragraph per line, null = page break */
async function makeDocx(paras) {
  const z = new JSZip();
  z.file("[Content_Types].xml", XMLH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("_rels/.rels", XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paras.map((p) => p === null ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    : `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join("");
  z.file("word/document.xml", XMLH + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return z.generateAsync({ type: "blob", mimeType: MIME.docx });
}

function htmlToText(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script,style").forEach((n) => n.remove());
  d.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  d.querySelectorAll("td,th").forEach((n) => n.append("\t"));
  d.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,pre,table").forEach((n) => n.append("\n"));
  return d.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

const canvasBlob = (c, type, q) => new Promise((res, rej) =>
  c.toBlob((b) => (b ? res(b) : rej(new Error("This browser can't encode that image format."))), type, q));

async function imageToImage(file, t) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = el("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (t === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0);
    return await canvasBlob(c, MIME[t], 0.92);
  } finally { URL.revokeObjectURL(url); }
}

async function loadPdf(file) {
  if (!window.pdfjsLib) throw new Error("The PDF reader library failed to load. Check your connection and reload.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS;
  return withTimeout(pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise, 30000, "The PDF reader didn't respond (its library may be blocked). Reload the page and check that cdnjs.cloudflare.com is reachable.");
}

async function pdfText(file, report) {
  const pdf = await loadPdf(file), pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const lines = []; let cur = "", last = null;
    for (const it of tc.items) {
      const y = it.transform[5];
      if (last !== null && Math.abs(y - last) > 2) { lines.push(cur); cur = ""; }
      cur += it.str; last = y;
      if (it.hasEOL) { lines.push(cur); cur = ""; last = null; }
    }
    if (cur) lines.push(cur);
    pages.push(lines.map((l) => l.trim()).filter(Boolean));
    report(10 + Math.round((80 * i) / pdf.numPages));
  }
  return pages;
}

async function pdfToImages(file, t, report) {
  const pdf = await loadPdf(file);
  if (pdf.numPages > 100) throw new Error("This PDF has more than 100 pages. Split it first.");
  const blobs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    let vp = page.getViewport({ scale: 2 });
    vp = page.getViewport({ scale: 2 * Math.min(1, 4000 / Math.max(vp.width, vp.height)) });
    const c = el("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    blobs.push(await canvasBlob(c, MIME[t], 0.92));
    report(10 + Math.round((80 * i) / pdf.numPages));
  }
  if (blobs.length === 1) return { blob: blobs[0], ext: t };
  const z = new JSZip();
  blobs.forEach((b, i) => z.file(`page-${i + 1}.${t}`, b));
  return { blob: await z.generateAsync({ type: "blob" }), ext: "zip" };
}

async function convertOne(item, s, report) {
  const f = item.file, t = item.target, ext = item.ext;
  report(10); await tick();
  s = { ...s, report };
  if (s.lang && (item.cat === "img" || item.cat === "sheet" || (item.cat === "pdf" && (t === "png" || t === "jpg")))) throw new Error("Translation isn't available for images, spreadsheets or image output.");
  const out = (blob, e = t) => ({ blob, ext: e });
  const toPdf = async (html, o) => { report(35); return out((await htmlToPdf(html, s, pickOrient(s, o), report)).output("blob")); };
  const asHtml = (html) => {
    const d = el("div"); d.append(sanitize(html));
    return out(new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)}</title></head><body>${d.innerHTML}</body></html>`], { type: MIME.html }));
  };
  const asText = (txt) => out(new Blob([txt], { type: "text/plain;charset=utf-8" }));
  const asDocx = async (txt) => out(await makeDocx(Array.isArray(txt) ? txt : txt.split(/\r?\n/)));
  const sheetHtml = (wb) => wb.SheetNames.map((n) => `<h2>${esc(n)}</h2>` + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" })).join("");

  switch (item.cat) {
    case "img":
      if (t === "pdf") { report(40); return out((await imageToPdf(f, s)).output("blob")); }
      report(50); return out(await imageToImage(f, t));
    case "pdf": {
      if (t === "png" || t === "jpg") return pdfToImages(f, t, report);
      const pages = await trPages(await pdfText(f, report), s);
      if (!pages.some((p) => p.length)) throw new Error("This PDF has no selectable text (it may be a scan, which needs OCR).");
      if (t === "txt") return asText(pages.map((p) => p.join("\n")).join("\n\n"));
      const paras = []; pages.forEach((p, i) => { if (i) paras.push(null); paras.push(...p); });
      return asDocx(paras);
    }
    case "text": {
      let txt = await f.text();
      if (ext === "json") { try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch (e) { /* keep raw */ } }
      txt = await trText(txt, s);
      if (t === "docx") return asDocx(txt);
      const html = `<pre class="plain">${esc(txt)}</pre>`;
      return t === "html" ? asHtml(html) : toPdf(html, "p");
    }
    case "html": {
      const raw = await trHtml(await f.text(), s);
      if (t === "docx") return asDocx(htmlToText(raw));
      if (t === "txt") return asText(htmlToText(raw));
      return toPdf(raw, "p");
    }
    case "docx": {
      if (!window.mammoth) throw new Error("The DOCX library failed to load. Check your connection and reload.");
      const html = await trHtml((await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() })).value || "<p><em>(empty document)</em></p>", s);
      if (t === "txt") return asText(htmlToText(html));
      return t === "html" ? asHtml(html) : toPdf(html, "p");
    }
    case "sheet": {
      const wb = ext === "csv" ? XLSX.read(await f.text(), { type: "string" }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      report(30);
      if (t === "xlsx") return out(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: MIME.xlsx }));
      if (t === "csv") return out(new Blob(["\uFEFF" + XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])], { type: MIME.csv }));
      if (t === "json") {
        const o = {}; wb.SheetNames.forEach((n) => { o[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }); });
        return out(new Blob([JSON.stringify(o, null, 2)], { type: MIME.json }));
      }
      return t === "html" ? asHtml(sheetHtml(wb)) : toPdf(sheetHtml(wb), "l");
    }
    case "pptx": {
      const html = await trHtml(await pptxToHtml(await f.arrayBuffer()), s);
      if (t === "txt") return asText(htmlToText(html));
      if (t === "docx") return asDocx(htmlToText(html));
      return toPdf(html, "l");
    }
  }
  throw new Error("Unsupported conversion.");
}

/* ---------- Translation ----------
   1) On-device: the browser's built-in Translator API (recent desktop Chrome) – text stays on the device.
   2) Online fallback (only if the user ticks the box): MyMemory free API – text is sent to that service. */
const tCache = new Map();
const byteLen = (x) => new TextEncoder().encode(x).length;
const MYM = "https://api.mymemory.translated.net/get";
const mCode = (c) => ({ zh: "zh-CN" }[c] || c);

function chunkBytes(text, max) {
  const out = []; let cur = "";
  for (const w of text.split(" ")) {
    const next = cur ? cur + " " + w : w;
    if (byteLen(next) > max && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
function onlineEngine(src, tgt) {
  return {
    async translate(text) {
      const out = [];
      for (const c of chunkBytes(text, 450)) {
        const pair = (src === "auto" ? "Autodetect" : mCode(src)) + "|" + mCode(tgt);
        let r;
        try { r = await fetch(`${MYM}?q=${encodeURIComponent(c)}&langpair=${encodeURIComponent(pair)}`, { signal: AbortSignal.timeout(30000) }); }
        catch (e) { throw new Error("The online translation service can't be reached. Check your connection."); }
        if (!r.ok) throw new Error(`Online translation failed (HTTP ${r.status}).`);
        const j = await r.json();
        if (+j.responseStatus !== 200) {
          throw new Error(/ALL AVAILABLE|QUOTA|LIMIT/i.test(String(j.responseDetails))
            ? "The free daily limit of the online translation service is used up. Try again tomorrow, or use desktop Chrome for on-device translation."
            : "Online translation failed: " + j.responseDetails);
        }
        out.push(new DOMParser().parseFromString(j.responseData.translatedText, "text/html").documentElement.textContent);
      }
      return out.join(" ");
    },
  };
}
const TO = 60000, TMSG = "Translation is taking too long (a language pack may still be downloading, or the service is slow). Try again, choose the original language manually, or use another translation mode.";
const withTimeout = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
/* Accurate mode: your own translation server (see translate-worker.js). Put its URL here, e.g. "https://translate.example.workers.dev" */
const TRANSLATE_ENDPOINT = "";
function serverEngine(src, tgt) {
  const call = async (texts) => {
    let r;
    try { r = await fetch(TRANSLATE_ENDPOINT, { method: "POST", signal: AbortSignal.timeout(90000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts, source: src === "auto" ? "" : src, target: tgt }) }); }
    catch (e) { throw new Error("The translation server can't be reached."); }
    if (!r.ok) throw new Error(`Translation server error (HTTP ${r.status}).`);
    const j = await r.json();
    if (!Array.isArray(j.texts) || j.texts.length !== texts.length) throw new Error("The translation server returned an unexpected answer.");
    return j.texts;
  };
  return { translate: async (t) => (await call([t]))[0], batch: call };
}
async function getTranslator(src, tgt, online, server) {
  if (src === tgt) throw new Error("The source and target languages are the same.");
  const key = `${src}>${tgt}>${online}>${server}`;
  if (tCache.has(key)) return tCache.get(key);
  let eng = null;
  if (server && TRANSLATE_ENDPOINT) eng = serverEngine(src, tgt);
  if (!eng && src !== "auto" && "Translator" in self) {
    try {
      if ((await withTimeout(Translator.availability({ sourceLanguage: src, targetLanguage: tgt }), TO, TMSG)) !== "unavailable") eng = await withTimeout(Translator.create({ sourceLanguage: src, targetLanguage: tgt }), 180000, TMSG);
    } catch (e) { eng = null; }
  }
  if (!eng) {
    if (!online) throw new Error("This browser can't translate this language pair on-device. Tick “use the online service” in the translation settings, or use desktop Chrome.");
    eng = onlineEngine(src, tgt);
  }
  tCache.set(key, eng); return eng;
}
async function detectLang(sample) {
  if (!("LanguageDetector" in self)) throw new Error("This browser can't detect the language. Choose the original language manually.");
  const r = await withTimeout((async () => (await LanguageDetector.create()).detect(sample.slice(0, 1500)))(), TO, TMSG);
  if (!r.length || r[0].detectedLanguage === "und") throw new Error("Couldn't detect the language. Choose the original language manually.");
  return r[0].detectedLanguage;
}
async function pickSrc(sample, s) {
  if (s.src) return s.src;
  try { return await detectLang(sample); } catch (e) { if (s.online) return "auto"; throw e; }
}
function splitLong(part) {
  const out = [];
  while (part.length > 900) { let i = part.lastIndexOf(" ", 900); if (i < 300) i = 900; out.push(part.slice(0, i)); part = part.slice(i); }
  out.push(part); return out;
}
async function trText(text, s) {
  if (!s.lang) return text;
  const src = await pickSrc(text, s), tr = await getTranslator(src, s.lang, s.online, s.server), s2 = { ...s, src };
  if (tr.batch) {
    const lines = text.split("\n"), idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < idx.length;) {
      let e = k, len = 0;
      while (e < idx.length && e - k < 40 && (e === k || len + lines[idx[e]].length < 3000)) len += lines[idx[e++]].length;
      const part = idx.slice(k, e), res = await withTimeout(tr.batch(part.map((i) => lines[i].trim())), TO, TMSG);
      part.forEach((i, n) => { lines[i] = res[n]; });
      k = e; if (s.report) s.report(10 + Math.round((24 * k) / idx.length));
    }
    return lines.join("\n");
  }
  const lines = [], all = text.split("\n");
  for (const [n, line] of all.entries()) {
    if (!line.trim()) { lines.push(line); continue; }
    let r = "";
    for (const c of splitLong(line)) if (c.trim()) r += (r ? " " : "") + await withTimeout(tr.translate(c.trim()), TO, TMSG);
    lines.push(r);
    if (s.report) s.report(10 + Math.round((24 * (n + 1)) / all.length));
  }
  return lines.join("\n");
}
async function trHtml(html, s) {
  if (!s.lang) return html;
  const host = el("div"); host.append(sanitize(html));
  const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), nodes = [];
  while (w.nextNode()) if (w.currentNode.nodeValue.trim()) nodes.push(w.currentNode);
  if (!nodes.length) return html;
  const src = await pickSrc(nodes.map((n) => n.nodeValue).join(" "), s), s2 = { ...s, src, report: null };
  const eng = await getTranslator(src, s.lang, s.online, s.server);
  if (eng.batch) {
    for (let i = 0; i < nodes.length;) {
      let j = i, len = 0;
      while (j < nodes.length && j - i < 40 && (j === i || len + nodes[j].nodeValue.length < 3000)) len += nodes[j++].nodeValue.length;
      const part = nodes.slice(i, j), res = await withTimeout(eng.batch(part.map((n) => n.nodeValue.trim())), TO, TMSG);
      part.forEach((n, k) => { const v = n.nodeValue; n.nodeValue = v.match(/^\s*/)[0] + res[k] + v.match(/\s*$/)[0]; });
      i = j; if (s.report) s.report(10 + Math.round((24 * i) / nodes.length));
    }
    return host.innerHTML;
  }
  for (const [k, n] of nodes.entries()) {
    const v = n.nodeValue;
    n.nodeValue = v.match(/^\s*/)[0] + await trText(v.trim(), s2) + v.match(/\s*$/)[0];
    if (s.report) s.report(10 + Math.round((24 * (k + 1)) / nodes.length));
  }
  return host.innerHTML;
}
async function trPages(pages, s) {
  if (!s.lang) return pages;
  const src = await pickSrc(pages.flat().join(" "), s), s2 = { ...s, src, report: null }, out = [];
  for (const [n, p] of pages.entries()) {
    out.push((await trText(p.join("\n"), s2)).split("\n").filter((x) => x.trim()));
    if (s.report) s.report(90 + Math.round((8 * (n + 1)) / pages.length));
  }
  return out;
}

/* ---------- Convert all ---------- */
function setOverall(p, text) {
  $("overallFill").style.width = p + "%";
  $("overallText").textContent = text || Math.round(p) + "%";
  $("overall").querySelector("[role=progressbar]").setAttribute("aria-valuenow", Math.round(p));
}

async function convertAll() {
  if (busy) return;
  if (files.some((f) => !f.invalid && f.status !== "done" && f.target === "pdf") && (!window.jspdf || !window.html2canvas)) return toast("Converter libraries didn't load. Check your connection and reload.", true);
  const queue = files.filter((f) => !f.invalid && f.status !== "done");
  if (!queue.length) return;
  busy = true; refresh();
  const s = getSettings();
  if (s.lang && s.src) { try { await getTranslator(s.src, s.lang, s.online, s.server); } catch (e) { busy = false; refresh(); return toast(e.message, true); } }
  $("overall").hidden = false; setOverall(0);
  let ok = 0, fail = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    item.status = "converting"; item.error = ""; item.progress = 5; updateRow(item);
    const report = (p) => { item.progress = p; updateRow(item); setOverall(((i + p / 100) / queue.length) * 100); };
    try {
      const r = await convertOne(item, s, report);
      item.blob = r.blob; item.outExt = r.ext;
      if (item.url) URL.revokeObjectURL(item.url);
      item.url = URL.createObjectURL(item.blob);
      item.status = "done"; item.progress = 100; ok++;
      addHistory(item);
    } catch (err) {
      console.error(err);
      item.status = "error"; fail++;
      item.error = "Couldn't convert: " + (err && err.message ? err.message : "unknown error") + " The file may be corrupt, encrypted or password-protected.";
    }
    updateRow(item); setOverall(((i + 1) / queue.length) * 100);
    await tick();
  }
  busy = false; refresh();
  setOverall(100, "Finished");
  toast(`${ok} converted${fail ? `, ${fail} failed` : ""}.`, fail > 0 && ok === 0);
}

/* ---------- ZIP ---------- */
async function downloadZip() {
  const done = files.filter((f) => f.status === "done" && f.blob);
  if (!done.length) return;
  if (!window.JSZip) return toast("ZIP library failed to load.", true);
  $("zipBtn").disabled = true;
  try {
    const zip = new JSZip(), used = new Set();
    for (const it of done) {
      let n = outName(it), c = 1;
      while (used.has(n.toLowerCase())) n = outName(it).replace(/\.([^.]+)$/, ` (${++c}).$1`);
      used.add(n.toLowerCase()); zip.file(n, it.blob);
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(blob);
    download(url, "converted-pdfs.zip");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`ZIP with ${done.length} PDF${done.length > 1 ? "s" : ""} downloaded.`);
  } catch (e) { toast("Couldn't create the ZIP: " + e.message, true); }
  refresh();
}

/* ---------- History ---------- */
function addHistory(item) {
  const h = { id: ++uid, name: outName(item), size: item.blob.size, url: item.url, time: new Date() };
  history.unshift(h);
  const li = el("li", { class: "file", "data-id": h.id }, [
    el("div", { class: "thumb", text: item.outExt }),
    el("div", { class: "fmain" }, [
      el("div", { class: "fname", title: h.name, text: h.name }),
      el("div", { class: "fmeta" }, [el("span", { text: fmtSize(h.size) }), el("span", { text: h.time.toLocaleTimeString() })]),
    ]),
    el("div", { class: "fbtns" }, [
      PREVIEWABLE.includes(item.outExt) ? iconBtn("eye", `Preview ${h.name}`, () => openPreview(h.url, h.name)) : null,
      iconBtn("down", `Download ${h.name}`, () => download(h.url, h.name)),
    ]),
  ]);
  $("history").prepend(li);
  refresh();
}
function clearHistory() {
  history.splice(0).forEach((h) => { if (!files.some((f) => f.url === h.url)) URL.revokeObjectURL(h.url); });
  $("history").textContent = "";
  refresh();
}

/* ---------- Preview ---------- */
function openPreview(url, name) {
  if (!url) return;
  $("pvTitle").textContent = name;
  $("pvFrame").src = url;
  $("pvOpen").href = url;
  $("preview").showModal();
}
$("pvClose").addEventListener("click", () => $("preview").close());
$("preview").addEventListener("close", () => { $("pvFrame").src = "about:blank"; });
$("preview").addEventListener("click", (e) => { if (e.target === $("preview")) $("preview").close(); });

/* ---------- Events ---------- */
const drop = $("drop"), input = $("fileInput");
drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); if (t === "drop" || !drop.contains(e.relatedTarget)) drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
// Stop the browser from opening files dropped outside the drop zone
["dragover", "drop"].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));

$("convertBtn").addEventListener("click", convertAll);
$("zipBtn").addEventListener("click", downloadZip);
$("clearBtn").addEventListener("click", clearAll);
$("histClear").addEventListener("click", clearHistory);

function setTarget(item, t) {
  if (busy) return;
  item.target = t;
  if (item.status === "done") { item.status = "ready"; item.blob = null; item.progress = 0; }
  updateRow(item); refresh();
}
$("allTarget").addEventListener("change", () => {
  const t = $("allTarget").value;
  if (!t || busy) return;
  let n = 0, skip = 0;
  files.forEach((f) => {
    if (f.invalid) return;
    if (TARGETS[f.cat].includes(t)) { f.els.sel.value = t; setTarget(f, t); n++; } else skip++;
  });
  toast(n ? `${n} file(s) set to ${t.toUpperCase()}${skip ? `; ${skip} can't be converted to it` : ""}.` : `None of the files can be converted to ${t.toUpperCase()}.`, !n);
  $("allTarget").value = "";
});
// Changing settings invalidates earlier results so they can be re-converted with the new options
["size", "orient", "margin", "trLang", "trSrc", "trOnline", "trServer"].forEach((id) => $(id).addEventListener("change", () => {
  if (busy) return;
  let n = 0;
  files.forEach((f) => { if (f.status === "done") { f.status = "ready"; f.blob = null; f.progress = 0; updateRow(f); n++; } });
  if (n) { refresh(); toast("Settings changed. Press Convert all to apply them."); }
}));

refresh();

/* ---------- Language picker button ---------- */
(function initLangPicker() {
  const sel = $("trLang"), grid = $("langGrid");
  const mk = (code, label) => {
    const b = el("button", { type: "button", class: "langbtn", "data-code": code, text: label });
    b.addEventListener("click", () => setLang(code));
    grid.append(b);
  };
  [...sel.options].forEach((o) => mk(o.value, o.value ? o.text : "✕ Don’t translate"));
  function setLang(code) {
    sel.value = code;
    sel.dispatchEvent(new Event("change"));
    $("trBtn").textContent = "🌐 Translate: " + (code ? sel.selectedOptions[0].text : "Off");
    grid.querySelectorAll(".langbtn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.code === code));
    $("trDlg").close();
  }
  $("trBtn").addEventListener("click", () => $("trDlg").showModal());
  $("trClose").addEventListener("click", () => $("trDlg").close());
  $("trServerRow").hidden = !TRANSLATE_ENDPOINT;
  grid.querySelector('[data-code=""]').setAttribute("aria-pressed", "true");
})();
