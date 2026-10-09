import { getProfile } from '../../catalog/index';
import type { Member } from '../../geometry/member';
import { EX, EY, v3, type Vec3 } from '../../math/vec3';
import { buildingLength } from '../../model/grid';
import {
  longueurFacade,
  refusOuverture,
  seChevauchent,
  type FaceOuverture,
  type Ouverture,
} from '../../model/ouvertures';
import type { ProjectParams } from '../../model/project';
import { barre } from './commun';
import { debordDesLisses, railLevels } from './facades';
import { sectionOutline } from '../../geometry/section';

/**
 * CHEVÊTRES D'OUVERTURE — ce qui borde le vide.
 *
 * ⚠ Percer une façade ne consiste pas à effacer des lisses : les lisses
 * interrompues doivent trouver un appui, et le bardage au-dessus de l'ouverture
 * doit être porté. D'où deux MONTANTS aux jambages et un LINTEAU en tête, plus
 * une traverse basse quand il y a une allège.
 *
 * ⚠⚠ LES MONTANTS MONTENT PLUS HAUT QUE LE LINTEAU, et ce n'est pas un excès de
 * matière. Un montant qui s'arrêterait au linteau serait une console encastrée
 * dans le sol : il reprendrait le vent des lisses coupées sans avoir d'appui en
 * tête. On le prolonge jusqu'à la première lisse CONTINUE au-dessus de
 * l'ouverture — celle-là passe au-dessus du vide, elle est tenue à ses deux
 * bouts par les poteaux, et c'est elle qui tient la tête du montant.
 */

/** Ouvertures effectivement posables, dans l'ordre donné. */
export function ouverturesValides(p: ProjectParams): Ouverture[] {
  const o = p.ouvertures;
  if (!o.enabled) return [];
  const gardees: Ouverture[] = [];
  for (const item of o.items) {
    if (refusOuverture(item, p.grid) !== null) continue;
    if (gardees.some((g) => seChevauchent(g, item))) continue;
    gardees.push(item);
  }
  return gardees;
}

/**
 * Ouvertures écartées, avec la raison.
 *
 * ⚠ Nommées, jamais tues. Une ouverture demandée qui n'apparaît nulle part —
 * ni sur le plan, ni dans un message — se découvre sur le chantier, quand le
 * bardage est posé plein là où le portail devait être.
 */
export function ouverturesRefusees(
  p: ProjectParams,
): { readonly ouverture: Ouverture; readonly raison: string }[] {
  if (!p.ouvertures.enabled) return [];
  const out: { ouverture: Ouverture; raison: string }[] = [];
  const gardees: Ouverture[] = [];
  for (const item of p.ouvertures.items) {
    const refus = refusOuverture(item, p.grid);
    if (refus !== null) {
      out.push({ ouverture: item, raison: refus });
      continue;
    }
    const conflit = gardees.find((g) => seChevauchent(g, item));
    if (conflit) {
      out.push({ ouverture: item, raison: `chevauche l’ouverture ${conflit.id}` });
      continue;
    }
    gardees.push(item);
  }
  return out;
}

/**
 * Intervalles de façade interrompus à une altitude donnée.
 *
 * ⚠ Bornes INCLUSES en haut comme en bas : une lisse tombant exactement au
 * niveau du linteau ou de la traverse basse est remplacée par celui-ci, elle
 * n'est pas conservée en plus. Les garder toutes deux poserait deux barres au
 * même endroit — invisible en 3D, mais comptée deux fois au débit et au camion.
 */
export function intervallesInterrompus(
  p: ProjectParams,
  face: FaceOuverture,
  z: number,
): [number, number][] {
  /*
   * ⚠ Les lisses s'arrêtent à la RIVE des montants, avec un jeu — pas sur leur
   * axe, où elles entraient d'une demi-largeur de profil. Et sous l'allège d'un
   * châssis, les montants descendent jusqu'au sol : les lisses qui y passent
   * sont coupées autour d'eux.
   */
  const m = demiLargeur(p.ouvertures.profile) + JEU;
  const out: [number, number][] = [];
  for (const o of ouverturesValides(p)) {
    if (o.face !== face) continue;
    const g = o.position;
    const d = o.position + o.largeur;
    if (z >= o.allege && z <= o.allege + o.hauteur) out.push([g - m, d + m]);
    else if (z < niveauDAppui(p, o)) out.push([g - m, g + m], [d - m, d + m]);
  }
  return out;
}

/** Jeu entre l'about d'une lisse et la rive du montant qui la reçoit (mm). */
const JEU = 10;

/** Demi-encombrement d'un profil dans le plan de façade (mm), côté le plus large. */
function demiLargeur(profil: string): number {
  return Math.max(...sectionOutline(getProfile(profil), 1).outer.map((q) => Math.abs(q.y)));
}

/**
 * Ce qui reste d'un segment une fois les intervalles retirés.
 *
 * ⚠ Un segment peut se retrouver COUPÉ EN DEUX, et les deux morceaux comptent.
 * Ne garder que le plus long — ou n'en garder aucun dès qu'il y a recoupement —
 * ferait disparaître du bardage à côté du portail.
 */
