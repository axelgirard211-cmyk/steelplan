import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { memberMassKg, memberPaintM2 } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import type { Sheet } from '../sheet';
import { elementsAFabriquer, implantations } from '../sheets/element';
import { sheetFabrication, sheetsTolesAPlat } from '../sheets/fabrication';
import { planDeVues, titreDeCoupe } from '../sheets/coupes';
import { sheetsGammes } from '../sheets/gammes';
import { gammeDeFabrication } from '../sheets/gamme';

/**
 * PLANS DE FABRICATION D'ÉLÉMENT.
 *
 * ⚠ C'est le dossier d'atelier d'UNE pièce, du premier coup de scie au dernier
 * coup de pistolet. Quatre choses y sont vitales, et rien d'autre ne les porte
 * dans tout le dossier : la POSITION des tôles sur la barre, la position des
 * PERÇAGES dans chaque tôle, l'ORDRE des postes, et le TRAITEMENT de surface.
 * La nomenclature ne donne que le nombre de trous — on ne fabrique pas une
 * platine avec « 4 trous Ø22 ».
 */

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const ELEMENTS = elementsAFabriquer(M);
const META = P.meta;

const planche = (i = 0): Sheet =>
  sheetFabrication(ELEMENTS[i]!, { page: 1, total: 10, meta: META, finition: P.finition });

const textes = (s: Sheet): string[] =>
  s.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));

describe('sélection des éléments', () => {
  it('couvre TOUS les repères, y compris ceux sans rien de soudé', () => {
    /*
     * ⚠ La règle a changé, et c'est le cœur de cette planche. Ne l'éditer que
     * pour les pièces soudées produisait trois feuilles sur vingt et un repères :
     * l'atelier n'avait alors ni gamme ni fiche de peinture pour les pannes, les
     * lisses et les contreventements — c'est-à-dire pour l'essentiel du tonnage.
     */
    /*
     * Un élément par repère d'ASSEMBLAGE — et tous y sont, sauf les pièces
     * soudées sur une autre : une échantignolle part avec sa traverse, elle n'a
     * pas d'élément à elle.
     */
    const reperes = new Set(M.members.filter((m) => m.porteur === null).map((m) => m.assemblage));
    expect(new Set(ELEMENTS.map((e) => e.repere))).toEqual(reperes);
    expect(ELEMENTS.some((e) => e.membre.role === 'attache')).toBe(false);
  });

  it('en édite une pour la panne, qui ne porte pourtant aucune tôle', () => {
    const panne = M.members.find((m) => m.role === 'panne');
    expect(panne).toBeDefined();
    const e = ELEMENTS.find((x) => x.membre.mark === panne?.mark);
    expect(e, 'la panne n’a pas de plan de fabrication').toBeDefined();
    expect(e?.toles).toHaveLength(0);
  });

  it('rattache chaque tôle à la barre qui la porte, et à elle seule', () => {
    const vues = new Map<string, string>();
    for (const e of ELEMENTS) {
      for (const pl of e.toles) {
        expect(vues.has(pl.id), `${pl.id} rattachée deux fois`).toBe(false);
        vues.set(pl.id, e.membre.id);
        // Le rattachement est DÉCLARÉ par la tôle, plus deviné par son nom.
        expect(pl.porteur).toBe(e.membre.id);
      }
    }
  });

  it('compte la quantité de l’élément, pas celle d’une pièce', () => {
    for (const e of ELEMENTS) {
      const memeRepere = M.members.filter((m) => m.porteur === null && m.assemblage === e.repere).length;
      expect(e.quantite, e.repere).toBe(memeRepere);
    }
  });

  it('pèse l’élément COMPLET, tôles et jarrets compris', () => {
    /*
     * ⚠ La masse de l'élément doit dépasser STRICTEMENT celle de la barre nue dès
     * qu'il y a quelque chose de soudé dessus. Un jarret oublié dans la somme ne
     * se voit sur aucun dessin — il ne se voit qu'à la grue.
     */
    const soudes = ELEMENTS.filter((e) => e.toles.length + e.jarrets.length + e.pieces.length > 0);
    expect(soudes.length).toBeGreaterThan(0);
    for (const e of soudes) {
      expect(e.masseUnitaire, e.membre.mark).toBeGreaterThan(memberMassKg(e.membre));
      expect(e.surfaceUnitaire, e.membre.mark).toBeGreaterThan(memberPaintM2(e.membre));
    }
    // Et elle reste celle de la barre pour une pièce nue : pas de masse fantôme.
    for (const e of ELEMENTS.filter((x) => x.toles.length + x.jarrets.length + x.pieces.length === 0)) {
      expect(e.masseUnitaire, e.membre.mark).toBeCloseTo(memberMassKg(e.membre), 6);
    }
  });
});

