/**
 * Animated Repo Cards (2-up carousel, SMIL-only)
 * Slides run in sequence and the sequence repeats forever (correct global loop).
 * Now each card links to its repo.
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/repo-slide.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const GH_USER  = process.env.GH_USER || "statikfintechllc";
const REPOS_ENV = (process.env.REPOS || "").trim();
const PAGE_SEC  = Number(process.env.REPO_PAGE_SEC || 6);
const HOLD_FRAC = 0.55;
const EASE_IN   = "0.25 0.1 0.25 1";
const EASE_HOLD = "0.25 0.1 0.25 1";
const EASE_OUT  = "0.42 0 0.58 1";
const LINEAR    = "0 0 1 1";

if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");

// -------------------- GraphQL --------------------
const gql = async (query, variables = {}, attempt = 1) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ggpt-boost-repos"
    },
    body: JSON.stringify({ query, variables })
  });
  if (r.status >= 500 && attempt < 5) {
    await new Promise(res => setTimeout(res, attempt * 400));
    return gql(query, variables, attempt + 1);
  }
  if (!r.ok) throw new Error(`GraphQL ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
};

const qPinned = `
query($login:String!){
  user(login:$login){
    pinnedItems(first:12, types:[REPOSITORY]){
      nodes{
        ... on Repository { nameWithOwner name description stargazerCount forkCount isArchived }
      }
    }
  }
}`;

const qTop = `
query($login:String!){
  user(login:$login){
    repositories(first:50, ownerAffiliations:[OWNER], isFork:false, orderBy:{field:STARGAZERS, direction:DESC}){
      nodes{ nameWithOwner name description stargazerCount forkCount isArchived }
    }
  }
}`;

const qRepo = `
query($owner:String!, $name:String!){
  repository(owner:$owner, name:$name){
    nameWithOwner
    name
    description
    stargazerCount
    forkCount
    primaryLanguage{ name color }
    languages(first:25, orderBy:{field:SIZE, direction:DESC}){
      totalSize
      edges{ size node{ name color } }
    }
  }
}`;

const parseEnvRepos = (raw) => raw
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => {
    if (s.includes("/")) {
      const [owner, name] = s.split("/");
      return { owner, name };
    }
    return { owner: GH_USER, name: s };
  });

const xmlEsc = (s="") => s
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;")
  .replace(/'/g,"&apos;");

const starIcon = `
<path fill="none" stroke="#8abecf" stroke-width="2"
  d="M12 2.5l2.68 5.43 5.82.85-4.2 4.09.99 5.8L12 16.6 6.71 18.67l.99-5.8-4.2-4.09 5.82-.85L12 2.5z"/>
`;

const forkIcon = `
<path fill="#8abecf" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.25 2.25 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
`;

const takeRepos = async () => {
  if (REPOS_ENV) return parseEnvRepos(REPOS_ENV);

  const p = await gql(qPinned, { login: GH_USER });
  const pins = (p.user?.pinnedItems?.nodes || [])
    .filter(n => n && !n.isArchived)
    .slice(0, 12)
    .map(n => {
      const [owner, ...rest] = n.nameWithOwner.split("/");
      return { owner, name: rest.join("/") };
    });

  if (pins.length >= 2) return pins.slice(0, 12);

  const t = await gql(qTop, { login: GH_USER });
  const tops = (t.user?.repositories?.nodes || [])
    .filter(n => !n.isArchived)
    .slice(0, 12)
    .map(n => {
      const [owner, ...rest] = n.nameWithOwner.split("/");
      return { owner, name: rest.join("/") };
    });

  return tops.slice(0, 12);
};

const fetchRepoDetails = async (lst) => {
  const out = [];
  for (const { owner, name } of lst) {
    const d = await gql(qRepo, { owner, name });
    const r = d.repository;
    if (!r) continue;
    const langs = r.languages?.edges || [];
    const total = r.languages?.totalSize || 0;

    const segs = langs.map(e => {
      const w = total ? e.size / total : 0;
      return { name: e.node.name, color: e.node.color || "#374151", weight: w };
    }).filter(s => s.weight > 0);

    if (segs.length === 0) segs.push({ name: r.primaryLanguage?.name || "Other", color: r.primaryLanguage?.color || "#6b7280", weight: 1 });

    out.push({
      owner, name: r.name, full: r.nameWithOwner,
      desc: r.description || "",
      stars: r.stargazerCount || 0,
      forks: r.forkCount || 0,
      segments: segs.slice(0, 8)
    });
  }
  return out;
};

// ---------- Build SVG ----------
const W = 880, H = 280, CW = 420, CH = 230, G = 40;
const x0 = (W - (2 * CW + G)) / 2;
const TITLE = (s) => xmlEsc(s);
const DESC  = (s) => xmlEsc((s || "").replace(/\s+/g," ").trim());

// --------- text wrap ----------
function wrapTextToBox(text, boxWidthPx, boxHeightPx, options = {}) {
  let font = options.fontSize ?? 13;
  const minFont  = options.minFontSize ?? 9;
  const linePad  = options.linePad ?? 2;
  const avgChar  = options.avgChar ?? 0.58;

  const words = text.split(/\s+/).filter(Boolean);

  while (font >= minFont) {
    const lineHeight = font + linePad;
    const maxLines = Math.max(1, Math.floor(boxHeightPx / lineHeight));
    const charsPerLine = Math.max(8, Math.floor(boxWidthPx / (font * avgChar)));

    const lines = [];
    let cur = "";

    for (const w of words) {
      const cand = cur ? cur + " " + w : w;
      if (cand.length <= charsPerLine) cur = cand;
      else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
    }
    if (lines.length < maxLines && cur) lines.push(cur);

    const placed = lines.join(" ").trim().split(/\s+/).filter(Boolean).length;
    if (placed >= words.length) return { lines, font, lineHeight };
    font -= 1;
  }
  // fallback
  const lineHeight = minFont + linePad;
  const maxLines = Math.max(1, Math.floor(boxHeightPx / lineHeight));
  const charsPerLine = Math.max(8, Math.floor(boxWidthPx / (minFont * 0.58)));
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (cand.length <= charsPerLine) cur = cand;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  return { lines, font: minFont, lineHeight };
}

// ----- Card -----
const card = (repo, x) => {
  const px = 20, pw = CW - 40;
  const py = 165, ph = 12;

  // Language segments (min width)
  let acc = 0;
  const minw = 0.04;
  const totalWeight = repo.segments.reduce((a,b)=>a+b.weight,0) || 1;
  const segs = repo.segments.map(s => ({...s, weight: s.weight / totalWeight}));
  const hard = segs.map(s => Math.max(s.weight, minw));
  const hardSum = hard.reduce((a,b)=>a+b,0);
  const norm = hard.map(v => v / hardSum);

  const bars = norm.map((w, i) => {
    const wpx = Math.round(w * pw);
    const xseg = px + acc;
    acc += wpx;
    const s = segs[i];
    return `<rect x="${xseg}" y="${py}" width="${i === norm.length-1 ? (px+pw - xseg) : wpx}" height="${ph}" fill="${s.color}" />`;
  }).join("");

  const legends = segs.slice(0,4).map((s,i)=> {
    const lx = px + (i % 2) * 190;
    const ly = py + 30 + Math.floor(i / 2) * 12;
    return `<rect x="${lx}" y="${ly-8}" width="8" height="8" rx="2" fill="${s.color}"/><text x="${lx+12}" y="${ly}" class="legend">${xmlEsc(s.name)}</text>`;
  }).join("");

  // Title (≤2 lines)
  const titleText = TITLE(repo.name);
  const titleLines = [];
  const maxTitleCharsPerLine = 40;
  const maxTitleLines = 2;
  if (titleText.length > maxTitleCharsPerLine) {
    const words = titleText.split(/[\s-]+/);
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (t.length <= maxTitleCharsPerLine) cur = t;
      else { titleLines.push(cur); cur = w; if (titleLines.length === maxTitleLines - 1) break; }
    }
    if (cur && titleLines.length < maxTitleLines) titleLines.push(cur.length > maxTitleCharsPerLine ? (cur.slice(0, maxTitleCharsPerLine - 1) + "…") : cur);
  } else {
    titleLines.push(titleText);
  }
  const titleSvg = titleLines.map((line,i)=>
    `<text x="${px}" y="${30 + i*20}" class="name">${line}</text>`
  ).join("");

  // Description block – fit inside box
  const descTop = titleLines.length > 1 ? 70 : 54;
  const descBottom = 130;
  const descHeight = Math.max(12, Math.floor(descBottom - descTop));
  const wrap = wrapTextToBox(DESC(repo.desc), pw, descHeight, { fontSize:13, minFontSize:9, linePad:2 });

  const descSvg = wrap.lines.map((line, i) =>
    `<text x="${px}" y="${descTop + i * wrap.lineHeight}" style="font:400 ${wrap.font}px system-ui" class="desc">${line}</text>`
  ).join("");

  return `
  <a xlink:href="https://github.com/${repo.full}" target="_blank">
    <g transform="translate(${x},20)">
      <rect x="0" y="0" rx="14" ry="14" width="${CW}" height="${CH}" fill="#0b1220" stroke="#1f2937"/>
      ${titleSvg}
      ${descSvg}
      <!-- Stars and forks -->
      <g class="badges" transform="translate(0,135)">
        <g transform="translate(${CW-180},0)">
          <rect x="0" y="-12" rx="10" ry="10" width="78" height="20" fill="#111827" stroke="#1f2937"/>
          <g transform="translate(8, -9)">
            <svg viewBox="0 0 24 24" width="16" height="16">${starIcon}</svg>
          </g>
          <text x="26" y="2" class="pill">${repo.stars.toLocaleString()}</text>
        </g>
        <g transform="translate(${CW-90},0)">
          <rect x="0" y="-12" rx="10" ry="10" width="78" height="20" fill="#111827" stroke="#1f2937"/>
          <g transform="translate(4, -9)">
            <svg viewBox="0 0 24 24" width="18" height="18">${forkIcon}</svg>
          </g>
          <text x="26" y="2" class="pill">${repo.forks.toLocaleString()}</text>
        </g>
      </g>
      ${bars}
      ${legends}
    </g>
  </a>`;
};

// ------------- BUILD (global-cycle loop; no master clock) -------------
const buildRepoSvg = (repos) => {
  const pages = [];
  for (let i = 0; i < repos.length; i += 2) pages.push(repos.slice(i, i + 2));
  const N = Math.max(1, pages.length);
  const totalDur = N * PAGE_SEC;

  const enterK = ((1 - HOLD_FRAC) / 2);
  const exitK  = (1 - (1 - HOLD_FRAC) / 2);

  let slides = "";
  pages.forEach((pg, i) => {
    const t0 = (i * PAGE_SEC) / totalDur;
    const t1 = ((i + 1) * PAGE_SEC) / totalDur;

    const kin =  t0 + (enterK * PAGE_SEC) / totalDur;
    const khold = t0 + (exitK  * PAGE_SEC) / totalDur;

    const keyTimes = `0;${t0.toFixed(4)};${kin.toFixed(4)};${khold.toFixed(4)};${t1.toFixed(4)};1`;
    const values = `${W};${W};0;0;${-W};${-W}`;
    const keySplines = `${LINEAR}; ${EASE_IN}; ${EASE_HOLD}; ${EASE_OUT}; ${LINEAR}`;

    slides += `
    <g class="slide" transform="translate(${W},0)" clip-path="url(#frame)">
      ${card(pg[0], x0)}${pg[1] ? card(pg[1], x0 + CW + G) : ""}
      <animateTransform attributeName="transform" type="translate"
        values="${values}"
        keyTimes="${keyTimes}"
        keySplines="${keySplines}"
        calcMode="spline"
        dur="${totalDur}s"
        begin="0s"
        repeatCount="indefinite"/>
    </g>`;
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">
  <style>
    :root{ color-scheme: dark; }
    .name{ font:800 18px system-ui; fill:#e5e7eb }
    .desc{ fill:#9ca3af }
    .pill{ font:700 12px system-ui; fill:#e5e7eb }
    .legend{ font:600 12px system-ui; fill:#cbd5e1 }
    a:hover .name, a:hover .desc { text-decoration: underline; }
  </style>
  <defs>
    <clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}" rx="8" ry="8"/></clipPath>
  </defs>
  ${slides}
</svg>`;
  return svg;
};

(async () => {
  const list = await takeRepos();
  if (!list.length) throw new Error("No repositories selected");
  const details = await fetchRepoDetails(list.slice(0, 12));
  const svg = buildRepoSvg(details);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, svg, "utf8");
  console.log("wrote", OUT);
})();
