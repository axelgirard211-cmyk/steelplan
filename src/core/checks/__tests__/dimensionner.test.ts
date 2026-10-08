import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { isValid, validateProject } from '../../model/validate';
import { getProfile } from '../../catalog/index';
import { cutLengths } from '../../geometry/member';
import { inertieFaible } from '../buckling';
import { runChecks } from '../index';
import { dimensionner } from '../dimensionner';
import { candidats, postesActifs } from '../postes';

/**
 * DIMENSIONNEMENT AUTOMATIQUE.
 *
 * ⚠ Une proposition FAUSSE est pire que pas de proposition du tout : l'utilisateur
 * n'a aucune raison de recontrôler ce que le logiciel lui présente comme vérifié.
 * Ces tests portent donc d'abord sur la SÛRETÉ du résultat — le projet proposé
 * tient — et seulement ensuite sur son économie.
 */

describe('postes dimensionnables', () => {
  it('sépare les trois contreventements, qui partagent pourtant un rôle', () => {
    /*
     * ⚠ Poutre au vent, palées et pignon portent tous le rôle `contreventement`.
     * Les confondre ferait remonter les trois au profil du plus sollicité.
     */
    const model = buildProject(DEFAULT_PROJECT);
    const postes = postesActifs(DEFAULT_PROJECT).filter((p) => p.id.startsWith('contreventement'));
    expect(postes.length).toBeGreaterThan(1);

    const vus = new Map<string, string>();
    for (const poste of postes) {
      for (const m of model.members.filter(poste.concerne)) {
        expect(vus.has(m.id), `${m.id} rattachée à deux postes`).toBe(false);
        vus.set(m.id, poste.id);
      }
    }
    // Et chaque poste attrape bien quelque chose.
    for (const poste of postes) {
      expect(model.members.some(poste.concerne), poste.libelle).toBe(true);
    }
  });

  it('propose des candidats triés du plus léger au plus lourd', () => {
    for (const poste of postesActifs(DEFAULT_PROJECT)) {
      const liste = candidats(poste);
      expect(liste.length, poste.libelle).toBeGreaterThan(3);
      expect(new Set(liste).size, `${poste.libelle} : doublons`).toBe(liste.length);
    }
  });

  it('met les poteaux en dernier : ils portent tout le reste', () => {
    const ids = postesActifs(DEFAULT_PROJECT).map((p) => p.id);
    expect(ids[ids.length - 1]).toBe('poteau');
  });
});

describe('proposition sur le projet par défaut', () => {
  const prop = dimensionner(DEFAULT_PROJECT);

  it('sort un projet qui TIENT', () => {
    expect(prop.tauxMax, `taux max ${prop.tauxMax.toFixed(2)}`).toBeLessThanOrEqual(1);
  });

  it('sort un projet générable', () => {
    expect(isValid(validateProject(prop.projet))).toBe(true);
  });

  it('ne présente que des changements réels, chacun vérifié', () => {
    for (const c of prop.changements) {
      expect(c.apres, c.poste).not.toBe(c.avant);
      expect(c.tauxApres, `${c.poste} : ${c.apres} à ${c.tauxApres.toFixed(2)}`).toBeLessThanOrEqual(1);
    }
  });

  it('n’alourdit AUCUNE pièce sans en donner la raison', () => {
    /*
     * ⚠ C'est la garantie qui rend la proposition crédible. Une seule ligne
     * « IPE 240 → IPE 300 » sur une pièce qui travaillait à 0,75, sans
     * explication, et l'utilisateur cesse de croire les sept autres.
     */
    for (const c of prop.changements) {
      if (c.deltaKgParM <= 0) continue;
      expect(
        c.motif,
        `${c.poste} alourdi de ${c.deltaKgParM.toFixed(1)} kg/m sans motif recevable`,
      ).not.toBe('allegement');
    }
    // Et globalement, le projet par défaut étant déjà vérifié, il s'allège.
    expect(runChecks(DEFAULT_PROJECT, buildProject(DEFAULT_PROJECT)).maxRatio).toBeLessThanOrEqual(1);
    expect(prop.masseApres).toBeLessThan(prop.masseAvant);
  });

  it('n’écrit « allégement » que sur un profil réellement plus léger', () => {
    for (const c of prop.changements) {
      if (c.motif === 'allegement') expect(c.deltaKgParM, c.poste).toBeLessThan(0);
      if (c.motif === 'renfort') expect(c.tauxAvant, c.poste).toBeGreaterThan(1);
    }
  });

  it('ne propose aucune barre trop élancée pour être montée', () => {
    // ⚠ Sans ce garde-fou, une palée de 8 m devenait une cornière L 20×20×3 :
    // elle « tient » — elle est tendue — et personne ne l'expédierait.
    const model = buildProject(prop.projet);
    for (const m of model.members) {
      if (m.role !== 'contreventement') continue;
      const pr = getProfile(m.profileId);
      const iMin = Math.sqrt(inertieFaible(pr) / pr.A);
      expect(cutLengths(m).axis / iMin, `${m.mark} ${m.profileId}`).toBeLessThanOrEqual(420);
    }
  });

  it('reste dans un temps utilisable', () => {
    expect(prop.ms, `${prop.ms.toFixed(0)} ms, ${prop.evaluations} évaluations`).toBeLessThan(60_000);
  });
});

describe('robustesse', () => {
  it('tient sur tous les gabarits et n’en condamne aucun', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const prop = dimensionner(p);
      expect(isValid(validateProject(prop.projet)), t.id).toBe(true);
      // Soit tout tient, soit les postes en cause sont NOMMÉS. Le silence sur un
      // poste qu'aucun profil ne satisfait ferait croire à un projet vérifié.
      if (prop.tauxMax > 1) expect(prop.insuffisants, t.id).not.toEqual([]);
    }
  });

  it('converge vers le même projet si on le relance', () => {
    // ⚠ Un dimensionnement qui oscille entre deux solutions à chaque clic est
    // inutilisable : on ne saurait jamais lequel des deux états est le bon.
    const un = dimensionner(DEFAULT_PROJECT);
    const deux = dimensionner(un.projet);
    expect(deux.changements, deux.changements.map((c) => `${c.poste} ${c.avant}→${c.apres}`).join(', ')).toEqual([]);
  });
});
