import { getProfile } from '../../catalog/index';
import { squareCut, type Member } from '../../geometry/member';
import { normalize, sub, v3, EX, EY, type Vec3 } from '../../math/vec3';
import { buildingLength, frameStations, ridgeHeight, ridgeY, roofNormal, roofZ } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { FaceOuverture } from '../../model/ouvertures';
import { distribute } from '../../model/secondary';
import { tieLevel, tieZ } from '../buildTruss';
import { dimensionsPlatineDeFaitage } from '../connections/platines';
import { barre, hauteurPorteur } from './commun';
import { intervallesInterrompus, soustraire } from './ouvertures';

/**
 * FAÇADES : lisses de bardage et potelets de pignon.
 *
 * Elles vivent à part des pannes parce qu'elles ne portent pas la même chose et
 * ne se posent pas de la même façon : une lisse est plaquée sur la FACE
 * EXTÉRIEURE du poteau, un potelet monte du sol jusqu'au rampant qu'il vient
 * buter. Les pannes, elles, reposent sur le DESSUS de la traverse.
 */

/** Altitudes des lisses, du soubassement vers l'égout. */
export function railLevels(p: ProjectParams): number[] {
  const g = p.grid;
  const r = p.secondary.rails;
  /*
   * ⚠ Sous une ferme, le poteau s'arrête à l'entrait, plus bas que l'égout :
   * les lisses ne montent pas plus haut que lui. La lisse haute se posait à
   * l'égout, au-dessus de la tête du poteau, et ne portait sur rien — le
   * perçage, qui la cherchait sur le poteau, est tombé 136 mm au-dessus.
   */
  const haut = p.truss.enabled ? Math.min(g.eaveHeight, tieLevel(g, p.truss)) : g.eaveHeight;
  const utile = haut - r.sillHeight;
  const { intervals } = distribute(utile, r.mode, r.spacing, r.count);
  return Array.from({ length: intervals }, (_, k) => r.sillHeight + (utile * k) / intervals);
}

