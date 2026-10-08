import { getProfile } from '../../catalog/index';
import { contourJarret } from '../../build/jarret';
import { plateFrame } from '../../build/connections/geom';
import { cutLengths, fibreAbscissa, memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import { add, dot, scale } from '../../math/vec3';
import { contourDeTrou } from '../../geometry/holes';
import { roundMm } from '../../math/tolerance';
import { miseEnPageAxiale } from '../barre/axial';
import { coteDeLongueur, cotesCumulees, type CoteCumulee } from '../barre/cotes';
import {
  dansLaBarre,
  dessinerVue,
  encombrementSection,
  transversale,
  type Accessoire,
  type Face,
} from '../barre/vue';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { coterAngle, etendue, interetsDeLaBarre } from './debit';
import { ordonnees, type Coupe, type PlanDeVues } from './coupes';
import { bulleRepere } from '../dimension';
import { contourDansBarre, implantations, type ElementFabrication } from './element';
import { fenteDuPlat } from '../../build/connections/contreventement';

/**
 * VUES DE L'ÉLÉMENT ASSEMBLÉ — ce que l'assembleur pointe et soude.
 *
 * La barre principale en vue interrompue, avec À LEUR PLACE ses tôles, son
 * jarret et ses pièces soudées, chacun repéré et coté en implantation cumulée
 * depuis l'about d'origine — la même origine que le plan de pièce et que la
 * machine. Une vue de dessus dès qu'il y a des pièces soudées sur la semelle :
 * une échantignolle se positionne en long ET en travers.
 */

const BANDE_COTES = 17;
const BANDE_TITRE = 6;
const MARGE_GAUCHE = 24;

interface AccessoireRepere extends Accessoire {
  /** Abscisse cotée en implantation, ou `null` pour une tôle posée sur un about. */
  readonly sCote: number | null;
  /** Identifiant de la pièce, pour retrouver son cordon. */
  readonly id: string;
}

export function dessinerVuesAssemblage(
  s: DrawScene,
  e: ElementFabrication,
  zone: Bbox,
  plan: PlanDeVues = { gauche: null, deuxBouts: false, droite: null, dessus: false, coupes: [] },
): { echelle: number; raccourci: (s: number) => number } {
  const coupes = plan.coupes;
  const m = e.membre;
  const f = memberFrame(m);
  const accessoires = accessoiresDe(e);
  const enc = encombrementSection(m);

  // Vue de face, et vue de dessus projetée SOUS elle quand quelque chose se voit
  // d'en haut : c'est là que se cote la position en travers.
  const faces: Face[] = plan.dessus ? ['v', 'o'] : ['v'];

  const hauteurs = accessoires.flatMap((a) => a.points.map((q) => q.z));
  const tMaxV = Math.max(enc.zMax, ...hauteurs);
  const tMinV = Math.min(enc.zMin, ...hauteurs);
  const largeur = zone.max.x - zone.min.x - MARGE_GAUCHE - 6;
  /*
   * Les deux vues partagent une échelle : la hauteur papier se répartit selon ce
   * que chacune doit contenir — le profil et ses tôles en vue de face, sa largeur
   * et ce qui la déborde en vue de dessus —, pas à parts égales.
   */
  const accY = accessoires.flatMap((a) => a.points.map((q) => q.y));
  const etendues = faces.map((f) =>
    f === 'v' ? tMaxV - tMinV : Math.max(enc.yMax, ...accY) - Math.min(enc.yMin, ...accY),
  );
  const parVue =
    zone.max.y - zone.min.y - 4 - BANDE_DESSUS - faces.length * (BANDE_TITRE + BANDE_COTES + 6);
  /*
   * ⚠ L'échelle se règle sur ce qui S'ASSEMBLE — tôles, jarrets, pièces
   * soudées, abouts —, et non sur chaque perçage : les trous des lisses,
   * répartis sur toute la hauteur d'un poteau, multipliaient les zones et
   * ramenaient l'élément au 1:100, six centimètres de poteau sur une feuille A3.
   * Les perçages sont cotés au plan de pièce, d'où la barre arrive percée.
   */
  // Les plats d'un tube dépassent ses abouts : l'étendue dessinée les comprend.
  const metal = etendue(m);
  const sAcc = accessoires.flatMap((a) => a.points.map((q) => q.s));
  const ax = miseEnPageAxiale({
    sMin: Math.min(metal.sMin, ...sAcc),
    sMax: Math.max(metal.sMax, ...sAcc),
    interets: interetsDeLaBarre({ ...m, holes: [], notches: [] }, accessoires.map((a) => a.points)),
    largeur,
    hauteurProfil: etendues.reduce((a, b) => a + b, 0),
    hauteurMaxi: parVue,
    plafond: parVue,
    marge: Math.max(60, 0.25 * (enc.zMax - enc.zMin)),
  });
  const k = 1 / ax.echelle;
  const l = cutLengths(m);
  const sOrigine = fibreAbscissa(f, m.start, m.cutStart, { y: 0, z: 0 });
  const sFin = fibreAbscissa(f, m.start, m.cutEnd, { y: 0, z: 0 });
  const xOrigine = zone.min.x + MARGE_GAUCHE;

  let y = zone.max.y;
  for (const face of faces) {
    const ts = face === 'v' ? [tMinV, tMaxV] : face === 'o' ? [enc.yMin, enc.yMax] : [-enc.yMax, -enc.yMin];
    const [tMin, tMax] = [
      Math.min(...accessoiresT(accessoires, face), ts[0] as number),
      Math.max(...accessoiresT(accessoires, face), ts[1] as number),
    ];
    const dessus = face === 'v' ? BANDE_DESSUS : 0;
    const forme = getProfile(m.profileId).shape;
    const libelle = face === 'v' && forme !== 'I' && forme !== 'U' ? 'VUE DE FACE' : LIBELLE_ASSEMBLAGE[face];
    s.texte(pt(zone.min.x, y - 3), `${libelle} — 1:${ax.echelle}`, { hauteur: 2.2, gras: true });
    const yAxe = y - BANDE_TITRE - dessus - tMax * k;
    const v = dessinerVue(s, m, face, ax, pt(xOrigine, yAxe), accessoires);
    const yHaut = yAxe + tMax * k;
    const yBas = yAxe + tMin * k;
    // Plus bas atteint par les cotes des plats de tube, sous la vue de face.
    let basPlats = Infinity;

    if (face === 'v') {
      // Les tôles vues de face montrent leurs perçages, à leur place.
      for (const pl of e.toles) {
        const n = plateFrame(pl).n;
        if (Math.abs(dot(n, f.ay)) < 0.9) continue;
        for (const h of pl.holes) {
          const vers = (q: { y: number; z: number }) => {
            const p = dansLaBarre(f, m.start, add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z))));
            return v.P(p.s, p.z);
          };
          if (h.oblong) s.polyligne(contourDeTrou(h, 16).map(vers), true, 'contour');
          else s.cercle(vers(h.at), Math.max(0.4, (h.d / 2) * k), 'contour');
        }
      }
      /*
       * Plat engagé dans un tube : ce que l'assembleur règle avant de pointer —
       * la saillie hors de l'about, les trous, la longueur engagée dans la fente.
       */
      for (const pl of e.toles.filter((x) => x.kind === 'plat-tube')) {
        const fd = fenteDuPlat(m, pl);
        const pts = contourDansBarre(pl, f, m.start);
        const zBord = Math.min(...pts.map((q) => q.z));
        const sAbout = fd.about === 'origine' ? sOrigine : sFin;
        const sTrous = pl.holes.map((h) => dansLaBarre(f, m.start, add(pl.origin, add(scale(pl.u, h.at.y), scale(pl.v, h.at.z)))).s);
        // Cotes cumulées depuis le bout libre du plat, celui qu'on mesure.
        const sMin = Math.min(...pts.map((q) => q.s));
        const sMax = Math.max(...pts.map((q) => q.s));
        const libreAGauche = Math.abs(sMin - sAbout) > Math.abs(sMax - sAbout);
        const sLibre = libreAGauche ? sMin : sMax;
        const sens = libreAGauche ? 1 : -1;
        const valeurs = [...sTrous, sAbout, libreAGauche ? sMax : sMin].map((x) => Math.round(sens * (x - sLibre)));
        ordonnees(s, valeurs, (val) => v.P(sLibre + sens * val, zBord), v.P(sLibre, zBord), yBas - 20, 'h');
        basPlats = Math.min(basPlats, yBas - 30);
      }
      // Traits de coupe : à chaque endroit où se pose une pièce, sa lettre ;
      // deux traits voisins décalent leurs lettres pour ne pas se chevaucher.
      const traits = coupes.flatMap((c) => c.abscisses.map((sc) => ({ c, x: v.P(sc, 0).x }))).sort((a, b) => a.x - b.x);
      // Flèches de vue aux abouts qui ont leur vue de bout.
      if (plan.gauche) flecheDeVue(s, v.P(sOrigine, 0).x, yHaut, 1, plan.gauche.lettre);
      if (plan.gauche && plan.deuxBouts) flecheDeVue(s, v.P(sFin, 0).x, yHaut, -1, plan.gauche.lettre);
      if (plan.droite) flecheDeVue(s, v.P(sFin, 0).x, yHaut, -1, plan.droite.lettre);
      let xPrec = -Infinity;
      let rang = 0;
      for (const t of traits) {
        rang = t.x - xPrec < 9 ? (rang + 1) % 3 : 0;
        traitDeCoupe(s, t.x, yHaut, yBas, t.c, rang * 3.2);
        xPrec = t.x;
      }
      bullesDeRepere(s, accessoires, (q) => v.P(q.s, q.z), yHaut + 17, zone.max.x - 4);
      coteDeLongueur(s, v.P(sOrigine, 0), v.P(sFin, 0), yHaut + 25, l.axis, ax, xOrigine, '', 2.8);
      if (Math.abs(l.max - l.min) > 1) {
        s.texte(pt(xOrigine + ax.longueur, yHaut + 21.5), `maxi ${roundMm(l.max)} — mini ${roundMm(l.min)}`, {
          hauteur: 1.9,
          ancrage: 'droite',
        });
      }
      const ab = (z: number, c: 'start' | 'end') =>
        v.P(fibreAbscissa(f, m.start, c === 'start' ? m.cutStart : m.cutEnd, { y: 0, z }), z);
      coterAngle(s, m, 'start', v.P(sOrigine, 0), ab(enc.zMin, 'start'), ab(enc.zMax, 'start'), ax.echelle);
      coterAngle(s, m, 'end', v.P(sFin, 0), ab(enc.zMin, 'end'), ab(enc.zMax, 'end'), ax.echelle);
    }

    /*
     * Cotes cumulées d'implantation, depuis l'about d'origine : tôles
     * intermédiaires et pointe de jarret en vue de face, pièces soudées en vue
     * de dessus quand il y en a une.
     */
    const points: CoteCumulee[] = [];
    for (const a of accessoires) {
      if (a.sCote === null) continue;
      const estPiece = e.pieces.some((x) => x.id === a.id);
      if ((face === 'o') === estPiece || (face === 'v' && !faces.includes('o'))) {
        points.push({ s: a.sCote, vise: v.P(a.sCote, transversale(face, centre(a))) });
      }
    }
    const bas = cotesCumulees(
      s,
      { s: sOrigine, x: v.P(sOrigine, 0).x },
      points.map((p) => ({ ...p, vise: pt(p.vise.x, yBas) })),
      yBas - 15,
      -1,
    );
    if (face === 'o') {
      /*
       * Position EN TRAVERS, depuis l'axe, de chaque repère qui se voit d'en haut :
       * une fois par repère, à droite de sa première occurrence.
       */
      s.ligne(v.P(sOrigine, 0), v.P(sFin, 0), 'axe');
      const vus = new Set<string>();
      // Les platines d'about ont leur vue de bout : on ne les recote pas ici.
      const deBout = new Set([plan.gauche?.repere, plan.droite?.repere].filter((x): x is string => !!x));
      for (const a of accessoires) {
        if (vus.has(a.repere) || deBout.has(a.repere)) continue;
        const tt = a.points.map((q) => transversale(face, q));
        if (!tt.some((t) => Math.abs(t) > enc.yMax + 1)) continue;
        vus.add(a.repere);
        const sDroite = Math.max(...a.points.map((q) => q.s));
        const xDroite = Math.max(...a.points.map((q) => v.P(q.s, transversale(face, q)).x));
        ordonnees(
          s,
          [...new Set([Math.min(...tt), Math.max(...tt)].map((t) => Math.round(t)))],
          (t) => v.P(sDroite, t),
          v.P(sDroite, 0),
          xDroite + 3,
          'v',
          1,
        );
      }
    }
    y = Math.min(bas, v.cadre.min.y - 9, basPlats) - 3;
  }
  // L'abscisse « raccourcie » de la vue de face, en mm de modèle — les vides
  // réduits à la longueur d'une interruption : la vue 3D les resserre comme elle.
  return { echelle: ax.echelle, raccourci: (sAbs: number): number => ax.x(sAbs) * ax.echelle };
}