describe('gamme de fabrication', () => {
  it('va du débit au traitement de surface, dans cet ordre', () => {
    for (const e of ELEMENTS) {
      const postes = gammeDeFabrication(e, P.finition).map((x) => x.poste);
      expect(postes[0], e.membre.mark).toBe('DÉBIT');
      expect(postes[postes.length - 1], e.membre.mark).toBe('TRAITEMENT DE SURFACE');
      // Numérotation continue : c'est elle que l'atelier pointe en fin de poste.
      const numeros = gammeDeFabrication(e, P.finition).map((x) => x.numero);
      expect(numeros).toEqual(numeros.map((_, i) => i + 1));
    }
  });

  it('perce AVANT d’assembler : une platine soudée bloque la perceuse', () => {
    const e = ELEMENTS.find((x) => x.toles.length > 0 && x.membre.holes.length > 0);
    expect(e).toBeDefined();
    const postes = gammeDeFabrication(e!, P.finition).map((x) => x.poste);
    expect(postes.indexOf('PERÇAGE')).toBeLessThan(postes.indexOf('ASSEMBLAGE ET POINTAGE'));
  });

  it('ne décrit que ce que la pièce porte réellement', () => {
    // ⚠ Une gamme générique se lit comme du remplissage et finit ignorée.
    for (const e of ELEMENTS) {
      const postes = gammeDeFabrication(e, P.finition).map((x) => x.poste);
      expect(postes.includes('SOUDURE'), e.membre.mark).toBe(e.soudures.length > 0);
      expect(postes.includes('GRUGEAGE'), e.membre.mark).toBe(e.membre.notches.length > 0);
      const trous = e.membre.holes.length + e.toles.reduce((n, pl) => n + pl.holes.length, 0);
      expect(postes.includes('PERÇAGE'), e.membre.mark).toBe(trous > 0);
    }
  });

  it('n’implante jamais une tôle à une cote négative', () => {
    /*
     * ⚠ Le plan moyen d'une platine d'about tombe une demi-épaisseur AU-DELÀ de
     * la coupe : mesurée depuis l'about, elle donnait « à −10 mm ». Personne ne
     * pose une tôle à −10 mm — et l'assembleur qui lit ça pose au jugé.
     */
    for (const t of [P, ...TEMPLATES.map((x) => x.build())]) {
      for (const e of elementsAFabriquer(buildProject(t))) {
        for (const x of implantations(e)) {
          if (x.about === null) {
            expect(x.depuisAbout, `${e.membre.mark} / ${x.pl.mark}`).toBeGreaterThan(0);
          }
        }
        const lignes = gammeDeFabrication(e, t.finition)
          .flatMap((g) => g.lignes)
          .join(' ');
        expect(lignes, e.membre.mark).not.toMatch(/[-−]\d+ mm de l’about/);
      }
    }
  });

  it('annonce les perçages des TÔLES, pas seulement ceux de la barre', () => {
    // ⚠ Une platine d'about porte huit trous que la barre n'a pas : sans eux au
    // poste de perçage, la tôle arrive vierge au poste d'assemblage.
    const e = ELEMENTS.find(
      (x) => x.membre.holes.length === 0 && x.toles.some((pl) => pl.holes.length > 0),
    );
    expect(e, 'aucun élément à barre vierge et tôle percée').toBeDefined();
    const percage = gammeDeFabrication(e!, P.finition).find((x) => x.poste === 'PERÇAGE');
    expect(percage, 'le poste de perçage a disparu').toBeDefined();
    const tole = e!.toles.find((pl) => pl.holes.length > 0)!;
    expect(percage?.lignes.join(' ')).toContain(tole.mark);
  });

  it('donne au peintre le système, la préparation et la surface', () => {
    const lignes = gammeDeFabrication(ELEMENTS[0]!, P.finition)
      .filter((x) => x.poste === 'TRAITEMENT DE SURFACE')
      .flatMap((x) => x.lignes)
      .join(' ');
    expect(lignes).toContain('ISO 12944');
    expect(lignes).toContain(P.finition.preparation);
    expect(lignes).toContain('m²/pièce');
    for (const c of P.finition.couches) expect(lignes).toContain(c.nom);
  });

  it('suit le traitement choisi : galvanisé, la gamme parle zinc et pas peinture', () => {
    const lignes = gammeDeFabrication(ELEMENTS[0]!, {
      ...P.finition,
      type: 'galvanisation',
    })
      .filter((x) => x.poste === 'TRAITEMENT DE SURFACE')
      .flatMap((x) => x.lignes)
      .join(' ');
    expect(lignes).toContain('ISO 1461');
    expect(lignes).toContain('µm exigibles');
    expect(lignes).not.toContain('Couche 1');
  });
});