export function buildRails(p: ProjectParams, out: Member[]): number {
  const g = p.grid;
  const r = p.secondary.rails;
  const hLisse = getProfile(r.profile).h;
  const hPoteau = getProfile(p.frame.columnProfile).h;
  const debord = hPoteau / 2 + hLisse / 2; // lisse plaquée sur la face extérieure
  const stations = frameStations(g);
  const niveaux = railLevels(p);

  /*
   * ⚠ Les ouvertures découpent les lisses ICI, à l'endroit où l'on sait de
   * quelle façade il s'agit. Le faire après coup obligerait à redeviner la
   * façade d'une lisse depuis son identifiant — et une convention de nommage
   * relue est exactement ce qui avait fait perdre les jarrets du colisage.
   */
  const morceaux = (
    face: FaceOuverture,
    z: number,
    a: number,
    b: number,
  ): [number, number][] => soustraire(a, b, intervallesInterrompus(p, face, z));

  // Long pans : lisses filant selon X, de part et d'autre du bâtiment.
  for (const [c, yMur, face] of [
    [0, -debord, 'long-pan-gauche'],
    [1, g.span + debord, 'long-pan-droit'],
  ] as const) {
    for (const [k, z] of niveaux.entries()) {
      for (let t = 0; t < stations.length - 1; t++) {
        const bouts = morceaux(face, z, stations[t] as number, stations[t + 1] as number);
        for (const [i, [x0, x1]] of bouts.entries()) {
          out.push(
            barre(
              `LI-${c}${k}-${t}${bouts.length > 1 ? `-${i}` : ''}`,
              'lisse',
              r.profile,
              r.grade,
              v3(x0, yMur, z),
              v3(x1, yMur, z),
              EY,
              `lisse ${k + 1} — long pan ${c === 0 ? 'gauche' : 'droit'}, travée ${t + 1}` +
                (bouts.length > 1 ? `, tronçon ${i + 1}` : ''),
            ),
          );
        }
      }
    }
  }

  // Pignons : lisses filant selon Y, arrêtées sous le rampant.
  //
  // ⚠ Elles se découpent sur les POTELETS, exactement comme les lisses de long
  // pan se découpent sur les portiques. Une lisse d'un seul tenant sur toute la
  // portée ne s'achète pas, ne se monte pas, et surtout ne tient pas : sa portée
  // de calcul serait celle du pignon entier au lieu de l'entraxe des potelets.
  if (r.onGables) {
    const L = buildingLength(g);
    const appuis = [0, ...gablePostStations(p), g.span];
    /*
     * ⚠ Au pignon, la lisse se plaque sur la semelle des POTELETS, pas sur la
     * face d'un poteau de long pan : en travers du pignon, un poteau ne présente
     * que la demi-largeur de ses semelles. Elle reculait de la demi-hauteur du
     * poteau, comme en long pan, et flottait à 110 mm des poteaux d'angle et
     * à 140 mm des potelets, sans rien pour la tenir.
     */
    const appuiPignon = Math.max(
      p.secondary.gablePosts.enabled && gablePostStations(p).length > 0
        ? getProfile(p.secondary.gablePosts.profile).h / 2
        : 0,
      getProfile(p.frame.columnProfile).b / 2,
    );
    const debordPignon = appuiPignon + hLisse / 2;
    for (const [c, xMur, face] of [
      [0, -debordPignon, 'pignon-ouest'],
      [1, L + debordPignon, 'pignon-est'],
    ] as const) {
      for (const [k, z] of niveaux.entries()) {
        for (let t = 0; t < appuis.length - 1; t++) {
          const bouts = morceaux(face, z, appuis[t] as number, appuis[t + 1] as number);
          for (const [i, [y0, y1]] of bouts.entries()) {
            // Aux angles, la lisse de pignon arrive sur un poteau qui ne lui
            // présente que les rives de ses semelles : une équerre la reçoit.
            for (const yAngle of [0, g.span]) {
              if (Math.abs((yAngle === 0 ? y0 : y1) - yAngle) > 1) continue;
              out.push(equerreDAngle(p, c === 0 ? 0 : L, yAngle, z, appuiPignon, `ATL-${c}${k}-${yAngle === 0 ? 'g' : 'd'}`));
            }
            out.push(
              barre(
                `LIP-${c}${k}-${t}${bouts.length > 1 ? `-${i}` : ''}`,
                'lisse',
                r.profile,
                r.grade,
                v3(xMur, y0, z),
                v3(xMur, y1, z),
                EX,
                `lisse ${k + 1} — pignon ${c === 0 ? 'ouest' : 'est'}, travée ${t + 1}` +
                  (bouts.length > 1 ? `, tronçon ${i + 1}` : ''),
              ),
            );
          }
        }
      }
    }
  }

  const utile = g.eaveHeight - r.sillHeight;
  return distribute(utile, r.mode, r.spacing, r.count).actualSpacing;
}

/** Cornière des équerres d'angle : assez courte pour dégager le congé du poteau. */
export const PROFIL_EQUERRE_ANGLE = 'L 80x80x8';

/**
 * ÉQUERRE DE LISSE D'ANGLE — soudée à l'intérieur de la semelle du poteau
 * d'angle, côté pignon, elle offre à la lisse de pignon une face où se boulonner.
 *
 * ⚠ La lisse de pignon arrive sur le poteau d'angle par le côté : elle ne voit
 * que les rives de ses deux semelles, sur lesquelles rien ne se boulonne. Sans
 * pièce entre les deux, la lisse ne tenait à rien à chaque angle du bâtiment.
 *
 * Disposition : le talon de la cornière au nu de la lisse, une aile plaquée
 * contre la lisse — on y boulonne —, l'autre contre la face intérieure de la
 * semelle intérieure du poteau — on l'y soude.
 */
