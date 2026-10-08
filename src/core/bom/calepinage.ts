import { getProfile } from '../catalog/index';
import type { SteelGradeId } from '../catalog/types';
import type { StructuralModel } from '../build/types';
import { cutAngleDeg, cutLengths, type Member } from '../geometry/member';
import type { AtelierParams } from '../model/atelier';

/**
 * CALEPINAGE DE DÉBIT — comment les coupes se rangent dans les barres du
 * commerce.
 *
 * ⚠ C'est la question que la liste de débit ne pose pas. Elle dit « 75 pannes
 * de 5 995 mm » ; le scieur, lui, reçoit des barres de 12 m, et la question est
 * de savoir combien en sortir du parc et ce qui restera au bout. Deux pannes de
 * 5 995 mm ne « tiennent » dans 12 000 mm que sur le papier : deux tombées
 * d'about et un trait de scie plus tard, il manque 13 mm et la seconde panne
 * sort d'une autre barre. Le calepinage les compte.
 *
 * Rangement par MEILLEUR AJUSTEMENT DÉCROISSANT : les plus grandes coupes
 * d'abord, chacune dans la barre ouverte où elle laisse le moins de reste. Ce
 * n'est pas l'optimum mathématique, mais c'est à quelques pour cent de lui, et
 * c'est ce que fait un bon scieur à la main — le schéma reste lisible.
 *
 * Les barres identiques sont regroupées en SCHÉMAS DE COUPE : « schéma 1 —
 * 12 barres de 12 m : PA1 + PA1 ». C'est ainsi qu'on le donne à la scie.
 */

export interface Coupe {
  readonly mark: string;
  /** Longueur à prélever : la fibre la plus longue (mm). */
  readonly longueur: number;
  readonly angleDebut: number;
  readonly angleFin: number;
}

export interface Schema {
  readonly numero: number;
  /** Longueur de la barre du commerce (mm). */
  readonly barre: number;
  /** Coupes, dans l'ordre où elles sortent de la barre. */
  readonly coupes: readonly Coupe[];
  /** Ce qui reste au bout, tombées et traits de scie déduits (mm). */
  readonly chute: number;
  /** Nombre de barres débitées selon ce schéma. */
  readonly nombre: number;
}

export interface CalepinageProfil {
  readonly profil: string;
  readonly grade: SteelGradeId;
  readonly schemas: readonly Schema[];
  /** Coupes plus longues que toute barre du commerce : à commander à longueur. */
  readonly aLongueur: readonly Coupe[];
  readonly barres: number;
  /** Longueur commandée en barres (mm), coupes à longueur non comprises. */
  readonly longueurCommandee: number;
  /** Longueur réellement débitée en pièces (mm). */
  readonly longueurUtile: number;
  /** Chutes réutilisables, stockées et non ferraillées (mm chacune). */
  readonly chutesStockees: readonly number[];
  /** Masse commandée (kg), à longueur comprise. */
  readonly masseCommandee: number;
}

/**
 * Barres du commerce que l'atelier peut recevoir pour ce profil, de la plus
 * courte à la plus longue : les longueurs que livrent les négociants, jusqu'à la
 * longueur maximale de l'atelier.
 */
export function barresDisponibles(profileId: string, a: AtelierParams): number[] {
  const p = getProfile(profileId);
  const tube = p.shape === 'CHS' || p.shape === 'BOX' || p.shape === 'RECT' || p.shape === 'L' || p.shape === 'ROND' || p.family === 'PLAT';
  const maxi = tube ? a.barreTube : a.barreLaminee;
  const commerce = tube ? [6_000, 12_000] : [6_000, 12_000, 15_000, 18_000, 24_000];
  const retenues = commerce.filter((l) => l <= maxi);
  return retenues.length > 0 ? retenues : [maxi];
}

/**
 * Les profils FORMÉS À FROID ne se calepinent pas : le profileur les livre à la
 * longueur commandée, percés en usine. Leur ligne va directement à la commande.
 */
export function seCommandeALongueur(profileId: string): boolean {
  const s = getProfile(profileId).shape;
  return s === 'Z' || s === 'C';
}

export function calepiner(model: StructuralModel, a: AtelierParams): CalepinageProfil[] {
  // Une coupe par PIÈCE, regroupées par profil et nuance.
  const groupes = new Map<string, { profil: string; grade: SteelGradeId; coupes: Coupe[] }>();
  for (const m of model.members) {
    const cle = `${m.profileId}|${m.grade}`;
    const g = groupes.get(cle) ?? { profil: m.profileId, grade: m.grade, coupes: [] };
    g.coupes.push(coupeDe(m));
    groupes.set(cle, g);
  }

  const out: CalepinageProfil[] = [];
  for (const { profil, grade, coupes } of groupes.values()) {
    out.push(calepinerProfil(profil, grade, coupes, a));
  }
  // Ordre de la commande : les plus lourds d'abord.
  return out.sort((x, y) => y.masseCommandee - x.masseCommandee);
}

function coupeDe(m: Member): Coupe {
  return {
    mark: m.mark,
    longueur: cutLengths(m).max,
    angleDebut: cutAngleDeg(m, 'start'),
    angleFin: cutAngleDeg(m, 'end'),
  };
}

/**
 * Calepinage d'un profil, sur la longueur de barre qui gaspille le moins.
 *
 * ⚠ La barre « standard » n'est pas toujours la bonne. Des poteaux de 6,2 m
 * dans des barres de 12 m sortent un par barre et laissent 5,8 m de chute
 * chacun ; en barres de 15 m, ils sortent par deux. On essaie donc chaque
 * longueur du commerce et l'on garde celle qui commande le moins d'acier — à
 * égalité, la standard, la plus facile à trouver chez le négociant.
 */
export function calepinerProfil(
  profil: string,
  grade: SteelGradeId,
  coupes: readonly Coupe[],
  a: AtelierParams,
): CalepinageProfil {
  const disponibles = barresDisponibles(profil, a);
  let meilleur: CalepinageProfil | null = null;
  for (const [i, standard] of disponibles.entries()) {
    const essai = calepinerSur(profil, grade, coupes, a, [standard, ...disponibles.slice(i + 1)]);
    const commande = (c: CalepinageProfil): number => c.longueurCommandee + c.aLongueur.reduce((t, x) => t + x.longueur, 0);
    if (!meilleur || commande(essai) < commande(meilleur) - 1) meilleur = essai;
  }
  return meilleur as CalepinageProfil;
}

function calepinerSur(
  profil: string,
  grade: SteelGradeId,
  coupes: readonly Coupe[],
  a: AtelierParams,
  disponibles: readonly number[],
): CalepinageProfil {
  const G = getProfile(profil).G;
  const masseDe = (mm: number): number => (G * mm) / 1000;
  const utileTotal = coupes.reduce((t, c) => t + c.longueur, 0);

  if (seCommandeALongueur(profil)) {
    return {
      profil,
      grade,
      schemas: [],
      aLongueur: [...coupes],
      barres: 0,
      longueurCommandee: 0,
      longueurUtile: utileTotal,
      chutesStockees: [],
      masseCommandee: masseDe(utileTotal),
    };
  }

  const plusLongue = disponibles[disponibles.length - 1] as number;
  // Place que prend une coupe : sa longueur et un trait de scie.
  const encombrement = (c: Coupe): number => c.longueur + a.traitDeScie;
  // Place utile d'une barre : sa longueur moins les deux tombées.
  const capacite = (barre: number): number => barre - 2 * a.tombee + a.traitDeScie;

  const aLongueur: Coupe[] = coupes.filter((c) => encombrement(c) > capacite(plusLongue));
  const aRanger = coupes
    .filter((c) => encombrement(c) <= capacite(plusLongue))
    .sort((x, y) => y.longueur - x.longueur);

  const ouvertes: { barre: number; coupes: Coupe[]; reste: number }[] = [];
  for (const c of aRanger) {
    const e = encombrement(c);
    // La barre ouverte où la coupe laisse le moins de reste…
    let meilleure: (typeof ouvertes)[number] | null = null;
    for (const b of ouvertes) {
      if (b.reste >= e && (!meilleure || b.reste < meilleure.reste)) meilleure = b;
    }
    if (meilleure) {
      meilleure.coupes.push(c);
      meilleure.reste -= e;
      continue;
    }
    // … sinon une barre neuve : la standard si la coupe y tient, la plus
    // courte des longues sinon.
    const barre = disponibles.find((l) => capacite(l) >= e) as number;
    ouvertes.push({ barre, coupes: [c], reste: capacite(barre) - e });
  }

  // Regroupement des barres identiques en schémas.
  const parSignature = new Map<string, { barre: number; coupes: Coupe[]; reste: number; nombre: number }>();
  for (const b of ouvertes) {
    const sig = `${b.barre}|${b.coupes.map((c) => `${c.mark}:${Math.round(c.longueur)}`).join(',')}`;
    const deja = parSignature.get(sig);
    if (deja) deja.nombre += 1;
    else parSignature.set(sig, { ...b, nombre: 1 });
  }
  /*
   * ⚠ Un schéma qui jette plus que la part admise est ABANDONNÉ : ses pièces
   * se commandent à longueur. Sans cela, des pannes de 6 m sortaient chacune
   * d'une barre de 12 m, et la commande achetait deux fois l'acier des pannes —
   * ce qu'aucun bureau d'études ne ferait : il les fait débiter par le
   * négociant.
   */
  const gardes = [...parSignature.values()].filter((b) => Math.max(0, b.reste) / b.barre <= a.chuteMaxi);
  for (const b of parSignature.values()) {
    if (gardes.includes(b)) continue;
    for (let k = 0; k < b.nombre; k++) aLongueur.push(...b.coupes);
  }
  const schemas: Schema[] = gardes
    .sort((x, y) => y.nombre - x.nombre || x.reste - y.reste)
    .map((b, i) => ({ numero: i + 1, barre: b.barre, coupes: b.coupes, chute: Math.max(0, b.reste), nombre: b.nombre }));

  const longueurCommandee = gardes.reduce((t, b) => t + b.barre * b.nombre, 0);
  const aLongueurTotal = aLongueur.reduce((t, c) => t + c.longueur, 0);
  return {
    profil,
    grade,
    schemas,
    aLongueur,
    barres: gardes.reduce((t, b) => t + b.nombre, 0),
    longueurCommandee,
    longueurUtile: utileTotal,
    chutesStockees: gardes.flatMap((b) => Array.from({ length: b.nombre }, () => b.reste)).filter((r) => r >= a.chuteReutilisable),
    masseCommandee: masseDe(longueurCommandee + aLongueurTotal),
  };
}

/** Taux de chute : ce qui est commandé et ne devient pas pièce. */
export function tauxDeChute(c: CalepinageProfil): number {
  const commande = c.longueurCommandee + c.aLongueur.reduce((t, x) => t + x.longueur, 0);
  return commande > 0 ? 1 - c.longueurUtile / commande : 0;
}