/** Titres des vues de l'élément assemblé. */
const LIBELLE_ASSEMBLAGE: Readonly<Record<Face, string>> = {
  v: 'VUE DE FACE (âme)',
  o: 'VUE DE DESSUS',
  u: 'VUE DE DESSOUS',
};

/** Au-dessus de la vue de face : traits de coupe, bulles de repère, cote de longueur. */
const BANDE_DESSUS = 31;

/**
 * Flèche de vue (ISO 128-30) : à l'about, pointée vers lui depuis l'extérieur,
 * avec la lettre de la vue de bout qui le montre.
 */
function flecheDeVue(s: DrawScene, x: number, yHaut: number, sens: 1 | -1, lettre: string): void {
  const y = yHaut + 3.5;
  const pointe = pt(x - sens * 1.5, y);
  const queue = pt(x - sens * 11, y);
  s.ligne(queue, pointe, 'contour');
  s.remplissage([pointe, pt(pointe.x - sens * 2.4, y + 1), pt(pointe.x - sens * 2.4, y - 1)], [], 0, 'contour');
  s.texte(pt(x - sens * 7, y + 1.6), lettre, { hauteur: 2.6, gras: true, ancrage: 'centre' });
}

/**
 * Trait de coupe : deux amorces fortes au-delà de la vue, la flèche dans le sens
 * où l'on regarde, et la lettre — comme on le trace à la main.
 */
