import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { elementsAFabriquer } from '../../drawing/sheets/element';
import { cutLengths } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { buildBom } from '../index';
import { colisage, masseALivrer, PLATEAU_STANDARD } from '../colisage';
import { GRILLE_PAR_DEFAUT, valoriser } from '../valorisation';

const P = DEFAULT_PROJECT;
const M = buildProject(P);

/* ================================================================== */
/* Conservation de la masse                                            */
/* ================================================================== */

describe('conservation de la masse', () => {
  /*
   * ⚠ L'INVARIANT CENTRAL de tout ce qui sort du logiciel. Fiches de
   * fabrication, tableau de montage et colisage se servent tous dans
   * `elementsAFabriquer` : si cette source perd de la matière en route, les
   * trois mentent ensemble et se confirment l'une l'autre. Aucune vérification
   * interne ne peut alors les démentir — seule la comparaison à la masse du
   * modèle le peut.
   *
   * C'est ce test qui a démasqué le rattachement des jarrets : nommés « 0-JG »
   * là où leur traverse s'appelle « 0-TG », ils n'étaient rattachés à aucun
   * élément et 498 kg de renforts disparaissaient de tous les documents.
   */
  it('les éléments à fabriquer pèsent exactement le modèle', () => {
    const total = elementsAFabriquer(M).reduce(
      (s, e) => s + e.masseUnitaire * e.quantite,
      0,
    );
    expect(total).toBeCloseTo(M.stats.massKg, 6);
  });

  it('chaque jarret est rattaché à une traverse et à une seule', () => {
    const vus = elementsAFabriquer(M).flatMap((e) =>
      e.jarrets.map((j) => ({ id: j.id, mark: e.membre.mark, role: e.membre.role })),
    );
    // Un jarret d'un repère porté à n exemplaires vaut n jarrets au modèle : on
    // compare donc les identifiants distincts, pas les quantités.
    const ids = vus.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of vus) expect(v.role).toBe('traverse');
  });

  it('la masse à livrer égale celle du modèle, hors gabarit compris', () => {
    expect(masseALivrer(colisage(M))).toBeCloseTo(M.stats.massKg, 6);
  });

  it('la nomenclature annonce la même masse d’acier que le modèle', () => {
    /*
     * ⚠ UN SEUL chiffre pour une seule grandeur. La liste de débit pesait la
     * barre BRUTE quand le modèle pèse la pièce GRUGÉE : l'écran affichait
     * 29 776 kg « à livrer » en synthèse et 29 771 kg « à livrer » au colisage.
     * Quatre kilos et demi n'ont aucune importance — deux nombres sous le même
     * nom en ont beaucoup, parce qu'ils ôtent au lecteur le moyen de savoir
     * lequel croire.
     */
    expect(buildBom(P, M).totals.massSteel).toBeCloseTo(M.stats.massKg, 6);
  });
});

/* ================================================================== */
/* Colisage                                                            */
/* ================================================================== */

describe('colisage', () => {
  const C = colisage(M);

  it('ne charge aucun colis au-delà de la charge utile', () => {
    for (const c of C.colis) expect(c.masse).toBeLessThanOrEqual(PLATEAU_STANDARD.chargeUtile);
  });

  it('ne charge aucune pièce plus longue que le plateau', () => {
    for (const c of C.colis) {
      expect(c.longueurMax).toBeLessThanOrEqual(PLATEAU_STANDARD.longueurUtile);
    }
  });

  it('écarte les pièces hors gabarit en les nommant', () => {
    /*
     * Ce hangar de 30 m sort des contreventements de 20,6 m : ils ne peuvent
     * pas partir sur un plateau de 13,60 m. Le point vérifié n'est pas qu'il y
     * en ait — c'est qu'aucune pièce trop longue ne soit chargée EN SILENCE.
     */
    const trop = elementsAFabriquer(M).filter(
      (e) => cutLengths(e.membre).max > PLATEAU_STANDARD.longueurUtile,
    );
    expect(C.horsGabarit.map((h) => h.mark).sort()).toEqual(
      trop.map((e) => e.membre.mark).sort(),
    );
    for (const h of C.horsGabarit) expect(h.masse).toBeGreaterThan(0);
  });

  it('charge chaque repère en entier, quitte à le scinder', () => {
    const parMark = new Map<string, number>();
    for (const c of C.colis) {
      for (const l of c.lignes) parMark.set(l.mark, (parMark.get(l.mark) ?? 0) + l.nombre);
    }
    const ecartes = new Set(C.horsGabarit.map((h) => h.mark));
    // On charge des ASSEMBLAGES : c'est leur repère qui est peint et colisé.
    for (const e of elementsAFabriquer(M)) {
      if (ecartes.has(e.repere)) continue;
      expect(parMark.get(e.repere), e.repere).toBe(e.quantite);
    }
  });

  it('suit l’ordre de montage : les poteaux avant les pannes', () => {
    const rang = (mot: string): number => C.colis.findIndex((c) => c.phase.includes(mot));
    expect(rang('Poteaux')).toBeLessThan(rang('Pannes'));
    expect(rang('Contreventements')).toBeLessThan(rang('Pannes'));
  });

  it('un plateau plus petit produit plus de colis, jamais moins de masse', () => {
    const petit = colisage(M, { longueurUtile: 12_000, chargeUtile: 12_000, libelle: 'Petit' });
    expect(petit.colis.length).toBeGreaterThan(C.colis.length);
    expect(masseALivrer(petit)).toBeCloseTo(M.stats.massKg, 6);
  });
});

/* ================================================================== */
/* Valorisation                                                        */
/* ================================================================== */

describe('valorisation', () => {
  const V = valoriser(buildBom(P, M), P.finition);

  it('valorise l’acier par nuance et non au tonnage global', () => {
    const lignes = V.lignes.filter((l) => l.poste.startsWith('Acier'));
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      const nuance = l.poste.replace('Acier ', '');
      expect(l.prixUnitaire).toBe(GRILLE_PAR_DEFAUT.acier[nuance]);
    }
  });

  it('le total est la somme des lignes', () => {
    expect(V.total).toBeCloseTo(
      V.lignes.reduce((s, l) => s + l.montant, 0),
      6,
    );
  });

  it('tient dans l’ordre de grandeur du métier, 1 à 4 €/kg', () => {
    /*
     * ⚠ Contrôle de VRAISEMBLANCE, pas d'exactitude. Une charpente courante se
     * chiffre entre 1 et 4 €/kg fourniture et atelier. Un résultat hors de cette
     * plage signale une erreur d'unité — des millimètres pris pour des mètres,
     * un kilo pour une tonne — bien avant qu'un devis ne parte.
     */
    expect(V.parKg).toBeGreaterThan(1);
    expect(V.parKg).toBeLessThan(4);
  });

  it('la galvanisation coûte plus cher que la peinture, toutes choses égales', () => {
    const bom = buildBom(P, M);
    const peint = valoriser(bom, { ...P.finition, type: 'peinture' });
    const galva = valoriser(bom, { ...P.finition, type: 'galvanisation' });
    expect(galva.total).toBeGreaterThan(peint.total);
  });

  it('une nuance inconnue retombe sur un prix, jamais sur NaN', () => {
    const bidon = valoriser(buildBom(P, M), P.finition, {
      ...GRILLE_PAR_DEFAUT,
      acier: { S235: 1.15 },
    });
    expect(Number.isFinite(bidon.total)).toBe(true);
    expect(bidon.total).toBeGreaterThan(0);
  });
});
