import { getProfile } from '../../catalog/index';
import { EN_ATTENTE, type Hole } from '../../geometry/holes';
import { memberFrame, type Member } from '../../geometry/member';
import { add, dot, scale, sub } from '../../math/vec3';
import type { ProjectParams } from '../../model/project';

/**
 * PASSAGES DE LIERNES — le trou que chaque lierne traverse dans l'âme d'une
 * panne.
 *
 * ⚠ Les pannes n'en avaient aucun : soixante-quinze pannes percées pour leurs
 * échantignolles, et pas une pour les liernes qui les tiennent au déversement.
 * Le trou est pris là où l'AXE de la lierne coupe le plan de l'âme — aucune
 * cote n'est recopiée d'un repère à l'autre.
 *
 * Ce n'est pas un trou de boulon : la lierne y passe et s'y bloque par deux
 * écrous. Sa provenance la nomme, et la boulonnerie la compte à part.
 */
export function passagesDeLiernes(
  p: ProjectParams,
  members: readonly Member[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const sb = p.secondary.purlins.sagBars;
  if (!p.secondary.purlins.enabled || !sb.enabled) return;
  const d = sb.diameter + 2; // jeu de passage
  const pannes = members.filter((m) => m.role === 'panne');

  for (const ln of members.filter((m) => m.role === 'lierne')) {
    const u = sub(ln.end, ln.start);
    for (const pa of pannes) {
      const f = memberFrame(pa);
      const pr = getProfile(pa.profileId);
      // L'abscisse de la lierne doit tomber dans la panne.
      const s = dot(sub(ln.start, pa.start), f.ax);
      const l = dot(sub(pa.end, pa.start), f.ax);
      if (s < 0 || s > l) continue;
      // Plan de l'âme : normale = largeur de la panne (y local).
      const yAme = pr.shape === 'Z' || pr.shape === 'C' ? -pr.cy + pr.t / 2 : 0;
      const origine = add(pa.start, scale(f.ay, yAme));
      const denom = dot(u, f.ay);
      if (Math.abs(denom) < 1e-9) continue;
      const t = dot(sub(origine, ln.start), f.ay) / denom;
      if (t <= 0 || t >= 1) continue;
      const q = add(ln.start, scale(u, t));
      const local = sub(q, pa.start);
      const z = dot(local, f.az);
      if (Math.abs(z) > pr.h / 2) continue;
      ajouter(pa.id, [{ s: dot(local, f.ax), at: { y: yAme, z }, d, through: 'y', part: 'ame', from: ln.id }]);
    }
  }
}

/**
 * Pannes PERCÉES À L'IDENTIQUE pour les liernes : chaque passage reçoit son
 * symétrique de l'autre côté de l'axe, en attente s'il ne sert pas.
 *
 * ⚠ Les liernes voisines passent l'une au-dessus de l'axe, l'autre au-dessous ;
 * la panne d'égout et la faîtière n'en reçoivent qu'une. Percées au plus juste,
 * les pannes se scindaient en trois repères pour un trou de différence.
 */
export function percerPannesPourLiernes(members: readonly Member[], trous: Map<string, Hole[]>): void {
  const liernes = new Set(members.filter((m) => m.role === 'lierne').map((m) => m.id));
  for (const pa of members.filter((m) => m.role === 'panne')) {
    const l = trous.get(pa.id);
    if (!l) continue;
    const manquants = l
      .filter((h) => liernes.has(h.from))
      .filter((h) => !l.some((k) => Math.abs(k.s - h.s) < 0.5 && Math.abs(k.at.z + h.at.z) < 0.5))
      .map((h) => ({ ...h, at: { y: h.at.y, z: -h.at.z }, from: EN_ATTENTE }));
    l.push(...manquants);
  }
}
