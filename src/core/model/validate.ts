import { findProfile } from '../catalog/index';
import { rad2deg } from '../math/tolerance';
import { minEdgeDistance, minGauge, minPitch, positionsDesAncrages, tigeDAncrage, type EndPlateParams } from './connections';
import { grilleDePlatine, semellesDerrierePlatine } from '../geometry/holes';
import { bracedBays } from './bracing';
import { buildingLength, leftSlopeRad, rafterLength, ridgeHeight, ridgeY, rightSlopeRad } from './grid';
import { barresEstimees, PLAFONDS } from './plafonds';
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
 * Rubrique de saisie où se corrige un paramètre.
 *
 * ⚠ Les messages citaient le chemin interne (« grid.span ») : il ne dit rien à
 * qui saisit, et ne lui dit pas OÙ corriger. La rubrique, si : c'est le titre de
 * la fiche qui porte le champ.
 */
export function rubriqueDe(path: string): string {
  const racine = path.split(/[.[]/)[0] as keyof ProjectParams;
  if (path === 'frame.enabled' || racine === 'truss') return 'Toiture';
  return RUBRIQUES[racine] ?? 'Projet';
}

const RUBRIQUES: Partial<Record<keyof ProjectParams, string>> = {
  meta: 'Cartouche et indices',
  grid: 'Trame — paramètres',
  frame: 'Portique',
  secondary: 'Ossature secondaire',
  ouvertures: 'Ouvertures',
  bracing: 'Contreventements',
  connections: 'Assemblages',
  site: 'Site et charges climatiques',
  loads: 'Charges et critères',
  finition: 'Traitement de surface',
  atelier: 'Atelier',
  prix: 'Chiffrage',
  freeMembers: 'Barres libres',
};

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
  // ⚠ Sans rappeler la valeur : elle est en mm ici, et la portée se saisit en
  // mètres — « saisi : −30000 » pour −30 tapé laissait croire à une autre faute.
  const positif = (path: string, v: number, label: string) => {
    if (!(v > 0)) err(path, `${label} : une valeur strictement positive est attendue.`);
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

  /* --- Chiffrage --------------------------------------------------- */
  // ⚠ Des avertissements seulement : un prix faux fausse le chiffre, jamais le
  // bâtiment, et ne doit pas suspendre les plans.
  const px = p.prix;
  const prixNegatifs: [string, number, string][] = [
    ...Object.entries(px.acier).map(([n, v]): [string, number, string] => [`acier.${n}`, v, `acier ${n}`]),
    ['boulon', px.boulon, 'boulon posé'],
    ['heureAtelier', px.heureAtelier, 'heure d’atelier'],
    ['heureParPiece', px.heureParPiece, 'temps par pièce'],
    ['peinture', px.peinture, 'peinture'],
    ['galvanisation', px.galvanisation, 'galvanisation'],
    ['transport', px.transport, 'transport'],
    ['montage', px.montage, 'montage'],
  ];
  for (const [cle, v, libelle] of prixNegatifs) {
    if (!(v >= 0)) warn(`prix.${cle}`, `Prix négatif dans la grille (${libelle}) : le chiffrage est faux.`);
  }
  if (!(px.cadenceSoudure > 0)) warn('prix.cadenceSoudure', 'La cadence de soudure doit être positive, en mètres de cordon par heure.');
  for (const [cle, libelle] of [['fraisGeneraux', 'frais généraux'], ['aleas', 'aléas'], ['marge', 'marge']] as const) {
    if (!(px[cle] >= 0 && px[cle] <= 100)) warn(`prix.${cle}`, `Taux de ${libelle} hors de 0 à 100 % : à vérifier.`);
  }

  /* --- Trame ------------------------------------------------------- */
  const g = p.grid;
  if (!Number.isInteger(g.nBays) || g.nBays < 1) {
    err('grid.nBays', 'Le bâtiment doit compter au moins une travée entière.');
  }
  positif('grid.baySpacing', g.baySpacing, "L'entraxe des portiques");
  positif('grid.span', g.span, 'La portée');
  positif('grid.eaveHeight', g.eaveHeight, "La hauteur à l'égout");
  /*
   * ⚠ PLAFONDS MÉTIER, bloquants. La génération est synchrone : un fichier à
   * 2 000 travées figeait l'onglet avant le moindre message. Les bornes restent
   * larges — aucun hangar réel ne les approche.
   */
  const plafond = (path: string, v: number, max: number, message: string) => {
    if (v > max) err(path, message);
  };
  plafond('grid.nBays', g.nBays, PLAFONDS.travees, `Au plus ${PLAFONDS.travees} travées : recouper le bâtiment par des joints.`);
  plafond('grid.baySpacing', g.baySpacing, PLAFONDS.entraxe, `Entraxe des portiques limité à ${PLAFONDS.entraxe / 1000} m.`);
  plafond('grid.span', g.span, PLAFONDS.portee, `Portée limitée à ${PLAFONDS.portee / 1000} m.`);
  plafond('grid.eaveHeight', g.eaveHeight, PLAFONDS.hauteur, `Hauteur à l'égout limitée à ${PLAFONDS.hauteur / 1000} m.`);

  for (const [path, rad] of [
    ['grid.slope', leftSlopeRad(g)],
    ['grid.slopeRight', rightSlopeRad(g)],
  ] as const) {
    if (rad <= 0) err(path, 'La pente doit être strictement positive.');
    else if (rad >= Math.PI / 2) err(path, 'La pente doit rester inférieure à 90°.');
    else if (rad > Math.PI / 4) {
      warn(path, `Pente de ${rad2deg(rad).toFixed(1)}° : inhabituelle en bâtiment industriel.`);
    }
  }
  if (g.baySpacing > 12000) {
    warn('grid.baySpacing', `Entraxe de ${(g.baySpacing / 1000).toFixed(1)} m : pannes très sollicitées.`);
  }
  /*
   * ⚠ Une trame fausse fausse tout ce qu'on en déduit. Une portée négative
   * faisait signaler, en plus, un jarret « plus long que le rampant de −15 m » :
   * deux fautes affichées pour une seule saisie. Les contrôles qui dépendent de
   * la trame attendent qu'elle soit juste.
   */
  // Une pente raide sur une grande portée monte le faîtage sans limite.
  if (!out.some((i) => i.level === 'erreur' && i.path.startsWith('grid.')) && !(ridgeHeight(g) <= PLAFONDS.faitage)) {
    err('grid.slope', `Faîtage à plus de ${PLAFONDS.faitage / 1000} m : réduire la pente ou la portée.`);
  }
  const trameValide = !out.some((i) => i.level === 'erreur' && i.path.startsWith('grid.'));

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
      if (trameValide && f.haunch.length >= lmax) {
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
    plafond('truss.nPanels', t.nPanels, PLAFONDS.panneaux, `Une ferme compte au plus ${PLAFONDS.panneaux} panneaux.`);
    if (t.type === 'warren' && t.nPanels % 2 !== 0) {
      warn('truss.nPanels', 'Un treillis Warren se répartit mieux sur un nombre pair de panneaux.');
    }
    positif('truss.heightAtSupport', t.heightAtSupport, "La hauteur de ferme à l'appui");
    positif('truss.heightAtRidge', t.heightAtRidge, 'La hauteur de ferme au faîtage');

    // L'entrait repose sur la tête du poteau : la ferme se loge SOUS la hauteur
    // à l'égout, elle ne peut donc pas être plus haute que le bâtiment.
    if (!trameValide) {
      // La hauteur à l'égout est déjà signalée : rien à comparer.
    } else if (t.heightAtSupport >= g.eaveHeight) {
      err(
        'truss.heightAtSupport',
        `Hauteur de ferme à l'appui (${t.heightAtSupport} mm) supérieure ou égale à la hauteur à l'égout (${g.eaveHeight} mm) : il ne resterait pas de poteau.`,
      );
    } else if (t.heightAtSupport > g.eaveHeight / 2) {
      warn('truss.heightAtSupport', 'La ferme occupe plus de la moitié de la hauteur du bâtiment.');
    }

    if (t.straightTie && trameValide) {
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
      plafond('secondary.purlins.sagBars.rows', s.purlins.sagBars.rows, PLAFONDS.filesLiernes, `Au plus ${PLAFONDS.filesLiernes} files de liernes par travée.`);
    }
  }
  if (s.rails.enabled) {
    profil('secondary.rails.profile', s.rails.profile);
    if (trameValide && s.rails.sillHeight >= g.eaveHeight) {
      err('secondary.rails.sillHeight', 'Le soubassement atteint ou dépasse la hauteur à l’égout.');
    }
  }
  if (s.gablePosts.enabled) {
    profil('secondary.gablePosts.profile', s.gablePosts.profile);
    positif('secondary.gablePosts.courseTete', s.gablePosts.courseTete, 'La course des oblongs de tête de potelet');
  }

  /*
   * ⚠ GARDE SUR LE NOMBRE DE BARRES. Les plafonds de trame ne suffisent pas : un
   * entraxe de pannes de 1 mm sur 100 m de rampant en génère 100 000 par travée.
   * Le compte est estimé à partir des seuls paramètres, AVANT toute génération.
   */
  if (trameValide) {
    const { total, principal } = barresEstimees(p);
    if (!(total <= PLAFONDS.barres)) {
      err(principal, `Environ ${Number.isFinite(total) ? Math.round(total) : '∞'} barres à générer (au plus ${PLAFONDS.barres}) : augmenter l’entraxe ou réduire le nombre d’éléments.`);
    }
  }
  plafond('ouvertures.items', p.ouvertures.items.length, PLAFONDS.ouvertures, `Au plus ${PLAFONDS.ouvertures} ouvertures.`);
  plafond('freeMembers', p.freeMembers.length, PLAFONDS.barresLibres, `Au plus ${PLAFONDS.barresLibres} barres libres.`);

  /* --- Contreventements -------------------------------------------- */
  for (const [path, set] of [
    ['bracing.roof', p.bracing.roof],
    ['bracing.wall', p.bracing.wall],
    ['bracing.gable', p.bracing.gable],
  ] as const) {
    if (!set.enabled) continue;
    profil(`${path}.profile`, set.profile);
    for (const b of set.bays) {
      if (trameValide && (b < 0 || b >= g.nBays)) err(`${path}.bays`, `Travée ${b} inexistante (le bâtiment en compte ${g.nBays}).`);
    }
  }
  if (!p.bracing.roof.enabled && !p.bracing.wall.enabled) {
    warn('bracing', 'Aucun contreventement : la stabilité longitudinale du bâtiment n’est pas assurée.');
  }
  if (trameValide) dilatation(p, warn);

  /* --- Assemblages -------------------------------------------------- */
  const platine = (path: string, e: EndPlateParams) => {
    positif(`${path}.thickness`, e.thickness, "L'épaisseur de platine");
    if (e.rows < 2) err(`${path}.rows`, 'Une platine d’about comporte au moins 2 rangées de boulons.');
    plafond(`${path}.rows`, e.rows, PLAFONDS.rangees, `Au plus ${PLAFONDS.rangees} rangées de boulons par platine.`);
    plafond(`${path}.cols`, e.cols, PLAFONDS.filesBoulons, `Au plus ${PLAFONDS.filesBoulons} files de boulons par platine.`);
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

  /*
   * ⚠ Les rangées doivent TENIR sur la platine : entre les deux pinces, à 2,2 d0
   * l'une de l'autre au moins, et hors des semelles de la traverse. Six rangées
   * de M20 sur un IPE 240 se touchaient, et rien ne le disait.
   */
  const rafter = findProfile(p.frame.rafterProfile);
  // Une grille démesurée est déjà refusée plus haut : ne pas la construire.
  const grillesRaisonnables = [p.connections.rafterToColumn, p.connections.ridge].every(
    (e) => e.rows <= PLAFONDS.rangees && e.cols <= PLAFONDS.filesBoulons,
  );
  if (trameValide && grillesRaisonnables && p.frame.enabled && rafter && rafter.shape === 'I') {
    const cosA = Math.cos(leftSlopeRad(p.grid));
    for (const [path, e, haunch] of [
      ['connections.rafterToColumn', p.connections.rafterToColumn, p.frame.haunch],
      ['connections.ridge', p.connections.ridge, p.frame.ridgeHaunch],
    ] as const) {
      if (path === 'connections.ridge' && p.grid.roofType === 'monopente') continue;
      const hauteur = haunch.enabled ? Math.max(haunch.depth, rafter.h / cosA) : rafter.h / cosA;
      const grille = grilleDePlatine({ ...e, hauteurUtile: hauteur, semelles: semellesDerrierePlatine(rafter.h, rafter.tf, cosA, hauteur) });
      const bas = Math.min(...grille.map((q) => q.z));
      if (hauteur / 2 + bas < e.edgeDistance - 0.5) {
        err(
          `${path}.rows`,
          `${e.rows} rangées de M${e.bolt.d} ne tiennent pas sur la platine (${Math.round(hauteur)} mm utiles, entraxe mini ${Math.ceil(minPitch(e.bolt))} mm, semelles évitées) : réduire le nombre de rangées${haunch.enabled ? '' : ' ou ajouter un jarret'}.`,
        );
      }
    }
  }

  /*
   * ⚠ Portique de pignon distinct : ses POTEAUX doivent avoir la hauteur de
   * section des poteaux courants. Les lisses de long pan se plaquent sur la face
   * extérieure des poteaux, sur un seul plan : un poteau de pignon plus haut y
   * entre, un plus bas laisse les lisses d'angle en l'air. Sa traverse, elle,
   * peut différer — le portique est relevé pour en aligner le dessus.
   */
  if (p.frame.enabled && p.frame.distinctGableFrame) {
    const courant = findProfile(p.frame.columnProfile);
    const pignon = findProfile(p.frame.gableColumnProfile);
    if (courant && pignon && Math.abs(courant.h - pignon.h) > 0.5) {
      err(
        'frame.gableColumnProfile',
        `Poteau de pignon ${pignon.id} (h = ${pignon.h} mm) de hauteur différente du poteau courant ${courant.id} (h = ${courant.h} mm) : les lisses de long pan ne seraient plus dans un même plan. Choisir un profil de même hauteur.`,
      );
    }
  }

  const cb = p.connections.columnBase;
  positif('connections.columnBase.thickness', cb.thickness, "L'épaisseur de platine de pied");
  if (p.frame.enabled && cb.anchorCount <= PLAFONDS.ancrages) {
    const col = findProfile(p.frame.columnProfile);
    if (col && cb.length < col.h) {
      err('connections.columnBase.length', `Platine de pied (${cb.length} mm) plus courte que la hauteur du poteau ${col.id} (${col.h} mm).`);
    }
    if (col && cb.width < col.b) {
      err('connections.columnBase.width', `Platine de pied (${cb.width} mm) plus étroite que la semelle du poteau ${col.id} (${col.b} mm).`);
    }
    /*
     * Chaque écrou d'ancrage doit tomber HORS du poteau : une tige implantée sous
     * la semelle traverse le profil — on ne la serre pas, on ne la monte même pas.
     */
    const cle = 0.87 * tigeDAncrage(cb).bolt.d;
    const dessous = col
      ? positionsDesAncrages(cb).some((a) => Math.abs(a.z) < col.h / 2 + cle && Math.abs(a.y) < col.b / 2 + cle)
      : false;
    if (col && dessous) {
      err(
        'connections.columnBase.length',
        `Tiges d'ancrage sous le poteau ${col.id} : allongez la platine de pied (${cb.length} mm) — il faut au moins ${Math.ceil(col.h / 2 + cle)} mm de l'axe à chaque tige.`,
      );
    }
  }
  plafond('connections.columnBase.anchorCount', cb.anchorCount, PLAFONDS.ancrages, `Au plus ${PLAFONDS.ancrages} tiges d’ancrage par pied.`);
  if (p.frame.baseFixity === 'encastre' && cb.anchorCount < 4) {
    err('connections.columnBase.anchorCount', 'Un pied encastré demande au moins 4 tiges d’ancrage.');
  }

  /*
   * ⚠ Chevêtres d'ouverture : même hauteur de profil que les lisses. Ils sont
   * dans le même plan : le bardage se fixe sur leurs semelles extérieures, et les
   * plats d'attache se plaquent sur leurs semelles intérieures — à fleur des deux.
   */
  if (p.ouvertures.enabled && p.ouvertures.items.length > 0 && p.secondary.rails.enabled) {
    const chevetre = findProfile(p.ouvertures.profile);
    const lisse = findProfile(p.secondary.rails.profile);
    if (chevetre && lisse && Math.abs(chevetre.h - lisse.h) > 0.5) {
      err(
        'ouvertures.profile',
        `Chevêtres en ${chevetre.id} (h = ${chevetre.h} mm) et lisses en ${lisse.id} (h = ${lisse.h} mm) : ils doivent avoir la même hauteur pour que le bardage reste plan et que les attaches se plaquent.`,
      );
    }
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

/** Dilatation d'une ossature acier : α ≈ 12·10⁻⁶ /K (EN 1993-1-1 §3.2.6). */
const ALPHA_ACIER = 12e-6;
/** Écart de température retenu pour donner un ORDRE DE GRANDEUR du mouvement (K). */
const ECART_INDICATIF = 30;
/** Longueur au-delà de laquelle la SCI (P070) recommande un joint de dilatation. */
const LONGUEUR_SANS_JOINT = 100_000;
/** Distance entre palées d'extrémité à partir de laquelle SteelPlan le signale (repère indicatif). */
const PALEES_ELOIGNEES = 60_000;

/**
 * ⚠ BÂTIMENT LONG. Un hangar de 120 m sortait avec ses deux seules palées
 * d'extrémité, sans un mot : rien ne disait ni qu'un joint de dilatation est
 * d'usage à cette longueur, ni que deux palées aux pignons BRIDENT la file entre
 * elles. Une palée centrale laisse au contraire le bâtiment se dilater vers les
 * deux pignons. SteelPlan ne modélise ni joint ni action thermique : il le dit.
 */
function dilatation(p: ProjectParams, warn: (path: string, message: string) => void): void {
  const g = p.grid;
  const L = buildingLength(g);
  const m = (v: number): string => (v / 1000).toFixed(0);
  if (L > LONGUEUR_SANS_JOINT) {
    warn(
      'grid.nBays',
      `Bâtiment de ${m(L)} m d’un seul tenant : au-delà d’environ 100 m, l’usage est de le recouper par un joint de dilatation (SCI P070), ou de justifier les actions thermiques (EN 1991-1-5). SteelPlan ne modélise ni joint ni effet thermique.`,
    );
  }
  const palees = bracedBays(p.bracing.wall, g.nBays);
  if (palees.length < 2) return;
  const x = (b: number): number => (b + 0.5) * g.baySpacing;
  const premiere = Math.min(...palees);
  const derniere = Math.max(...palees);
  const ecart = x(derniere) - x(premiere);
  const auCentre = palees.some((b) => x(b) > L / 3 && x(b) < (2 * L) / 3);
  if (ecart > PALEES_ELOIGNEES && !auCentre) {
    const bride = ALPHA_ACIER * ecart * ECART_INDICATIF;
    const centrale = Math.floor(g.nBays / 2) + 1;
    warn(
      'bracing.wall.bays',
      `Palées de stabilité distantes de ${m(ecart)} m, aucune en partie centrale : la dilatation de la file est bridée entre elles (≈ ${bride.toFixed(0)} mm pour ${ECART_INDICATIF} K d’écart). Une palée en travée centrale (travée ${centrale}) laisse le bâtiment se dilater vers les pignons ; sinon, justifier les efforts thermiques dans les sablières et les palées.`,
    );
  }
}

