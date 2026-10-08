import { getProfile } from '../catalog/index';
import { fibreAbscissa, memberFrame, squareCut, type Member } from '../geometry/member';
import { sectionOutline } from '../geometry/section';
import { add, normalize, scale, sub } from '../math/vec3';

/**
 * DÉGAGEMENT DES BARRES DE TREILLIS À UN MÊME NŒUD.
 *
 * L'ébout calculé contre la membrure ne suffit pas : au faîtage, le poinçon et
 * les deux diagonales centrales convergent sur un nœud sous un angle aigu, et
 * leurs abouts se recouvraient — les boulons de l'un traversaient l'aile de
 * l'autre. Chaque barre est ici vue dans le plan de la ferme comme une bande
 * (sa largeur de section, plus un demi-jeu de chaque côté) qui part de sa coupe ;
 * tant que deux bandes d'un même nœud se recouvrent, on recule la diagonale par
 * pas de 5 mm — le montant, plus court et d'aplomb, garde sa coupe.
 *
 * Seuls les plans de coupe bougent : les points de travail, et donc le modèle
 * de calcul, restent ceux de l'épure.
 */

type P2 = { y: number; z: number };

interface Bout {
  readonly base: string;
  readonly role: Member['role'];
  readonly noeud: P2;
  readonly u: P2;
  readonly n: P2;
  readonly zMin: number;
  readonly zMax: number;
  readonly maxi: number;
  recul: number;
}

const PAS = 5;
/** Longueur de bande examinée depuis la coupe (mm) : au-delà, les barres divergent. */
const PORTEE = 400;

export function degagerLesNoeuds(barres: Member[], depuis: number, jeu: number): void {
  const treillis = barres
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => i >= depuis && (m.role === 'montant' || m.role === 'diagonale'));
  if (treillis.length === 0) return;

  // Les deux cornières d'une barre double ont la même épure dans le plan : une seule bande.
  const ids = new Set(treillis.map(({ m }) => m.id));
  const baseDe = (id: string): string => {
    const racine = id.replace(/[ab]$/, '');
    return racine !== id && (ids.has(`${racine}a`) && ids.has(`${racine}b`)) ? racine : id;
  };

  const bouts = new Map<string, Bout>();
  const parNoeud = new Map<string, Bout[]>();
  for (const { m } of treillis) {
    const base = baseDe(m.id);
    if (bouts.has(`${base}|debut`)) continue;
    const f = memberFrame(m);
    const l = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
    const hauteurs = sectionOutline(getProfile(m.profileId), 1).outer.map((q) => q.z);
    const u: P2 = { y: f.ax.y, z: f.ax.z };
    const n: P2 = { y: f.az.y, z: f.az.z };
    const commun = { base, role: m.role, n, zMin: Math.min(...hauteurs) - jeu / 2, zMax: Math.max(...hauteurs) + jeu / 2, maxi: 0.35 * l };
    const axe = { y: 0, z: 0 };
    const debut: Bout = {
      ...commun,
      noeud: { y: m.start.y, z: m.start.z },
      u,
      recul: fibreAbscissa(f, m.start, m.cutStart, axe),
    };
    const fin: Bout = {
      ...commun,
      noeud: { y: m.end.y, z: m.end.z },
      u: { y: -u.y, z: -u.z },
      recul: l - fibreAbscissa(f, m.start, m.cutEnd, axe),
    };
    for (const [cote, b] of [['debut', debut], ['fin', fin]] as const) {
      bouts.set(`${base}|${cote}`, b);
      const cle = `${Math.round(b.noeud.y)}|${Math.round(b.noeud.z)}`;
      const l2 = parNoeud.get(cle);
      if (l2) l2.push(b);
      else parNoeud.set(cle, [b]);
    }
  }

  for (const groupe of parNoeud.values()) {
    for (let iter = 0; iter < 100; iter++) {
      let bouge = false;
      for (let i = 0; i < groupe.length; i++) {
        for (let j = i + 1; j < groupe.length; j++) {
          const a = groupe[i] as Bout;
          const b = groupe[j] as Bout;
          if (!seRecouvrent(a, b)) continue;
          const reculer = a.role === b.role ? [a, b] : [a.role === 'diagonale' ? a : b];
          for (const x of reculer) {
            if (x.recul + PAS <= x.maxi) {
              x.recul += PAS;
              bouge = true;
            }
          }
        }
      }
      if (!bouge) break;
    }
  }

  for (const { m, i } of treillis) {
    const base = baseDe(m.id);
    const debut = (bouts.get(`${base}|debut`) as Bout).recul;
    const fin = (bouts.get(`${base}|fin`) as Bout).recul;
    const axe = normalize(sub(m.end, m.start));
    barres[i] = {
      ...m,
      cutStart: squareCut(add(m.start, scale(axe, debut)), axe, -1),
      cutEnd: squareCut(sub(m.end, scale(axe, fin)), axe, 1),
    };
  }
}

/** Coins de la bande d'un about, dans le plan de la ferme. */
function coins(b: Bout): P2[] {
  const out: P2[] = [];
  for (const s of [b.recul, b.recul + PORTEE]) {
    for (const z of [b.zMin, b.zMax]) {
      out.push({ y: b.noeud.y + b.u.y * s + b.n.y * z, z: b.noeud.z + b.u.z * s + b.n.z * z });
    }
  }
  return out;
}

/** Deux bandes se recouvrent-elles ? Axes séparateurs : leurs deux repères. */
function seRecouvrent(a: Bout, b: Bout): boolean {
  const ca = coins(a);
  const cb = coins(b);
  for (const axe of [a.u, a.n, b.u, b.n]) {
    const pa = ca.map((q) => q.y * axe.y + q.z * axe.z);
    const pb = cb.map((q) => q.y * axe.y + q.z * axe.z);
    if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
  }
  return true;
}
