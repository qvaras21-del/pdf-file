"use strict";

/* ---------- Config ---------- */
const MAX_MB = 25, MAX_FILES = 30;
const CAT = {
  jpg: "img", jpeg: "img", png: "img", webp: "img", gif: "img", bmp: "img",
  txt: "text", md: "text", log: "text", json: "text",
  html: "html", htm: "html", docx: "docx",
  xlsx: "sheet", xls: "sheet", csv: "sheet", pptx: "pptx",
};
const LEGACY = ["doc", "ppt", "odt", "rtf", "odp", "ods", "pages", "key", "numbers"];
const PAGE = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], a5: [148, 210] };

/* ---------- State & helpers ---------- */
const $ = (id) => document.getElementById(id);
const files = [];          // {id, file, ext, cat, status, progress, error, blob, url, els}
const history = [];        // {id, name, size, time, url}
let uid = 0, busy = false;

const fmtSize = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pdfName = (n) => n.replace(/\.[^.]+$/, "") + ".pdf";
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
    const item = { id: ++uid, file, ext, cat: CAT[ext], status: "ready", progress: 0, error: "", blob: null, url: null, invalid: false };
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
  const meta = el("div", { class: "fmeta" }, [
    el("span", { text: fmtSize(item.file.size) }),
    el("span", { text: item.ext ? item.ext.toUpperCase() : "FILE" }), status,
  ]);
  const prev = iconBtn("eye", `Preview PDF of ${item.file.name}`, () => openPreview(item.url, pdfName(item.file.name)));
  const dl = iconBtn("down", `Download PDF of ${item.file.name}`, () => download(item.url, pdfName(item.file.name)));
  const rm = iconBtn("x", `Remove ${item.file.name}`, () => removeFile(item));
  const btns = el("div", { class: "fbtns" }, [prev, dl, rm]);
  const name = el("div", { class: "fname", title: item.file.name, text: item.file.name });
  const li = el("li", { class: "file" }, [thumb, el("div", { class: "fmain" }, [name, meta, err, bar]), btns]);
  item.els = { li, status, err, bar, fill, prev, dl, rm };
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
  e.prev.hidden = e.dl.hidden = item.status !== "done";
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
const getSettings = () => ({ size: $("size").value, orient: $("orient").value, margin: +$("margin").value });
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
  document.body.append(host);
  try {
    onProgress(55);
    await tick(60);
    await doc.html(host, {
      margin: [s.margin, s.margin, s.margin, s.margin], autoPaging: "text", width: mmW, windowWidth: px,
      html2canvas: { scale: 2, useCORS: false, allowTaint: false, backgroundColor: "#ffffff", logging: false },
    });
  } finally { host.remove(); }
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

async function convertOne(item, s, report) {
  const f = item.file;
  report(10); await tick();
  let doc;
  switch (item.cat) {
    case "img": report(40); doc = await imageToPdf(f, s); break;
    case "text": {
      let t = await f.text();
      if (item.ext === "json") { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (e) { /* keep raw */ } }
      report(35); doc = await htmlToPdf(`<pre class="plain">${esc(t)}</pre>`, s, pickOrient(s, "p"), report); break;
    }
    case "html": report(35); doc = await htmlToPdf(await f.text(), s, pickOrient(s, "p"), report); break;
    case "docx": {
      if (!window.mammoth) throw new Error("The DOCX library failed to load. Check your connection and reload.");
      const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      report(35); doc = await htmlToPdf(r.value || "<p><em>(empty document)</em></p>", s, pickOrient(s, "p"), report); break;
    }
    case "sheet": {
      const wb = item.ext === "csv" ? XLSX.read(await f.text(), { type: "string" }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      const html = wb.SheetNames.map((n) => `<h2>${esc(n)}</h2>` + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" })).join("");
      report(35); doc = await htmlToPdf(html, s, pickOrient(s, "l"), report); break;
    }
    case "pptx": {
      const html = await pptxToHtml(await f.arrayBuffer());
      report(35); doc = await htmlToPdf(html, s, pickOrient(s, "l"), report); break;
    }
  }
  report(92);
  return doc.output("blob");
}

/* ---------- Convert all ---------- */
function setOverall(p, text) {
  $("overallFill").style.width = p + "%";
  $("overallText").textContent = text || Math.round(p) + "%";
  $("overall").querySelector("[role=progressbar]").setAttribute("aria-valuenow", Math.round(p));
}

async function convertAll() {
  if (busy) return;
  if (!window.jspdf || !window.html2canvas) return toast("Converter libraries didn't load. Check your connection and reload.", true);
  const queue = files.filter((f) => !f.invalid && f.status !== "done");
  if (!queue.length) return;
  busy = true; refresh();
  const s = getSettings();
  $("overall").hidden = false; setOverall(0);
  let ok = 0, fail = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    item.status = "converting"; item.error = ""; item.progress = 5; updateRow(item);
    const report = (p) => { item.progress = p; updateRow(item); setOverall(((i + p / 100) / queue.length) * 100); };
    try {
      item.blob = await convertOne(item, s, report);
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
      let n = pdfName(it.file.name), c = 1;
      while (used.has(n.toLowerCase())) n = pdfName(it.file.name).replace(/\.pdf$/, ` (${++c}).pdf`);
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
  const h = { id: ++uid, name: pdfName(item.file.name), size: item.blob.size, url: item.url, time: new Date() };
  history.unshift(h);
  const li = el("li", { class: "file", "data-id": h.id }, [
    el("div", { class: "thumb", text: "pdf" }),
    el("div", { class: "fmain" }, [
      el("div", { class: "fname", title: h.name, text: h.name }),
      el("div", { class: "fmeta" }, [el("span", { text: fmtSize(h.size) }), el("span", { text: h.time.toLocaleTimeString() })]),
    ]),
    el("div", { class: "fbtns" }, [
      iconBtn("eye", `Preview ${h.name}`, () => openPreview(h.url, h.name)),
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
// Changing settings invalidates earlier results so they can be re-converted with the new options
["size", "orient", "margin"].forEach((id) => $(id).addEventListener("change", () => {
  if (busy) return;
  let n = 0;
  files.forEach((f) => { if (f.status === "done") { f.status = "ready"; f.blob = null; f.progress = 0; updateRow(f); n++; } });
  if (n) { refresh(); toast("Settings changed. Press Convert all to apply them."); }
}));

refresh();
