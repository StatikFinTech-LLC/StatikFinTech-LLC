/**
 * Animated Trophies (2-card carousel, center dwell, crisp text)
 * Data: lifetime window (createdAt -> now), stars=sum(stargazerCount of owned non-fork repos)
 * Output: assets/trophies.svg
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "assets/trophies.svg");
const GH_TOKEN = process.env.PAT_GITHUB;
const USER = process.env.GH_USER || "statikfintechllc";

// tuning (seconds)
const PAGE_SEC = Number(process.env.TROPHIES_PAGE_SEC || 6);  // seconds each page is visible
const HOLD_FRAC = 0.75;                                       // fraction of page time holding centered

// keySpline presets
const EASE_IN   = "0.25 0.1 0.25 1";
const EASE_HOLD = "0.25 0.1 0.25 1";
const EASE_OUT  = "0.42 0 0.58 1";
const LINEAR    = "0 0 1 1";

if (!GH_TOKEN) throw new Error("PAT_GITHUB env missing");

// -------------------- GraphQL helper --------------------
const gql = async (query, variables = {}, attempt = 1) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ggpt-boost-trophies"
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

// User creation time (lifetime window)
const qUser = `query($login:String!){ user(login:$login){ createdAt } }`;
const who = await gql(qUser, { login: USER });
const fromISO = new Date(who.user.createdAt).toISOString();
const nowISO = new Date().toISOString();

// Sum stars & count owned non-fork repos accurately (pagination)
let starSum = 0;
let repoCount = 0;
let cursor = null;
do {
  const d = await gql(`
    query($login:String!,$cursor:String){
      user(login:$login){
        repositories(affiliations:[OWNER], isFork:false, first:100, after:$cursor){
          totalCount
          nodes{ stargazerCount }
          pageInfo{ hasNextPage endCursor }
        }
      }
    }`, { login: USER, cursor });
  const r = d.user.repositories;
  repoCount = r.totalCount;
  for (const n of r.nodes) starSum += (n.stargazerCount || 0);
  cursor = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
} while (cursor);

// Lifetime contribution & follower stats
const qStats = `
  query($login:String!, $from:DateTime!, $to:DateTime!){
    user(login:$login){
      followers{ totalCount }
      contributionsCollection(from:$from, to:$to){
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoryContributions
        contributionCalendar{ totalContributions }
      }
    }
  }
`;
const stats = await gql(qStats, { login: USER, from: fromISO, to: nowISO });
const c = stats.user.contributionsCollection;

// -------------------- Cards --------------------
const grade = v => v > 5000 ? "S" : v > 1000 ? "A" : "B";
const fmt = v => Number(v).toLocaleString();

const trophies = [
  { title:"Commits",        value: c.totalCommitContributions,             desc:"Commit contributions across all repos." },
  { title:"Followers",      value: stats.user.followers.totalCount,        desc:"People following this account." },
  { title:"Stars Earned",   value: starSum,                                 desc:"Stargazers on owned repositories." },
  { title:"Reviews",        value: c.totalPullRequestReviewContributions,  desc:"Pull request reviews submitted." },
  { title:"Issues",         value: c.totalIssueContributions,              desc:"Issues created." },
  { title:"Repositories",   value: repoCount,                               desc:"Owned non-fork repositories." },
  { title:"Pull Requests",  value: c.totalPullRequestContributions,        desc:"Pull requests opened." },
  { title:"Total Activity", value: c.contributionCalendar.totalContributions, desc:"All recorded contributions." }
];

// 2 per page
const pages = [];
for (let i = 0; i < trophies.length; i += 2) pages.push(trophies.slice(i, i + 2));

// -------------------- SVG build --------------------
const W = 760, H = 150, CW = 300, CH = 120, G = 40;
const x0 = (W - (2 * CW + G)) / 2;

const glow = (x, y, w, h) => `
  <g filter="url(#glow)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ry="18" fill="#0ea5e9" opacity="0.14">
      <animate attributeName="opacity" values="0.10;0.20;0.10" dur="2s" repeatCount="indefinite"/>
    </rect>
  </g>`;

const card = (t, x) => `
  ${glow(x-6, 4, CW+12, CH+12)}
  <g transform="translate(${x},10)">
    <rect x="0" y="0" rx="14" ry="14" width="${CW}" height="${CH}" fill="#0b1220" stroke="#1f2937"/>
    <text x="20" y="34" class="cardTitle">${t.title}</text>
    <text x="20" y="70" class="cardValue">${fmt(t.value)} <tspan class="grade">[${grade(t.value)}]</tspan></text>
    <text x="20" y="96" class="cardDesc">${t.desc}</text>
  </g>`;

// -------- Global-cycle animation (fixes “last slide only” repeat) --------
const N = Math.max(1, pages.length);
const totalDur = N * PAGE_SEC;           // full cycle duration (s)
const enterK = (1 - HOLD_FRAC) / 2;      // in-window fractions (same as before, but numeric)
const exitK  = 1 - (1 - HOLD_FRAC) / 2;

let slides = "";
pages.forEach((pg, i) => {
  // window for this slide: [i*PAGE_SEC, (i+1)*PAGE_SEC] in the global cycle
  const t0 = (i * PAGE_SEC) / totalDur;          // start of this slide's window (0..1)
  const t1 = ((i + 1) * PAGE_SEC) / totalDur;    // end of window
  const kin   = t0 + (enterK * PAGE_SEC) / totalDur;   // end of enter
  const khold = t0 + (exitK  * PAGE_SEC) / totalDur;   // end of hold

  // 6 segments: pre-wait | enter | hold | exit | post-wait
  const keyTimes = `0;${t0.toFixed(4)};${kin.toFixed(4)};${khold.toFixed(4)};${t1.toFixed(4)};1`;
  const values   = `${W};${W};0;0;${-W};${-W}`;
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
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">
  <style>
    :root{ color-scheme: dark; }
    .cardTitle{ font:700 16px system-ui; fill:#e5e7eb }
    .cardValue{ font:800 22px system-ui; fill:#60a5fa }
    .grade{ font:700 16px system-ui; fill:#e11d48 }
    .cardDesc{ font:12px system-ui; fill:#9ca3af }
  </style>
  <defs>
    <clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}" rx="8" ry="8"/></clipPath>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${slides}
</svg>`;

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, svg, "utf8");
console.log("wrote", OUT);
