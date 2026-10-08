import { getProfile } from '../../catalog/index';
import type { StructuralModel } from '../../build/types';
import { memberFrame, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { v3 } from '../../math/vec3';
import { buildingLength, ridgeHeight } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { FaceOuverture } from '../../model/ouvertures';
import { dessinerOuvertures } from '../ouvertures';
import { chaineDeCotes, coteLineaire, coteNiveau } from '../dimension';
import { etiqueterPieces } from '../reperage';
import { pt, type DrawScene, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import {
  appliquer,
  project,
  VUE_LONG_PAN,
  VUE_TRANSVERSALE,
  type Transform2D,
  type ViewDir,
} from '../view';
import { frameStations } from '../../model/grid';
import { preparer, silhouette, tracer, type EnsembleOptions, type RenvoiDetail } from './ensemble';
import { renvoiDeDetail } from '../coupeRepere';

/**
 * LES QUATRE FAÇADES.
 *
 * ⚠ Le dossier n'en portait qu'UNE : l'élévation du long pan avant. Les trois
 * autres faces n'existaient nulle part — et la « coupe de pignon » n'en tenait
 * pas lieu, parce qu'une coupe et une façade ne montrent pas la même chose. Une
 * coupe tranche le bâtiment et montre ce qu'il y a DEDANS ; une façade se
 * regarde de l'extérieur et montre ce qu'on VOIT : le bardage, ses lisses, ses
 * potelets, ses contreventements. C'est le document que lit le bardeur, et celui
 * sur lequel on repère une ouverture.
 *
 * Chaque façade est vue DE L'EXTÉRIEUR, ce qui impose de retourner le repère
 * pour deux d'entre elles. Dessiner les quatre avec la même direction de regard
 * en donnerait deux en miroir : les files se liraient de droite à gauche, et le
 * bardeur poserait son calepinage à l'envers.
 */

/** Pignon OUEST vu de l'extérieur : on regarde vers les x croissants. */
const VUE_PIGNON_OUEST: ViewDir = {
  origin: v3(0, 0, 0),
  right: v3(0, -1, 0),
  up: v3(0, 0, 1),
};

/** Long pan ARRIÈRE vu de l'extérieur : on regarde vers les y décroissants. */
const VUE_LONG_PAN_ARRIERE: ViewDir = {
  origin: v3(0, 0, 0),
  right: v3(-1, 0, 0),
  up: v3(0, 0, 1),
};

export type Face = 'avant' | 'arriere' | 'ouest' | 'est';

/**
 * Correspondance entre la face du dossier et celle des ouvertures.
 *
 * ⚠ Deux vocabulaires cohabitent, et c'est délibéré : le dossier parle
 * d'« avant » et d'« arrière », qui se lisent sur une planche ; le modèle parle
 * de « long pan gauche » et « droit », qui se rapportent aux axes. La table les
 * relie en un seul endroit, plutôt que de laisser chaque appelant deviner
 * lequel des deux long pans est l'avant.
 */
export const FACE_OUVERTURE: Readonly<Record<Face, FaceOuverture>> = {
  avant: 'long-pan-gauche',
  arriere: 'long-pan-droit',
  ouest: 'pignon-ouest',
  est: 'pignon-est',
};

const LIBELLES: Readonly<Record<Face, string>> = {
  avant: 'Façade long pan avant',
  arriere: 'Façade long pan arrière',
  ouest: 'Façade pignon ouest',
  est: 'Façade pignon est',
};

export function sheetFacade(
  model: StructuralModel,
  p: ProjectParams,
  face: Face,
  opts: EnsembleOptions,
  renvois: readonly RenvoiDetail[] = [],
): Sheet {
  const g = p.grid;
  const longPan = face === 'avant' || face === 'arriere';
  const v = vueDe(face);
  const titre = LIBELLES[face];

  /*
   * ⚠ Ce qu'on garde, c'est la MOITIÉ du bâtiment située de ce côté. Tout garder
   * superposerait les deux façades opposées et rendrait le dessin illisible ;
   * ne garder que le plan de la façade ferait disparaître la toiture, qui fait
   * pourtant partie de ce qu'on voit.
   */
  const visibles = model.members.filter((m) => duCote(m, face, g.span, buildingLength(g)));
  const { s, t, echelle, fenetre } = preparer(visibles, v, titre, opts, longPan ? 700 : 600);

  for (const m of visibles) {
    // Le poteau et le potelet portent la façade : ils ressortent. Le reste est
    // du remplissage, tracé fin pour ne pas concurrencer la trame.
    const fort = m.role === 'poteau' || m.role === 'potelet';
    tracer(s, t, silhouette(m, v), fort ? 'contour' : 'contour-fin');
  }

  /*
   * Les pièces qui ABOUTISSENT sur la façade — pannes et lisses vues en bout sur
   * un pignon — se voient par leur section, mais SANS hachures : on ne les coupe
   * pas, on les regarde. Hachurer ferait de cette façade une coupe.
   */
  for (const m of model.members.filter((x) => aboutissantSur(x, face, buildingLength(g)))) {
    sectionVue(s, t, m, v);
  }

  s.ligne(...solDe(t, v, longPan ? buildingLength(g) : g.span), 'contour');

  /*
   * ⚠ Les ouvertures se tracent APRÈS l'ossature, pour que leur rectangle reste
   * lisible par-dessus les lisses qui l'entourent. C'est la façade qui situe une
   * ouverture : le chevêtre seul se lirait comme un renfort de bardage, pas
   * comme un portail de quatre mètres.
   */
  dessinerOuvertures(s, t, v, p, FACE_OUVERTURE[face]);

  /*
   * ⚠ La chaîne de cotes se place SOUS LE DESSIN, pas au bas de la feuille.
   * L'ancrer sur la fenêtre de la planche la reléguait à huit centimètres du
   * bâtiment quand celui-ci n'occupait pas toute la hauteur : une cotation
   * qu'il faut relier à l'œil à travers une bande vide n'est plus une cotation.
   */
  const bas = Math.min(
    ...visibles.flatMap((m) => [
      appliquer(t, project(m.start, v)).y,
      appliquer(t, project(m.end, v)).y,
    ]),
  );
  const yCotes = Math.max(fenetre.min.y + 14, bas - 22);
  coterFacade(s, t, p, face, yCotes);

  /*
   * ⚠ REPÉRAGE EN DERNIER, et ce n'est pas un détail d'ordonnancement : les
   * étiquettes doivent éviter la cotation et les bulles de file déjà tracées.
   * Les poser avant reviendrait à les placer en aveugle, puis à écrire les cotes
   * par-dessus — c'est-à-dire à rendre les deux illisibles.
   */
  // Renvois de détail avant le repérage : les étiquettes contournent les bulles.
  const centreVue = appliquer(t, project(v3(buildingLength(g) / 2, g.span / 2, g.eaveHeight / 2), v));
  const bulles = renvois.map((r) => {
    const c = appliquer(t, project(r.point, v));
    return renvoiDeDetail(s, c, r.rayon * t.facteur, r.lettre, { x: c.x - centreVue.x, y: c.y - centreVue.y });
  });
  etiqueterPieces(s, t, v, visibles, {
    occupe: [{ x0: fenetre.min.x - 40, y0: yCotes - 12, x1: fenetre.max.x + 40, y1: yCotes + 8 }, ...bulles],
  });

  return {
    id: `facade-${face}`,
    kind: 'elevation',
    titre,
    format: opts.format ?? 'A3',
    echelle,
    scene: s,
  };
}

/* ------------------------------------------------------------------ */

function vueDe(face: Face): ViewDir {
  switch (face) {
    case 'avant':
      return VUE_LONG_PAN;
    case 'arriere':
      return VUE_LONG_PAN_ARRIERE;
    case 'ouest':
      return VUE_PIGNON_OUEST;
    default:
      return VUE_TRANSVERSALE;
  }
}

/** La pièce est-elle du côté de cette façade ? */
function duCote(m: Member, face: Face, span: number, longueur: number): boolean {
  switch (face) {
    case 'avant':
      return m.start.y < span / 2 && m.end.y < span / 2;
    case 'arriere':
      return m.start.y > span / 2 && m.end.y > span / 2;
    case 'ouest':
      return m.start.x < longueur / 2 && m.end.x < longueur / 2;
    default:
      return m.start.x > longueur / 2 && m.end.x > longueur / 2;
  }
}

/** La pièce aboutit-elle sur le plan de cette façade, vue en bout ? */
function aboutissantSur(m: Member, face: Face, longueur: number): boolean {
  if (face === 'avant' || face === 'arriere') return false;
  const plan = face === 'ouest' ? 0 : longueur;
  const a = Math.abs(m.start.x - plan) < 1;
  const b = Math.abs(m.end.x - plan) < 1;
  // Une seule extrémité dans le plan : la pièce s'y arrête et se voit en bout.
  return a !== b;
}

/**
 * Section d'une pièce vue en bout, contour seul.
 *
 * ⚠ Sans hachures, contrairement à `sectionCoupee`. La hachure signifie « matière
 * tranchée par le plan de coupe » ; sur une façade, rien n'est tranché.
 */
function sectionVue(s: DrawScene, t: Transform2D, m: Member, v: ViewDir): void {
  const profil = getProfile(m.profileId);
  const contour = sectionOutline(profil, 6);
  const f = memberFrame(m);
  const centre = m.start;

  const versVue = (q: { y: number; z: number }): Pt => {
    const global = {
      x: centre.x + f.ay.x * q.y + f.az.x * q.z,
      y: centre.y + f.ay.y * q.y + f.az.y * q.z,
      z: centre.z + f.ay.z * q.y + f.az.z * q.z,
    };
    return appliquer(t, project(global, v));
  };
  s.polyligne(contour.outer.map(versVue), true, 'contour-fin');
}

/** Ligne de sol, sur toute la largeur de la façade. */
function solDe(t: Transform2D, v: ViewDir, largeur: number): [Pt, Pt] {
  const a = appliquer(t, project(v === VUE_LONG_PAN ? v3(-900, 0, 0) : v3(0, -900, 0), v));
  const b = appliquer(
    t,
    project(v === VUE_LONG_PAN ? v3(largeur + 900, 0, 0) : v3(0, largeur + 900, 0), v),
  );
  return [pt(a.x, a.y), pt(b.x, b.y)];
}

/**
 * Cotation de façade : la trame dans le sens de la façade, les niveaux à côté.
 *
 * Sur un long pan c'est la chaîne des travées ; sur un pignon, la portée. Ce sont
 * les deux repères que le bardeur emploie pour caler son calepinage.
 */
function coterFacade(
  s: DrawScene,
  t: Transform2D,
  p: ProjectParams,
  face: Face,
  yBas: number,
): void {
  const g = p.grid;
  const v = vueDe(face);
  const enPlan = (x: number, y: number): Pt => appliquer(t, project(v3(x, y, 0), v));

  if (face === 'avant' || face === 'arriere') {
    const yFacade = face === 'avant' ? 0 : g.span;
    const stations = frameStations(g);
    chaineDeCotes(
      s,
      stations.map((x) => pt(enPlan(x, yFacade).x, yBas)),
      0,
      stations.slice(1).map(() => g.baySpacing),
      { decalageTotal: -10 },
    );
  } else {
    const xFacade = face === 'ouest' ? 0 : buildingLength(g);
    coteLineaire(
      s,
      pt(enPlan(xFacade, 0).x, yBas),
      pt(enPlan(xFacade, g.span).x, yBas),
      0,
      g.span,
    );
  }

  // Niveaux : sol, égout, faîtage. Ils situent la façade en hauteur.
  const gauche = face === 'avant' || face === 'arriere' ? enPlan(0, face === 'avant' ? 0 : g.span) : enPlan(face === 'ouest' ? 0 : buildingLength(g), 0);
  const parNiveau = (z: number): Pt => pt(gauche.x, appliquer(t, project(v3(0, 0, z), v)).y);
  coteNiveau(s, parNiveau(0), 0);
  coteNiveau(s, parNiveau(g.eaveHeight), g.eaveHeight);
  if (g.roofType === 'bipente') coteNiveau(s, parNiveau(ridgeHeight(g)), ridgeHeight(g));
}
