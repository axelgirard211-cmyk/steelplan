import { createRound, getProfile } from '../catalog/index';
import type { Member } from '../geometry/member';
import { v3, type Vec3 } from '../math/vec3';
import { frameStations, rafterLength, ridgeY, roofNormal, roofZ } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { distribute } from '../model/secondary';
import { barre, hauteurPorteur } from './secondaire/commun';
import { semelleInferieure } from './connections/attaches';
import { add, cross, normalize, scale, sub, EX } from '../math/vec3';
import { buildGablePosts, buildRails } from './secondaire/facades';
import { buildOuvertures } from './secondaire/ouvertures';

/*
 * ⚠ Les lisses et les potelets vivent dans `secondaire/facades`, et leurs
 * fonctions publiques sont RÉEXPORTÉES ici : le point d'entrée de l'ossature
 * secondaire reste unique, quel que soit le découpage interne.
 */
export { gablePostStations, railLevels } from './secondaire/facades';

/**
 * Ossature secondaire : pannes et liernes, lisses de bardage, potelets.
 *
 * Deux principes tenus partout ici :
 *  - une pièce PAR TRAVÉE. Pannes et lisses sont débitées travée par travée,
 *    c'est leur longueur réelle de commande ; les modéliser d'un seul tenant
 *    sur toute la longueur du bâtiment donnerait des cotes de débit fausses ;
 *  - les pièces sont EMPILÉES, pas confondues avec la ligne de toiture : une
 *    panne repose sur le dessus de la traverse, une lisse est plaquée sur la
 *    face extérieure du poteau. Les décalages sont calculés depuis les hauteurs
 *    de section réelles, pour que la 3D montre le montage et non un schéma.
 */

export interface SecondaryResult {
  readonly members: Member[];
  /** Entraxes réellement obtenus (mm), à coter sur les plans. */
  readonly purlinSpacing: number;
  readonly railSpacing: number;
}

export function buildSecondary(p: ProjectParams): SecondaryResult {
  const members: Member[] = [];
  const s = p.secondary;

  const pannes = s.purlins.enabled ? buildPurlins(p, members) : 0;
  const lisses = s.rails.enabled ? buildRails(p, members) : 0;
  if (s.gablePosts.enabled) buildGablePosts(p, members);
  /*
   * ⚠ APRÈS les lisses, jamais avant : le chevêtre borde le vide que les lisses
   * viennent de laisser. `buildRails` a déjà retiré les tronçons traversant les
   * ouvertures ; on pose ici ce qui reprend leurs abouts.
   */
  buildOuvertures(p, members);

  return { members, purlinSpacing: pannes, railSpacing: lisses };
}

/* ------------------------------------------------------------------ */
/* Pannes et liernes                                                   */
/* ------------------------------------------------------------------ */

/**
 * Abscisses transversales des pannes sur un versant, de l'égout au faîtage.
 * Le calcul se fait sur la longueur DÉVELOPPÉE du rampant : c'est l'entraxe
 * suivant la pente qui est imposé par la portée admissible du bac, pas sa
 * projection horizontale.
 */
export function purlinStations(p: ProjectParams, cote: 'gauche' | 'droite'): number[] {
  const g = p.grid;
  const pu = p.secondary.purlins;
  const dev = rafterLength(g, cote);
  const { intervals } = distribute(dev, pu.mode, pu.spacing, pu.count);

  const yEgout = cote === 'gauche' ? 0 : g.span;
  const ySommet = g.roofType === 'monopente' ? g.span : ridgeY(g);
  const yHaut = cote === 'gauche' ? ySommet : ySommet;

  const out: number[] = [];
  // PANNE DE RIVE : quand la toiture déborde, la traverse est prolongée en
  // porte-à-faux et porte une panne à son extrémité, sinon le débord n'aurait
  // rien pour tenir.
  if (pu.eaveOverhang > 0 && pu.eavePurlin) {
    out.push(yEgout + (yEgout < yHaut ? -pu.eaveOverhang : pu.eaveOverhang));
  }
  const premier = pu.eavePurlin ? 0 : 1;
  const dernier = pu.ridgePurlin ? intervals : intervals - 1;
  for (let k = premier; k <= dernier; k++) {
    out.push(yEgout + ((yHaut - yEgout) * k) / intervals);
  }
  return out;
}