export function soustraire(
  a: number,
  b: number,
  trous: readonly [number, number][],
): [number, number][] {
  let morceaux: [number, number][] = [[Math.min(a, b), Math.max(a, b)]];
  for (const [t0, t1] of trous) {
    const suivant: [number, number][] = [];
    for (const [s0, s1] of morceaux) {
      if (t1 <= s0 || t0 >= s1) {
        suivant.push([s0, s1]);
        continue;
      }
      if (t0 > s0) suivant.push([s0, t0]);
      if (t1 < s1) suivant.push([t1, s1]);
    }
    morceaux = suivant;
  }
  // Un résidu de quelques millimètres n'est pas une lisse : on ne le débite pas.
  return morceaux.filter(([s0, s1]) => s1 - s0 > LONGUEUR_MINIMALE);
}

/** En deçà, le morceau de lisse restant ne se fabrique pas. */
const LONGUEUR_MINIMALE = 100;

/**
 * Altitude à laquelle la tête d'un montant trouve son appui.
 *
 * La première lisse CONTINUE au-dessus de l'ouverture, à défaut l'égout. Une
 * lisse est continue au-dessus de l'ouverture dès lors qu'elle n'est pas
 * elle-même interrompue par celle-ci.
 */
function niveauDAppui(p: ProjectParams, o: Ouverture): number {
  const tete = o.allege + o.hauteur;
  const dessus = railLevels(p).filter((z) => z > tete);
  return dessus.length > 0 ? Math.min(...dessus) : p.grid.eaveHeight;
}

/**
 * Repère d'une façade : où est son plan, et dans quelle direction court son
 * abscisse.
 *
 * ⚠ Le plan est celui des LISSES, débord compris, et non le nu du poteau. Un
 * chevêtre posé sur l'axe du poteau serait en retrait d'une demi-hauteur de
 * profil derrière les lisses qu'il doit recevoir.
 *
 * ⚠⚠ EXPORTÉ, parce que le DESSIN en a besoin autant que la construction : le
 * rectangle de l'ouverture tracé sur la façade doit tomber exactement sur les
 * montants qui le bordent. Recopier le calcul dans le module de dessin — ce que
 * j'ai failli faire — donnerait deux plans de façade qu'une modification de
 * profil suffirait à désaccorder, et le rectangle glisserait devant son chevêtre
 * sans que rien ne le signale.
 */
export function repereFacade(
  p: ProjectParams,
  face: FaceOuverture,
): { point: (s: number, z: number) => Vec3; up: Vec3 } {
  const g = p.grid;
  const debord = debordDesLisses(p, face.startsWith('pignon'));
  switch (face) {
    case 'long-pan-gauche':
      return { point: (s, z) => v3(s, -debord, z), up: EY };
    case 'long-pan-droit':
      return { point: (s, z) => v3(s, g.span + debord, z), up: EY };
    case 'pignon-ouest':
      return { point: (s, z) => v3(-debord, s, z), up: EX };
    case 'pignon-est':
      return { point: (s, z) => v3(buildingLength(g) + debord, s, z), up: EX };
  }
}

/** Montants, linteaux et traverses basses de toutes les ouvertures posables. */
export function buildOuvertures(p: ProjectParams, out: Member[]): void {
  const par = p.ouvertures;
  for (const o of ouverturesValides(p)) {
    const { point, up } = repereFacade(p, o.face);
    const gauche = o.position;
    const droite = o.position + o.largeur;
    const tete = o.allege + o.hauteur;
    // La tête du montant s'arrête sous la lisse continue qui la tient, avec un jeu.
    const appui = niveauDAppui(p, o);
    const sommet = appui < p.grid.eaveHeight ? appui - demiLargeur(p.secondary.rails.profile) - JEU : appui - JEU;
    // Linteau et traverse basse viennent entre les montants, au contact de leurs rives.
    const rive = demiLargeur(par.profile);
    const nom = `${o.id}`;

    /*
     * MONTANTS : du sol jusqu'à l'appui de tête.
     *
     * ⚠ Ils partent du SOL même pour un châssis en allège. Un montant suspendu
     * entre deux lisses tiendrait par ses seules attaches, et c'est le portail
     * de 4 m de large qui décide du dimensionnement, pas la fenêtre.
     */
    for (const [cote, s] of [
      ['gauche', gauche],
      ['droit', droite],
    ] as const) {
      out.push(
        barre(
          `${nom}-M${cote === 'gauche' ? 'G' : 'D'}`,
          'chevetre',
          par.profile,
          par.grade,
          point(s, 0),
          point(s, sommet),
          up,
          `montant ${cote} — ${nom}`,
        ),
      );
    }

    /* LINTEAU : il ferme l'ouverture en tête et porte le bardage au-dessus. */
    out.push(
      barre(
        `${nom}-LT`,
        'chevetre',
        par.profile,
        par.grade,
        point(gauche + rive, tete),
        point(droite - rive, tete),
        up,
        `linteau — ${nom}`,
      ),
    );

    /*
     * TRAVERSE BASSE : seulement s'il y a une allège, c'est-à-dire du bardage
     * sous l'ouverture à porter. Une porte descend au sol et n'en a pas.
     */
    if (o.allege > 0) {
      out.push(
        barre(
          `${nom}-TB`,
          'chevetre',
          par.profile,
          par.grade,
          point(gauche + rive, o.allege),
          point(droite - rive, o.allege),
          up,
          `traverse basse — ${nom}`,
        ),
      );
    }
  }
}

/** Longueur de façade réellement bardée, ouvertures déduites (m²). */
export function surfaceOuvertures(p: ProjectParams): number {
  return ouverturesValides(p).reduce((s, o) => s + (o.largeur * o.hauteur) / 1e6, 0);
}

/** Longueur de la façade concernée, exposée pour la saisie et les contrôles. */
export { longueurFacade };
