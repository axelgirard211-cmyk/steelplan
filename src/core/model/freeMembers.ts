import type { SteelGradeId } from '../catalog/types';
import type { Vec3 } from '../math/vec3';
import type { FreeMember, ProjectParams } from './project';

/**
 * BARRES LIBRES : création, duplication, suppression.
 *
 * Tout le reste du modèle est paramétrique — on ne duplique pas une panne, on
 * change leur entraxe. Les barres libres sont le seul endroit où l'utilisateur
 * crée des objets un par un : bracons, potences, poutres de reprise, tout ce que
 * la génération automatique ne couvre pas. C'est donc là, et là seulement, que
 * « dupliquer » a un sens.
 */

/** Identifiant libre, jamais réutilisé même après suppressions. */
export function prochainId(existantes: readonly FreeMember[]): string {
  let n = 1;
  const pris = new Set(existantes.map((m) => m.id));
  while (pris.has(`L${n}`)) n += 1;
  return `L${n}`;
}

/** Barre neuve, horizontale, posée à hauteur d'égout au milieu de la portée. */
export function nouvelleBarre(p: ProjectParams): FreeMember {
  const y = p.grid.span / 2;
  const z = p.grid.eaveHeight;
  return {
    id: prochainId(p.freeMembers),
    profile: 'IPE 200',
    grade: p.frame.grade as SteelGradeId,
    start: { x: 0, y, z },
    end: { x: p.grid.baySpacing, y, z },
    rotation: 0,
    label: '',
  };
}

/** Vecteur de décalage par défaut d'une copie : une travée selon X. */
export function decalageParDefaut(p: ProjectParams): Vec3 {
  return { x: p.grid.baySpacing, y: 0, z: 0 };
}

/**
 * Duplique une barre en la décalant.
 *
 * ⚠ Le décalage par défaut n'est jamais nul. Une copie posée exactement sur
 * l'original est invisible dans la vue 3D, se superpose sur les plans, et
 * apparaît en double dans la nomenclature : l'utilisateur croit que la commande
 * n'a rien fait, puis découvre le doublon dans sa liste de débit.
 */
export function dupliquer(source: FreeMember, decalage: Vec3, existantes: readonly FreeMember[]): FreeMember {
  return {
    ...source,
    id: prochainId(existantes),
    start: ajouter(source.start, decalage),
    end: ajouter(source.end, decalage),
    label: source.label ? `${source.label} (copie)` : '',
  };
}

/**
 * Duplique en série : `n` copies décalées régulièrement.
 *
 * C'est la forme utile en charpente — on ne pose pas un bracon, on en pose un
 * par portique.
 */
export function dupliquerEnSerie(
  source: FreeMember,
  decalage: Vec3,
  n: number,
  existantes: readonly FreeMember[],
): FreeMember[] {
  const out: FreeMember[] = [];
  let deja = [...existantes];
  for (let i = 1; i <= Math.max(0, Math.floor(n)); i++) {
    const copie = dupliquer(
      source,
      { x: decalage.x * i, y: decalage.y * i, z: decalage.z * i },
      deja,
    );
    out.push(copie);
    deja = [...deja, copie];
  }
  return out;
}

function ajouter(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Longueur d'une barre libre (mm), pour l'afficher pendant la saisie. */
export function longueurLibre(m: FreeMember): number {
  return Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
}
