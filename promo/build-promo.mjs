// Builds a 1080x1350 (4:5) LinkedIn launch image as SVG, then rasterizes to PNG with resvg.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1080, H = 1350;
const here = dirname(fileURLToPath(import.meta.url));

// ---- palette ----
const C = {
  bg: "#06080c",
  panel: "#0e1521",
  panel2: "#0b111b",
  side: "#0c131e",
  border: "#1d2a3a",
  cell: "#101a27",
  text: "#eef3f9",
  muted: "#8499ad",
  faint: "#5b6c80",
  blue: "#0a66c2",
  blue2: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
};

// ---- calendar mock ----
const gridX = 330, gridY = 690, cols = 7, rows = 5, cw = 78, ch = 70, gap = 6;
const chips = {
  "1-0": ["09:00", C.blue2],
  "4-0": ["13:30", C.blue2],
  "6-1": ["08:00", C.green],
  "2-2": ["18:00", C.blue2],
  "5-3": ["07:30", C.amber],
  "3-4": ["12:00", C.blue2],
};

let cells = "";
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const x = gridX + c * (cw + gap);
    const y = gridY + r * (ch + gap);
    const day = r * cols + c + 1;
    cells += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="9" fill="${C.cell}" stroke="${C.border}"/>`;
    cells += `<text x="${x + 9}" y="${y + 20}" font-family="Segoe UI" font-size="13" fill="${C.faint}">${day}</text>`;
    const chip = chips[`${c}-${r}`];
    if (chip) {
      const [time, color] = chip;
      cells += `<rect x="${x + 7}" y="${y + 30}" width="${cw - 14}" height="26" rx="6" fill="${color}1f" stroke="${color}" stroke-opacity="0.5"/>`;
      cells += `<circle cx="${x + 16}" cy="${y + 43}" r="3" fill="${color}"/>`;
      cells += `<text x="${x + 24}" y="${y + 47}" font-family="Segoe UI" font-size="12" font-weight="700" fill="${color}">${time}</text>`;
    }
  }
}

// weekday labels
const wd = ["L", "M", "X", "J", "V", "S", "D"];
let weekdays = "";
wd.forEach((d, i) => {
  weekdays += `<text x="${gridX + i * (cw + gap) + cw / 2}" y="${gridY - 16}" font-family="Segoe UI" font-size="14" font-weight="600" fill="${C.faint}" text-anchor="middle">${d}</text>`;
});

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.blue}"/>
      <stop offset="1" stop-color="${C.blue2}"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#121b28"/>
      <stop offset="1" stop-color="#0a101a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.blue2}" stop-opacity="0.45"/>
      <stop offset="0.6" stop-color="${C.blue}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${C.blue}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000000" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="thumb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f6feb"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <clipPath id="win"><rect x="150" y="560" width="780" height="540" rx="22"/></clipPath>
  </defs>

  <!-- background -->
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <ellipse cx="700" cy="250" rx="620" ry="420" fill="url(#glow)"/>
  <ellipse cx="240" cy="1180" rx="520" ry="360" fill="url(#glow)" opacity="0.5"/>

  <!-- particles -->
  <circle cx="120" cy="430" r="3" fill="${C.blue2}" opacity="0.5"/>
  <circle cx="980" cy="360" r="2.5" fill="${C.blue2}" opacity="0.5"/>
  <circle cx="900" cy="520" r="2" fill="#fff" opacity="0.4"/>
  <circle cx="200" cy="560" r="2" fill="#fff" opacity="0.35"/>
  <circle cx="1010" cy="900" r="2.5" fill="${C.blue2}" opacity="0.45"/>

  <!-- eyebrow -->
  <rect x="86" y="120" width="186" height="40" rx="20" fill="${C.blue}1f" stroke="${C.blue2}" stroke-opacity="0.5"/>
  <circle cx="110" cy="140" r="4" fill="${C.green}"/>
  <text x="124" y="146" font-family="Segoe UI" font-size="16" font-weight="600" fill="${C.blue2}" letter-spacing="1">NUEVO · SELF-HOSTED</text>

  <!-- headline -->
  <text x="84" y="262" font-family="Segoe UI" font-size="78" font-weight="800" fill="${C.text}" letter-spacing="-1">Programa.</text>
  <text x="84" y="346" font-family="Segoe UI" font-size="78" font-weight="800" fill="${C.text}" letter-spacing="-1">Automatiza.</text>
  <text x="84" y="430" font-family="Segoe UI" font-size="78" font-weight="800" fill="url(#blue)" letter-spacing="-1">Publica.</text>

  <!-- subtitle -->
  <text x="88" y="488" font-family="Segoe UI" font-size="25" fill="${C.muted}">Mi propio programador de posts de LinkedIn —</text>
  <text x="88" y="522" font-family="Segoe UI" font-size="25" fill="${C.muted}">con primer comentario automático y media.</text>

  <!-- app window shadow + glow -->
  <ellipse cx="540" cy="1090" rx="430" ry="90" fill="url(#shadow)"/>
  <rect x="150" y="560" width="780" height="540" rx="22" fill="url(#panel)" stroke="${C.border}"/>

  <g clip-path="url(#win)">
    <!-- sidebar -->
    <rect x="150" y="560" width="150" height="540" fill="${C.side}"/>
    <rect x="176" y="592" width="36" height="36" rx="9" fill="url(#blue)"/>
    <text x="194" y="617" font-family="Segoe UI" font-size="19" font-weight="800" font-style="italic" fill="#fff" text-anchor="middle">in</text>
    <rect x="176" y="672" width="100" height="13" rx="6" fill="${C.blue2}" opacity="0.85"/>
    <rect x="176" y="702" width="86" height="13" rx="6" fill="#26344733"/>
    <rect x="176" y="702" width="86" height="13" rx="6" fill="${C.faint}" opacity="0.4"/>
    <rect x="176" y="732" width="92" height="13" rx="6" fill="${C.faint}" opacity="0.4"/>
    <!-- account dot bottom -->
    <circle cx="194" cy="1060" r="15" fill="${C.cell}" stroke="${C.border}"/>
    <rect x="218" y="1052" width="60" height="9" rx="4" fill="${C.faint}" opacity="0.5"/>

    <!-- calendar header -->
    <text x="330" y="628" font-family="Segoe UI" font-size="22" font-weight="700" fill="${C.text}">Junio 2026</text>
    <rect x="828" y="606" width="74" height="30" rx="8" fill="${C.cell}" stroke="${C.border}"/>
    <text x="865" y="626" font-family="Segoe UI" font-size="14" fill="${C.muted}" text-anchor="middle">Hoy</text>

    ${weekdays}
    ${cells}
  </g>

  <!-- floating: first comment pill -->
  <g>
    <rect x="612" y="516" width="316" height="70" rx="16" fill="${C.panel}" stroke="${C.blue2}" stroke-opacity="0.45"/>
    <circle cx="648" cy="551" r="18" fill="${C.blue}2e"/>
    <path d="M639 545 h18 a3 3 0 0 1 3 3 v8 a3 3 0 0 1 -3 3 h-10 l-6 5 v-5 a3 3 0 0 1 -2 -3 v-8 a3 3 0 0 1 0 -3 z" fill="${C.blue2}"/>
    <text x="680" y="546" font-family="Segoe UI" font-size="16" font-weight="700" fill="${C.text}">Primer comentario</text>
    <text x="680" y="568" font-family="Segoe UI" font-size="14" fill="${C.muted}">automático, con tu enlace</text>
  </g>

  <!-- floating: media thumbnail -->
  <g>
    <rect x="96" y="880" width="118" height="118" rx="16" fill="url(#thumb)" stroke="${C.border}"/>
    <circle cx="138" cy="922" r="13" fill="#ffffff" opacity="0.9"/>
    <path d="M120 980 l26 -30 l20 22 l14 -14 l24 22 v8 a4 4 0 0 1 -4 4 h-76 a4 4 0 0 1 -4 -4 z" fill="#ffffff" opacity="0.85"/>
    <rect x="108" y="966" width="56" height="16" rx="8" fill="#00000055"/>
    <text x="116" y="979" font-family="Segoe UI" font-size="12" font-weight="700" fill="#fff">IMG · VÍDEO</text>
  </g>

  <!-- floating: paper plane + trail -->
  <g>
    <path d="M812 1012 q60 -34 120 -70" stroke="${C.blue2}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" fill="none" opacity="0.7"/>
    <g transform="translate(930 928) rotate(18)">
      <path d="M0 0 L54 22 L20 28 L16 54 L8 30 Z" fill="url(#blue)"/>
      <path d="M20 28 L16 54 L30 34 Z" fill="#1e4e8c"/>
    </g>
  </g>

  <!-- bottom brand lockup -->
  <rect x="84" y="1206" width="48" height="48" rx="12" fill="url(#blue)"/>
  <text x="108" y="1239" font-family="Segoe UI" font-size="25" font-weight="800" font-style="italic" fill="#fff" text-anchor="middle">in</text>
  <text x="150" y="1228" font-family="Segoe UI" font-size="27" font-weight="700" fill="${C.text}">LinkedIn Scheduler</text>
  <text x="151" y="1256" font-family="Segoe UI" font-size="16" fill="${C.faint}">Next.js · Supabase · Vercel — hecho en una tarde</text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  background: C.bg,
  font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" },
});
const png = resvg.render().asPng();
const out = here + "/linkedin-launch-4x5.png";
writeFileSync(out, png);
console.log("OK ->", out, png.length, "bytes");
