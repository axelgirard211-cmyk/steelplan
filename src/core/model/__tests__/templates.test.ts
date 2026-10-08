import { describe, expect, it } from 'vitest';
import { buildFrameModel, chargerModele, secondaryLoadKnM2 } from '../../analysis/frameModel';
import { solveFrame2d } from '../../analysis/frame2d';
import { intensities } from '../../analysis/loadCases';
import { buildBom } from '../../bom/index';
import { buildProject } from '../../build/buildProject';
import { runChecks } from '../../checks/index';
import { buildSheets } from '../../drawing/buildSheets';
import { rafterLength } from '../grid';
import { validateProject } from '../validate';
import { TEMPLATES, getTemplate } from '../templates';

describe('gabarits de départ', () => {
  it('ont tous un identifiant distinct et un libellé', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.nom.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.resume).toMatch(/m/);
      expect(getTemplate(t.id)).toBe(t);
    }
  });

  it('ne produisent aucune anomalie de saisie', () => {
    for (const t of TEMPLATES) {
      const erreurs = validateProject(t.build()).filter((i) => i.level === 'erreur');
      expect(erreurs, `${t.id} : ${erreurs.map((e) => e.message).join(' ; ')}`).toEqual([]);
    }
  });

  it('portent la date du jour, non celle du code', () => {
    const jour = new Date().toISOString().slice(0, 10);
    for (const t of TEMPLATES) expect(t.build().meta.date).toBe(jour);
  });

  it('SORTENT VÉRIFIÉS du calcul, tous leurs repères sous 1,00', () => {
    // ⚠ C'est la raison d'être de ce test. Un gabarit livré avec des profils
    // sous-dimensionnés apprendrait à l'utilisateur, dès sa première ouverture, que
    // les taux de travail affichés par le logiciel sont décoratifs. Les profils de
    // chaque gabarit ont été calés sur ce calcul, et doivent le rester.
    for (const t of TEMPLATES) {
      const p = t.build();
      const rapport = runChecks(p, buildProject(p));
      const dépassements = rapport.lines
        .filter((l) => l.ratio > 1)
        .map((l) => `${l.mark} (${l.profileId}) = ${l.ratio.toFixed(2)} / ${l.gouverne}`);
      expect(dépassements, `${t.id} — ${t.nom}`).toEqual([]);
      // Et pas grossièrement surdimensionnés non plus : un gabarit doit montrer
      // un dimensionnement crédible, pas une marge de dix.
      expect(rapport.maxRatio, `${t.id} : taux maximal ${rapport.maxRatio.toFixed(2)}`)
        .toBeGreaterThan(0.35);
    }
  });

  it('rendent compte de chaque repère : vérifié, ou exclu avec sa raison', () => {
    // ⚠ Ce contrôle ne portait que sur le projet par défaut, et laissait donc
    // passer l'essentiel : sur une ferme treillis, TOUTES les barres du portique
    // avaient disparu du rapport sans que rien ne le signale.
    for (const t of TEMPLATES) {
      const p = t.build();
      const model = buildProject(p);
      const rapport = runChecks(p, model);
      const couverts = new Set([
        ...rapport.byMark.keys(),
        ...rapport.nonVerifiables.map((x) => x.mark),
      ]);
      const orphelins = [...new Set(model.members.map((m) => m.mark))].filter(
        (r) => !couverts.has(r),
      );
      expect(orphelins, `${t.id}`).toEqual([]);
    }
  });

  it('produisent un dossier de plans complet', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const model = buildProject(p);
      const bom = buildBom(p, model);
      const sheets = buildSheets(model, p, bom, runChecks(p, model));
      expect(sheets.length, t.id).toBeGreaterThan(10);
      for (const s of sheets) {
        expect(JSON.stringify(s.scene.entities), `${t.id} / ${s.titre}`).not.toMatch(
          /null|NaN|Infinity/,
        );
      }
    }
  });

  it('se régénèrent en moins d’une seconde', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const t0 = performance.now();
      buildProject(p);
      expect(performance.now() - t0, t.id).toBeLessThan(1000);
    }
  });
});

describe('charge appliquée au portique', () => {
  it('vaut exactement la charge de surface, calculée de zéro', () => {
    // ⚠ L'invariant d'équilibre interne ne suffit PAS : il compare les réactions
    // aux charges telles que le modèle les a posées, et reste donc satisfait si
    // celles-ci sont doublées. Il faut confronter le total à la charge recalculée
    // depuis la géométrie du bâtiment. C'est ce contrôle qui a révélé qu'une ferme
    // en cornières jumelées recevait DEUX FOIS la charge de toiture, les deux
    // cornières d'une paire se voyant chacune attribuer la bande entière.
    for (const t of TEMPLATES) {
      const base = t.build();
      const model = buildProject(base);
      const fm = buildFrameModel(base, model);
      const q = intensities(base.loads, secondaryLoadKnM2(base, model));

      // Une seule action, et sans poids propre : on isole la charge de surface.
      const p = {
        ...base,
        loads: { ...base.loads, loads: { ...base.loads.loads, includeSelfWeight: false } },
      };
      const res = solveFrame2d(
        chargerModele(fm, p, q, {
          id: 'T',
          label: 'contrôle',
          kind: 'ELS',
          windDirection: 1,
          factors: { G: 1 },
        }),
      );

      const reaction = [...res.reactions.values()].reduce((s, [, fz]) => s + fz, 0) / 1000;
      // Charge permanente : par m² de rampant, sur la longueur développée des
      // deux versants et la travée reprise. Le débord de rive s'y ajoute, d'où la
      // tolérance vers le haut.
      const developpe =
        (rafterLength(base.grid, 'gauche') + rafterLength(base.grid, 'droite')) / 1000;
      const attendu = q.gToit * developpe * (base.grid.baySpacing / 1000);

      expect(reaction / attendu, `${t.id} : ${reaction.toFixed(1)} kN pour ${attendu.toFixed(1)} kN`)
        .toBeGreaterThan(0.99);
      expect(reaction / attendu, `${t.id} : ${reaction.toFixed(1)} kN pour ${attendu.toFixed(1)} kN`)
        .toBeLessThan(1.12);
    }
  });
});