/** Entraxe réel des pannes suivant le rampant (mm). */
export function purlinSpacing(p: ProjectParams): number {
  const g = p.grid;
  const pu = p.secondary.purlins;
  const dev = rafterLength(g, 'gauche');
  return distribute(dev, pu.mode, pu.spacing, pu.count).actualSpacing;
}

/** Axe d'une panne : sa position transversale et son orientation de section. */
export interface PurlinAxis {
  /** Abscisse transversale du point de toiture correspondant (mm). */
  readonly station: number;
  /** Position de l'axe de la panne (mm). */
  readonly y: number;
  readonly z: number;
  /** Direction « haut de section » (normale au versant). */
  readonly up: Vec3;
  /** Vrai pour la panne faîtière, partagée par les deux versants. */
  readonly faitiere: boolean;
}

/**
 * Positions des axes de pannes, versant par versant. UNIQUE source de vérité :
 * les pannes et les liernes la consomment toutes les deux, ce qui garantit
 * qu'une lierne aboutit exactement sur l'axe de la panne qu'elle relie.
 *
 * La panne faîtière est décalée suivant la BISSECTRICE des deux versants — donc
 * à l'aplomb du faîtage sur une toiture symétrique — et non suivant la normale
 * d'un seul versant : sinon les dernières liernes des deux rampants ne feraient
 * pas la même longueur alors que la toiture est symétrique.
 */
export function purlinLines(p: ProjectParams): Map<'gauche' | 'droite', PurlinAxis[]> {
  const g = p.grid;
  /*
   * ⚠ L'ÉCHANTIGNOLLE occupe sa propre hauteur entre la traverse et la panne.
   * L'oublier posait la panne à même la semelle supérieure de la traverse, et la
   * cornière d'attache — calée sous la panne — se retrouvait entièrement NOYÉE
   * dans la traverse. Rien ne le signalait : les longueurs, les perçages et les
   * masses restaient justes, seule la vue 3D montrait deux aciers occupant le
   * même volume.
   */
  /*
   * ⚠ L'axe d'une panne est son CENTRE DE GRAVITÉ, qui n'est à mi-hauteur que
   * pour une section symétrique. On empile donc depuis la face inférieure de sa
   * semelle — celle qui repose sur l'échantignolle —, et non depuis h/2.
   */
  const profilPanne = getProfile(p.secondary.purlins.profile);
  const dessous = -(semelleInferieure(profilPanne)?.z ?? -profilPanne.h / 2);
  const recul =
    hauteurPorteur(p) / 2 + getProfile(p.connections.purlinCleat.profile).h + dessous;
  const yFaitage = g.roofType === 'monopente' ? g.span : ridgeY(g);
  const cotes: ('gauche' | 'droite')[] =
    g.roofType === 'monopente' ? ['gauche'] : ['gauche', 'droite'];

  const out = new Map<'gauche' | 'droite', PurlinAxis[]>();
  for (const cote of cotes) {
    const lignes: PurlinAxis[] = [];
    for (const station of purlinStations(p, cote)) {
      const faitiere = g.roofType === 'bipente' && Math.abs(station - yFaitage) < 1;
      const nrm = faitiere ? normaleFaitage(p) : roofNormal(g, station);
      lignes.push({
        station,
        y: station + nrm.y * recul,
        z: roofZ(g, station) + nrm.z * recul,
        up: v3(0, nrm.y, nrm.z),
        faitiere,
      });
    }
    out.set(cote, lignes);
  }
  return out;
}

/** Bissectrice des normales des deux versants, au faîtage. */
function normaleFaitage(p: ProjectParams): { y: number; z: number } {
  const g = p.grid;
  const yr = ridgeY(g);
  const a = roofNormal(g, yr - 1);
  const b = roofNormal(g, yr + 1);
  const s = { y: a.y + b.y, z: a.z + b.z };
  const n = Math.hypot(s.y, s.z);
  return { y: s.y / n, z: s.z / n };
}

