import { findProfile } from '../catalog/index';
import { rad2deg } from '../math/tolerance';
import { minEdgeDistance, minGauge, type EndPlateParams } from './connections';
import { leftSlopeRad, rafterLength, ridgeY, rightSlopeRad } from './grid';
import type { ProjectParams } from './project';
import { CLASSES_EXECUTION } from './atelier';

export type IssueLevel = 'erreur' | 'avertissement';

export interface Issue {
  readonly level: IssueLevel;
  /** Chemin du paramètre fautif, ex. « frame.columnProfile ». */
  readonly path: string;
  readonly message: string;
}

/**
 * Validation du modèle à la frontière du système : un projet chargé depuis un
 * fichier ou saisi dans l'interface passe obligatoirement par ici avant d'être
 * utilisé par le générateur. Une `erreur` empêche la génération, un
 * `avertissement` la laisse passer en signalant un choix douteux.
 */
export function validateProject(p: ProjectParams): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'erreur', path, message });
  const warn = (path: string, message: string) =>
    out.push({ level: 'avertissement', path, message });

  const profil = (path: string, id: string) => {
    if (!findProfile(id)) err(path, `Profil « ${id} » absent du catalogue.`);
  };
  /*
   * ⚠ Tournure SANS ACCORD : les libellés sont tantôt masculins (« l'entraxe »,
   * « le diamètre »), tantôt féminins (« la portée », « la hauteur »).
   * « doit être strictement positif » donnait « La portée doit être strictement
   * positif » — une faute dans le message même qui reproche une erreur de saisie.
   */
  const positif = (path: string, v: number, label: string) => {
    if (!(v > 0)) err(path, `${label} : une valeur strictement positive est attendue (saisi : ${v}).`);
  };

  /* --- Atelier ----------------------------------------------------- */
  const at = p.atelier;
  positif('atelier.barreLaminee', at.barreLaminee, 'La longueur des barres laminées');
  positif('atelier.barreTube', at.barreTube, 'La longueur des barres de tubes');
  if (!(at.traitDeScie >= 0)) err('atelier.traitDeScie', 'Le trait de scie ne peut pas être négatif.');
  if (!(at.tombee >= 0)) err('atelier.tombee', 'La tombée d’about ne peut pas être négative.');
  if (!CLASSES_EXECUTION.includes(at.classeExecution)) {
    err('atelier.classeExecution', `Classe d’exécution « ${at.classeExecution} » inconnue (EXC1, EXC2 ou EXC3).`);
  }
  positif('atelier.toleLongueur', at.toleLongueur, 'La longueur des tôles du commerce');
  positif('atelier.toleLargeur', at.toleLargeur, 'La largeur des tôles du commerce');
  if (!(at.jeuDecoupe >= 0)) err('atelier.jeuDecoupe', 'Le jeu de découpe ne peut pas être négatif.');
  if (!(at.chuteMaxi > 0 && at.chuteMaxi <= 1)) {
    err('atelier.chuteMaxi', `La chute maximale est une part, entre 0 et 1 (saisi : ${at.chuteMaxi}).`);
  }
  if (at.barreLaminee < 6000) {
    warn('atelier.barreLaminee', `Barres de ${at.barreLaminee} mm : les laminés se livrent couramment en 12 m.`);
  }

  /* --- Trame ------------------------------------------------------- */
  const g = p.grid;
  if (!Number.isInteger(g.nBays) || g.nBays < 1) {
    err('grid.nBays', 'Le bâtiment doit compter au moins une travée entière.');
  }
  positif('grid.baySpacing', g.baySpacing, "L'entraxe des portiques");
  positif('grid.span', g.span, 'La portée');
  positif('grid.eaveHeight', g.eaveHeight, "La hauteur à l'égout");

  for (const [path, rad] of [
    ['grid.slope', leftSlopeRad(g)],
    ['grid.slopeRight', rightSlopeRad(g)],
  ] as const) {
    if (rad <= 0) err(path, 'La pente doit être strictement positive.');
    else if (rad > Math.PI / 4) {
      warn(path, `Pente de ${rad2deg(rad).toFixed(1)}° : inhabituelle en bâtiment industriel.`);
    }
  }
  if (g.baySpacing > 12000) {
    warn('grid.baySpacing', `Entraxe de ${(g.baySpacing / 1000).toFixed(1)} m : pannes très sollicitées.`);
  }

  /* --- Structure principale ---------------------------------------- */
  // Les poteaux existent dans les deux cas : ces deux options ne commandent que
  // la nature de la toiture, traverse à âme pleine ou ferme treillis.
  if (!p.frame.enabled && !p.truss.enabled) {
    err('frame.enabled', 'Aucune toiture : activer la traverse à âme pleine ou la ferme treillis.');
  }
  if (p.frame.enabled && p.truss.enabled) {
    err('truss.enabled', 'Traverse à âme pleine et ferme treillis sont activées simultanément : choisir l’une des deux.');
  }

  if (p.frame.enabled) {
    const f = p.frame;
    profil('frame.columnProfile', f.columnProfile);
    profil('frame.rafterProfile', f.rafterProfile);
    if (f.distinctGableFrame) {
      profil('frame.gableColumnProfile', f.gableColumnProfile);
      profil('frame.gableRafterProfile', f.gableRafterProfile);
    }
    const rafter = findProfile(f.rafterProfile);
    if (f.haunch.enabled) {
      const lmax = rafterLength(g, 'gauche');
      if (f.haunch.length >= lmax) {
        err('frame.haunch.length', `Le jarret (${f.haunch.length} mm) dépasse la longueur du rampant (${lmax.toFixed(0)} mm).`);
      }
      if (rafter && f.haunch.depth <= rafter.h) {
        err('frame.haunch.depth', `La hauteur au droit du jarret (${f.haunch.depth} mm) doit dépasser celle de la traverse (${rafter.h} mm).`);
      }
    }
  }

  if (p.truss.enabled) {
    const t = p.truss;
    profil('truss.topChordProfile', t.topChordProfile);
    profil('truss.bottomChordProfile', t.bottomChordProfile);
    profil('truss.postProfile', t.postProfile);
    profil('truss.diagonalProfile', t.diagonalProfile);
    if (!Number.isInteger(t.nPanels) || t.nPanels < 2) {
      err('truss.nPanels', 'Une ferme treillis compte au moins 2 panneaux.');
    }
    if (t.type === 'warren' && t.nPanels % 2 !== 0) {
      warn('truss.nPanels', 'Un treillis Warren se répartit mieux sur un nombre pair de panneaux.');
    }
    positif('truss.heightAtSupport', t.heightAtSupport, "La hauteur de ferme à l'appui");
    positif('truss.heightAtRidge', t.heightAtRidge, 'La hauteur de ferme au faîtage');

    // L'entrait repose sur la tête du poteau : la ferme se loge SOUS la hauteur
    // à l'égout, elle ne peut donc pas être plus haute que le bâtiment.
    if (t.heightAtSupport >= g.eaveHeight) {
      err(
        'truss.heightAtSupport',
        `Hauteur de ferme à l'appui (${t.heightAtSupport} mm) supérieure ou égale à la hauteur à l'égout (${g.eaveHeight} mm) : il ne resterait pas de poteau.`,
      );
    } else if (t.heightAtSupport > g.eaveHeight / 2) {
      warn('truss.heightAtSupport', 'La ferme occupe plus de la moitié de la hauteur du bâtiment.');
    }

    if (t.straightTie) {
      // Avec un entrait droit, la hauteur au faîtage découle de la pente.
      const deduite = t.heightAtSupport + ridgeY(g) * Math.tan(leftSlopeRad(g));
      if (Math.abs(deduite - t.heightAtRidge) > 5) {
        warn(
          'truss.heightAtRidge',
          `Ignorée : avec un entrait droit la hauteur au faîtage est imposée par la pente et vaut ${Math.round(deduite)} mm.`,
        );
      }
    }
  }

  /* --- Ossature secondaire ----------------------------------------- */
  const s = p.secondary;
  if (s.purlins.enabled) {
    profil('secondary.purlins.profile', s.purlins.profile);
    if (s.purlins.mode === 'entraxe') positif('secondary.purlins.spacing', s.purlins.spacing, "L'entraxe des pannes");
    else positif('secondary.purlins.count', s.purlins.count, 'Le nombre de pannes');
    if (s.purlins.spacing > 2500) {
      warn('secondary.purlins.spacing', `Entraxe de pannes de ${s.purlins.spacing} mm : vérifier la portée admissible du bac.`);
    }
    if (s.purlins.sagBars.enabled) {
      positif('secondary.purlins.sagBars.diameter', s.purlins.sagBars.diameter, 'Le diamètre des liernes');
      if (s.purlins.sagBars.rows < 1) {
        err('secondary.purlins.sagBars.rows', 'Au moins une file de liernes doit être posée si elles sont activées.');
      }
    }
  }
  if (s.rails.enabled) {
    profil('secondary.rails.profile', s.rails.profile);
    if (s.rails.sillHeight >= g.eaveHeight) {
      err('secondary.rails.sillHeight', 'Le soubassement atteint ou dépasse la hauteur à l’égout.');
    }
  }
  if (s.gablePosts.enabled) {
    profil('secondary.gablePosts.profile', s.gablePosts.profile);
    positif('secondary.gablePosts.courseTete', s.gablePosts.courseTete, 'La course des oblongs de tête de potelet');
  }

  /* --- Contreventements -------------------------------------------- */
  for (const [path, set] of [
    ['bracing.roof', p.bracing.roof],
    ['bracing.wall', p.bracing.wall],
    ['bracing.gable', p.bracing.gable],
  ] as const) {
    if (!set.enabled) continue;
    profil(`${path}.profile`, set.profile);
    for (const b of set.bays) {
      if (b < 0 || b >= g.nBays) err(`${path}.bays`, `Travée ${b} inexistante (le bâtiment en compte ${g.nBays}).`);
    }
  }
  if (!p.bracing.roof.enabled && !p.bracing.wall.enabled) {
    warn('bracing', 'Aucun contreventement : la stabilité longitudinale du bâtiment n’est pas assurée.');
  }

  /* --- Assemblages -------------------------------------------------- */
  const platine = (path: string, e: EndPlateParams) => {
    positif(`${path}.thickness`, e.thickness, "L'épaisseur de platine");
    if (e.rows < 2) err(`${path}.rows`, 'Une platine d’about comporte au moins 2 rangées de boulons.');
    const eMin = minEdgeDistance(e.bolt);
    if (e.edgeDistance < eMin) {
      err(`${path}.edgeDistance`, `Pince de ${e.edgeDistance} mm inférieure au minimum EN 1993-1-8 (${eMin.toFixed(0)} mm pour un M${e.bolt.d}).`);
    }
    const gMin = minGauge(e.bolt);
    if (e.cols > 1 && e.gauge < gMin) {
      err(`${path}.gauge`, `Entraxe de files de ${e.gauge} mm inférieur au minimum (${gMin.toFixed(0)} mm pour un M${e.bolt.d}).`);
    }
  };
  platine('connections.rafterToColumn', p.connections.rafterToColumn);
  platine('connections.ridge', p.connections.ridge);

  const cb = p.connections.columnBase;
  positif('connections.columnBase.thickness', cb.thickness, "L'épaisseur de platine de pied");
  if (p.frame.enabled) {
    const col = findProfile(p.frame.columnProfile);
    if (col && cb.length < col.h) {
      err('connections.columnBase.length', `Platine de pied (${cb.length} mm) plus courte que la hauteur du poteau ${col.id} (${col.h} mm).`);
    }
    if (col && cb.width < col.b) {
      err('connections.columnBase.width', `Platine de pied (${cb.width} mm) plus étroite que la semelle du poteau ${col.id} (${col.b} mm).`);
    }
  }
  if (p.frame.baseFixity === 'encastre' && cb.anchorCount < 4) {
    err('connections.columnBase.anchorCount', 'Un pied encastré demande au moins 4 tiges d’ancrage.');
  }

  /* --- Charges ------------------------------------------------------ */
  const l = p.loads;
  for (const [k, v] of Object.entries(l.loads)) {
    if (typeof v === 'number' && v < 0) err(`loads.loads.${k}`, 'Une charge ne peut pas être négative.');
  }
  if (l.loads.neige === 0 && l.loads.exploitation === 0) {
    warn('loads.loads', 'Ni neige ni charge d’exploitation : les vérifications seront peu représentatives.');
  }
  for (const [k, v] of Object.entries(l.deflection)) {
    if (v < 50) warn(`loads.deflection.${k}`, `Limite de flèche L/${v} : très permissive.`);
  }

  /* --- Barres libres ------------------------------------------------ */
  const vus = new Set<string>();
  for (const m of p.freeMembers) {
    profil(`freeMembers.${m.id}.profile`, m.profile);
    if (vus.has(m.id)) err(`freeMembers.${m.id}`, `Identifiant de barre libre en double : « ${m.id} ».`);
    vus.add(m.id);
    const d = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
    if (d < 1) err(`freeMembers.${m.id}`, 'Barre de longueur nulle.');
  }

  /* --- Cartouche et historique des indices -------------------------- */
  /*
   * AVERTISSEMENT, pas erreur : un écart ne rend pas le dossier faux, il le rend
   * douteux. Le modèle reste générable ; le projeteur doit simplement savoir que
   * son cartouche et son tableau d'indices ne disent pas la même chose.
   */
  const revs = p.meta.revisions;
  const derniere = revs[revs.length - 1];
  if (derniere && derniere.indice !== p.meta.indice) {
    warn(
      'meta.indice',
      `Le cartouche est à l’indice « ${p.meta.indice} » mais la dernière diffusion ` +
        `inscrite est l’indice « ${derniere.indice} ».`,
    );
  }
  const indices = new Set<string>();
  for (const r of revs) {
    if (indices.has(r.indice)) {
      warn('meta.revisions', `L’indice « ${r.indice} » figure deux fois dans l’historique.`);
    }
    indices.add(r.indice);
  }

  return out;
}

/** Le projet est-il générable (aucune erreur bloquante) ? */
export function isValid(issues: readonly Issue[]): boolean {
  return !issues.some((i) => i.level === 'erreur');
}
