// scripts/fetch_mun.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* -------------------------------- Helpers -------------------------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => {
  for (let i = 0; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t === `--${k}`) return process.argv[i + 1] ?? d;
    if (t.startsWith(`--${k}=`)) return t.split("=", 2)[1] || d;
  }
  return d;
};
const getFeeds = () => {
  const feeds = [];
  for (let i = 0; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t === "--feed" && process.argv[i + 1]) {
      process.argv[i + 1].split(",").map(s => s.trim()).filter(Boolean).forEach(u => feeds.push(u));
    } else if (t.startsWith("--feed=")) {
      t.split("=", 2)[1].split(",").map(s => s.trim()).filter(Boolean).forEach(u => feeds.push(u));
    }
  }
  return Array.from(new Set(feeds));
};
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const pick  = (...vals) => vals.find(v => v && clean(v)) || "";

/* ------------------------------- Constants -------------------------------- */
const OUT          = path.join(__dirname, "..", "public", "data", "all.json");
const SLUG         = arg("slug", "Biomedical");
const LIMIT        = Number(arg("limit", "0")) || 0;
const FEEDS        = getFeeds();
const CONCURRENCY  = Math.max(2, Number(arg("concurrency", "6")) || 6);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/* --------------------------------- HTTP ----------------------------------- */
async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, "Accept": "*/*" } });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  return await res.text();
}
const tryFetchText = async (url) => { try { return await fetchText(url); } catch { return null; } };