function buildPurlins(p: ProjectParams, out: Member[]): number {
  const g = p.grid;
  const pu = p.secondary.purlins;
  const stations = frameStations(g);
  const lignes = purlinLines(p);

  let n = 0;
  for (const [cote, axes] of lignes) {
    for (const axe of axes) {
      // Au faîtage les deux versants proposent la même panne : on ne la pose
      // qu'une fois, du côté gauche.
      if (cote === 'droite' && axe.faitiere) continue;
      n += 1;
      for (let t = 0; t < stations.length - 1; t++) {
        out.push(
          barre(
            `PA-${cote[0]}${n}-${t}`,
            'panne',
            pu.profile,
            pu.grade,
            v3(stations[t] as number, axe.y, axe.z),
            v3(stations[t + 1] as number, axe.y, axe.z),
            axe.up,
            `panne ${n} — travée ${t + 1}`,
          ),
        );
      }
    }
  }

  if (pu.sagBars.enabled) buildSagBars(p, out, lignes);
  if (p.connections.purlinCleat.enabled) buildCleats(p, out, lignes);
  return purlinSpacing(p);
}

/** Saillie d'une lierne au-delà de l'âme : écrou, rondelle et deux filets (mm). */
export function saillieDeLierne(diametre: number): number {
  return 2.5 * diametre;
}

/**
 * Liernes : ronds tendus entre pannes voisines, qui bloquent le déversement des
 * pannes sous le poids de la couverture.
 *
 * ⚠ Une lierne relie DEUX PANNES VOISINES, elle ne traverse pas le versant d'un
 * bout à l'autre : sa longueur est l'entraxe réel des pannes suivant le rampant.
 * Elle reste dans le plan du versant — même abscisse aux deux abouts — parce
 * qu'elle est perpendiculaire aux pannes qu'elle entretoise.
 *
 * Le nombre de FILES répartit les liernes dans la travée : une file à mi-travée,
 * deux files aux tiers.
 */
function buildSagBars(
  p: ProjectParams,
  out: Member[],
  lignes: Map<'gauche' | 'droite', PurlinAxis[]>,
): void {
  const sb = p.secondary.purlins.sagBars;
  const stations = frameStations(p.grid);
  const profil = createRound(sb.diameter);
  const panne = getProfile(p.secondary.purlins.profile);
  /*
   * ⚠ La lierne TRAVERSE l'âme de chaque panne et s'y bloque par deux écrous :
   * elle dépasse donc de chaque âme de quoi loger écrou, rondelle et deux filets
   * — 2,5 diamètres. Coupée d'axe à axe, elle s'arrêtait au milieu de l'âme,
   * sans un millimètre de filetage pour serrer.
   */
  const saillie = saillieDeLierne(sb.diameter);
  // Plan de l'âme de la panne dans sa section : au centre pour un I, décalé
  // pour un Z ou un C dont l'âme n'est pas sur le centre de gravité.
  const yAme = panne.shape === 'Z' || panne.shape === 'C' ? -panne.cy + panne.t / 2 : 0;
  const zPassage = panne.h / 5;

  for (const [cote, axes] of lignes) {
    for (let k = 0; k < axes.length - 1; k++) {
      const a = axes[k] as PurlinAxis;
      const b = axes[k + 1] as PurlinAxis;
      const largeur = cross(a.up, EX);
      /*
       * Deux liernes voisines passent dans des trous DIFFÉRENTS de la panne qui
       * les sépare, l'un au-dessus de l'axe, l'autre au-dessous : dans un même
       * trou, leurs écrous se rencontreraient.
       */
      // Alternance inversée sur le versant droit : à la faîtière, les liernes
      // des deux versants arrivent dans les deux trous, pas dans le même.
      const z = ((k % 2 === 0) === (cote === 'gauche') ? 1 : -1) * zPassage;
      const decal = add(scale(largeur, yAme), scale(a.up, z));
      const pa = add(v3(0, a.y, a.z), decal);
      const pb = add(v3(0, b.y, b.z), decal);
      const u = normalize(sub(pb, pa));
      for (let t = 0; t < stations.length - 1; t++) {
        const x0 = stations[t] as number;
        const travee = (stations[t + 1] as number) - x0;
        for (let f = 1; f <= sb.rows; f++) {
          const x = x0 + (travee * f) / (sb.rows + 1);
          const debut = add(v3(x, pa.y, pa.z), scale(u, -saillie));
          const fin = add(v3(x, pb.y, pb.z), scale(u, saillie));
          out.push(
            barre(
              `LN-${cote[0]}${k}-${t}-${f}`,
              'lierne',
              profil.id,
              p.secondary.purlins.grade,
              debut,
              fin,
              a.up,
              `lierne entre pannes ${k + 1} et ${k + 2} — versant ${cote}, travée ${t + 1}`,
            ),
          );
        }
      }
    }
  }
}