function equerreDAngle(
  p: ProjectParams,
  xPignon: number,
  yAngle: number,
  zLisse: number,
  appuiPignon: number,
  id: string,
): Member {
  const prPoteau = getProfile(p.frame.distinctGableFrame ? p.frame.gableColumnProfile : p.frame.columnProfile);
  const prLisse = getProfile(p.secondary.rails.profile);
  const pr = getProfile(PROFIL_EQUERRE_ANGLE);
  const longueur = p.connections.purlinCleat.length;
  const sx = xPignon === 0 ? -1 : 1; // côté extérieur du pignon
  const sy = yAngle === 0 ? 1 : -1; // vers l'intérieur du bâtiment
  const tf = prPoteau.shape === 'I' || prPoteau.shape === 'U' ? prPoteau.tf : 10;
  const cyL = pr.shape === 'L' ? pr.cy : pr.h / 2;
  const czL = pr.shape === 'L' ? pr.cz : pr.h / 2;
  // Talon : au nu de la lisse, contre la face intérieure de la semelle.
  const talon = v3(xPignon + sx * appuiPignon, yAngle + sy * (prPoteau.h / 2 - tf), 0);
  // Section : +z le long de l'aile boulonnée (vers l'axe du poteau, −sy·Y),
  // +y le long de l'aile soudée (vers l'âme, −sx·X).
  const axe = v3(talon.x - sx * cyL, talon.y - sy * czL, 0);
  // Hauteur : centrée sur l'aile de la lisse, là où passent ses boulons.
  const cyU = prLisse.shape === 'U' ? prLisse.cy : prLisse.b / 2;
  const zMilieu = zLisse + prLisse.b / 2 - cyU;
  // Sens de l'axe choisi pour que (−sy·Y) × axe = −sx·X : le repère direct qui
  // pose les ailes de ce côté-là.
  const sz = sx * sy;
  return barre(
    id,
    'equerre',
    PROFIL_EQUERRE_ANGLE,
    p.secondary.rails.grade,
    v3(axe.x, axe.y, zMilieu - (sz * longueur) / 2),
    v3(axe.x, axe.y, zMilieu + (sz * longueur) / 2),
    v3(0, -sy, 0),
    `équerre de lisse d’angle — pignon ${xPignon === 0 ? 'ouest' : 'est'}, ${yAngle === 0 ? 'long pan gauche' : 'long pan droit'}`,
  );
}

/**
 * Abscisses transversales des potelets, réparties entre les deux poteaux.
 *
 * ⚠ En mode « nombre », `count` désigne le nombre de POTELETS et non le nombre
 * d'intervalles : demander 3 potelets doit en produire 3, répartis en 4 travées
 * de bardage. C'est pourquoi la répartition n'utilise pas `distribute` ici.
 */
export function gablePostStations(p: ProjectParams): number[] {
  const g = p.grid;
  const gp = p.secondary.gablePosts;
  const intervals =
    gp.mode === 'entraxe'
      ? Math.max(1, Math.ceil(g.span / Math.max(1, gp.spacing)))
      : Math.max(1, gp.count) + 1;
  return Array.from({ length: intervals - 1 }, (_, k) => ((k + 1) * g.span) / intervals);
}

export function buildGablePosts(p: ProjectParams, out: Member[]): void {
  const g = p.grid;
  const hPorteur = hauteurPorteur(p);
  const L = buildingLength(g);

  for (const [c, x] of [
    [0, 0],
    [1, L],
  ] as const) {
    for (const [k, y] of gablePostStations(p).entries()) {
      // Le potelet monte jusque sous la pièce qui porte la toiture.
      const zHaut = plafondPignon(p, y, hPorteur);
      if (zHaut <= 0) continue;
      out.push(
        potelet(p, `PT-${c}${k}`, v3(x, y, 0), v3(x, y, zHaut), y, `potelet ${k + 1} — pignon ${c === 0 ? 'ouest' : 'est'}`),
      );
    }
  }
}

/**
 * Potelet de pignon.
 *
 * Sa tête ne peut pas être sciée d'équerre : elle vient buter sous une traverse
 * INCLINÉE. On la coupe donc en biais, parallèlement au rampant, et on grugue
 * ses deux semelles sur la longueur du biais — seule l'âme porte, car une
 * semelle biseautée ne se soude pas proprement contre une semelle en pente.
 * Sous une ferme, l'entrait est horizontal et la coupe redevient droite.
 */