/* ------------------------------ Feed builders ----------------------------- */
function buildExportUrls(slug) {
  const slugPath = slug.split("/").map(encodeURIComponent).join("/");
  const fileStem = slug.replace(/\//g, "_");
  const bases = ["https://research.library.mun.ca", "http://research.library.mun.ca"];
  const formats = [
    { fmt: "RSS2", ext: "rss" }, { fmt: "RSS", ext: "rss" },
    { fmt: "Atom", ext: "xml" }, { fmt: "RDF", ext: "rdf" },
  ];
  const urls = [];
  for (const base of bases) {
    for (const { fmt, ext } of formats) {
      urls.push(`${base}/cgi/exportview/departments/${slugPath}/${fmt}/${fileStem}.${ext}`);
      urls.push(`${base}/cgi/export/view/departments/${slugPath}/${fmt}/${fileStem}.${ext}`);
    }
  }
  return urls;
}

/* ------------------------------- Feed parser ------------------------------ */
function extractIdsFromFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const ids = new Set();
  const harvest = (txt) => {
    if (!txt) return;
    const s = String(txt);
    const re = /\/(?:id\/)?eprint\/(\d+)(?=[\/?#\s"'<]|$)|\/(\d{3,7})(?=[\/.?#\s"'<]|$)/gi;
    let m; while ((m = re.exec(s))) ids.add(m[1] || m[2]);
  };
  $("item").each((_, it) => {
    harvest($(it).find("link").first().text());
    harvest($(it).find("guid").first().text());
    $(it).find("dc\\:identifier, identifier").each((__, n) => harvest($(n).text()));
    harvest($(it).text());
  });
  $("entry").each((_, e) => {
    harvest($(e).find("link[href]").first().attr("href"));
    harvest($(e).find("id").first().text());
    harvest($(e).text());
  });
  $("rdf\\:Description, Description").each((_, d) => {
    harvest($(d).attr("rdf:about")); harvest($(d).attr("about"));
  });
  harvest(xml);
  return Array.from(ids);
}

/* ------------------------- Resolve ID -> working URL ---------------------- */
function makeUrlVariantsForId(id) {
  const roots = [
    `https://research.library.mun.ca/id/eprint/${id}/`,
    `http://research.library.mun.ca/id/eprint/${id}/`,
    `https://research.library.mun.ca/${id}/`,
    `http://research.library.mun.ca/${id}/`,
  ];
  const set = new Set();
  for (const u of roots) {
    set.add(u);
    if (u.endsWith("/")) set.add(u.slice(0, -1) + ".html");
    else if (!u.endsWith(".html")) set.add(u + ".html");
  }
  return Array.from(set);
}
async function resolveWorkingItemUrl(id) {
  for (const u of makeUrlVariantsForId(id)) {
    const html = await tryFetchText(u);
    if (html) return { url: u, html };
  }
  return null;
}

/* ------------------------------ Authors utils ----------------------------- */
function normalizeName(n) {
  if (!n) return null;
  let v = clean(n);
  if (!v || /^(unknown|n\/a|null|none)$/i.test(v)) return null;
  return v.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
}
function authorsFromHtml(html) {
  const $ = cheerio.load(html);
  const set = new Set();
  const push = (t) => { const n = normalizeName(t); if (n) set.add(n); };

  $(".person_name, .ep_person_name, .name").each((_, el) => {
    const fam = clean($(el).find(".family, .ep_family").text());
    const giv = clean($(el).find(".given, .ep_given").text());
    if (fam && giv) push(`${fam}, ${giv}`); else push($(el).text());
  });
  $("ul.creators li, ul.ep_creators li, .creators li").each((_, li) => {
    const fam = clean($(li).find(".family, .ep_family").text());
    const giv = clean($(li).find(".given, .ep_given").text());
    if (fam && giv) push(`${fam}, ${giv}`); else push($(li).text());
  });
  [
    'meta[name="citation_author"]',
    'meta[name="DC.creator"]', 'meta[name="dc.creator"]',
    'meta[name="DC.contributor.author"]', 'meta[name="dc.contributor.author"]',
    'meta[name="eprints.creators_name"]',
    'meta[name="eprints.creators_name_family"]',
    'meta[name="eprints.creators_name_given"]',
  ].forEach(sel => { $(sel).each((_, m) => push($(m).attr("content"))); });

  if (set.size === 0) {
    const row = $("tr").filter((_, tr) => {
      const th = $(tr).find("th,dt").first().text().toLowerCase();
      return /(creator|author)\b/.test(th);
    }).first();
    const raw = clean(row.find("td,dd").text());
    if (raw) {
      let parts = raw.split(/[;•|\n\r]+/).map(clean).filter(Boolean);
      if (parts.length <= 1) parts = raw.split(/\s+\band\b\s+/i).map(clean).filter(Boolean);
      if (parts.length <= 1 && /,/.test(raw)) {
        const bits = raw.split(",").map(clean).filter(Boolean);
        for (let i = 0; i < bits.length; i++) {
          const a = bits[i]; const b = bits[i + 1];
          if (b && /^[A-Z]/i.test(b)) { push(`${a}, ${b}`); i++; } else { push(a); }
        }
      } else parts.forEach(push);
    }
  }
  return Array.from(set);
}
async function authorsFromExport(id) {
  const set = new Set();
  const push = (t) => { const n = normalizeName(t); if (n) set.add(n); };

  const risUrl = `https://research.library.mun.ca/cgi/export/eprint/${id}/RIS/${id}.ris`;
  const ris = await tryFetchText(risUrl);
  if (ris) {
    ris.split(/\r?\n/).forEach(line => { const m = line.match(/^AU\s*-\s*(.+)$/); if (m) push(m[1]); });
    if (set.size) return Array.from(set);
  }

  const dcUrl = `https://research.library.mun.ca/cgi/export/eprint/${id}/DC/${id}.xml`;
  const xml = await tryFetchText(dcUrl);
  if (xml) {
    const $ = cheerio.load(xml, { xmlMode: true });
    $("dc\\:creator, creator").each((_, el) => push($(el).text()));
  }
  return Array.from(set);
}

/* --------------------------- Month / core parsing ------------------------- */
const MONTH_RX = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };

function parseItemCore(html, url, idGuess = null) {
  const $ = cheerio.load(html);

  const title = clean(pick(
    $('meta[name="DC.Title"]').attr("content"),
    $('meta[name="DC.title"]').attr("content"),
    $('meta[name="citation_title"]').attr("content"),
    $('meta[property="og:title"]').attr("content"),
    $("h1").first().text(), $("h2").first().text()
  )) || "Untitled";

  const department = clean(pick(
    $('meta[name="eprints.department"]').attr("content"),
    $('meta[name="eprints.divisions"]').attr("content"),
    $('th:contains("Department"), td:contains("Department")').first().parent().find("td,dd").last().text(),
    $('th:contains("Faculty"), td:contains("Faculty")').first().parent().find("td,dd").last().text()
  ));

  const degree = clean(pick(
    $('meta[name="eprints.thesis_type"]').attr("content"),
    $('th:contains("Thesis Type"), td:contains("Thesis Type")').first().parent().find("td,dd").last().text(),
    $('th:contains("Degree"), td:contains("Degree")').first().parent().find("td,dd").last().text(),
    $('th:contains("Type"), td:contains("Type")').first().parent().find("td,dd").last().text()
  )) || "Unspecified";

  const rawDate = pick(
    $('meta[name="DC.date.issued"]').attr("content"),
    $('meta[name="dc.date.issued"]').attr("content"),
    $('meta[name="citation_date"]').attr("content"),
    $('meta[name="eprints.date"]').attr("content"),
    $('th:contains("Date"), td:contains("Date")').first().parent().find("td,dd").last().text(),
    $('th:contains("Year"), td:contains("Year")').first().parent().find("td,dd").last().text()
  );

  let year = null;
  if (rawDate) {
    const ym = String(rawDate).match(/\b(19|20)\d{2}\b/);
    if (ym) year = Number(ym[0]);
  }

  const dateTypeCell = $('th:contains("Date Type"), td:contains("Date Type")').first().parent().find("td,dd").last().text();
  const citationDate  = $('meta[name="citation_date"]').attr("content"); // e.g. 2025-05-01 or 2025/05/01
  const blob          = [dateTypeCell, citationDate, rawDate].filter(Boolean).join(" ");

  let month = null;
  const mWord = (blob.match(MONTH_RX) || [])[0];
  if (mWord) month = MONTH_MAP[mWord.toLowerCase()];
  if (!month && citationDate) {
    const m = citationDate.match(/-(\d{2})\b|\/(\d{2})\b/);
    if (m) month = Number(m[1] || m[2]) || null;
  }

  const metaId   = $('meta[name="eprints.eprintid"]').attr("content");
  const idFromUrl = (url.match(/\/(\d+)(?:\/|\.html)?$/) || [])[1];
  const id = metaId || idFromUrl || idGuess || null;

  return { id, title, department, degree, year: typeof year === "number" ? year : null, month: month || null };
}

/* ----------------------------------- Main --------------------------------- */
async function run() {
  // 1) get feed(s)
  let xmlBlobs = [];
  if (FEEDS.length) {
    console.log(`Using provided feeds (${FEEDS.length}):`);
    for (const u of FEEDS) console.log("  -", u);
    for (let i = 0; i < FEEDS.length; i++) {
      const u = FEEDS[i];
      const xml = await tryFetchText(u);
      if (xml) {
        xmlBlobs.push(xml);
        if (i === 0) try { await fs.writeFile(path.join(__dirname, "last_feed.xml"), xml, "utf8"); } catch {}
      } else console.warn("  skip feed", u);
      await SLEEP(40);
    }
  } else {
    console.log("No --feed provided; trying export feeds for slug:", SLUG);
    const tries = buildExportUrls(SLUG);
    let chosen = null, xml = null;
    for (const u of tries) { xml = await tryFetchText(u); if (xml) { chosen = u; break; } }
    if (!chosen || !xml) {
      console.error("Tried export URLs:"); tries.forEach(u => console.error("  -", u));
      throw new Error("No working export feed URL found.");
    }
    xmlBlobs.push(xml);
    try { await fs.writeFile(path.join(__dirname, "last_feed.xml"), xml, "utf8"); } catch {}
  }
  if (!xmlBlobs.length) throw new Error("No feeds could be fetched.");

  // 2) to IDs
  let ids = [];
  for (const xml of xmlBlobs) ids.push(...extractIdsFromFeed(xml));
  ids = Array.from(new Set(ids));
  if (LIMIT > 0) ids = ids.slice(0, LIMIT);
  if (!ids.length) throw new Error("Feeds returned no eprint IDs.");
  console.log(`Resolving ${ids.length} items to working pages…`);

  // 3) Resolve + parse (concurrency)
  const queue = [...ids];
  const records = [];
  let processed = 0;

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const resolved = await resolveWorkingItemUrl(id);
      if (!resolved) { console.warn(`  skip id ${id} -> no working URL`); processed++; continue; }

      try {
        const core = parseItemCore(resolved.html, resolved.url, id);

        // authors: html first, then try export (prefer multi-author export list)
        let authors = authorsFromHtml(resolved.html);
        if (core.id) {
          const extra = await authorsFromExport(core.id);
          authors = extra.length > 1
            ? extra.map(normalizeName).filter(Boolean)
            : Array.from(new Set([...authors, ...extra].map(normalizeName).filter(Boolean)));
        }

        records.push({
          title: core.title,
          authors,
          year: core.year,
          month: core.month || null,
          department: core.department || SLUG,
          degree: core.degree,
          url: resolved.url,
        });
      } catch (e) {
        console.warn(`  parse fail for id ${id} -> ${e.message}`);
      }

      processed++;
      if (processed % 10 === 0) console.log(`  processed ${processed}/${ids.length} (kept ${records.length})`);
      await SLEEP(30);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // 4) write
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(records, null, 2), "utf8");
  console.log(`Saved ${records.length} records to ${OUT}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });