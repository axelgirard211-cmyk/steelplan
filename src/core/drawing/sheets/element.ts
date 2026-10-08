import { getProfile } from '../../catalog/index';
import {
  haunchMassKg,
  haunchPaintM2,
  plateMassKg,
  platePaintM2,
} from '../../build/buildProject';
import type { Haunch, Plate, StructuralModel } from '../../build/types';
import {
  cutLengths,
  fibreAbscissa,
  memberFrame,
  memberMassKg,
  memberPaintM2,
  type Member,
  type CutPlane,
  type MemberFrame,
} from '../../geometry/member';
import type { Weld } from '../../geometry/weld';
import { dot, sub, type Vec3 } from '../../math/vec3';
import { plateFrame } from '../../build/connections/geom';
import { fenteDuPlat } from '../../build/connections/contreventement';

/**
 * L'ÉLÉMENT À FABRIQUER : une pièce complète, telle qu'elle quitte l'atelier.
 *
 * ⚠ C'est l'unité de travail de l'atelier, et elle ne coïncide avec aucune autre.
 * Ce n'est pas une barre — une barre nue n'est pas un élément livrable ; ce n'est
 * pas non plus un assemblage de chantier — celui-là se fait à la grue. C'est ce
 * qu'un homme débite, perce, assemble, pointe, soude, contrôle et envoie
 * peindre : le profil ET tout ce qui lui est soudé dessus.
 *
 * Le regroupement se fait par REPÈRE : deux pièces interchangeables ont, par
 * définition, exactement le même assemblage, et une seule fiche les décrit toutes.
 */

export interface ElementFabrication {
  /** Barre principale représentant le repère : celle qu'on débite d'abord. */
  readonly membre: Member;
  /** Repère d'ASSEMBLAGE — celui qu'on peint sur la pièce finie. */
  readonly repere: string;
  readonly toles: readonly Plate[];
  readonly jarrets: readonly Haunch[];
  /** Barres soudées sur la principale : les échantignolles d'une traverse. */
  readonly pieces: readonly Member[];
  readonly soudures: readonly Weld[];
  /** Nombre de pièces identiques à fabriquer. */
  readonly quantite: number;
  /** Masse d'UNE pièce finie, tôles, jarrets et pièces soudées compris (kg). */
  readonly masseUnitaire: number;
  /** Surface développée à traiter pour UNE pièce (m²). */
  readonly surfaceUnitaire: number;
}

/**
 * Tous les éléments à fabriquer, un par REPÈRE D'ASSEMBLAGE.
 *
 * ⚠ TOUS, y compris les pièces sans rien de soudé. Une panne n'a pas de platine,
 * mais elle se débite, se perce et se peint : elle a sa fiche comme les autres.
 *
 * ⚠ Les pièces SOUDÉES sur une autre — une échantignolle sur sa traverse — ne
 * sont pas des éléments : elles quittent l'atelier avec leur porteur. Les
 * compter à part les faisait coliser en vrac, et la traverse partait sans elles.
 *
 * Le rattachement des tôles, jarrets et pièces soudées est lu dans le modèle
 * (`porteur`), où il est établi une fois. Il était autrefois deviné ici, par
 * préfixe d'identifiant pour les tôles — ce qui soudait la platine de genou sur
 * le poteau — et par la géométrie pour les jarrets.
 */
export function elementsAFabriquer(model: StructuralModel): ElementFabrication[] {
  const parRepere = new Map<string, Member[]>();
  for (const m of model.members) {
    if (m.porteur !== null) continue;
    const l = parRepere.get(m.assemblage);
    if (l) l.push(m);
    else parRepere.set(m.assemblage, [m]);
  }

  const out: ElementFabrication[] = [];
  for (const [repere, membres] of parRepere) {
    const membre = membres[0] as Member;
    const toles = model.plates.filter((pl) => pl.porteur === membre.id);
    const jarrets = model.haunches.filter((h) => h.porteur === membre.id);
    const pieces = model.members.filter((x) => x.porteur === membre.id);
    const ids = new Set([
      membre.id,
      ...toles.map((x) => x.id),
      ...jarrets.map((x) => x.id),
      ...pieces.map((x) => x.id),
    ]);

    out.push({
      membre,
      repere,
      toles,
      jarrets,
      pieces,
      soudures: model.welds.filter((w) => w.between.some((x) => ids.has(x))),
      quantite: membres.length,
      masseUnitaire:
        memberMassKg(membre) +
        toles.reduce((s, pl) => s + plateMassKg(pl), 0) +
        jarrets.reduce((s, h) => s + haunchMassKg(h), 0) +
        pieces.reduce((s, x) => s + memberMassKg(x), 0),
      surfaceUnitaire:
        memberPaintM2(membre) +
        toles.reduce((s, pl) => s + platePaintM2(pl), 0) +
        jarrets.reduce((s, h) => s + haunchPaintM2(h), 0) +
        pieces.reduce((s, x) => s + memberPaintM2(x), 0),
    });
  }

  // Ordre de l'atelier : les pièces les plus lourdes d'abord, ce sont celles qui
  // occupent le poste le plus longtemps et qui commandent le planning.
  return out.sort((a, b) => b.masseUnitaire * b.quantite - a.masseUnitaire * a.quantite);
}

/** Une pièce de débit : un repère de barre et le nombre d'exemplaires. */
export interface PieceDeDebit {
  readonly membre: Member;
  readonly quantite: number;
}

/**
 * Les PIÈCES à débiter et percer, une par repère de débit — y compris celles
 * qui seront soudées sur une autre.
 *
 * ⚠ Ce n'est pas la liste des éléments. La scie et la perceuse travaillent la
 * barre nue : l'échantignolle se débite et se perce avant d'être soudée sur sa
 * traverse, et c'est son repère à elle que porte le fichier machine. Ne
 * programmer que les éléments laissait les échantignolles sans fichier.
 */
export function piecesDeDebit(model: StructuralModel): PieceDeDebit[] {
  const parRepere = new Map<string, { membre: Member; quantite: number }>();
  for (const m of model.members) {
    const deja = parRepere.get(m.mark);
    if (deja) deja.quantite += 1;
    else parRepere.set(m.mark, { membre: m, quantite: 1 });
  }
  return [...parRepere.values()];
}

/**
 * Tôles LIBRES : éclisses et goussets, boulonnées au montage et soudées à rien.
 * Elles ne font partie d'aucun élément, mais elles se débitent, se percent, se
 * peignent et se livrent.
 */
export function tolesLibres(model: StructuralModel): Plate[] {
  return model.plates.filter((pl) => pl.porteur === null);
}

/* ------------------------------------------------------------------ */
/* Géométrie de l'élément, dans le repère de sa barre                  */
/* ------------------------------------------------------------------ */

/** Point 3D exprimé dans le repère de la barre : abscisse, largeur, hauteur. */
export function versBarre(
  f: MemberFrame,
  origine: Vec3,
  p: Vec3,
): { s: number; y: number; z: number } {
  const d = sub(p, origine);
  return {
    s: d.x * f.ax.x + d.y * f.ax.y + d.z * f.ax.z,
    y: d.x * f.ay.x + d.y * f.ay.y + d.z * f.ay.z,
    z: d.x * f.az.x + d.y * f.az.y + d.z * f.az.z,
  };
}

/** Contour d'une tôle, projeté dans le repère de la barre qui la porte. */
export function contourDansBarre(
  pl: Plate,
  f: MemberFrame,
  origine: Vec3,
): { s: number; y: number; z: number }[] {
  return pl.outline.map((p) =>
    versBarre(f, origine, {
      x: pl.origin.x + pl.u.x * p.y + pl.v.x * p.z,
      y: pl.origin.y + pl.u.y * p.y + pl.v.y * p.z,
      z: pl.origin.z + pl.u.z * p.y + pl.v.z * p.z,
    }),
  );
}

/** Centre d'un contour, pour y poser un repère ou une cote d'implantation. */
export function milieu(
  c: readonly { s: number; y: number; z: number }[],
): { s: number; y: number; z: number } {
  const n = Math.max(1, c.length);
  return {
    s: c.reduce((t, q) => t + q.s, 0) / n,
    y: c.reduce((t, q) => t + q.y, 0) / n,
    z: c.reduce((t, q) => t + q.z, 0) / n,
  };
}

export interface Implantation {
  readonly pl: Plate;
  /** Abscisse du centre de la tôle dans le repère de la barre, pour le tracé. */
  readonly s: number;
  /**
   * Distance depuis l'ABOUT d'origine — la cote que lit l'assembleur.
   *
   * ⚠ Ce n'est pas `s`. Sur une barre éboutée le point de travail et l'about
   * sont distants de plusieurs centimètres, et une platine posée à la mauvaise
   * origine ne se rattrape qu'à la meuleuse.
   */
  readonly depuisAbout: number;
  /** About sur lequel la tôle est posée, quand elle y est soudée à plat. */
  readonly about: 'origine' | 'extremite' | null;
  /**
   * Plat engagé dans la FENTE de l'about d'un tube : longueur engagée — celle
   * de la fente à scier et des cordons — et saillie hors du tube (mm).
   */
  readonly fente: { readonly longueur: number; readonly saillie: number } | null;
}

/**
 * Implantation de chaque tôle sur la barre, dans l'ordre.
 *
 * ⚠ Une platine d'about n'a PAS de cote d'implantation : son plan moyen tombe à
 * une demi-épaisseur au-delà de la coupe, ce qui produisait une cote négative —
 * « PL2 à −10 mm de l'about » — que personne ne peut exécuter. Elle est repérée
 * comme posée sur l'about, ce qu'elle est.
 */
export function implantations(e: ElementFabrication): Implantation[] {
  const f = memberFrame(e.membre);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, e.membre.start, e.membre.cutStart, axe);

  return e.toles
    .map((pl) => {
      const s = milieu(contourDansBarre(pl, f, e.membre.start)).s;
      /*
       * ⚠ Un plat de tube n'est ni à plat sur l'about ni « à x mm » de lui : il
       * est engagé DANS l'about fendu, et en dépasse. Son centre tombe hors de la
       * barre, et la gamme l'annonçait « à −8 mm de l'about origine ».
       */
      if (pl.kind === 'plat-tube') {
        const fd = fenteDuPlat(e.membre, pl);
        return { pl, s, depuisAbout: 0, about: fd.about, fente: { longueur: fd.longueur, saillie: fd.saillie } };
      }
      /*
       * La tôle est-elle soudée SUR un about ? Elle l'est si elle est PARALLÈLE
       * au plan de coupe et plaquée contre lui. ⚠ Comparer l'abscisse de son
       * centre à celle de la coupe ne suffit pas : la platine de genou descend
       * sous la traverse jusqu'au bas du jarret, son centre se projette 29 mm
       * avant l'about sur un rampant à 10 %, et elle était annoncée « à −29 mm
       * de l'about » au lieu d'« soudée sur l'about ».
       */
      const contre = (plan: CutPlane): boolean => {
        const n = plateFrame(pl).n;
        return (
          Math.abs(dot(n, plan.normal)) > 0.99 &&
          Math.abs(dot(sub(pl.origin, plan.point), plan.normal)) <= pl.thickness
        );
      };
      const about = contre(e.membre.cutStart)
        ? ('origine' as const)
        : contre(e.membre.cutEnd)
          ? ('extremite' as const)
          : null;
      return { pl, s, depuisAbout: s - s0, about, fente: null };
    })
    .sort((a, b) => a.s - b.s);
}

/** Dimensions hors-tout d'une tôle, dans son propre plan (mm). */
export function encombrementTole(pl: Plate): { largeur: number; hauteur: number } {
  const ys = pl.outline.map((p) => p.y);
  const zs = pl.outline.map((p) => p.z);
  return {
    largeur: Math.max(...ys) - Math.min(...ys),
    hauteur: Math.max(...zs) - Math.min(...zs),
  };
}

/** Tôles distinctes de l'élément : une vue de découpe par REPÈRE, pas par pièce. */
export function tolesDistinctes(e: ElementFabrication): { pl: Plate; nombre: number }[] {
  const out: { pl: Plate; nombre: number }[] = [];
  for (const pl of e.toles) {
    const deja = out.find((x) => x.pl.mark === pl.mark);
    if (deja) deja.nombre += 1;
    else out.push({ pl, nombre: 1 });
  }
  return out;
}

/** Longueur de coupe et angles, tels qu'ils se règlent sur la scie. */
export function debitDe(m: Member): {
  axe: number;
  mini: number;
  maxi: number;
  profil: string;
} {
  const l = cutLengths(m);
  return { axe: l.axis, mini: l.min, maxi: l.max, profil: getProfile(m.profileId).id };
}
