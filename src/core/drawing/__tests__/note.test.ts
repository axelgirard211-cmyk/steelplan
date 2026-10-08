import { describe, expect, it } from 'vitest';
import { buildBom } from '../../bom/index';
import { buildProject } from '../../build/buildProject';
import { runChecks } from '../../checks/index';
import { AVERTISSEMENT } from '../../checks/types';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { buildSheets } from '../buildSheets';
import { LARGEUR_CARACTERE, sheetsNote } from '../sheets/note';
import { lignesParPage } from '../sheets/nomenclature';
import { fenetreDe } from '../layout';
import type { Sheet } from '../sheet';
import { sheetToDxf } from '../../../export/dxf';
import { sheetsToPdf } from '../../../export/pdf';

const P = DEFAULT_PROJECT;
const model = buildProject(P);
const bom = buildBom(P, model);
const rapport = runChecks(P, model);

const textes = (s: Sheet): string[] =>
  s.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));

describe('note de pré-dimensionnement', () => {
  const planches = sheetsNote(rapport, { page: 1, total: 99, meta: P.meta });

  it('pagine les taux de travail, puis assemblages et hypothèses', () => {
    const taux = Math.max(1, Math.ceil(rapport.lines.length / lignesParPage()));
    expect(planches).toHaveLength(taux + (rapport.assemblages.length > 0 ? 1 : 0) + 1);
  });

  it('porte l’avertissement sur CHAQUE planche, pas seulement la première', () => {
    // ⚠ Les feuilles se séparent et se transmettent à l'unité : un avertissement
    // qui ne figure que sur la première ne protège que la première.
    for (const s of planches) {
      expect(textes(s).some((t) => t.includes('Pré-dimensionnement indicatif'))).toBe(true);
    }
  });

  it('inscrit un repère et son taux pour chaque ligne vérifiée', () => {
    const tous = planches.flatMap(textes);
    for (const l of rapport.lines) expect(tous).toContain(l.mark);
  });

  it('imprime les hypothèses et les combinaisons', () => {
    const derniere = planches[planches.length - 1];
    expect(derniere?.titre).toContain('hypothèses');
    const t = textes(derniere!).join(' ');
    expect(t).toContain('Hypothèses de calcul');
    expect(t).toContain('Combinaisons examinées');
    // Le contenu, et non seulement les titres.
    expect(t).toMatch(/1,35 G/);
    expect(t).toContain('bracon');
  });

  it('numérote ses planches en continu', () => {
    const numeros = planches.map((_, i) => i + 1);
    expect(numeros).toEqual(planches.map((_, i) => i + 1));
    // Le cartouche porte bien un numéro croissant sans trou.
    const pages = planches.flatMap(textes).filter((t) => /^\d+\/99$/.test(t));
    expect(pages).toEqual(planches.map((_, i) => `${i + 1}/99`));
  });

  it('ne laisse aucun texte sortir du cadre de dessin', () => {
    // ⚠ Un texte qui dépasse le cadre est perdu à l'impression. Sur cette planche
    // ce sont les hypothèses de calcul : une note tronquée n'est pas seulement
    // laide, elle devient trompeuse. La largeur est estimée avec le même facteur
    // que celui qui sert à la découpe, mesuré sur le rendu réel.
    const fenetre = fenetreDe('A3');
    const droite = fenetre.max.x;
    for (const s of planches) {
      for (const e of s.scene.entities) {
        if (e.kind !== 'texte' || e.ancrage === 'droite') continue;
        const largeur = e.texte.length * e.hauteur * LARGEUR_CARACTERE;
        expect(e.at.x + largeur).toBeLessThanOrEqual(droite + 0.5);
      }
    }
  });

  it('ne produit aucune coordonnée non finie', () => {
    for (const s of planches) {
      const json = JSON.stringify(s.scene.entities);
      expect(json).not.toMatch(/null|NaN|Infinity/);
    }
  });
});

