#!/usr/bin/env node
/**
 * Draws the Krama mark, the Forged Stair, as SVG (4 Oct 2026).
 *
 *   node brand/forged-stair.mjs
 *
 * writes the three files beside this one:
 *
 *   krama-mark.svg         the full mark, lit for a dark ground, with its glow
 *   krama-mark-light.svg   the same object in deeper metal for a light ground
 *   krama-mark-small.svg   the eight-step cut, no orbit, for small sizes
 *
 * Nothing in the build reads this folder. It is the source the pictures in
 * app/ were made from (see README.md), kept so the mark can be redrawn or
 * re-rendered at another size without anyone having to reverse-engineer a
 * PNG. It needs only Node: no packages.
 *
 * The object. A staircase that turns back on itself and only ever goes up
 * -- Krama means one step after another. It is a Penrose loop: every step
 * is drawn one rise above the last, all the way round, and the last meets
 * the first. That works because of the projection. With ground axes drawn
 * as (A, B) and (-A, B) and height drawn straight up, a step towards the
 * viewer moves down the screen by B minus one rise, and a step away moves
 * up by B plus one rise. For flights of n1, n2 towards the viewer and n3,
 * n4 away, the loop closes on screen when
 *
 *   rise = B * (n1 + n2 - n3 - n4) / (n1 + n2 + n3 + n4)
 *
 * so nothing is nudged per step, and the result reads as one solid thing.
 *
 * components/brand/Logo.tsx draws the small cut by hand from the same
 * numbers (flights 3, 3, 1, 1 in a 64-unit box). If the geometry here
 * changes, change it there too.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Projection: how far one tread moves across (A) and down (B) the page.
const A = 0.82;
const B = 0.58;

const n = (value) => (Math.round(value * 100) / 100).toString();
const path = (points) => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;

const BLURS =
  '<filter id="blur-s" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>' +
  '<filter id="blur-m" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="14"/></filter>' +
  '<filter id="blur-l" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="26"/></filter>' +
  '<filter id="blur-xl" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="46"/></filter>';

const METAL = {
  // Lit for a dark ground: near-white treads, lavender and indigo walls.
  dark: { top: ["#FFFFFF", "#DAD6F6"], left: ["#A99FE8", "#5D50B6"], right: ["#5145AC", "#221C5E"], rim: "#FFFFFF", line: "#B9B1EC" },
  // For a light ground the same object is cast in deeper metal, or the
  // treads would vanish into the paper.
  light: { top: ["#A99FE8", "#7468CC"], left: ["#5D50B6", "#372F86"], right: ["#2E2870", "#14102F"], rim: "#D8D3F7", line: "#8B80D8" },
};
const GOLD = { top: ["#FFF6D8", "#FBC559"], left: ["#F9AB2B", "#D06B06"], right: ["#C2600A", "#6E3306"] };

const gradient = (id, [from, to], x2, y2) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;

/** A tapered stroke along part of a tilted ellipse: the orbit. */
function orbit({ centre, rx, ry, tilt, from, to, thickness }) {
  const turn = (tilt * Math.PI) / 180;
  const at = (degrees) => {
    const t = (degrees * Math.PI) / 180;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [centre[0] + x * Math.cos(turn) - y * Math.sin(turn), centre[1] + x * Math.sin(turn) + y * Math.cos(turn)];
  };
  const steps = 90;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const angle = from + (to - from) * u;
    // Thin at the tail, full two thirds of the way along, fine at the head.
    const width = thickness * Math.sin(Math.PI * Math.min(1, u * 1.02)) ** 0.9 * (0.25 + 0.75 * u);
    const here = at(angle);
    const next = at(angle + 0.6);
    const along = [next[0] - here[0], next[1] - here[1]];
    const length = Math.hypot(...along) || 1;
    const across = [along[1] / length, -along[0] / length];
    outer.push([here[0] + (across[0] * width) / 2, here[1] + (across[1] * width) / 2]);
    inner.push([here[0] - (across[0] * width) / 2, here[1] - (across[1] * width) / 2]);
  }
  const [x1, y1] = at(from);
  const head = at(to);
  return {
    defs:
      `<linearGradient id="orbit" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(head[0])}" y2="${n(head[1])}">` +
      '<stop offset="0" stop-color="#F08D0C" stop-opacity="0"/><stop offset="0.35" stop-color="#F08D0C"/>' +
      '<stop offset="0.75" stop-color="#F9AB2B"/><stop offset="1" stop-color="#FFF1C4"/></linearGradient>',
    /** The stretch between two fractions of its length, as one filled path. */
    stretch: (start, end) => {
      const i = Math.round(start * steps);
      const j = Math.round(end * steps);
      return path([...outer.slice(i, j + 1), ...inner.slice(i, j + 1).reverse()]);
    },
    head,
  };
}

/**
 * The mark on a 512-unit field.
 *   flights  steps per flight: the first two come towards the viewer
 *   wall     how far each step's walls drop, in treads
 *   gold     which step, counted from the start of the loop, is gold
 *   box      the largest width or height the stair may take
 */
