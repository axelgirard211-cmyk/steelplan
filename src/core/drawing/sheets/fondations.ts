import type { Plate, StructuralModel } from '../../build/types';
import type { AppuiPotelet, ChecksReport } from '../../checks/types';
import { souleve, type EnveloppeAppui } from '../../checks/reactions';
import { AVERTISSEMENT } from '../../checks/types';
import { add, scale, type Vec3 } from '../../math/vec3';
import { coteLineaire } from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData } from '../layout';
import { choisirEchelle } from '../scale';
import { DrawScene, pt, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { appliquer, cadrer } from '../view';

/**
 * PLAN D'IMPLANTATION DES TIGES D'ANCRAGE ET DESCENTE DE CHARGES.
 *
 * ⚠ C'est le premier document du chantier, et le dossier ne le portait pas.
 * Avant qu'une seule pièce d'acier n'arrive, quelqu'un doit couler des semelles
 * et y sceller des tiges — et pour cela il lui faut deux choses que la charpente
 * est seule à connaître : OÙ vont les tiges, à quelques millimètres près, et ce
 * que chaque pied REND à sa fondation. Sans le premier, rien ne se monte ; sans
 * le second, aucune semelle ne se calcule.
 *
 * Les deux sont sur la même planche parce qu'ils s'adressent aux deux mêmes
 * corps d'état, le maçon et le bureau d'études béton, et qu'ils se lisent
 * ensemble : l'implantation dit où, la descente dit combien.
 */

const TEXTE = 2.2;

export interface FondationsOptions {
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}

export function sheetFondations(
  model: StructuralModel,
  rapport: ChecksReport,
  opts: FondationsOptions,
): Sheet | null {
  if (rapport.reactions.length === 0) return null;

  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();

  // Le plan occupe le haut, le tableau le bas : l'un se regarde, l'autre se lit,
  // et les mêler rendrait les deux pénibles.
  const yCoupure = fenetre.min.y + (fenetre.max.y - fenetre.min.y) * 0.4;
  const echelle = dessinerImplantation(s, model, rapport.reactions, {
    min: pt(fenetre.min.x, yCoupure),
    max: fenetre.max,
  });
  dessinerDescente(s, rapport.reactions, rapport.piedsPotelets, {
    min: fenetre.min,
    max: pt(fenetre.max.x, yCoupure - 4),
  });

  dessinerCadre(s, format, {
    meta: opts.meta,
    titre: 'Implantation des tiges d’ancrage et descente de charges',
    echelle,
    page: opts.page,
    total: opts.total,
  });

  return {
    id: 'fondations',
    kind: 'fondations',
    titre: 'Implantation des ancrages et descente de charges',
    format,
    echelle,
    scene: s,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Vue en plan des pieds, cotée depuis les files.
 *
 * ⚠ Les cotes partent des AXES de files, comme sur un plan de génie civil, et
 * non d'un coin du bâtiment. C'est ainsi que le maçon implante : il tire ses
 * cordeaux sur les axes, puis pique les tiges par rapport à eux.
 */
function dessinerImplantation(
  s: DrawScene,
  model: StructuralModel,
  appuis: readonly EnveloppeAppui[],
  zone: Bbox,
): number {
  const xs = [...new Set(appuis.map((a) => a.x))].sort((a, b) => a - b);
  const ys = [...new Set(appuis.map((a) => a.y))].sort((a, b) => a - b);

  /*
   * ⚠ La bande réservée aux cotes se compte en millimètres PAPIER, pas en
   * millimètres du modèle. Une marge fixe de deux mètres poussait l'emprise
   * juste au-delà du 1:200, et l'échelle sautait au 1:500 : le bâtiment tenait
   * alors dans un timbre-poste au milieu d'une demi-planche vide. L'emprise
   * dépendant de l'échelle qui dépend de l'emprise, on itère jusqu'au point fixe.
   */
  const MARGE_PAPIER = 10;
  const emprise = (ech: number): Bbox => ({
    min: pt((xs[0] ?? 0) - MARGE_PAPIER * ech, (ys[0] ?? 0) - MARGE_PAPIER * ech),
    max: pt(
      (xs[xs.length - 1] ?? 0) + MARGE_PAPIER * ech,
      (ys[ys.length - 1] ?? 0) + MARGE_PAPIER * ech,
    ),
  });
  let echelle = choisirEchelle(emprise(1), zone, 1.05);
  for (let i = 0; i < 3; i++) echelle = choisirEchelle(emprise(echelle), zone, 1.05);
  const marge = MARGE_PAPIER * echelle;
  const t = cadrer(emprise(echelle), zone, echelle);
  const P = (x: number, y: number): Pt => appliquer(t, pt(x, y));

  s.texte(pt(zone.min.x, zone.max.y - 3), 'IMPLANTATION DES ANCRAGES — vue en plan', {
    hauteur: TEXTE * 1.2,
    gras: true,
  });

  // Axes de files, prolongés au-delà des pieds : ce sont eux qu'on trace au sol.
  for (const x of xs) {
    s.ligne(P(x, (ys[0] ?? 0) - marge), P(x, (ys[ys.length - 1] ?? 0) + marge), 'axe');
  }
  for (const y of ys) {
    s.ligne(P((xs[0] ?? 0) - marge, y), P((xs[xs.length - 1] ?? 0) + marge, y), 'axe');
  }

  /*
   * ⚠ Les platines et leurs tiges sont lues dans le MODÈLE, là où les a posées
   * le générateur d'assemblages. Cette planche les redessinait avec sa propre
   * règle — deux rangées, pince à 62 % de la demi-platine — qui ne coïncidait
   * avec les trous de la platine que par hasard : le maçon scellait les tiges
   * là où le plan d'implantation les mettait, et la platine percée à l'atelier
   * arrivait à côté. Les pieds de potelets n'y figuraient pas du tout.
   */
  const parId = new Map(model.members.map((m) => [m.id, m]));
  for (const pl of model.plates.filter((x) => x.kind === 'platine-pied')) {
    const porteur = pl.porteur ? parId.get(pl.porteur) : undefined;
    const appui = appuis.find((a) => Math.hypot(a.x - pl.origin.x, a.y - pl.origin.y) < 1);
    dessinerPied(s, pl, appui?.repere ?? porteur?.assemblage ?? pl.mark, P, t.facteur);
  }

  // Les potelets se cotent depuis l'axe de file, le long de chaque pignon.
  const roleDuPorteur = (pl: (typeof model.plates)[number]): string | undefined =>
    pl.porteur ? parId.get(pl.porteur)?.role : undefined;
  const potelets = model.plates.filter(
    (x) =>
      x.kind === 'platine-pied' &&
      roleDuPorteur(x) === 'potelet' &&
      !appuis.some((a) => Math.hypot(a.x - x.origin.x, a.y - x.origin.y) < 1),
  );
  /*
   * Pieds de montants de chevêtres : cotés le long de LEUR façade, depuis l'axe
   * de file le plus proche — ils tombent entre deux poteaux, et le maçon les
   * implante depuis eux.
   */
  const montants = model.plates.filter((x) => x.kind === 'platine-pied' && roleDuPorteur(x) === 'chevetre');
  const longPan = (y: number): boolean => y < (ys[0] ?? 0) || y > (ys[ys.length - 1] ?? 0);
  for (const cote of [...new Set(montants.map((x) => (longPan(x.origin.y) ? `y${Math.round(x.origin.y)}` : `x${Math.round(x.origin.x)}`)))]) {
    const surY = cote.startsWith('y');
    const pieds = montants.filter((x) => (surY ? `y${Math.round(x.origin.y)}` : `x${Math.round(x.origin.x)}`) === cote);
    const reperes = surY ? xs : ys;
    const positions = pieds.map((x) => (surY ? x.origin.x : x.origin.y));
    const proche = (v: number): number => reperes.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), reperes[0] ?? 0);
    const chaine = [...new Set([...positions.map(proche), ...positions])].sort((a, b) => a - b);
    const fixe = surY ? (pieds[0] as (typeof pieds)[number]).origin.y : (pieds[0] as (typeof pieds)[number]).origin.x;
    // Au-delà des chaînes des files et des potelets, pour ne pas s'y superposer.
    const decal = (fixe < (surY ? (ys[0] ?? 0) : (xs[0] ?? 0)) ? -1 : 1) * marge * 0.85;
    for (let i = 1; i < chaine.length; i++) {
      const a = chaine[i - 1] as number;
      const b = chaine[i] as number;
      coteLineaire(
        s,
        surY ? P(a, fixe + decal) : P(fixe + decal, a),
        surY ? P(b, fixe + decal) : P(fixe + decal, b),
        0,
        b - a,
        { hauteurTexte: 1.7, attaches: false },
      );
    }
  }
  for (const xPignon of [...new Set(potelets.map((x) => Math.round(x.origin.x)))]) {
    const chaine = [...(ys.length > 0 ? [ys[0] as number, ys[ys.length - 1] as number] : []), ...potelets.filter((x) => Math.round(x.origin.x) === xPignon).map((x) => x.origin.y)]
      .sort((a, b) => a - b);
    const xc = xPignon + (xPignon <= (xs[0] ?? 0) ? -1 : 1) * marge * 0.3;
    for (let i = 1; i < chaine.length; i++) {
      coteLineaire(s, P(xc, chaine[i] as number), P(xc, chaine[i - 1] as number), 0, (chaine[i] as number) - (chaine[i - 1] as number), {
        hauteurTexte: 1.7,
        attaches: false,
      });
    }
  }

  // Cotation des entraxes de files, dans les deux sens.
  if (xs.length >= 2) {
    const y0 = (ys[0] ?? 0) - marge * 0.55;
    for (let i = 1; i < xs.length; i++) {
      coteLineaire(
        s,
        P(xs[i - 1] as number, y0),
        P(xs[i] as number, y0),
        0,
        (xs[i] as number) - (xs[i - 1] as number),
        { hauteurTexte: 1.9, attaches: false },
      );
    }
  }
  if (ys.length >= 2) {
    const x0 = (xs[0] ?? 0) - marge * 0.55;
    for (let i = 1; i < ys.length; i++) {
      coteLineaire(
        s,
        P(x0, ys[i] as number),
        P(x0, ys[i - 1] as number),
        0,
        (ys[i] as number) - (ys[i - 1] as number),
        { hauteurTexte: 1.9, attaches: false },
      );
    }
  }
  return echelle;
}

/** Un pied : contour de platine, tiges, repère — tels que posés dans le modèle. */
function dessinerPied(s: DrawScene, pl: Plate, repere: string, P: (x: number, y: number) => Pt, facteur: number): void {
  const plan = (y: number, z: number): Pt => {
    const q: Vec3 = add(pl.origin, add(scale(pl.u, y), scale(pl.v, z)));
    return P(q.x, q.y);
  };
  s.polyligne(pl.outline.map((c) => plan(c.y, c.z)), true, 'contour');
  for (const h of pl.holes) {
    const c = plan(h.at.y, h.at.z);
    s.cercle(c, Math.max(0.6, (h.d / 2) * facteur), 'contour');
    const t = Math.max(1.6, (h.d / 2) * facteur + 1.2);
    s.ligne(pt(c.x - t, c.y), pt(c.x + t, c.y), 'axe');
    s.ligne(pt(c.x, c.y - t), pt(c.x, c.y + t), 'axe');
  }

  // Le repère se pose sous la platine, à distance PAPIER constante : indexé sur
  // la taille de la platine, il se collait au contour dès que l'échelle réduisait.
  const coins = pl.outline.map((c) => plan(c.y, c.z));
  const bas = Math.min(...coins.map((c) => c.y));
  const centre = plan(0, 0);
  s.texte(pt(centre.x, bas - 3.2), repere, { hauteur: TEXTE, gras: true, ancrage: 'centre' });
}

/* ------------------------------------------------------------------ */

/**
 * Tableau de descente de charges.
 *
 * Compression ET soulèvement, chacun avec la combinaison qui le produit : ce
 * sont deux cas de fondation distincts, et une semelle se dimensionne sur l'un
 * puis se vérifie sur l'autre.
 */
function dessinerDescente(
  s: DrawScene,
  appuis: readonly EnveloppeAppui[],
  potelets: readonly AppuiPotelet[],
  zone: Bbox,
): void {
  const largeur = zone.max.x - zone.min.x;
  const parts = [0.07, 0.11, 0.11, 0.24, 0.11, 0.24, 0.12];
  const bornes: number[] = [zone.min.x];
  for (const f of parts) bornes.push((bornes[bornes.length - 1] as number) + f * largeur);

  let y = zone.max.y - 3;
  s.texte(pt(zone.min.x, y), 'DESCENTE DE CHARGES — efforts rendus aux fondations (kN, kN·m)', {
    hauteur: TEXTE * 1.2,
    gras: true,
  });
  y -= 6;

  const rangee = (cellules: readonly string[], gras: boolean): void => {
    for (const [i, c] of cellules.entries()) {
      const droite = i > 0 && !(i === 3 || i === 5);
      s.texte(pt(droite ? (bornes[i + 1] as number) - 1.5 : (bornes[i] as number), y), c, {
        hauteur: 1.9,
        gras,
        ancrage: droite ? 'droite' : 'gauche',
      });
    }
  };

  rangee(['Rep.', 'N compr.', 'V', 'Combinaison', 'N soulèv.', 'Combinaison', 'M maxi'], true);
  y -= 1.8;
  s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
  y -= 3.6;

  const n = (v: number, d = 1): string => v.toFixed(d).replace('.', ',');
  for (const a of appuis) {
    if (y < zone.min.y + 6) break;
    rangee(
      [
        a.repere,
        n(a.compression.fz),
        n(a.horizontal.fy),
        a.compression.combinaison,
        souleve(a) ? n(a.soulevement.fz) : '—',
        souleve(a) ? a.soulevement.combinaison : '—',
        n(a.moment.m),
      ],
      false,
    );
    y -= 3.5;
  }
  // Pieds de potelets : articulés, ils rendent la réaction du vent de pignon.
  for (const l of potelets) {
    if (y < zone.min.y + 10) break;
    rangee([l.mark, n(l.n), n(l.v), l.combinaison, '—', '—', '0'], false);
    y -= 3.5;
  }

  y -= 2;
  const arrache = appuis.filter(souleve).length;
  s.texte(
    pt(zone.min.x, y),
    arrache > 0
      ? `⚠ ${arrache} pied(s) en SOULÈVEMENT : l’ancrage et le poids de la semelle doivent l’équilibrer.`
      : 'Aucun soulèvement : tous les pieds restent comprimés sous toutes les combinaisons.',
    { hauteur: 1.9, gras: true },
  );
  y -= 3.6;
  if (potelets.length > 0) {
    s.texte(pt(zone.min.x, y), 'Potelets : pieds articulés — V = réaction du vent de pignon, N = poids propre du potelet seul (bardage non compris).', {
      hauteur: 1.8,
    });
    y -= 3.4;
  }
  s.texte(pt(zone.min.x, y), AVERTISSEMENT, { hauteur: 1.8 });
}
