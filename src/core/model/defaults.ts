import { FINITION_PAR_DEFAUT } from './finition';
import { GRILLE_PAR_DEFAUT } from './prix';
import { ATELIER_PAR_DEFAUT } from './atelier';
import { OUVERTURES_PAR_DEFAUT } from './ouvertures';
import { SITE_PAR_DEFAUT } from './site';
import type { ProjectParams } from './project';

/**
 * Projet par défaut : un hangar courant de 20 m de portée, 5 travées de 6 m,
 * égout à 6 m, bipente 10 %. Sert de point de départ et de gabarit de test.
 */
export const DEFAULT_PROJECT: ProjectParams = {
  version: 3,
  meta: {
    nom: 'Nouveau projet',
    client: '',
    chantier: '',
    dessinateur: '',
    indice: 'A',
    date: new Date().toISOString().slice(0, 10),
    commentaire: '',
    revisions: [],
  },
  grid: {
    nBays: 5,
    baySpacing: 6000,
    span: 20000,
    eaveHeight: 6000,
    roofType: 'bipente',
    slopeUnit: 'pourcent',
    slope: 10,
    slopeRight: 10,
    asymmetric: false,
  },
  frame: {
    enabled: true,
    columnProfile: 'IPE 400',
    rafterProfile: 'IPE 360',
    grade: 'S235',
    baseFixity: 'articule',
    haunch: { enabled: true, length: 1500, depth: 700 },
    ridgeHaunch: { enabled: false, length: 800, depth: 500 },
    distinctGableFrame: false,
    gableColumnProfile: 'IPE 300',
    gableRafterProfile: 'IPE 270',
  },
  /*
   * Ferme de 20 m dimensionnée pour la portée par défaut : basculer « toiture
   * portée par » sur treillis doit donner un modèle crédible, pas un modèle
   * rouge. Deux points en décident, et ce sont les mêmes que sur les gabarits :
   *  - `warrenWithPosts` : sans montants, une Warren n'a de nœuds en membrure
   *    supérieure qu'un panneau sur deux, qui fléchit alors sur 5 m ;
   *  - la maille, fixée par `nPanels`, dont dépend le carré de cette flexion.
   *
   * Il reste que sur pieds ARTICULÉS une ferme ne tient pas le déplacement en
   * tête : le rapport le signale nommément sur le poteau concerné.
   */
  truss: {
    enabled: false,
    type: 'warren',
    nPanels: 10,
    heightAtSupport: 1400,
    heightAtRidge: 2600,
    straightTie: true,
    warrenWithPosts: true,
    topChordProfile: 'L 120x120x12',
    bottomChordProfile: 'L 100x100x10',
    postProfile: 'L 70x70x7',
    diagonalProfile: 'L 100x100x10',
    grade: 'S235',
    doubleAngles: true,
  },
  secondary: {
    purlins: {
      enabled: true,
      profile: 'IPE 160',
      grade: 'S235',
      mode: 'entraxe',
      spacing: 1800,
      count: 6,
      eaveOverhang: 300,
      eavePurlin: true,
      ridgePurlin: true,
      sagBars: { enabled: true, rows: 1, diameter: 16 },
    },
    rails: {
      enabled: true,
      profile: 'UPE 160',
      grade: 'S235',
      mode: 'entraxe',
      spacing: 1500,
      count: 4,
      sillHeight: 1000,
      onGables: true,
    },
    gablePosts: {
      enabled: true,
      profile: 'IPE 240',
      grade: 'S235',
      mode: 'nombre',
      spacing: 5000,
      count: 3,
      // La traverse de pignon d'un portique de 20 m fléchit de 45 mm au faîtage
      // sous G + Q : ±25 mm ne suffisaient pas.
      courseTete: 50,
    },
  },
  ouvertures: OUVERTURES_PAR_DEFAUT,
  bracing: {
    roof: { enabled: true, shape: 'croix', profile: 'CHS 60.3x4', bays: [] },
    wall: { enabled: true, shape: 'croix', profile: 'CHS 60.3x4', bays: [] },
    gable: { enabled: true, shape: 'croix', profile: 'CHS 48.3x3.2', bays: [] },
    grade: 'S235',
  },
  connections: {
    rafterToColumn: {
      thickness: 20,
      bolt: { d: 20, cls: '10.9' },
      rows: 6,
      cols: 2,
      edgeDistance: 45,
      gauge: 100,
      overhang: 40,
    },
    ridge: {
      thickness: 20,
      bolt: { d: 20, cls: '10.9' },
      rows: 4,
      cols: 2,
      edgeDistance: 45,
      gauge: 100,
      overhang: 40,
    },
    columnBase: {
      thickness: 25,
      width: 350,
      length: 550,
      anchorDiameter: 24,
      anchorCount: 4,
      anchorEmbedment: 500,
      groutThickness: 30,
      shearKey: false,
      concrete: 'C25/30',
    },
    gusset: {
      thickness: 10,
      bolt: { d: 16, cls: '8.8' },
      edgeMargin: 35,
    },
    splice: {
      enabled: false,
      thickness: 15,
      bolt: { d: 20, cls: '10.9' },
      rows: 4,
    },
    secondaryBolt: { d: 12, cls: '8.8' },
    // L 100 et non L 80 : deux boulons M12 côte à côte sous l'âme de la panne
    // demandent 39 mm d'entraxe et 2 × 1,2 d0 de pince, soit 70 mm de partie
    // plate — l'aile de 80 n'en offre que 62.
    purlinCleat: { enabled: true, profile: 'L 100x100x10', length: 120 },
  },
  finition: FINITION_PAR_DEFAUT,
  prix: GRILLE_PAR_DEFAUT,
  atelier: ATELIER_PAR_DEFAUT,
  site: SITE_PAR_DEFAUT,
  loads: {
    loads: {
      permanent: 0.25,
      includeSelfWeight: true,
      exploitation: 0.4,
      neige: 0.45,
      neigeAccidentelle: 0,
      ventPression: 0.6,
      ventDepression: 0.9,
    },
    deflection: {
      rafter: 200,
      purlin: 200,
      rail: 200,
      columnDrift: 150,
    },
    factors: {
      gammaG: 1.35,
      gammaQ: 1.5,
      psi0Neige: 0.5,
      psi0Vent: 0.6,
      psi0Exploitation: 0,
    },
  },
  freeMembers: [],
  retouches: [],
};