describe('contenu d’une planche', () => {
  const s = planche(0);
  const e = ELEMENTS[0]!;

  it('porte le repère de l’élément et de chacune de ses tôles', () => {
    const t = textes(s);
    expect(t.some((x) => x.includes(e.membre.mark))).toBe(true);
    for (const pl of e.toles) {
      expect(t.some((x) => x.includes(pl.mark)), `tôle ${pl.mark} absente`).toBe(true);
    }
  });

  it('donne l’épaisseur de chaque tôle : on ne la déduit d’aucune vue', () => {
    const t = textes(s).join(' ');
    for (const pl of e.toles) expect(t).toContain(`ép. ${pl.thickness} mm`);
  });

  it('trace une vue à plat par repère de tôle, perçages compris', () => {
    // Autant de cercles que de perçages sur les tôles distinctes : c'est ce qui
    // rend la platine fabricable.
    const distinctes = new Map(e.toles.map((pl) => [pl.mark, pl]));
    const attendus = [...distinctes.values()].reduce((n, pl) => n + pl.holes.length, 0);
    const cercles = s.scene.entities.filter((x) => x.kind === 'cercle').length;
    expect(cercles).toBeGreaterThanOrEqual(attendus);
  });

  it('cote l’implantation des tôles sur la barre', () => {
    // Une cotation existe : sans elle, on sait quoi souder mais pas où.
    const cotations = s.scene.entities.filter((x) => x.layer === 'cotation').length;
    expect(cotations).toBeGreaterThan(0);
  });

  it('annonce l’échelle et la quantité dans son cartouche', () => {
    const t = textes(s).join(' ');
    expect(t).toContain(e.repere);
    expect(s.echelle).toBeGreaterThan(0);
    // Planche d'ASSEMBLAGE, au repère qu'on peint sur la pièce finie.
    expect(s.titre).toBe(`Assemblage ${e.repere}`);
  });

  it('porte la vue de face, ses vues de bout et coupes, sa nomenclature et ses notes', () => {
    for (const [i, el] of ELEMENTS.entries()) {
      const t = textes(planche(i));
      const repere = el.membre.mark;
      expect(t, repere).toContain('NOMENCLATURE DE L’ÉLÉMENT');
      expect(t, repere).toContain('NOTES');
      expect(t.some((x) => x.startsWith('VUE DE FACE')), repere).toBe(true);
      const plan = planDeVues(el);
      if (plan.gauche || plan.droite || plan.coupes.length > 0) {
        expect(t.some((x) => x.startsWith('VUES DE BOUT ET COUPES')), repere).toBe(true);
      }
      if (plan.dessus) expect(t.some((x) => x.startsWith('VUE DE DESSUS')), repere).toBe(true);
    }
  });

  it('ne fait qu’une coupe par type de pièce, et seulement pour ce qu’aucune vue ne montre', () => {
    /*
     * ⚠ Une coupe par pièce soudée faisait sept coupes sur une traverse. Les
     * platines d'about ont leur VUE DE BOUT, désignée par une flèche ; ce qui
     * déborde du profil se cote en VUE DE DESSUS ; il ne reste en coupe qu'un
     * type de pièce caché, une fois, et la coupe vaut pour ses semblables.
     */
    for (const [i, el] of ELEMENTS.entries()) {
      const t = textes(planche(i));
      const plan = planDeVues(el);
      const types = plan.coupes.map((c) => (c.objet.kind === 'tole' ? `${c.objet.pl.kind}:${c.mode}` : c.objet.m.role));
      expect(new Set(types).size, el.repere).toBe(types.length);
      for (const c of plan.coupes) {
        expect(t.some((x) => x.startsWith(titreDeCoupe(c))), `${el.repere} ${c.lettre}`).toBe(true);
        // Deux amorces, au-dessus et au-dessous, à l'occurrence dessinée.
        expect(t.filter((x) => x === c.lettre).length, `${el.repere} ${c.lettre}`).toBeGreaterThanOrEqual(2);
      }
      for (const v of [plan.gauche, plan.droite]) {
        if (!v) continue;
        expect(t.some((x) => x.startsWith(`VUE ${v.lettre} — a`)), `${el.repere} vue ${v.lettre}`).toBe(true);
        // La flèche de vue porte la même lettre.
        expect(t.filter((x) => x === v.lettre).length, `${el.repere} flèche ${v.lettre}`).toBeGreaterThanOrEqual(1);
      }
      // Chaque repère soudé a sa bulle.
      for (const mark of new Set([...el.toles.map((x) => x.mark), ...el.pieces.map((x) => x.mark)])) {
        expect(t, `${el.repere} ${mark}`).toContain(mark);
      }
    }
  });

  it('renvoie l’ordre d’exécution à la gamme de l’élément, sur sa fiche', () => {
    // La gamme a quitté le plan pour sa fiche : la planche y renvoie, et la
    // fiche porte bien la gamme de cet élément-là.
    const t = textes(s).join(' ');
    expect(t).toContain(`gamme ${e.repere}`);
    const fiches = sheetsGammes(ELEMENTS, P.finition, P.meta).flatMap(textes);
    for (const el of ELEMENTS) expect(fiches.some((x) => x.startsWith(`Assemblage ${el.repere} — `)), el.repere).toBe(true);
  });

  it('écrit la peinture sur la planche, pas seulement dans un coin du dossier', () => {
    const t = textes(planche(0)).join(' ');
    expect(t).toContain('TRAITEMENT DE SURFACE');
    expect(t).toContain('RAL');
  });
});

