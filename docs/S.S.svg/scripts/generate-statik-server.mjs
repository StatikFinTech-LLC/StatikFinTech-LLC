import fs from "fs/promises";
import https from "https";
import path from "path";

const OUTPUT = path.resolve("assets/statik-server-card.svg");
const USER = "statikfintechllc";
const REPO = "statik-server";
const TOKEN = process.env.PAT_GITHUB;

async function fetchAvatarAsBase64() {
  try {
    const response = await fetch('https://avatars.githubusercontent.com/u/200911899?v=4');
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.log('Failed to fetch avatar, using fallback');
    return 'https://avatars.githubusercontent.com/u/200911899?v=4';
  }
}


function fetchGitHub(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "BadgeBot",
        Authorization: `Bearer ${TOKEN}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
      res.on("error", reject);
    });
  });
}

const langColor = {
  Python: "#3572A5",
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Shell: "#89e051",
  CSS: "#563d7c",
  HTML: "#e34c26",
};

const starIcon = `
<path fill="none" stroke="#8abecf" stroke-width="2"
  d="M12 2.5l2.68 5.43 5.82.85-4.2 4.09.99 5.8L12 16.6 6.71 18.67l.99-5.8-4.2-4.09 5.82-.85L12 2.5z"/>
`;

const forkIcon = `
<path fill="#8abecf" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.25 2.25 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
`;

async function main() {
  const repo = await fetchGitHub(`https://api.github.com/repos/${USER}/${REPO}`);
  const user = await fetchGitHub(`https://api.github.com/users/${USER}`);
  const langs = await fetchGitHub(`https://api.github.com/repos/${USER}/${REPO}/languages`);
  const avatarUrl = await fetchAvatarAsBase64();
  const total = Object.values(langs).reduce((a, b) => a + b, 0);

  let x = 0;
  const langBar = Object.entries(langs).map(([lang, bytes]) => {
    const w = (bytes / total) * 440;
    const color = langColor[lang] || "#ccc";
    const rect = `<rect x="${x}" y="195" width="${w}" height="6" fill="${color}" />`;
    x += w;
    return rect;
  }).join("\n");

  const svg = `
<svg width="480" height="230" viewBox="0 0 480 230" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="avatar-clip">
      <rect x="20" y="16" width="20" height="20" rx="4"/>
    </clipPath>
  </defs>
  <style>
    .title { font: 600 16px sans-serif; fill: #ff4775; }
    .meta  { font: 12px sans-serif; fill: #8abecf; dominant-baseline: middle; }
  </style>

  <rect width="100%" height="100%" rx="10" fill="#0d1117"/>
  <image x="20" y="16" width="20" height="20" xlink:href="${avatarUrl}" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice"/>
  <text x="48" y="31" class="title">${repo.name}</text>

  <foreignObject x="48" y="40" width="400" height="120">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="color:#8abecf;font:13px sans-serif;line-height:1.4;white-space:normal;overflow:hidden;">
      ${repo.description}
    </div>
  </foreignObject>

  <circle cx="48" cy="180" r="6" fill="${langColor[repo.language] || "#ccc"}"/>
  <text x="64" y="180" class="meta">${repo.language}</text>

  <g transform="translate(140, 172)">
    <svg viewBox="0 0 24 24" width="16" height="16">${starIcon}</svg>
  </g>
  <text x="162" y="180" class="meta">${repo.stargazers_count}</text>

  <g transform="translate(200, 173)">
    <svg viewBox="0 0 24 24" width="16" height="16">${forkIcon}</svg>
  </g>
  <text x="222" y="180" class="meta">${repo.forks_count}</text>

  <g transform="translate(20, 0)">
    ${langBar}
  </g>
</svg>
`.trim();

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, svg);
}

main().catch(err => {
  console.error("SVG generation failed:", err);
  process.exit(1);
});