function potelet(
  p: ProjectParams,
  id: string,
  pied: Vec3,
  tete: Vec3,
  y: number,
  position: string,
): Member {
  const gpp = p.secondary.gablePosts;
  const axe = normalize(sub(tete, pied));
  /*
   * ⚠ INERTIE FORTE PERPENDICULAIRE AU PIGNON : l'âme est orientée selon X, de
   * sorte que le vent qui frappe le pignon fléchit le potelet autour de son axe
   * fort. Il était posé l'âme dans le plan du pignon — selon Y —, donc fléchi par
   * le vent autour de son axe FAIBLE, quand la vérification, elle, le comptait
   * sur son axe fort. Le calcul et le plan décrivaient deux pièces différentes,
   * et c'est celle du plan qui se serait montée : un IPE 240 travaillant sur une
   * inertie quinze fois plus petite que celle annoncée.
   */
  const base = barre(id, 'potelet', gpp.profile, gpp.grade, pied, tete, EX, position);
  if (p.truss.enabled) return base;
  // Sous les platines de faîtage, dont le bas est horizontal : tête d'équerre.
  if (sousLeFaitage(p, y)) return base;

  // Tête coupée suivant le rampant, sous la traverse : c'est sur la LARGEUR de
  // la semelle, désormais selon Y, que court la pente.
  const nrm = roofNormal(p.grid, y);
  return {
    ...base,
    cutEnd: { point: tete, normal: v3(0, nrm.y, nrm.z) },
    cutStart: squareCut(pied, axe, -1),
  };
}

/** Course verticale permise par les oblongs de l'attache de tête, de part et d'autre (mm). */
export function courseDeTete(p: ProjectParams): number {
  return p.secondary.gablePosts.courseTete;
}

/**
 * Jeu entre la tête d'un potelet et la traverse qui le coiffe (mm) : la course
 * de ses oblongs, plus 5 mm.
 *
 * ⚠ Le potelet ne PORTE pas la traverse : il lui transmet le vent, et la laisse
 * fléchir. Arrêté au contact, il reprenait la toiture du pignon dès la première
 * neige — et la vérification, qui ne lui donne que son poids propre, ne le savait
 * pas. Un jeu plus court que la course la rendrait inutile : la traverse
 * toucherait le potelet avant le bout des oblongs.
 */
export function jeuSousTraverse(p: ProjectParams): number {
  return courseDeTete(p) + 5;
}

/**
 * Altitude sous laquelle un potelet doit s'arrêter : sous la traverse en âme
 * pleine, au jeu près, ou sous les platines de faîtage s'il est à leur aplomb ;
 * sous l'entrait de la ferme si c'est une ferme qui coiffe le pignon.
 */
function plafondPignon(p: ProjectParams, y: number, hPorteur: number): number {
  if (p.truss.enabled) {
    return tieZ(p.grid, p.truss, y) - getProfile(p.truss.bottomChordProfile).h / 2;
  }
  const nrm = roofNormal(p.grid, y);
  const sousTraverse = roofZ(p.grid, y) - (hPorteur / 2) / Math.max(0.1, nrm.z) - jeuSousTraverse(p);
  if (!sousLeFaitage(p, y)) return sousTraverse;
  const platine = dimensionsPlatineDeFaitage(p, p.frame.distinctGableFrame ? p.frame.gableRafterProfile : p.frame.rafterProfile);
  return Math.min(sousTraverse, ridgeHeight(p.grid) - platine.dessous - jeuSousTraverse(p));
}

/**
 * Le potelet est-il à l'aplomb des platines de faîtage ? Sa semelle, large de b,
 * les rencontre dès que son axe en est à moins de b/2 plus leur épaisseur.
 */
function sousLeFaitage(p: ProjectParams, y: number): boolean {
  if (!p.frame.enabled || p.grid.roofType === 'monopente') return false;
  const b = getProfile(p.secondary.gablePosts.profile).b;
  return Math.abs(y - ridgeY(p.grid)) < b / 2 + p.connections.ridge.thickness + jeuSousTraverse(p);
}