describe('robustesse du tracé', () => {
  it('ne produit aucune coordonnée non finie, sur aucun élément', () => {
    for (const [i] of ELEMENTS.entries()) {
      const s = planche(i);
      expect(JSON.stringify(s.scene.entities), ELEMENTS[i]!.membre.mark).not.toMatch(
        /null|NaN|Infinity/,
      );
    }
  });

  it('tient dans le cadre de la planche', () => {
    // ⚠ Un trait hors cadre est perdu à l'impression. Sur cette planche, ce
    // serait une cote de perçage — et la tôle deviendrait infabricable sans que
    // rien ne le signale.
    for (const [i] of ELEMENTS.entries()) {
      const s = planche(i);
      for (const ent of s.scene.entities) {
        const pts =
          ent.kind === 'ligne'
            ? [ent.a, ent.b]
            : ent.kind === 'polyligne'
              ? ent.points
              : ent.kind === 'cercle' || ent.kind === 'arc'
                ? [ent.c]
                : ent.kind === 'texte'
                  ? [ent.at]
                  : [];
        for (const q of pts) {
          expect(q.x, `${ELEMENTS[i]!.membre.mark} : x = ${q.x.toFixed(1)}`).toBeGreaterThan(-30);
          expect(q.x, `${ELEMENTS[i]!.membre.mark} : x = ${q.x.toFixed(1)}`).toBeLessThan(450);
          expect(q.y, `${ELEMENTS[i]!.membre.mark} : y = ${q.y.toFixed(1)}`).toBeGreaterThan(-30);
          expect(q.y, `${ELEMENTS[i]!.membre.mark} : y = ${q.y.toFixed(1)}`).toBeLessThan(330);
        }
      }
    }
  });

  it('tient sur tous les gabarits, treillis compris', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      const m = buildProject(p);
      for (const e of elementsAFabriquer(m)) {
        const s = sheetFabrication(e, {
          page: 1,
          total: 1,
          meta: p.meta,
          finition: p.finition,
        });
        expect(JSON.stringify(s.scene.entities), `${t.id} / ${e.membre.mark}`).not.toMatch(
          /null|NaN|Infinity/,
        );
      }
    }
  });

  it('n’émet que des échelles normalisées', () => {
    const normalisees = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const [i] of ELEMENTS.entries()) {
      expect(normalisees, ELEMENTS[i]!.membre.mark).toContain(planche(i).echelle);
    }
  });
});

describe('tôles à plat — plans de découpe', () => {
  const M = buildProject(P);
  const planches = sheetsTolesAPlat(M, { page: 1, total: 99, meta: P.meta, finition: P.finition });
  const libelles = planches.flatMap((s) => s.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : [])));

  it('dessine chaque repère de tôle une fois, avec sa quantité totale', () => {
    /*
     * ⚠ Un gousset posé sur dix traverses était redessiné dix fois, dans dix
     * bandes de détails trop étroites pour lui. Ici : une vue par repère.
     */
    const parRepere = new Map<string, number>();
    for (const pl of M.plates) parRepere.set(pl.mark, (parRepere.get(pl.mark) ?? 0) + 1);
    for (const [mark, n] of parRepere) {
      expect(libelles.filter((t) => t.startsWith(`${mark} — `)), mark).toEqual([expect.stringContaining(`${n}× ép.`)]);
    }
    for (const s of planches) expect(s.postes).toContain('tolerie');
  });

  it('renvoie chaque plan d’assemblage vers ces planches pour la découpe', () => {
    const e = elementsAFabriquer(M).find((x) => x.repere === 'TR1D');
    expect(e).toBeDefined();
    const t = sheetFabrication(e!, { page: 1, total: 9, meta: P.meta, finition: P.finition }).scene.entities.flatMap((x) =>
      x.kind === 'texte' ? [x.texte] : [],
    );
    expect(t.join(' ')).toContain('« Tôles à plat »');
  });
});