function traitDeCoupe(s: DrawScene, x: number, yHaut: number, yBas: number, c: Coupe, decalage = 0): void {
  for (const [y0, y1] of [
    [yHaut + 1.5, yHaut + 6 + decalage],
    [yBas - 1.5, yBas - 6 - decalage],
  ] as const) {
    s.ligne(pt(x, y0), pt(x, y1), 'contour');
    const bout = pt(x + c.sens * 4, y1);
    s.ligne(pt(x, y1), bout, 'contour');
    s.remplissage(
      [bout, pt(bout.x - c.sens * 1.6, y1 + 0.7), pt(bout.x - c.sens * 1.6, y1 - 0.7)],
      [],
      0,
      'contour',
    );
    s.texte(pt(x + c.sens * 5.5, y1), c.lettre, { hauteur: 2.4, gras: true, ancrage: c.sens > 0 ? 'gauche' : 'droite', ligneDeBase: 'milieu' });
  }
}

/**
 * Bulles de repère, une par repère, rangées sur une ligne au-dessus de la vue
 * et reliées chacune à sa pièce : les étiquettes posées SUR les pièces se
 * chevauchaient dès que deux goussets étaient voisins.
 */
function bullesDeRepere(
  s: DrawScene,
  accessoires: readonly AccessoireRepere[],
  versPapier: (q: { s: number; z: number }) => Pt,
  yLigne: number,
  xMax: number,
): void {
  const parRepere = new Map<string, Pt>();
  for (const a of accessoires) if (!parRepere.has(a.repere)) parRepere.set(a.repere, versPapier(centre(a)));
  const tries = [...parRepere.entries()].sort((p, q) => p[1].x - q[1].x);
  const RAYON = 3.2;
  let xLibre = -Infinity;
  const places = tries.map(([repere, cible]) => {
    const x = Math.max(cible.x, xLibre + 2 * RAYON + 1.5);
    xLibre = x;
    return { repere, cible, x };
  });
  // Rangée trop longue : on la recale vers la gauche, depuis la droite.
  const debord = (places[places.length - 1]?.x ?? 0) - xMax;
  for (const p of places) bulleRepere(s, pt(p.x - Math.max(0, debord), yLigne), p.cible, p.repere, RAYON);
}