describe('dossier complet avec la note', () => {
  const sansNote = buildSheets(model, P, bom);
  const avecNote = buildSheets(model, P, bom, rapport);

  it('ajoute les planches de note ET la planche de fondations', () => {
    /*
     * ⚠ Fournir le rapport de vérification ajoute DEUX choses au dossier, pas
     * une : la note de pré-dimensionnement, et le plan d'implantation des
     * ancrages — celui-ci vit du même calcul, puisque les réactions d'appui en
     * sortent. Compter la seule note laisserait passer une planche non paginée.
     */
    expect(avecNote.filter((s) => s.kind === 'fondations')).toHaveLength(1);
    expect(sansNote.filter((s) => s.kind === 'fondations')).toHaveLength(0);
    expect(avecNote.length).toBe(sansNote.length + sheetsNote(rapport, { page: 1, total: 99, meta: P.meta }).length + 1);
  });

  it('implante les tiges là où les platines sont percées, potelets compris', () => {
    // ⚠ Chaque tige dessinée est un trou de platine de pied du modèle : 12 pieds
    // de poteaux × 4 et 6 pieds de potelets × 2. Le plan les redessinait avec sa
    // propre règle, et n'avait pas de potelets.
    const f = avecNote.find((s) => s.kind === 'fondations') as Sheet;
    const tiges = model.plates.filter((pl) => pl.kind === 'platine-pied').flatMap((pl) => pl.holes);
    expect(tiges).toHaveLength(60);
    expect(f.scene.entities.filter((e) => e.kind === 'cercle')).toHaveLength(tiges.length);
    const potelets = [...new Set(model.members.filter((m) => m.role === 'potelet').map((m) => m.assemblage))];
    for (const r of potelets) expect(textes(f)).toContain(r);
  });

  it('place l’implantation des ancrages AVANT les plans de débit', () => {
    // Les semelles se coulent des semaines avant que l'acier n'arrive.
    const kinds = avecNote.map((s) => s.kind);
    expect(kinds.indexOf('fondations')).toBeLessThan(kinds.indexOf('debit'));
  });

  it('pagine tout le dossier sans trou ni doublon', () => {
    // ⚠ Le « n / N » du cartouche doit être juste dès la PREMIÈRE feuille : on ne
    // peut donc pas compter les planches en les construisant. Le comptage
    // anticipé et la construction doivent tomber d'accord — et rien ne le
    // garantit à part cette vérification.
    const pages = avecNote
      .flatMap(textes)
      .map((t) => /^(\d+)\/(\d+)$/.exec(t))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [Number(m[1]), Number(m[2])] as const);

    expect(pages).toHaveLength(avecNote.length);
    const totaux = new Set(pages.map(([, t]) => t));
    expect(totaux.size).toBe(1); // un seul total annoncé
    expect([...totaux][0]).toBe(avecNote.length);

    const numeros = pages.map(([n]) => n).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: avecNote.length }, (_, i) => i + 1));
  });

  it('place la note en fin de dossier, après les nomenclatures', () => {
    const iNote = avecNote.findIndex((s) => s.id.startsWith('note-'));
    const iNom = avecNote.findIndex((s) => s.id.startsWith('nomenclature-'));
    expect(iNote).toBeGreaterThan(iNom);
    expect(avecNote[avecNote.length - 1]?.id).toBe('note-hypotheses');
  });
});

describe('export du dossier avec la note', () => {
  const sheets = buildSheets(model, P, bom, rapport);

  it('sort en PDF vectoriel, planches de note comprises', () => {
    const pdf = sheetsToPdf(sheets);
    expect(pdf.size).toBeGreaterThan(20_000);
  });

  it('sort chaque planche de note en DXF', () => {
    for (const s of sheets.filter((x) => x.id.startsWith('note-'))) {
      const dxf = sheetToDxf(s);
      expect(dxf, s.titre).toContain('SECTION');
      expect(dxf.length, s.titre).toBeGreaterThan(2000);
    }
  });
});

describe('avertissement permanent', () => {
  it('figure au cartouche de TOUTES les planches du dossier', () => {
    // Pas seulement des planches de calcul : un plan de débit sorti seul de la
    // liasse doit dire lui aussi ce que vaut le dimensionnement qui l'a produit.
    for (const s of buildSheets(model, P, bom, rapport)) {
      expect(textes(s)).toContain(AVERTISSEMENT);
    }
  });

  it('provient d’une seule source, mot pour mot', () => {
    // ⚠ Ce texte a existé en double : une chaîne littérale dans le cartouche et
    // la constante partagée. Deux formulations qui divergent laisseraient croire
    // à deux portées différentes du logiciel. Le cartouche doit donc porter la
    // constante EXACTEMENT, pas une variante.
    const auCartouche = buildSheets(model, P)
      .flatMap(textes)
      .filter((t) => t.includes('Pré-dimensionnement'));
    expect(new Set(auCartouche)).toEqual(new Set([AVERTISSEMENT]));
    expect(AVERTISSEMENT).toContain('ne remplace pas la note de calcul');
  });
});
