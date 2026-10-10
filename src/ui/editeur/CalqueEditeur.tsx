import type { PointAccroche } from '../../core/drawing/geometrie2d';
import { cleDeRef, type ElementEditable } from '../../core/drawing/retouches';
import type { DrawEntity, Pt } from '../../core/drawing/scene';
import { Marqueur, Reticule, Trait } from './Traits';
import type { Vue } from './vue';

/**
 * CALQUE D'APERÇU DE L'ÉDITEUR — tout ce qui n'est pas le plan : retouches à
 * revoir, survol, sélection et ses poignées, tracé élastique, fenêtre de
 * sélection, accrochage et réticule.
 */
export function CalqueEditeur({
  vue,
  H,
  k,
  elements,
  survol,
  choisis,
  fantomes,
  elastique,
  fenetre,
  poignees,
  poigneeChaude,
  accroche,
  curseur,
}: {
  vue: Vue;
  H: number;
  /** Millimètres de feuille par pixel. */
  k: number;
  elements: readonly ElementEditable[];
  survol: ElementEditable | null;
  choisis: readonly ElementEditable[];
  fantomes: readonly DrawEntity[];
  elastique: readonly DrawEntity[];
  fenetre: { a: Pt; b: Pt } | null;
  poignees: readonly Pt[];
  poigneeChaude: Pt | null;
  accroche: PointAccroche | null;
  curseur: Pt | null;
}): JSX.Element {
  const capture = fenetre ? fenetre.b.x < fenetre.a.x : false;
  const cote = 7 * k;
  return (
    <svg className="editeur-calque" viewBox={`${vue.x} ${vue.y} ${vue.w} ${vue.h}`} preserveAspectRatio="none">
      {elements.map((el) => (el.aRevoir ? el.traits.map((t, j) => <Trait key={`${cleDeRef(el.ref)}-${j}`} e={t} H={H} couleur="#f08c00" epaisseur={2} />) : null))}
      {survol && !choisis.includes(survol) && survol.traits.map((t, j) => <Trait key={`s${j}`} e={t} H={H} couleur="#3b82f6" epaisseur={2} tirets="6 4" />)}
      {choisis.flatMap((el) => el.traits.map((t, j) => <Trait key={`${cleDeRef(el.ref)}-${j}`} e={t} H={H} couleur="#3b82f6" epaisseur={2.5} />))}
      {fantomes.map((t, j) => <Trait key={`f${j}`} e={t} H={H} couleur="#22a06b" epaisseur={1.5} />)}
      {elastique.map((t, j) => <Trait key={`e${j}`} e={t} H={H} couleur="#22a06b" epaisseur={1.5} />)}
      {/* Poignées : carrés pleins, la poignée saisie en rouge. */}
      {poignees.map((p, i) => (
        <rect
          key={`p${i}`}
          x={p.x - cote / 2}
          y={H - p.y - cote / 2}
          width={cote}
          height={cote}
          style={{ vectorEffect: 'non-scaling-stroke', fill: poigneeChaude && poigneeChaude.x === p.x && poigneeChaude.y === p.y ? '#e5484d' : '#3b82f6', stroke: '#fff', strokeWidth: 1 }}
        />
      ))}
      {fenetre && (
        <rect
          x={Math.min(fenetre.a.x, fenetre.b.x)}
          y={H - Math.max(fenetre.a.y, fenetre.b.y)}
          width={Math.abs(fenetre.b.x - fenetre.a.x)}
          height={Math.abs(fenetre.b.y - fenetre.a.y)}
          style={{
            vectorEffect: 'non-scaling-stroke',
            stroke: capture ? '#22a06b' : '#3b82f6',
            strokeWidth: 1,
            strokeDasharray: capture ? '6 4' : undefined,
            fill: capture ? 'rgba(34,160,107,0.08)' : 'rgba(59,130,246,0.08)',
          }}
        />
      )}
      {accroche && <Marqueur a={accroche} H={H} k={k} />}
      {curseur && <Reticule p={curseur} H={H} k={k} />}
    </svg>
  );
}