function accessoiresT(acc: readonly Accessoire[], face: Face): number[] {
  return acc.flatMap((a) => a.points.map((q) => transversale(face, q)));
}

function centre(a: Accessoire): { s: number; y: number; z: number } {
  const n = a.points.length || 1;
  return {
    s: a.points.reduce((t, q) => t + q.s, 0) / n,
    y: a.points.reduce((t, q) => t + q.y, 0) / n,
    z: a.points.reduce((t, q) => t + q.z, 0) / n,
  };
}

/** Tôles, jarrets et pièces soudées, exprimés dans le repère de la barre. */
function accessoiresDe(e: ElementFabrication): AccessoireRepere[] {
  const m = e.membre;
  const f = memberFrame(m);
  const out: AccessoireRepere[] = [];

  const implant = new Map(implantations(e).map((x) => [x.pl.id, x]));
  for (const pl of e.toles) {
    const { n } = plateFrame(pl);
    const c = contourDansBarre(pl, f, m.start);
    const d = dansLaBarre(f, { x: 0, y: 0, z: 0 }, scale(n, pl.thickness / 2));
    const points = c.flatMap((q) => [
      { s: q.s + d.s, y: q.y + d.y, z: q.z + d.z },
      { s: q.s - d.s, y: q.y - d.y, z: q.z - d.z },
    ]);
    const im = implant.get(pl.id);
    out.push({ id: pl.id, repere: pl.mark, points, sCote: im && im.about === null ? im.s : null });
  }

  for (const j of e.jarrets) {
    const c = contourJarret(j);
    const b = getProfile(j.profileId).b / 2;
    const points = [c.haut, c.bas, c.pointe].flatMap((q) => [
      dansLaBarre(f, m.start, add(q, scale(f.ay, b))),
      dansLaBarre(f, m.start, add(q, scale(f.ay, -b))),
    ]);
    // On cote la POINTE du jarret : sa racine est contre la platine d'about.
    out.push({ id: j.id, repere: j.mark, points, sCote: dansLaBarre(f, m.start, c.pointe).s });
  }

  for (const x of e.pieces) out.push(pieceSoudee(m, x));
  return out;
}

/** Les huit coins d'une pièce soudée — coupes comprises —, dans le repère de la barre. */
function pieceSoudee(m: Member, x: Member): AccessoireRepere {
  const fm = memberFrame(m);
  const fx = memberFrame(x);
  const enc = encombrementSection(x);
  const points = [enc.yMin, enc.yMax].flatMap((y) =>
    [enc.zMin, enc.zMax].flatMap((z) =>
      (['cutStart', 'cutEnd'] as const).map((c) => {
        const sAbs = fibreAbscissa(fx, x.start, x[c], { y, z });
        return dansLaBarre(fm, m.start, sectionPointAt(fx, x.start, sAbs, { y, z }));
      }),
    ),
  );
  // Implantation à l'AXE de la pièce soudée : c'est l'axe de la panne qu'elle
  // reçoit, la cote que le monteur retrouvera sur le plan de repérage.
  const milieu = dansLaBarre(fm, m.start, scale(add(x.start, x.end), 0.5));
  return { id: x.id, repere: x.mark, points, sCote: milieu.s };
}
