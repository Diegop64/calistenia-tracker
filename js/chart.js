// Gráficos SVG propios (sin librerías → cero dependencias y 100 % offline).

import { parseISO, fechaCorta } from './util.js';

const W0 = 340, ML = 36, MR = 12, MT = 14, MB = 24;

function escala(puntos) {
  const ys = puntos.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  const rango = max - min;
  const pad = rango ? rango * 0.18 : (max || 1) * 0.12;
  min = Math.max(0, min - pad);
  max = max + pad;
  return { min, max };
}

const tt = (p) => parseISO(p.fecha).getTime();

/**
 * @param puntos [{fecha:'YYYY-MM-DD', y:number}]  ordenados por fecha
 * @param opts   { h, sel (índice seleccionado), fmt (y => texto) }
 */
export function lineChart(puntos, { w = W0, h = 200, sel = null, fmt = (v) => String(Math.round(v * 10) / 10) } = {}) {
  if (!puntos.length) return '';
  const W = w;
  const { min, max } = escala(puntos);
  const iw = W - ML - MR, ih = h - MT - MB;
  const t0 = tt(puntos[0]), t1 = tt(puntos[puntos.length - 1]);
  const X = (p) => ML + (puntos.length === 1 || t1 === t0 ? iw / 2 : ((tt(p) - t0) / (t1 - t0)) * iw);
  const Y = (v) => MT + ih - ((v - min) / (max - min || 1)) * ih;

  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    const y = Y(v);
    grid += `<line class="ch-grid" x1="${ML}" x2="${W - MR}" y1="${y}" y2="${y}"/>` +
            `<text class="ch-txt" x="${ML - 6}" y="${y + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }

  const coords = puntos.map((p) => [X(p), Y(p.y)]);
  const linea = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `${linea} L${coords[coords.length - 1][0].toFixed(1)},${MT + ih} L${coords[0][0].toFixed(1)},${MT + ih} Z`;

  const ultimo = puntos.length - 1;
  const puntosSvg = coords.map((c, i) => {
    const activo = i === sel || (sel == null && i === ultimo);
    return `<g data-pt="${i}">
      <circle cx="${c[0]}" cy="${c[1]}" r="16" fill="transparent"/>
      <circle class="${activo ? 'ch-dot-act' : 'ch-dot'}" cx="${c[0]}" cy="${c[1]}" r="${activo ? 5 : 3.2}"/>
    </g>`;
  }).join('');

  const guia = sel != null
    ? `<line class="ch-guide" x1="${coords[sel][0]}" x2="${coords[sel][0]}" y1="${MT}" y2="${MT + ih}"/>` : '';

  const xl = puntos.length === 1
    ? `<text class="ch-txt" x="${W / 2}" y="${h - 6}" text-anchor="middle">${fechaCorta(puntos[0].fecha)}</text>`
    : `<text class="ch-txt" x="${ML}" y="${h - 6}" text-anchor="start">${fechaCorta(puntos[0].fecha)}</text>
       <text class="ch-txt" x="${W - MR}" y="${h - 6}" text-anchor="end">${fechaCorta(puntos[ultimo].fecha)}</text>`;

  return `<svg viewBox="0 0 ${W} ${h}" class="w-full select-none" role="img" aria-label="Gráfico de progresión">
    <defs><linearGradient id="chg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${guia}
    ${puntos.length > 1 ? `<path d="${area}" fill="url(#chg)"/><path class="ch-line" d="${linea}"/>` : ''}
    ${puntosSvg}${xl}
  </svg>`;
}

/** Mini gráfico para las tarjetas de lista. */
export function sparkline(valores, w = 76, h = 28) {
  if (valores.length < 2) return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><line class="ch-grid" x1="2" x2="${w - 2}" y1="${h / 2}" y2="${h / 2}" stroke-dasharray="3 3"/></svg>`;
  const min = Math.min(...valores), max = Math.max(...valores);
  const X = (i) => 2 + (i / (valores.length - 1)) * (w - 4);
  const Y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const d = valores.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path class="ch-line" style="stroke-width:2" d="${d}"/>
    <circle class="ch-dot-act" cx="${X(valores.length - 1)}" cy="${Y(valores[valores.length - 1])}" r="2.8"/></svg>`;
}
