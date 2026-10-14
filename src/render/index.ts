import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Report } from '../report/index.js';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
const fontUrl = new URL('../../assets/NotoSans-Regular.ttf', import.meta.url);
// The same location works from src/render and dist/render.
export async function svg(report: Report): Promise<string> {
  const font = (await readFile(fontUrl)).toString('base64');
  const s = report.scoring;
  const labels = [
    ['impact', 'Code Impact', 300],
    ['consistency', 'Consistency', 250],
    ['collaboration', 'Collaboration', 200],
    ['delivery', 'Delivery', 150],
    ['breadth', 'Breadth', 100],
  ] as const;
  const bars = labels
    .map(([key, label, max], i) => {
      const y = 240 + i * 66;
      const value = s.categories[key];
      return `<text x="530" y="${y}" fill="#cbd5e1" font-size="17">${label}</text><text x="926" y="${y}" text-anchor="end" fill="#f8fafc" font-size="17">${Math.round(value)} <tspan fill="#64748b">/ ${max}</tspan></text><rect x="530" y="${y + 14}" width="396" height="9" rx="4.5" fill="#243045"/><rect x="530" y="${y + 14}" width="${(396 * value) / max}" height="9" rx="4.5" fill="url(#bar)"/>`;
    })
    .join('');
  const stats = [
    ['ACTIVE DAYS', s.metrics.activeDays],
    ['LONGEST STREAK', s.metrics.longestStreak],
    ['VALID COMMITS', s.metrics.validCommits],
    ['MERGED PRS', s.metrics.mergedPRs],
  ]
    .map(
      ([label, value], i) =>
        `<text x="${62 + i * 231}" y="640" fill="#94a3b8" font-size="11" letter-spacing="1.5">${label}</text><text x="${62 + i * 231}" y="682" fill="#f8fafc" font-size="32">${value}</text>`,
    )
    .join('');
  const coverage = `${report.fixture ? 'FIXTURE · ' : ''}${report.coverage.fullyVerified ? 'PUBLIC CHECKS COMPLETE' : 'PARTIAL ANALYSIS'} · ${Math.floor(report.coverage.ratio * 100)}% COVERAGE`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="780" viewBox="0 0 1000 780" role="img" aria-labelledby="title desc"><title id="title">GitRanked · ${escape(report.subject.login)} · ${s.displayTotal}/1000</title><desc id="desc">Experimental public development activity index. ${escape(coverage)}. Coverage is relative to discovered public activity.</desc><defs><style>@font-face{font-family:Noto Sans;src:url(data:font/ttf;base64,${font})}text{font-family:Noto Sans,sans-serif}</style><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#111d33"/><stop offset="1" stop-color="#090f1c"/></linearGradient><linearGradient id="bar"><stop stop-color="#34d399"/><stop offset="1" stop-color="#38bdf8"/></linearGradient><radialGradient id="glow"><stop stop-color="#0c736b" stop-opacity=".4"/><stop offset="1" stop-color="#0c736b" stop-opacity="0"/></radialGradient></defs><rect width="1000" height="780" rx="28" fill="url(#bg)"/><circle cx="180" cy="280" r="260" fill="url(#glow)"/><rect x="24" y="24" width="952" height="732" rx="18" fill="none" stroke="#27354c"/><path d="M62 75h17v17H62z M84 75h17v17H84z M62 97h17v17H62z" fill="#34d399"/><text x="118" y="102" fill="#f8fafc" font-size="22" letter-spacing="3">GITRANKED</text><text x="926" y="99" text-anchor="end" fill="#94a3b8" font-size="14">PUBLIC ACTIVITY / ${report.mode.toUpperCase()}</text><text x="62" y="174" fill="#cbd5e1" font-size="27">@${escape(report.subject.login)}</text><text x="62" y="307" fill="#f8fafc" font-size="112">${s.displayTotal}</text><text x="66" y="350" fill="#94a3b8" font-size="17" letter-spacing="2">OUT OF 1000</text><text x="62" y="415" fill="#34d399" font-size="13">${escape(coverage)}</text><text x="62" y="458" fill="#94a3b8" font-size="15">${report.window.since.slice(0, 10)} — ${report.window.until.slice(0, 10)} · UTC</text><text x="62" y="495" fill="#64748b" font-size="13">${escape(String(report.parameters.scoring && (report.parameters.scoring as Record<string, unknown>).version))}</text>${bars}<path d="M62 597H938" stroke="#27354c"/>${stats}<text x="62" y="727" fill="#64748b" font-size="12">Publicly verifiable development activity · Experimental methodology · Not a measure of skill</text></svg>`;
}
let initialized: Promise<void> | undefined;
export async function png(source: string): Promise<Uint8Array> {
  initialized ??= initWasm(
    readFile(
      createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'),
    ),
  );
  await initialized;
  const renderer = new Resvg(source, {
    font: {
      fontBuffers: [await readFile(fontUrl)],
      defaultFontFamily: 'Noto Sans',
    },
    fitTo: { mode: 'original' },
  });
  const image = renderer.render();
  try {
    return image.asPng();
  } finally {
    image.free();
    renderer.free();
  }
}
