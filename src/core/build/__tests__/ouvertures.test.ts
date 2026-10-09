import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { sectionOutline } from '../../geometry/section';
import { railLevels } from '../secondaire/facades';
import {
  ouverturesRefusees,
  ouverturesValides,
  soustraire,
} from '../secondaire/ouvertures';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { Ouverture } from '../../model/ouvertures';
import type { ProjectParams } from '../../model/project';
import { buildProject } from '../buildProject';

const PORTAIL: Ouverture = {
  id: 'P1',
  face: 'long-pan-gauche',
  type: 'portail',
  // Entre les poteaux des files 2 et 3 (6 et 12 m), avec la place des attaches.
  position: 7000,
  largeur: 4000,
  hauteur: 4500,
  allege: 0,
};

const CHASSIS: Ouverture = {
  id: 'F1',
  face: 'pignon-ouest',
  type: 'chassis',
  position: 6000,
  largeur: 2000,
  hauteur: 1500,
  allege: 2000,
};

function avec(items: Ouverture[]): ProjectParams {
  return {
    ...DEFAULT_PROJECT,
    ouvertures: { enabled: true, profile: 'UPE 160', grade: 'S235', items },
  };
}

/* ================================================================== */
/* Découpe des lisses                                                  */
/* ================================================================== */

describe('soustraction d’intervalles', () => {
  it('coupe un segment en DEUX quand le trou est au milieu', () => {
    /*
     * ⚠ Les deux morceaux comptent. Ne garder que le plus long — ou renoncer au
     * segment entier dès qu'il y a recoupement — ferait disparaître du bardage
     * juste à côté du portail, là où il en faut le plus.
     */
    expect(soustraire(0, 6000, [[2000, 4000]])).toEqual([
      [0, 2000],
      [4000, 6000],
    ]);
  });

  it('laisse le segment intact quand le trou est ailleurs', () => {
    expect(soustraire(0, 6000, [[7000, 9000]])).toEqual([[0, 6000]]);
  });

  it('supprime le segment quand le trou le couvre entièrement', () => {
    expect(soustraire(2000, 4000, [[0, 6000]])).toEqual([]);
  });

  it('ne débite pas un résidu de quelques millimètres', () => {
    // Un bout de 50 mm n'est pas une lisse : ni commandable, ni posable.
    expect(soustraire(0, 6000, [[50, 6000]])).toEqual([]);
  });

  it('encaisse plusieurs trous sur le même segment', () => {
    expect(
      soustraire(0, 10_000, [
        [2000, 3000],
        [6000, 7000],
      ]),
    ).toEqual([
      [0, 2000],
      [3000, 6000],
      [7000, 10_000],
    ]);
  });
});

/* ================================================================== */
/* Le modèle construit                                                 */
/* ================================================================== */

describe('ouvertures dans le modèle', () => {
  const M = buildProject(avec([PORTAIL, CHASSIS]));

  it('AUCUNE lisse ne traverse une ouverture', () => {
    /*
     * ⚠ L'INVARIANT DE L'OUVERTURE. Une lisse qui traverserait le portail
     * passerait au travers de la porte : invisible sur une vue d'ensemble, elle
     * se découvre le jour où le menuisier vient poser le dormant. Le contrôle
     * porte sur la GÉOMÉTRIE des barres, pas sur le compte : une lisse peut
     * légitimement être coupée en deux et rester deux lisses.
     */
    const fautes: string[] = [];
    for (const o of ouverturesValides(avec([PORTAIL, CHASSIS]))) {
      const longPan = o.face.startsWith('long-pan');
      for (const l of M.members.filter((m) => m.role === 'lisse')) {
        const z = l.start.z;
        if (z < o.allege || z > o.allege + o.hauteur) continue;
        // Abscisse de la lisse le long de sa façade, et sa position hors façade.
        const s0 = Math.min(longPan ? l.start.x : l.start.y, longPan ? l.end.x : l.end.y);
        const s1 = Math.max(longPan ? l.start.x : l.start.y, longPan ? l.end.x : l.end.y);
        const horsPlan = longPan ? l.start.y : l.start.x;
        // Seule la façade concernée est en cause : l'autre long pan est ailleurs.
        const memeFacade =
          o.face === 'long-pan-gauche' || o.face === 'pignon-ouest'
            ? horsPlan < 0
            : horsPlan > 0;
        if (!memeFacade) continue;
        const chevauche = s0 < o.position + o.largeur - 1 && o.position + 1 < s1;
        if (chevauche) fautes.push(`${o.id} traversée par ${l.id} (${s0}…${s1} à z=${z})`);
      }
    }
    expect(fautes, fautes.join('\n')).toHaveLength(0);
  });

  it('borde chaque ouverture de deux montants et d’un linteau', () => {
    const chevetres = M.members.filter((m) => m.role === 'chevetre');
    for (const id of ['P1', 'F1']) {
      const siens = chevetres.filter((c) => c.id.startsWith(`${id}-`));
      expect(siens.filter((c) => c.position.startsWith('montant')), id).toHaveLength(2);
      expect(siens.filter((c) => c.position.startsWith('linteau')), id).toHaveLength(1);
    }
  });

  it('ne pose une traverse basse QUE sous une allège', () => {
    /*
     * Une porte descend au sol : il n'y a rien à porter sous elle. Lui donner
     * une traverse basse poserait une barre en travers du passage.
     */
    const bas = (id: string): number =>
      M.members.filter((m) => m.id.startsWith(`${id}-`) && m.position.startsWith('traverse basse'))
        .length;
    expect(bas('P1')).toBe(0); // portail, allège nulle
    expect(bas('F1')).toBe(1); // châssis, allège 2 m
  });

  it('fait monter les montants AU-DESSUS du linteau, jusqu’à un appui', () => {
    /*
     * ⚠ Un montant arrêté au linteau serait une console encastrée dans le sol :
     * il reprendrait le vent des lisses coupées sans appui en tête. Il monte
     * donc jusqu'à la première lisse continue au-dessus de l'ouverture.
     */
    const montant = M.members.find((m) => m.id === 'P1-MG');
    expect(montant).toBeDefined();
    const tete = PORTAIL.allege + PORTAIL.hauteur;
    expect(montant!.end.z).toBeGreaterThan(tete);
    const niveaux = railLevels(DEFAULT_PROJECT).filter((z) => z > tete);
    // Sous cette lisse d'appui, qu'il ne traverse pas : sa demi-largeur, plus 10 mm de jeu.
    const lisse = sectionOutline(getProfile(DEFAULT_PROJECT.secondary.rails.profile), 1).outer;
    const demi = Math.max(...lisse.map((q) => Math.abs(q.y)));
    expect(montant!.end.z).toBeCloseTo(Math.min(...niveaux) - demi - 10, 6);
  });

  it('pose le chevêtre dans le PLAN DES LISSES, pas sur l’axe du poteau', () => {
    // Sinon il serait en retrait d'une demi-hauteur de profil derrière les
    // lisses qu'il doit précisément recevoir.
    const lisse = M.members.find((m) => m.role === 'lisse' && m.start.y < 0);
    const montant = M.members.find((m) => m.id === 'P1-MG');
    expect(montant!.start.y).toBeCloseTo(lisse!.start.y, 6);
  });

  it('n’ajoute rien quand les ouvertures sont désactivées', () => {
    const sans = buildProject({
      ...avec([PORTAIL]),
      ouvertures: { ...avec([PORTAIL]).ouvertures, enabled: false },
    });
    expect(sans.members.filter((m) => m.role === 'chevetre')).toHaveLength(0);
    expect(sans.stats.massKg).toBeCloseTo(buildProject(DEFAULT_PROJECT).stats.massKg, 6);
  });
});

