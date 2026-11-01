// Avatars géométriques (aucun visage). Code en base : a1…a8, ou null = initiale du prénom.
export const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

const NS = 'http://www.w3.org/2000/svg';
const pts = (n, r, rot = 0, cx = 50, cy = 50) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
const poly = p => 'M' + p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
// Étoile {n/k} : relie chaque sommet au k-ième suivant
const star = (n, k, r, rot = 0) => { const p = pts(n, r, rot); return poly(p.map((_, i) => p[(i * k) % n])); };

const SHAPES = {
  a1: () => [poly(pts(4, 30)), poly(pts(4, 30, Math.PI / 4)), circle(9)],                  // étoile à 8 branches
  a2: () => [star(16, 6, 33), circle(10)],                                                  // étoile à 16 branches
  a3: () => pts(8, 16).map(([x, y]) => circle(12, x, y)).concat(circle(6)),                 // rosace
  a4: () => [poly(pts(8, 33, Math.PI / 8)), poly(pts(8, 23)), poly(pts(8, 13, Math.PI / 8))], // octogones
  a5: () => [poly(pts(4, 31)), poly(pts(4, 31, Math.PI / 6)), poly(pts(4, 31, Math.PI / 3)), circle(8)], // 12 branches
  a6: () => [star(8, 3, 33), poly(pts(8, 12, Math.PI / 8))],                                // étoile {8/3}
  a7: () => pts(6, 15).map(([x, y]) => circle(15, x, y)).concat(circle(15)),                // fleur de vie
  a8: () => [star(10, 3, 32), poly(pts(10, 14))]                                            // étoile à 10 branches
};

function circle(r, cx = 50, cy = 50) {
  return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
}

let uid = 0;
export function avatarEl(code, gender, firstName, size = 56) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('avatar');
  const id = 'av' + (++uid);
  const [c1, c2] = gender === 'f' ? ['#E58AAB', '#C24E78'] : gender === 'm' ? ['#CC5555', '#9A2E2E'] : ['#256460', '#1B4D4A'];

  const defs = document.createElementNS(NS, 'defs');
  const g = document.createElementNS(NS, 'linearGradient');
  g.id = id; g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
  for (const [o, c] of [['0', c1], ['1', c2]]) {
    const s = document.createElementNS(NS, 'stop'); s.setAttribute('offset', o); s.setAttribute('stop-color', c); g.append(s);
  }
  defs.append(g); svg.append(defs);

  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('cx', 50); bg.setAttribute('cy', 50); bg.setAttribute('r', 48);
  bg.setAttribute('fill', `url(#${id})`); bg.setAttribute('stroke', '#C49A28'); bg.setAttribute('stroke-width', 3);
  svg.append(bg);

  if (SHAPES[code]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', SHAPES[code]().join(''));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#FAF0D2');
    path.setAttribute('stroke-width', 2.6);
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  } else {
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', 50); text.setAttribute('y', 52);
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', '#FAF0D2'); text.setAttribute('font-size', 46); text.setAttribute('font-weight', 700);
    text.setAttribute('font-family', 'Cormorant Garamond, Amiri, serif');
    text.textContent = (firstName || '?').trim().charAt(0).toUpperCase() || '?';
    svg.append(text);
  }
  return svg;
}