export function forgedStair({ tone = "dark", flights = [4, 4, 2, 2], wall = 1.35, gold = 11, box = 372, withOrbit = true, withGlow = true } = {}) {
  const total = flights.reduce((sum, count) => sum + count, 0);
  const rise = (B * (flights[0] + flights[1] - flights[2] - flights[3])) / total;
  const heading = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  const steps = [];
  let gx = 0;
  let gy = 0;
  flights.forEach((count, flight) => {
    for (let i = 0; i < count; i++) {
      steps.push({ gx, gy, z: steps.length * rise, index: steps.length });
      gx += heading[flight][0];
      gy += heading[flight][1];
    }
  });

  const project = (x, y, z) => [(x - y) * A, (x + y) * B - z];
  const extent = steps.flatMap((step) =>
    [[0, 0], [1, 0], [1, 1], [0, 1]].flatMap(([i, j]) => {
      const [x, y] = project(step.gx + i, step.gy + j, step.z);
      return [[x, y], [x, y + wall]];
    }),
  );
  const xs = extent.map(([x]) => x);
  const ys = extent.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(box / (maxX - minX), box / (maxY - minY));
  const centreY = withOrbit ? 262 : 256;
  const place = (x, y, z) => {
    const [px, py] = project(x, y, z);
    return [256 + (px - (minX + maxX) / 2) * scale, centreY + (py - (minY + maxY) / 2) * scale];
  };

  // Painter's order: furthest up the screen first.
  const backToFront = [...steps].sort((p, q) => project(p.gx + 0.5, p.gy + 0.5, p.z)[1] - project(q.gx + 0.5, q.gy + 0.5, q.z)[1] || p.index - q.index);

  const metal = METAL[tone];
  let defs =
    gradient("step-top", metal.top, 1, 1) + gradient("step-left", metal.left, 0, 1) + gradient("step-right", metal.right, 0, 1) +
    gradient("gold-top", GOLD.top, 1, 1) + gradient("gold-left", GOLD.left, 0, 1) + gradient("gold-right", GOLD.right, 0, 1);

  let stair = "";
  let goldGlow = "";
  for (const step of backToFront) {
    const isGold = step.index === gold;
    const back = place(step.gx, step.gy, step.z);
    const right = place(step.gx + 1, step.gy, step.z);
    const front = place(step.gx + 1, step.gy + 1, step.z);
    const left = place(step.gx, step.gy + 1, step.z);
    const drop = ([x, y]) => [x, y + wall * scale];
    const face = isGold ? "gold" : "step";
    stair += `<path d="${path([right, front, drop(front), drop(right)])}" fill="url(#${face}-right)" stroke="${isGold ? GOLD.right[1] : metal.right[1]}" stroke-width="0.7" stroke-linejoin="round"/>`;
    stair += `<path d="${path([left, front, drop(front), drop(left)])}" fill="url(#${face}-left)" stroke="${isGold ? GOLD.left[1] : metal.left[1]}" stroke-width="0.7" stroke-linejoin="round"/>`;
    stair += `<path d="${path([back, right, front, left])}" fill="url(#${face}-top)" stroke="${isGold ? GOLD.top[0] : metal.line}" stroke-width="1.1" stroke-linejoin="round"/>`;
    stair += `<path d="M${n(left[0])} ${n(left[1])}L${n(front[0])} ${n(front[1])}L${n(right[0])} ${n(right[1])}" fill="none" stroke="${isGold ? "#FFFDF2" : metal.rim}" stroke-opacity="0.9" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (isGold) {
      goldGlow = `<ellipse cx="${n((back[0] + front[0]) / 2)}" cy="${n((back[1] + front[1]) / 2 + 10)}" rx="70" ry="52" fill="#F9AB2B" opacity="0.6" filter="url(#blur-l)"/>`;
    }
  }

  let behind = "";
  let inFront = "";
  if (withGlow) {
    behind +=
      '<ellipse cx="256" cy="270" rx="170" ry="130" fill="#6355BC" opacity="0.55" filter="url(#blur-xl)"/>' +
      goldGlow +
      '<ellipse cx="256" cy="430" rx="150" ry="16" fill="#000" opacity="0.5" filter="url(#blur-m)"/>';
  }
  if (withOrbit) {
    const ring = orbit({ centre: [256, 272], rx: 236, ry: 150, tilt: -18, from: 205, to: -52, thickness: 13 });
    defs +=
      ring.defs +
      '<radialGradient id="point" cx="0.36" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFDF5"/><stop offset="0.45" stop-color="#FDDC92"/><stop offset="1" stop-color="#F9AB2B"/></radialGradient>';
    const [hx, hy] = ring.head;
    // The orbit passes behind the stair at both ends and in front of it
    // through the middle of its sweep.
    if (withGlow) behind += `<path d="${ring.stretch(0, 1)}" fill="#F9AB2B" opacity="0.45" filter="url(#blur-m)"/>`;
    behind += `<path d="${ring.stretch(0, 0.14)}" fill="url(#orbit)"/><path d="${ring.stretch(0.62, 1)}" fill="url(#orbit)"/>`;
    inFront += `<path d="${ring.stretch(0.14, 0.62)}" fill="url(#orbit)"/>`;
    if (withGlow) {
      inFront +=
        `<circle cx="${n(hx)}" cy="${n(hy)}" r="26" fill="#F9AB2B" opacity="0.55" filter="url(#blur-l)"/>` +
        `<circle cx="${n(hx)}" cy="${n(hy)}" r="15" fill="#FDDC92" opacity="0.7" filter="url(#blur-s)"/>`;
    }
    inFront += `<circle cx="${n(hx)}" cy="${n(hy)}" r="10" fill="url(#point)"/><circle cx="${n(hx - 3)}" cy="${n(hy - 3.4)}" r="2.8" fill="#fff" opacity="0.9"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>${BLURS}${defs}</defs>${behind}${stair}${inFront}</svg>\n`;
}

const SMALL = { flights: [3, 3, 1, 1], wall: 1.25, gold: 7, box: 404, withOrbit: false, withGlow: false };

export const MARKS = {
  "krama-mark.svg": forgedStair(),
  "krama-mark-light.svg": forgedStair({ tone: "light", withGlow: false }),
  "krama-mark-small.svg": forgedStair(SMALL),
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [name, svg] of Object.entries(MARKS)) {
    writeFileSync(join(HERE, name), svg);
    console.log(`wrote brand/${name}`);
  }
}