/* ================================================================== */
/* Ce que le logiciel refuse                                           */
/* ================================================================== */

describe('ouvertures refusées', () => {
  it('refuse et NOMME une ouverture qui déborde de la façade', () => {
    /*
     * ⚠ Refusée, jamais rabotée en silence. Ramener discrètement un portail de
     * 6 m dans une travée de 5 m donnerait un plan qui ne correspond ni à ce
     * qui a été demandé ni à ce qui sera construit.
     */
    const p = avec([{ ...PORTAIL, position: 28_000, largeur: 4000 }]);
    expect(ouverturesValides(p)).toHaveLength(0);
    const refus = ouverturesRefusees(p);
    expect(refus).toHaveLength(1);
    expect(refus[0]?.raison).toMatch(/déborde de la façade/);
  });

  it('refuse une ouverture dont la tête dépasse l’égout', () => {
    const p = avec([{ ...PORTAIL, hauteur: 8000 }]);
    expect(ouverturesRefusees(p)[0]?.raison).toMatch(/dépasse l’égout/);
  });

  it('refuse la seconde de deux ouvertures qui se chevauchent', () => {
    const p = avec([PORTAIL, { ...PORTAIL, id: 'P2', position: 8000, largeur: 2000 }]);
    expect(ouverturesValides(p).map((o) => o.id)).toEqual(['P1']);
    expect(ouverturesRefusees(p)[0]?.raison).toMatch(/chevauche l’ouverture P1/);
  });

  it('refuse deux ouvertures accolées : leurs montants seraient au même endroit', () => {
    const p = avec([
      { ...PORTAIL, largeur: 2000 },
      { ...PORTAIL, id: 'P2', position: 9000, largeur: 2000 },
    ]);
    expect(ouverturesValides(p).map((o) => o.id)).toEqual(['P1']);
    expect(ouverturesRefusees(p)[0]?.raison).toMatch(/trop proche de l’ouverture P1/);
  });

  it('accepte deux ouvertures d’une travée séparées par la place de leurs attaches', () => {
    const p = avec([
      { ...PORTAIL, largeur: 1500 },
      { ...PORTAIL, id: 'P2', position: 9300, largeur: 1500 },
    ]);
    expect(ouverturesValides(p)).toHaveLength(2);
  });

  it('refuse une ouverture devant un poteau', () => {
    const p = avec([{ ...PORTAIL, position: 10_000 }]);
    expect(ouverturesValides(p)).toHaveLength(0);
    expect(ouverturesRefusees(p)[0]?.raison).toMatch(/rencontre le poteau de la file 3/);
  });

  it('accepte deux ouvertures superposées sur des faces différentes', () => {
    const p = avec([PORTAIL, { ...PORTAIL, id: 'P2', face: 'long-pan-droit' }]);
    expect(ouverturesValides(p)).toHaveLength(2);
  });
});
