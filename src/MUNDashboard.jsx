// src/MUNDashboard.jsx
import React, {
  useEffect, useMemo, useState, useCallback, useDeferredValue,
} from "react";
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Brush,
  PieChart, Pie, Cell,
  LineChart, Line, Area
} from "recharts";

/* ------------------------------ Theme ------------------------------------ */
const COLOR_MASTERS  = "#2563eb";
const COLOR_DOCTORAL = "#10b981";
const COLOR_GRID     = "#e5e7eb";
const MONTH_LABELS   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ------------------------------ Utils ------------------------------------ */
function withBase(p) {
  const path = String(p || "").replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${path}`;
}

async function tryFetchJson(relPath) {
  try {
    const res = await fetch(withBase(relPath), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeRecord(raw, idx = 0) {
  const s = (v) => (v === undefined || v === null ? "" : v);

  const title  = String(s(raw.title || raw.name)).trim() || "Untitled";
  const degree = s(raw.degree || raw.level || raw.type) || "Unspecified";

  // keep these empty to save memory
  const department = "";
  const program    = "";

  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((t) => String(t || "").trim()).filter(Boolean)
    : String(s(raw.author || raw.authors)).split(/;|,| and | & /i).map((t) => t.trim()).filter(Boolean);

  let year = null, month = null;
  if (typeof raw.year === "number") year = raw.year;
  if (typeof raw.month === "number" && raw.month >= 1 && raw.month <= 12) month = raw.month;

  const url    = s(raw.url || raw.href || raw.link) || "";
  const idBase = s(raw.id || raw.eprintid || `${title}-${url}`) || `row-${idx}`;

  const lcTitle   = title.toLowerCase();
  const lcAuthors = authors.join(" ").toLowerCase();
  const degreeKey = (degree || "Unspecified").toLowerCase();

  return {
    id: String(idBase).slice(0, 160),
    title, degree, department, program, authors, year, month, url,
    lcTitle, lcAuthors, degreeKey,
  };
}

/* ------------------------------ Component -------------------------------- */
export default function MUNDashboard() {
  /* Load */
  const [raw, setRaw]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      const data = await tryFetchJson("data/all.json");
      const arr  = Array.isArray(data) ? data : [];
      setRaw(arr.map((d, i) => normalizeRecord(d, i)));
      if (!arr.length) setError("No data found in public/data/all.json");
      setLoading(false);
    })();
  }, []);

  /* Global year bounds */
  const [globalMinYear, globalMaxYear] = useMemo(() => {
    const ys = raw.map(d => d.year).filter((n) => typeof n === "number");
    return [ ys.length ? Math.min(...ys) : 1990,
             ys.length ? Math.max(...ys) : new Date().getFullYear() ];
  }, [raw]);

  /* Controls */
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.toLowerCase());
  const [degreeFilter, setDegreeFilter] = useState("all");
  const [yearRange, setYearRange] = useState([1990, new Date().getFullYear()]);

  useEffect(() => {
    setYearRange([globalMinYear, globalMaxYear]);
  }, [globalMinYear, globalMaxYear]);

  /* Chart selections */
  const [selectedYear, setSelectedYear]     = useState(null);
  const [selectedDegree, setSelectedDegree] = useState(null); // "masters" | "doctoral" | null
  const [selectedMonth, setSelectedMonth]   = useState(null);  // 1..12 | null

  /* Degree options */
  const degreeOptions = useMemo(() => {
    const bad  = /^\s*view\s*item\s*$/i;
    const uniq = Array.from(new Set(raw.map((d) => d.degree || "Unspecified")));
    return ["all", ...uniq.filter(v => !bad.test(v)).sort()];
  }, [raw]);

  /* --- Base filters (with and without yearRange) -------------------------- */
  // 1) filter that IGNORES yearRange (used to build the Brush domain + year bars)
  const filteredNoYear = useMemo(() => {
    const query = dq.trim();
    const degreeFilterKey = degreeFilter === "all" ? null : degreeFilter.toLowerCase();
    return raw.filter((d) => {
      const inDegree = !degreeFilterKey || d.degreeKey === degreeFilterKey;
      const inQuery  = !query || d.lcTitle.includes(query) || d.lcAuthors.includes(query) || d.degreeKey.includes(query);
      return inDegree && inQuery; // <-- no year filter here
    });
  }, [raw, dq, degreeFilter]);

  // 2) normal filter that APPLIES yearRange (drives the rest of the dashboard)
  const filtered = useMemo(() => {
    const query = dq.trim();
    const degreeFilterKey = degreeFilter === "all" ? null : degreeFilter.toLowerCase();
    return raw.filter((d) => {
      const inYear   = !d.year || (d.year >= yearRange[0] && d.year <= yearRange[1]);
      const inDegree = !degreeFilterKey || d.degreeKey === degreeFilterKey;
      const inQuery  = !query || d.lcTitle.includes(query) || d.lcAuthors.includes(query) || d.degreeKey.includes(query);
      return inYear && inDegree && inQuery;
    });
  }, [raw, dq, degreeFilter, yearRange]);

  /* Selection layer on top of the year‑filtered set */
  const interactive = useMemo(() => {
    const degKey = selectedDegree?.toLowerCase?.() ?? null;
    return filtered.filter(d =>
      (selectedYear  ? d.year  === selectedYear  : true) &&
      (degKey        ? d.degreeKey === degKey    : true) &&
      (selectedMonth ? d.month === selectedMonth : true)
    );
  }, [filtered, selectedYear, selectedDegree, selectedMonth]);

  /* KPIs */
  const kpis = useMemo(() => {
    const ys = interactive.map(d => d.year).filter((n) => typeof n === "number").sort((a,b)=>a-b);
    const span = ys.length ? `${ys[0]}–${ys[ys.length - 1]}` : "—";
    const uniqAuthors = new Set(interactive.flatMap(d => d.authors || [])).size;
    const thisYear = new Date().getFullYear();
    return {
      total: interactive.length,
      uniqAuthors,
      span,
      thisYearCount: interactive.filter(d => d.year === thisYear).length
    };
  }, [interactive]);

  /* ---------------- Aggregations ---------------- */
  // A) Year totals built from filteredNoYear (so Brush domain never collapses)
  const yearDegreeDataAllYears = useMemo(() => {
    const map = new Map();
    for (const d of filteredNoYear) {
      if (typeof d.year !== "number") continue;
      if (selectedDegree && d.degreeKey !== selectedDegree) continue;
      if (selectedMonth  && d.month !== selectedMonth) continue;
      const row = map.get(d.year) || { year: d.year, masters: 0, doctoral: 0 };
      if (d.degreeKey === "masters")  row.masters  += 1;
      if (d.degreeKey === "doctoral") row.doctoral += 1;
      map.set(d.year, row);
    }
    return Array.from(map.values()).sort((a, b) => a.year - b.year);
  }, [filteredNoYear, selectedDegree, selectedMonth]);

  // B) Year totals built from the normal filtered set (used by trends etc.)
  const yearDegreeData = useMemo(() => {
    const map = new Map();
    for (const d of filtered) {
      if (typeof d.year !== "number") continue;
      if (selectedDegree && d.degreeKey !== selectedDegree) continue;
      if (selectedMonth  && d.month !== selectedMonth) continue;
      const row = map.get(d.year) || { year: d.year, masters: 0, doctoral: 0 };
      if (d.degreeKey === "masters")  row.masters  += 1;
      if (d.degreeKey === "doctoral") row.doctoral += 1;
      map.set(d.year, row);
    }
    return Array.from(map.values()).sort((a, b) => a.year - b.year);
  }, [filtered, selectedDegree, selectedMonth]);

  // C) Month totals (only when a specific year is selected)
  const monthDegreeData = useMemo(() => {
    if (!selectedYear) return [];
    const base = Array.from({ length: 12 }, (_, i) => ({ key: i + 1, masters: 0, doctoral: 0 }));
    for (const d of filtered) {
      if (d.year !== selectedYear) continue;
      if (!d.month || d.month < 1 || d.month > 12) continue;
      if (selectedDegree && d.degreeKey !== selectedDegree) continue;
      if (d.degreeKey === "masters")  base[d.month - 1].masters  += 1;
      if (d.degreeKey === "doctoral") base[d.month - 1].doctoral += 1;
    }
    return base.some(r => r.masters || r.doctoral) ? base : [];
  }, [filtered, selectedYear, selectedDegree]);

  const hasMonthly = monthDegreeData.length > 0;

  // Seasonality
  const seasonalityData = useMemo(() => {
    const base = Array.from({ length: 12 }, (_, i) => ({ month: MONTH_LABELS[i], masters: 0, doctoral: 0 }));
    for (const d of filtered) {
      if (!d.month || d.month < 1 || d.month > 12) continue;
      if (selectedYear   && d.year !== selectedYear) continue;
      if (selectedDegree && d.degreeKey !== selectedDegree) continue;
      if (d.degreeKey === "masters")  base[d.month - 1].masters  += 1;
      if (d.degreeKey === "doctoral") base[d.month - 1].doctoral += 1;
    }
    return base;
  }, [filtered, selectedYear, selectedDegree]);

  // Pie
  const pieData = useMemo(() => {
    let masters = 0, doctoral = 0;
    for (const d of interactive) {
      if (d.degreeKey === "masters")  masters  += 1;
      if (d.degreeKey === "doctoral") doctoral += 1;
    }
    return [{ name: "Masters", value: masters }, { name: "Doctoral", value: doctoral }];
  }, [interactive]);

  /* ---------------- Brush wiring (controlled) ------------------------------ */
  // domain for the Brush must come from the same data the Brush is attached to
  const yearDomain = useMemo(() => yearDegreeDataAllYears.map(r => r.year), [yearDegreeDataAllYears]);

  const brushStartIndex = useMemo(() => {
    if (!yearDomain.length) return 0;
    const i = yearDomain.findIndex(v => v >= yearRange[0]);
    return i === -1 ? 0 : i;
  }, [yearDomain, yearRange]);

  const brushEndIndex = useMemo(() => {
    if (!yearDomain.length) return 0;
    let i = yearDomain.findIndex(v => v > yearRange[1]);
    if (i === -1) i = yearDomain.length;
    return Math.max(brushStartIndex, i - 1);
  }, [yearDomain, yearRange, brushStartIndex]);

  const onBrushChange = useCallback((r) => {
    if (!r || !yearDomain.length) return;
    const start = Math.max(0, r.startIndex ?? 0);
    const end   = Math.max(start, r.endIndex ?? (yearDomain.length - 1));
    const from  = yearDomain[start];
    const to    = yearDomain[end];
    if (Number.isFinite(from) && Number.isFinite(to)) {
      setSelectedYear(null);
      setSelectedMonth(null);
      setYearRange([Math.min(from, to), Math.max(from, to)]);
    }
  }, [yearDomain]);

  /* ---------------- Events ---------------- */
  const handleYearBarClick = useCallback((e) => {
    const yr = Number(e?.payload?.year);
    if (!yr) return;
    setSelectedYear(prev => (prev === yr ? null : yr));
    setSelectedMonth(null);
  }, []);

  const handleMonthBarClick = useCallback(() => {
    setSelectedYear(null);
    setSelectedMonth(null);
  }, []);

  const handleSeasonalityBarClick = useCallback((payload) => {
    const idx = MONTH_LABELS.indexOf(payload?.month);
    if (idx < 0) return;
    const m = idx + 1;
    setSelectedMonth(prev => (prev === m ? null : m));
  }, []);

  const handlePieClick = useCallback((entry) => {
    const key = String(entry?.name || "").toLowerCase();
    if (!key) return;
    setSelectedDegree(prev => (prev === key ? null : key));
  }, []);

  const clearChartSelections = useCallback(() => {
    setSelectedYear(null);
    setSelectedDegree(null);
    setSelectedMonth(null);
  }, []);

  /* ---------------- UI ---------------- */
  return (
    <div className="wrap" style={{ maxWidth: 1280, margin: "16px auto", padding: "0 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, minWidth: 0 }}>
        <img src="/mun-logo.png" alt="Memorial University" style={{ height: 90, width: "auto" }} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, lineHeight: 1.25 }}>
            Population Health and Applied Health Sciences | Faculty of Medicine
          </h1>
          <div style={{ color: "#090909", fontSize: 26, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Research Data Metrics
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(12, 1fr)", alignItems: "end", marginBottom: 8 }}>
        <div className="box" style={{ gridColumn: "span 3" }}>
          <label>Degree</label>
          <select value={degreeFilter} onChange={(e) => setDegreeFilter(e.target.value)} style={{ width: "100%" }}>
            {degreeOptions.map((d) => (<option key={d} value={d}>{d === "all" ? "All" : d}</option>))}
          </select>
        </div>
        <div className="box" style={{ gridColumn: "span 9" }}>
          <div style={{
            display: "flex", alignItems: "center",
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "6px 10px",
            boxShadow: "0 1px 0 rgba(0,0,0,0.02), inset 0 0 0 1px rgba(255,255,255,0.6)"
          }}>
            <span style={{ fontSize: 14, marginRight: 8, opacity: 0.65 }}>🔎</span>
            <input
              placeholder="Title, author, degree…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ border: "none", outline: "none", width: "100%", fontSize: 14, background: "transparent", padding: "6px 2px" }}
            />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(5, 1fr)", margin: "8px 0 12px" }}>
        {[
          { label: "Total Items", value: kpis.total, accent: "#2563eb", emoji: "📚" },
          { label: "Unique Authors", value: kpis.uniqAuthors, accent: "#7c3aed", emoji: "🧑‍🤝‍🧑" },
          { label: "Year Span", value: kpis.span, accent: "#0ea5e9", emoji: "🗓️" },
          { label: "This Year", value: kpis.thisYearCount, accent: "#10b981", emoji: "✅" },
          { label: "Median Year", value: (() => {
              const ys = interactive.map(d => d.year).filter(n => typeof n === "number").sort((a,b)=>a-b);
              return ys.length ? ys[Math.floor(ys.length/2)] : "—";
            })(), accent: "#f59e0b", emoji: "⚖️" },
        ].map((k) => (
          <div key={k.label} style={{
            background: `linear-gradient(180deg, ${k.accent}14, transparent 70%)`,
            border: `1px solid ${k.accent}2A`,
            borderRadius: 12, padding: "12px 14px"
          }}>
            <div style={{ fontSize: 12, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{k.emoji}</span><span>{k.label}</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, lineHeight: "26px" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Selection chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {selectedYear   && <button className="chip" onClick={() => { setSelectedYear(null); setSelectedMonth(null); }}>Year: {selectedYear} ✕</button>}
        {selectedDegree && <button className="chip" onClick={() => setSelectedDegree(null)}>Degree: {selectedDegree[0].toUpperCase() + selectedDegree.slice(1)} ✕</button>}
        {selectedMonth  && <button className="chip" onClick={() => setSelectedMonth(null)}>Month: {MONTH_LABELS[selectedMonth-1]} ✕</button>}
        {(selectedYear || selectedDegree || selectedMonth) && <button className="chip" onClick={clearChartSelections}>Clear selections ✕</button>}
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1.1fr 0.8fr 1.1fr" }}>
        {/* Year / Month Bar */}
        <div className="box" style={{ height: 300 }}>
          <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
            {hasMonthly ? (
              <>
                Research {selectedYear} by Month
                <button onClick={() => { setSelectedYear(null); setSelectedMonth(null); }} className="chip" style={{ marginLeft: "auto" }}>
                  Back to years
                </button>
              </>
            ) : (
              <>Research by Year{selectedMonth ? ` • ${MONTH_LABELS[selectedMonth-1]}` : ""}</>
            )}
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            {hasMonthly ? (
              <BarChart data={monthDegreeData}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
                <XAxis dataKey="key" tickFormatter={(v) => MONTH_LABELS[((Number(v) || 1) - 1) | 0] || ""} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(v) => MONTH_LABELS[((Number(v) || 1) - 1) | 0] || ""} />
                <Legend />
                <Bar dataKey="masters"  name="Masters"  fill={COLOR_MASTERS}  radius={[3,3,0,0]} onClick={handleMonthBarClick} cursor="pointer" />
                <Bar dataKey="doctoral" name="Doctoral" fill={COLOR_DOCTORAL} radius={[3,3,0,0]} onClick={handleMonthBarClick} cursor="pointer" />
              </BarChart>
            ) : (
              // IMPORTANT: Attach Brush to the all-years data so the domain is stable
              <BarChart data={yearDegreeDataAllYears} margin={{ top: 4, right: 12, left: 8, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
                <XAxis dataKey="year" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="masters"  name="Masters"  fill={COLOR_MASTERS}  onClick={handleYearBarClick} cursor="pointer" radius={[3,3,0,0]} />
                <Bar dataKey="doctoral" name="Doctoral" fill={COLOR_DOCTORAL} onClick={handleYearBarClick} cursor="pointer" radius={[3,3,0,0]} />
                {yearDegreeDataAllYears.length > 1 && (
                  <Brush
                    dataKey="year"
                    height={28}
                    travellerWidth={12}
                    startIndex={brushStartIndex}
                    endIndex={brushEndIndex}
                    onChange={onBrushChange}
                    stroke="#6b7280"
                    fill="#f3f4f6"
                  />
                )}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Program pie */}
        <div className="box" style={{ height: 300 }}>
          <h3 style={{ margin: "0 0 8px" }}>Program</h3>
          <ResponsiveContainer width="100%" height="85%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} onClick={handlePieClick}>
                {pieData.map((row) => (
                  <Cell key={row.name} fill={row.name === "Masters" ? COLOR_MASTERS : COLOR_DOCTORAL} style={{ cursor: "pointer" }} />
                ))}
              </Pie>
              <Tooltip formatter={(v, n) => [v, n]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Trend Lines (no Brush here) */}
        <div className="box" style={{ height: 300 }}>
          <h3 style={{ margin: "0 0 8px" }}>Trends</h3>
          <ResponsiveContainer width="100%" height="85%">
            {selectedYear ? (
              <LineChart data={monthDegreeData}>
                <defs>
                  <linearGradient id="gradMasters" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLOR_MASTERS} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={COLOR_MASTERS} stopOpacity="0.6" />
                  </linearGradient>
                  <linearGradient id="gradDoctoral" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLOR_DOCTORAL} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={COLOR_DOCTORAL} stopOpacity="0.6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
                <XAxis dataKey="key" tickFormatter={(v) => MONTH_LABELS[((Number(v) || 1) - 1) | 0] || ""} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(v) => MONTH_LABELS[((Number(v) || 1) - 1) | 0] || ""} />
                <Legend />
                <Area type="monotone" dataKey="masters" stroke="none" fill="url(#gradMasters)" opacity={0.15} />
                <Area type="monotone" dataKey="doctoral" stroke="none" fill="url(#gradDoctoral)" opacity={0.15} />
                <Line type="monotone" dataKey="masters"  name="Masters"  stroke="url(#gradMasters)"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="doctoral" name="Doctoral" stroke="url(#gradDoctoral)" strokeWidth={2} dot={false} />
              </LineChart>
            ) : (
              <LineChart data={yearDegreeData}>
                <defs>
                  <linearGradient id="gradMasters" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLOR_MASTERS} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={COLOR_MASTERS} stopOpacity="0.6" />
                  </linearGradient>
                  <linearGradient id="gradDoctoral" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLOR_DOCTORAL} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={COLOR_DOCTORAL} stopOpacity="0.6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
                <XAxis dataKey="year" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="masters" stroke="none" fill="url(#gradMasters)" opacity={0.15} />
                <Area type="monotone" dataKey="doctoral" stroke="none" fill="url(#gradDoctoral)" opacity={0.15} />
                <Line type="monotone" dataKey="masters"  name="Masters"  stroke="url(#gradMasters)"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="doctoral" name="Doctoral" stroke="url(#gradDoctoral)" strokeWidth={2} dot={false} />
                {/* No Brush here */}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div className="box" style={{ height: 300 }}>
          <h3 style={{ margin: "0 0 8px" }}>
            By Month
            {selectedYear ? ` • ${selectedYear}` : ` • ${yearRange[0]}–${yearRange[1]}`}
            {selectedDegree ? ` • ${selectedDegree[0].toUpperCase()+selectedDegree.slice(1)}` : ""}
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={seasonalityData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="masters"  name="Masters"  fill={COLOR_MASTERS}  radius={[3,3,0,0]}
                   onClick={({ payload }) => handleSeasonalityBarClick(payload)} cursor="pointer" />
              <Bar dataKey="doctoral" name="Doctoral" fill={COLOR_DOCTORAL} radius={[3,3,0,0]}
                   onClick={({ payload }) => handleSeasonalityBarClick(payload)} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="box" style={{ minHeight: 300, overflow: "auto" }}>
          <h3 style={{ margin: "0 0 8px" }}>Research List</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 6, fontWeight: 600, fontSize: 12, color: "#6b7280" }}>Year</th>
                <th style={{ textAlign: "left", padding: 6, fontWeight: 600, fontSize: 12, color: "#6b7280", width: "60%" }}>Title</th>
                <th style={{ textAlign: "left", padding: 6, fontWeight: 600, fontSize: 12, color: "#6b7280" }}>Degree</th>
                <th style={{ textAlign: "left", padding: 6, fontWeight: 600, fontSize: 12, color: "#6b7280" }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {interactive.slice(0, 20).map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: 6, fontSize: 13, width: 90 }}>
                    {d.year ?? "—"}{d.month ? ` (${MONTH_LABELS[d.month-1]})` : ""}
                  </td>
                  <td style={{ padding: 6, fontSize: 13, maxWidth: 420, wordBreak: "break-word", whiteSpace: "normal" }}>
                    {d.title}
                  </td>
                  <td style={{ padding: 6, fontSize: 13 }}>{d.degree}</td>
                  <td style={{ padding: 6, fontSize: 13 }}>
                    {d.url ? <a href={d.url} target="_blank" rel="noreferrer">Open</a> : "—"}
                  </td>
                </tr>
              ))}
              {!interactive.length && (
                <tr><td colSpan="4" style={{ padding: 18, textAlign: "center", color: "#6b7280" }}>No results.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            Showing {Math.min(20, interactive.length)} of {interactive.length}
          </div>
        </div>
      </div>

      {loading && <div className="box" style={{ marginTop: 12, textAlign: "center" }}>Loading…</div>}
      {error &&   <div className="box" style={{ marginTop: 12, color: "#b91c1c", background: "#fee2e2" }}>{error}</div>}
    </div>
  );
}