/**
 * Cornières d'attache (échantignolles) : à chaque croisement panne / traverse, un
 * tronçon de cornière assure la reprise. C'est une pièce à débiter, à repérer et
 * à peser comme les autres — la réduire à ses perçages ferait disparaître de la
 * nomenclature quelques centaines de pièces bien réelles.
 *
 * La cornière est posée le long de la panne, en « Γ » : son aile COUCHÉE en haut,
 * sous la semelle inférieure de la panne qui s'y boulonne ; son aile DRESSÉE
 * descend jusqu'à la traverse, sur laquelle elle est soudée en atelier.
 *
 * ⚠⚠ Elle était posée l'aile couchée EN BAS, centrée comme si son centre de
 * gravité était au milieu de sa hauteur : la cornière flottait 17 mm au-dessus de
 * la traverse, pénétrait la panne de 23 mm, et le boulon traversait 58 mm de vide
 * entre la semelle de la panne et l'aile percée. Chaque trou était « dans le
 * métal » ; c'est l'empilage qui était faux.
 */
function buildCleats(
  p: ProjectParams,
  out: Member[],
  lignes: Map<'gauche' | 'droite', PurlinAxis[]>,
): void {
  const cleat = p.connections.purlinCleat;
  const profil = getProfile(cleat.profile);
  const profilPanne = getProfile(p.secondary.purlins.profile);
  const semelle = semelleInferieure(profilPanne) ?? { z: -profilPanne.h / 2, yCentre: 0 };
  const stations = frameStations(p.grid);

  // Section de la cornière : centre de gravité et milieu de la partie plate de
  // l'aile couchée, là où passent les boulons.
  const cz = profil.shape === 'L' ? profil.cz : profil.h / 2;
  const yBoulons =
    profil.shape === 'L' ? (-profil.cy + profil.t + profil.r + (profil.a2 - profil.cy)) / 2 : 0;

  for (const [cote, axes] of lignes) {
    for (const [k, axe] of axes.entries()) {
      if (cote === 'droite' && axe.faitiere) continue;
      const n = axe.up;
      // Largeur de section de la panne (axe y de son repère : n × x).
      const largeur = cross(n, EX);
      /*
       * ⚠ TALON VERS L'AMONT des deux côtés du faîtage. La cornière n'est pas
       * symétrique : posée dans le même sens sur les deux versants, elle avait
       * son aile dressée vers l'amont à gauche et vers l'aval à droite — et le
       * poteau de gauche, sa sablière soudée en tête, n'était plus celui de
       * droite. Côté droit, elle est donc posée TÊTE-BÊCHE : même pièce, axe
       * inversé.
       */
      const sens = cote === 'droite' ? -1 : 1;
      for (const [t, x] of stations.entries()) {
        /*
         * Hauteur : le dos de l'aile couchée au contact du dessous de panne.
         * Latéralement : le milieu de la partie plate de l'aile à l'aplomb des
         * deux boulons, qui encadrent l'âme de la panne. Le repère de la cornière
         * est retourné (son « haut » vers la traverse), d'où le signe.
         */
        const centre = add(
          add(v3(x, axe.y, axe.z), scale(n, semelle.z - cz)),
          scale(largeur, semelle.yCentre + sens * yBoulons),
        );
        out.push(
          barre(
            `AT-${cote[0]}${k}-${t}`,
            'attache',
            cleat.profile,
            p.secondary.purlins.grade,
            v3(x - (sens * cleat.length) / 2, centre.y, centre.z),
            v3(x + (sens * cleat.length) / 2, centre.y, centre.z),
            scale(n, -1),
            `cornière d’attache — panne ${k + 1} du versant ${cote}, file ${t + 1}`,
          ),
        );
      }
    }
  }
}

