import { distribute } from './secondary';
import { rafterLength, ridgeHeight } from './grid';
import type { ProjectParams } from './project';

/**
 * PLAFONDS MÉTIER — bornes hautes des paramètres (mm, ou nombres).
 *
 * ⚠ La génération du modèle est synchrone : un fichier annonçant 2 000 travées
 * ou un entraxe de pannes de 1 mm figeait l'onglet avant d'afficher quoi que ce
 * soit. Ces bornes sont des ERREURS, mais généreuses : aucun hangar réel ne les
 * approche, et un bâtiment plus grand se recoupe de toute façon par des joints.
 */
export const PLAFONDS = {
  travees: 100,
  entraxe: 20_000,
  portee: 100_000,
  hauteur: 40_000,
  faitage: 60_000,
  panneaux: 200,
  filesLiernes: 10,
  rangees: 30,
  filesBoulons: 8,
  ancrages: 32,
  ouvertures: 500,
  barresLibres: 2_000,
  /** Toutes familles confondues : portiques, pannes, liernes, lisses, potelets, fermes. */
  barres: 50_000,
} as const;

/**
 * Nombre de barres que la génération produirait, estimé à partir des seuls
 * paramètres — sans rien générer. Une surestimation légère est sans
 * conséquence : seul l'ordre de grandeur compte face au plafond.
 *
 * `principal` désigne la famille la plus nombreuse : c'est là qu'il faut agir.
 */
export function barresEstimees(p: ProjectParams): { total: number; principal: string } {
  const g = p.grid;
  const s = p.secondary;
  const files = g.nBays + 1;
  const familles: [string, number][] = [];

  // Portiques : deux poteaux et deux rampants par file.
  familles.push(['grid.nBays', files * 4]);
  if (p.truss.enabled) familles.push(['truss.nPanels', files * p.truss.nPanels * 4]);

  if (s.purlins.enabled) {
    const rampants = g.roofType === 'monopente' ? [rafterLength(g, 'gauche')] : [rafterLength(g, 'gauche'), rafterLength(g, 'droite')];
    const intervalles = rampants.map((l) => distribute(l, s.purlins.mode, s.purlins.spacing, s.purlins.count).intervals);
    const parTravee = intervalles.reduce((a, n) => a + n + 1, 0);
    familles.push([`secondary.purlins.${s.purlins.mode === 'entraxe' ? 'spacing' : 'count'}`, parTravee * g.nBays]);
    if (s.purlins.sagBars.enabled) {
      const liernes = intervalles.reduce((a, n) => a + n, 0) * s.purlins.sagBars.rows * g.nBays;
      familles.push(['secondary.purlins.sagBars.rows', liernes]);
    }
  }

  const potelets = s.gablePosts.enabled ? distribute(g.span, s.gablePosts.mode, s.gablePosts.spacing, s.gablePosts.count).intervals : 1;
  if (s.gablePosts.enabled) familles.push([`secondary.gablePosts.${s.gablePosts.mode === 'entraxe' ? 'spacing' : 'count'}`, 2 * (potelets + 1)]);

  if (s.rails.enabled) {
    // Long pan sur la hauteur à l'égout ; pignon jusqu'au faîtage, recoupé par les potelets.
    const longPan = distribute(g.eaveHeight, s.rails.mode, s.rails.spacing, s.rails.count).intervals + 1;
    const pignon = s.rails.onGables ? distribute(ridgeHeight(g), s.rails.mode, s.rails.spacing, s.rails.count).intervals + 1 : 0;
    familles.push([`secondary.rails.${s.rails.mode === 'entraxe' ? 'spacing' : 'count'}`, 2 * longPan * g.nBays + 2 * pignon * (potelets + 1)]);
  }

  let total = 0;
  let principal = 'grid.nBays';
  let max = -Infinity;
  for (const [path, n] of familles) {
    // Un NaN (paramètre absurde) compte pour l'infini : le plafond le refuse.
    const v = Number.isFinite(n) ? n : Infinity;
    total += v;
    if (v > max) [max, principal] = [v, path];
  }
  return { total, principal };
}
