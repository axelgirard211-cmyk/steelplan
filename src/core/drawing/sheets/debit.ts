import { getProfile } from '../../catalog/index';
import {
  cutAngleDeg,
  cutLengths,
  fibreAbscissa,
  memberFrame,
  memberMassKg,
  type Member,
} from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { roundMm } from '../../math/tolerance';
import { coteAngulaire } from '../dimension';
import { miseEnPageAxiale, type Interet } from '../barre/axial';
import { chaineTransversale, coteDeLongueur, cotesCumulees } from '../barre/cotes';
import {
  dessinerVue,
  encombrementSection,
  faceDuTrou,
  LIBELLE_FACE,
  transversale,
  type Face,
} from '../barre/vue';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { choisirEchelle, ECHELLES } from '../scale';
import { ordonnees } from './coupes';
import { DrawScene, pt, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { appliquer, type Transform2D } from '../view';

/**
 * PLAN DE PIÈCE — la barre telle qu'on la débite et la perce.
 *
 * C'est la planche du poste de DÉBIT et du poste de PERÇAGE. Elle donne, sans
 * interprétation possible : la longueur de coupe, les angles de coupe aux deux
 * abouts, et l'implantation de chaque perçage, face par face.
 *
 * ⚠ Une vue PAR FACE PERCÉE, et la pièce INTERROMPUE là où il n'y a rien à
 * lire. La planche précédente dessinait un poteau de 6,2 m au 1:50 sur un A4 :
 * six rangées de boulons à 122 mm tombaient à 2,4 mm l'une de l'autre, et les
 * trous des deux semelles se superposaient sur la même vue de dessus. Les cotes
 * se chevauchaient — l'atelier ne pouvait rien en tirer.
 *
 * Cotes CUMULÉES depuis l'about d'origine, à l'axe : c'est l'origine que prend
 * aussi le fichier de commande numérique, si bien que le plan et la machine
 * disent la même chose dans la même référence.
 *
 * ⚠ Toutes les valeurs cotées viennent du modèle, pas du dessin.
 */

/** Hauteur papier réservée sous chaque vue à sa cotation cumulée. */
const BANDE_COTES = 17;
/** Titre de vue au-dessus de chaque dessin. */
const BANDE_TITRE = 6;
/** Bandeau du haut : fiche technique et section. */
const BANDEAU = 44;
/** Marge gauche réservée aux chaînes transversales. */
const MARGE_GAUCHE = 26;

export interface DebitOptions {
  readonly format?: SheetFormat;
  readonly quantite: number;
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}

export function sheetDebit(m: Member, opts: DebitOptions): Sheet {
  // A4 d'abord ; une pièce percée sur ses trois faces passe en A3.
  const faces = facesADessiner(m);
  const format = opts.format ?? (faces.length >= 3 ? 'A3' : 'A4');
  const profil = getProfile(m.profileId);
  const l = cutLengths(m);
  const f = memberFrame(m);
  const fenetre = fenetreDe(format);
  const s = new DrawScene();

  /* ---------------- Mise en page axiale ---------------- */
  const e = encombrementSection(m);
  const largeur = fenetre.max.x - fenetre.min.x - MARGE_GAUCHE - 8;
  const hautVues = fenetre.max.y - BANDEAU - fenetre.min.y;
  const parVue = hautVues / faces.length - BANDE_COTES - BANDE_TITRE - 6;
  const ax = miseEnPageAxiale({
    ...etendue(m),
    interets: interetsDeLaBarre(m, []),
    largeur,
    hauteurProfil: Math.max(e.zMax - e.zMin, e.yMax - e.yMin),
    hauteurMaxi: parVue,
    marge: Math.max(80, 0.6 * Math.max(e.zMax - e.zMin, e.yMax - e.yMin)),
  });
  const k = 1 / ax.echelle;
  const sOrigine = fibreAbscissa(f, m.start, m.cutStart, { y: 0, z: 0 });
  const sFin = fibreAbscissa(f, m.start, m.cutEnd, { y: 0, z: 0 });
  const xOrigine = fenetre.min.x + MARGE_GAUCHE;

  /* ---------------- Vues, de haut en bas ---------------- */
  let y = fenetre.max.y - BANDEAU;
  for (const face of faces) {
    const [tMin, tMax] = face === 'v' ? [e.zMin, e.zMax] : face === 'o' ? [e.yMin, e.yMax] : [-e.yMax, -e.yMin];
    // Place de la cote de longueur au-dessus de l'élévation.
    const dessus = face === 'v' ? 14 : 0;
    // Le perceur lit ici CE qu'il perce sur la face — nombre et diamètre —, et
    // sur la vue OÙ : les deux ensemble, sans aller chercher la nomenclature.
    const parDiametre = new Map<number, number>();
    for (const h of m.holes.filter((x) => faceDuTrou(x) === face)) parDiametre.set(h.d, (parDiametre.get(h.d) ?? 0) + 1);
    const percage = [...parDiametre.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${n} trou${n > 1 ? 's' : ''} Ø${d}`).join(', ');
    s.texte(pt(fenetre.min.x + 2, y - 3), `${LIBELLE_FACE[face]} — 1:${ax.echelle}${percage ? ` — ${percage}` : ''}`, { hauteur: 2.2, gras: true });
    const yAxe = y - BANDE_TITRE - dessus - tMax * k;
    const v = dessinerVue(s, m, face, ax, pt(xOrigine, yAxe));

    if (face === 'v') {
      // Longueur de coupe à l'axe, et fibres extrêmes si une coupe est biaise.
      coteDeLongueur(s, v.P(sOrigine, 0), v.P(sFin, 0), yAxe + tMax * k + 9, l.axis, ax, xOrigine, '', 3);
      if (Math.abs(l.max - l.min) > 1) {
        s.texte(pt(xOrigine + ax.longueur, yAxe + tMax * k + 4), `maxi ${roundMm(l.max)} — mini ${roundMm(l.min)}`, {
          hauteur: 2,
          ancrage: 'droite',
        });
      }
      const ab = (z: number, c: 'start' | 'end'): Pt =>
        v.P(fibreAbscissa(f, m.start, c === 'start' ? m.cutStart : m.cutEnd, { y: 0, z }), z);
      coterAngle(s, m, 'start', v.P(sOrigine, 0), ab(tMin, 'start'), ab(tMax, 'start'), ax.echelle);
      coterAngle(s, m, 'end', v.P(sFin, 0), ab(tMin, 'end'), ab(tMax, 'end'), ax.echelle);
    }

    // Perçages vus en vraie forme sur cette face : cotes cumulées et chaîne
    // transversale au premier groupe.
    const trous = m.holes.filter((h) => faceDuTrou(h) === face);
    const yCotes = yAxe + tMin * k - 4;
    const points = [
      ...trous.map((h) => ({ s: h.s, vise: v.P(h.s, transversale(face, h.at)) })),
      ...(face === 'v' ? m.notches.flatMap((n) => [{ s: n.s0, vise: v.P(n.s0, n.side === 'sup' ? tMax : tMin) }, { s: n.s1, vise: v.P(n.s1, n.side === 'sup' ? tMax : tMin) }]) : []),
    ];
    const bas = cotesCumulees(s, { s: sOrigine, x: v.P(sOrigine, 0).x }, points.map((p) => ({ ...p, vise: pt(p.vise.x, yAxe + tMin * k) })), yCotes, -1);
    if (trous.length > 0) {
      const sPremier = Math.min(...trous.map((h) => h.s));
      const groupe = trous.filter((h) => Math.abs(h.s - sPremier) < 1);
      chaineTransversale(s, v, sPremier, groupe.map((h) => transversale(face, h.at)), xOrigine - 10);
    }
    /*
     * Grugeages : profondeur et longueur écrites EN CLAIR, hors de la semelle.
     * ⚠ Une cote de 12 mm de profondeur fait 0,6 mm au 1:20 : son texte sortait
     * de la ligne de cote et se posait sur celui du grugeage voisin. L'abscisse
     * des deux bords, elle, est portée par les cotes cumulées.
     */
    if (face === 'v') {
      for (const n of m.notches) {
        const haut = n.side === 'sup';
        const c = v.P((n.s0 + n.s1) / 2, haut ? tMax : tMin);
        s.texte(pt(c.x, c.y + (haut ? 1.6 : -1.6)), `grugeage ${roundMm(n.depth)} × ${roundMm(n.s1 - n.s0)}`, {
          hauteur: 1.8,
          ancrage: 'centre',
          ligneDeBase: haut ? 'bas' : 'haut',
        });
      }
    }
    y = Math.min(bas, v.cadre.min.y) - 6;
  }

  /* ---------------- Bandeau : fiche, section, repère ---------------- */
  /*
   * La SECTION en grand, avec l'axe de chaque perçage, coté en travers depuis
   * l'axe du profil : les pinces que le perceur trace avant de pointer. Sur la
   * vue de dessus, elles n'étaient qu'une chaîne au premier groupe de trous.
   * À droite des vues s'il y a la place, dessous sinon ; la petite section du
   * bandeau ne reste que faute de mieux.
   */
  const xVues = xOrigine + ax.longueur + 24;
  const aDroite = fenetre.max.x - xVues >= 70;
  const zoneSection: Bbox | null = aDroite
    ? { min: pt(xVues, fenetre.min.y + 4), max: pt(fenetre.max.x - 2, fenetre.max.y - BANDEAU) }
    : y - fenetre.min.y >= 46
      ? { min: pt(fenetre.min.x + 4, fenetre.min.y + 2), max: pt(fenetre.min.x + 150, y - 2) }
      : null;
  if (m.holes.length > 0 && zoneSection) dessinerSectionPercee(s, m, zoneSection);
  else dessinerSection(s, m, fenetre, ax.echelle);
  ficheTechnique(s, m, opts.quantite, fenetre, l.axis, l.max);
  const cartouche: CartoucheData = {
    meta: opts.meta,
    titre: `Pièce ${m.mark} — ${profil.id}`,
    echelle: ax.echelle,
    page: opts.page,
    total: opts.total,
  };
  dessinerCadre(s, format, cartouche);

  return { id: `debit-${m.mark}`, kind: 'debit', titre: cartouche.titre, format, echelle: ax.echelle, scene: s };
}

/**
 * Faces à dessiner : toujours l'élévation, plus chaque semelle qui porte des
 * perçages. Une semelle sans trou n'a rien à dire de plus que l'élévation.
 */
export function facesADessiner(m: Member, accessoires = false): Face[] {
  const faces: Face[] = ['v'];
  for (const f of ['o', 'u'] as const) {
    if (m.holes.some((h) => faceDuTrou(h) === f) || (accessoires && f === 'o')) faces.push(f);
  }
  return faces;
}

/** Étendue du métal, toutes fibres confondues. */
export function etendue(m: Member): { sMin: number; sMax: number } {
  const f = memberFrame(m);
  const e = encombrementSection(m);
  const coins = [e.zMin, e.zMax].flatMap((z) => [e.yMin, e.yMax].map((y) => ({ y, z })));
  const a = coins.map((c) => fibreAbscissa(f, m.start, m.cutStart, c));
  const b = coins.map((c) => fibreAbscissa(f, m.start, m.cutEnd, c));
  return { sMin: Math.min(...a), sMax: Math.max(...b) };
}

/** Ce qui doit se lire sur la barre : abouts, perçages, grugeages, accessoires. */
export function interetsDeLaBarre(m: Member, accessoires: readonly (readonly { s: number }[])[]): Interet[] {
  const f = memberFrame(m);
  const e = encombrementSection(m);
  const coins = [e.zMin, e.zMax].flatMap((z) => [e.yMin, e.yMax].map((y) => ({ y, z })));
  const bout = (c: 'start' | 'end'): Interet => {
    const ss = coins.map((q) => fibreAbscissa(f, m.start, c === 'start' ? m.cutStart : m.cutEnd, q));
    return { a: Math.min(...ss), b: Math.max(...ss) };
  };
  return [
    bout('start'),
    bout('end'),
    ...m.holes.map((h) => ({ a: h.s - h.d, b: h.s + h.d })),
    ...m.notches.map((n) => ({ a: n.s0, b: n.s1 })),
    ...accessoires.map((pts) => ({ a: Math.min(...pts.map((q) => q.s)), b: Math.max(...pts.map((q) => q.s)) })),
  ];
}

/* ------------------------------------------------------------------ */

/** Croix d'axe d'un perçage : c'est elle qui porte la cote, pas le cercle. */
export function marquerAxe(s: DrawScene, centre: Pt, taille: number): void {
  s.ligne(pt(centre.x - taille, centre.y), pt(centre.x + taille, centre.y), 'axe');
  s.ligne(pt(centre.x, centre.y - taille), pt(centre.x, centre.y + taille), 'axe');
}

export function coterAngle(
  s: DrawScene,
  m: Member,
  cote: 'start' | 'end',
  sommet: Pt,
  traceBas: Pt,
  traceHaut: Pt,
  echelle: number,
): void {
  const ecart = cutAngleDeg(m, cote);
  // Angle porté sur le plan : celui que fait la face de coupe avec l'axe de la
  // pièce, donc 90° pour une coupe droite. C'est le réglage de la scie.
  const surLaScie = 90 - ecart;

  if (ecart < 0.05) {
    s.texte(pt(sommet.x + (cote === 'start' ? -5 : 5), sommet.y - 6), '90°', {
      hauteur: 2.2,
      ancrage: cote === 'start' ? 'droite' : 'gauche',
    });
    return;
  }

  const r = Math.max(9, 140 / echelle);
  // Direction de l'axe vers l'intérieur de la pièce, et trace de la coupe.
  const axe = cote === 'start' ? 0 : Math.PI;
  const trace = Math.atan2(traceHaut.y - traceBas.y, traceHaut.x - traceBas.x);
  // On garde l'arc du côté du métal, en le ramenant dans le bon demi-tour.
  let fin = trace;
  while (fin - axe > Math.PI) fin -= Math.PI;
  while (fin - axe < 0) fin += Math.PI;
  coteAngulaire(s, sommet, axe, fin, r, surLaScie);
}

/**
 * Section transversale de la pièce, hachurée, posée en haut à droite.
 *
 * `cote` est le côté du cadre PAPIER qu'elle occupe : une planche qui n'a rien
 * d'autre à montrer lui en donne davantage, et la section s'y lit à une échelle
 * plus grande — normalisée dans tous les cas.
 */
export function dessinerSection(
  s: DrawScene,
  m: Member,
  fenetre: Bbox,
  _echelleVue: number,
  cote = 34,
): void {
  const profil = getProfile(m.profileId);
  const contour = sectionOutline(profil, 8);
  // La section est un détail, tracée plus grande que les vues — mais son échelle
  // doit rester NORMALISÉE, comme toute échelle portée sur un plan : la section
  // se mesure à la règle elle aussi.
  const denom = choisirEchelle(
    { min: pt(-profil.b / 2, -profil.h / 2), max: pt(profil.b / 2, profil.h / 2) },
    { min: pt(0, 0), max: pt(cote, cote) },
    1.1,
  );
  const cx = fenetre.max.x - (profil.b / denom) / 2 - 14;
  const cy = fenetre.max.y - (profil.h / denom) / 2 - 12;
  const tSection: Transform2D = { facteur: 1 / denom, dx: cx, dy: cy };

  const ext = contour.outer.map((q) => appliquer(tSection, pt(q.y, q.z)));
  const trous = contour.holes.map((r) => r.map((q) => appliquer(tSection, pt(q.y, q.z))));
  s.hachure(ext, trous, 1.6, 45);
  s.polyligne(ext, true, 'contour');
  for (const r of trous) s.polyligne(r, true, 'contour');

  s.texte(pt(cx, cy - (profil.h / denom) / 2 - 5), `Section ${profil.id} — 1:${denom}`, {
    hauteur: 2,
    ancrage: 'centre',
  });
}

/**
 * Section de la pièce à grande échelle, avec l'axe de chaque perçage dans sa
 * paroi et ses positions en travers, cotées depuis l'axe du profil.
 */
function dessinerSectionPercee(s: DrawScene, m: Member, zone: Bbox): void {
  const profil = getProfile(m.profileId);
  const contour = sectionOutline(profil, 8);
  const ys = contour.outer.map((q) => q.y);
  const zs = contour.outer.map((q) => q.z);
  const [y0, y1, z0, z1] = [Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)];
  const largeur = zone.max.x - zone.min.x - 34;
  const hauteur = zone.max.y - zone.min.y - 44;
  const d = ECHELLES.find((k) => (y1 - y0) / k <= largeur && (z1 - z0) / k <= hauteur) ?? 20;
  const cx = zone.min.x + 22 + (largeur - (y1 - y0) / d) / 2 - y0 / d;
  const cy = zone.min.y + 18 + (hauteur - (z1 - z0) / d) / 2 - z0 / d;
  const P = (y: number, z: number): Pt => pt(cx + y / d, cy + z / d);
  const ext = contour.outer.map((q) => P(q.y, q.z));
  const creux = contour.holes.map((r) => r.map((q) => P(q.y, q.z)));
  s.hachure(ext, creux, 1.4, 45);
  s.polyligne(ext, true, 'contour');
  for (const r of creux) s.polyligne(r, true, 'contour');
  s.ligne(pt(P(y0, 0).x - 3, P(0, 0).y), pt(P(y1, 0).x + 3, P(0, 0).y), 'axe');
  s.ligne(pt(P(0, 0).x, P(0, z0).y - 3), pt(P(0, 0).x, P(0, z1).y + 3), 'axe');

  // Axe de chaque position de perçage, à travers sa paroi.
  const enHauteur = new Set<number>();
  for (const h of m.holes) {
    if (h.through === 'z') {
      const a = P(h.at.y, h.at.z >= 0 ? z1 + 4 : z0 - 4);
      const b = P(h.at.y, h.at.z >= 0 ? z1 - 24 : z0 + 24);
      s.ligne(a, b, 'axe');
    } else {
      s.ligne(P(h.at.y - 24, h.at.z), P(h.at.y + 24, h.at.z), 'axe');
      enHauteur.add(Math.round(h.at.z));
    }
  }
  const o = P(0, 0);
  // Trous de la semelle haute cotés au-dessus, de la semelle basse au-dessous :
  // une seule ligne mêlait les deux, et l'on ne savait plus quelle cote allait où.
  const haut = [...new Set(m.holes.filter((h) => h.through === 'z' && h.at.z >= 0).map((h) => Math.round(h.at.y)))];
  const bas = [...new Set(m.holes.filter((h) => h.through === 'z' && h.at.z < 0).map((h) => Math.round(h.at.y)))];
  ordonnees(s, haut.sort((a, b) => a - b), (v) => P(v, z1), o, P(0, z1).y + 7, 'h', 1);
  ordonnees(s, bas.sort((a, b) => a - b), (v) => P(v, z0), o, P(0, z0).y - 7, 'h');
  ordonnees(s, [...enHauteur].sort((a, b) => a - b), (v) => P(y0, v), o, P(y0, 0).x - 6, 'v');
  s.texte(pt((zone.min.x + zone.max.x) / 2, zone.max.y - 4), `SECTION — perçages en travers, depuis l’axe — 1:${d}`, {
    hauteur: 2.2,
    gras: true,
    ancrage: 'centre',
  });
}

/** Bloc d'identification de la pièce, en haut à gauche de la feuille. */
function ficheTechnique(
  s: DrawScene,
  m: Member,
  quantite: number,
  fenetre: Bbox,
  longueurAxe: number,
  longueurMaxi: number,
): void {
  const profil = getProfile(m.profileId);
  const lignes: [string, string][] = [
    ['Repère', m.mark],
    ['Profil', profil.id],
    ['Nuance', m.grade],
    ['Quantité', `${quantite}`],
    ['Longueur de coupe', `${roundMm(longueurAxe)} mm`],
    ['Longueur maxi', `${roundMm(longueurMaxi)} mm`],
    ['Masse unitaire', `${memberMassKg(m).toFixed(1)} kg`],
    ['Masse totale', `${(memberMassKg(m) * quantite).toFixed(1)} kg`],
    ['Perçages', `${m.holes.length}`],
    ...(m.fentes && m.fentes.length > 0
      ? ([['Fentes d’about', m.fentes.map((f) => `${f.about === 'origine' ? 'origine' : 'extrémité'} ${roundMm(f.longueur)} × ${f.largeur}`).join(', ')]] as [string, string][])
      : []),
    ...(m.notches.length > 0
      ? ([
          ['Grugeages', `${m.notches.length}`],
          ['Motif', m.notches[0]?.reason ?? ''],
        ] as [string, string][])
      : []),
  ];
  const x = fenetre.min.x + 18;
  let y = fenetre.max.y - 6;
  for (const [k, v] of lignes) {
    s.texte(pt(x, y), `${k} :`, { hauteur: 2.2 });
    s.texte(pt(x + 32, y), v, { hauteur: 2.2, gras: true });
    y -= 3.6;
  }
}
