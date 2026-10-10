import { coinsDuTexte, type ModeAccrochage, type PointAccroche } from '../../core/drawing/geometrie2d';
import type { DrawEntity, Pt } from '../../core/drawing/scene';

/**
 * TRACÉ D'APERÇU DE L'ÉDITEUR — sélection, survol, élastique, accrochage.
 *
 * ⚠ Épaisseur en PIXELS (`non-scaling-stroke`), pas en millimètres : une
 * sélection doit rester visible au même titre à 10 % comme à 2 000 % de zoom,
 * alors que le plan, lui, garde ses épaisseurs de papier.
 */

const NS = { vectorEffect: 'non-scaling-stroke' as const };

function chemin(l: readonly Pt[], H: number, fermee: boolean): string {
  return l.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${H - p.y}`).join(' ') + (fermee ? ' Z' : '');
}

export function Trait({ e, H, couleur, epaisseur = 2, tirets }: { e: DrawEntity; H: number; couleur: string; epaisseur?: number; tirets?: string }): JSX.Element | null {
  const style = { ...NS, stroke: couleur, strokeWidth: epaisseur, fill: 'none', ...(tirets ? { strokeDasharray: tirets } : {}) };
  switch (e.kind) {
    case 'ligne':
      return <line x1={e.a.x} y1={H - e.a.y} x2={e.b.x} y2={H - e.b.y} style={style} />;
    case 'polyligne':
      return <path d={chemin(e.points, H, e.fermee)} style={style} />;
    case 'cercle':
      return <circle cx={e.c.x} cy={H - e.c.y} r={e.r} style={style} />;
    case 'arc': {
      const p0 = { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) };
      const p1 = { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) };
      const d = e.a1 - e.a0;
      return <path d={`M ${p0.x} ${H - p0.y} A ${e.r} ${e.r} 0 ${Math.abs(d) > Math.PI ? 1 : 0} ${d > 0 ? 0 : 1} ${p1.x} ${H - p1.y}`} style={style} />;
    }
    case 'texte':
      return <path d={chemin(coinsDuTexte(e), H, true)} style={style} />;
    case 'hachure':
    case 'remplissage':
      return <path d={[e.contour, ...e.trous].map((r) => chemin(r, H, true)).join(' ')} style={style} />;
  }
}

/** Marqueur d'accrochage, dessiné en pixels autour du point. */
export function Marqueur({ a, H, k }: { a: PointAccroche; H: number; k: number }): JSX.Element {
  const x = a.p.x;
  const y = H - a.p.y;
  const r = 6 * k;
  const style = { ...NS, stroke: '#f0a020', strokeWidth: 2, fill: 'none' };
  const formes: Record<ModeAccrochage, JSX.Element> = {
    extremite: <rect x={x - r} y={y - r} width={2 * r} height={2 * r} style={style} />,
    milieu: <path d={`M ${x - r} ${y + r} L ${x} ${y - r} L ${x + r} ${y + r} Z`} style={style} />,
    centre: <circle cx={x} cy={y} r={r} style={style} />,
    quadrant: <path d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`} style={style} />,
    intersection: <path d={`M ${x - r} ${y - r} L ${x + r} ${y + r} M ${x + r} ${y - r} L ${x - r} ${y + r}`} style={style} />,
    insertion: <path d={`M ${x - r} ${y} L ${x + r} ${y} M ${x} ${y - r} L ${x} ${y + r}`} style={style} />,
  };
  return formes[a.mode];
}

export const LIBELLE_ACCROCHAGE: Readonly<Record<ModeAccrochage, string>> = {
  extremite: 'extrémité',
  milieu: 'milieu',
  centre: 'centre',
  quadrant: 'quadrant',
  intersection: 'intersection',
  insertion: 'point d’insertion',
};

/** Réticule du pointeur, avec sa boîte de désignation. */
export function Reticule({ p, H, k }: { p: Pt; H: number; k: number }): JSX.Element {
  const x = p.x;
  const y = H - p.y;
  const bras = 14 * k;
  const boite = 4 * k;
  const style = { ...NS, stroke: 'var(--accent, #3b82f6)', strokeWidth: 1, fill: 'none' };
  return (
    <g pointerEvents="none">
      <path d={`M ${x - bras} ${y} L ${x - boite} ${y} M ${x + boite} ${y} L ${x + bras} ${y} M ${x} ${y - bras} L ${x} ${y - boite} M ${x} ${y + boite} L ${x} ${y + bras}`} style={style} />
      <rect x={x - boite} y={y - boite} width={2 * boite} height={2 * boite} style={style} />
    </g>
  );
}
