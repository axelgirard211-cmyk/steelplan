import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { groupByMark } from '../../build/marks';
import type { Member } from '../../geometry/member';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import type { ProjectParams } from '../../model/project';
import { deg2rad } from '../../math/tolerance';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetDebit } from '../sheets/debit';
import { sheetFacade, type Face } from '../sheets/facades';
import { elementsAFabriquer } from '../sheets/element';
import { sheetFabrication, sheetsTolesAPlat } from '../sheets/fabrication';

/**
 * LISIBILITÉ DE LA COTATION SUR LES PLANS D'ATELIER.
 *
 * ⚠ Une cote illisible n'est pas un défaut de présentation : c'est une cote
 * PERDUE. L'ouvrier qui ne peut pas la lire mesure sur le dessin, et le dessin
 * est à l'échelle 1:20.
 *
 * Deux recouvrements ont existé, tous deux venant de la même cause — la PINCE et
 * les ENTRAXES tracés sur une seule ligne de cote :
 *  - « 65 » sous « 5 × 122 = 610 » sur l'élévation d'un poteau ;
 *  - « 45 » sous « 260 » sur la vue à plat d'une platine de pied.
 * Rien ne les signalait : les valeurs étaient justes, les traits dans le cadre,
 * et le contrôle de non-débordement passait.
 */

/** Chasse moyenne d'un caractère, en fraction de la hauteur du texte. */
const CHASSE = 0.55;
/**
 * Recouvrement toléré (mm papier).
 *
 * Deux libellés qui se frôlent restent lisibles ; c'est le chevauchement franc
 * qui efface un chiffre. Les défauts constatés faisaient 1,9 et 3,8 mm.
 */
const TOLERANCE = 1.2;

/** Un libellé de cote : nombre seul, cote répétée, angle, cote préfixée. */
const EST_UNE_COTE = /^(mini |maxi )?[\d\s×.,°=-]+$/u;

interface Boite {
  readonly texte: string;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Boîte englobante d'un texte, rotation comprise. */
function boiteDe(e: Extract<DrawEntity, { kind: 'texte' }>): Boite {
  const largeur = e.texte.length * e.hauteur * CHASSE;
  const dx = e.ancrage === 'centre' ? -largeur / 2 : e.ancrage === 'droite' ? -largeur : 0;
  const dy = e.ligneDeBase === 'milieu' ? -e.hauteur / 2 : e.ligneDeBase === 'haut' ? -e.hauteur : 0;

  const a = deg2rad(e.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const coins = [
    [dx, dy],
    [dx + largeur, dy],
    [dx + largeur, dy + e.hauteur],
    [dx, dy + e.hauteur],
  ].map(([u, v]) => ({
    x: e.at.x + (u as number) * cos - (v as number) * sin,
    y: e.at.y + (u as number) * sin + (v as number) * cos,
  }));

  return {
    texte: e.texte,
    x0: Math.min(...coins.map((c) => c.x)),
    x1: Math.max(...coins.map((c) => c.x)),
    y0: Math.min(...coins.map((c) => c.y)),
    y1: Math.max(...coins.map((c) => c.y)),
  };
}

/** Couples de cotes dont les libellés se recouvrent franchement. */
function recouvrements(s: Sheet): string[] {
  const boites = s.scene.entities
    .flatMap((e) => (e.kind === 'texte' ? [e] : []))
    .filter((e) => EST_UNE_COTE.test(e.texte))
    .map(boiteDe);

  const out: string[] = [];
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      const a = boites[i] as Boite;
      const b = boites[j] as Boite;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > TOLERANCE && oy > TOLERANCE) {
        out.push(`« ${a.texte} » sous « ${b.texte} » (${ox.toFixed(1)} × ${oy.toFixed(1)} mm)`);
      }
    }
  }
  return out;
}

/** Les planches d'ENSEMBLE : vue en plan, quatre façades, coupes. */
function planchesEnsemble(p: ProjectParams): Sheet[] {
  const model = buildProject(p);
  const opts = { page: 1, total: 99, meta: p.meta };
  return (['avant', 'arriere', 'ouest', 'est'] as Face[]).map((f) =>
    sheetFacade(model, p, f, opts),
  );
}

/** Les planches d'atelier d'un projet : débits et fabrications. */
function planchesAtelier(p: ProjectParams): Sheet[] {
  const model = buildProject(p);
  const debits = [...groupByMark(model.members).entries()].map(([, l], i) =>
    sheetDebit(l[0] as Member, {
      page: i + 1,
      total: 99,
      meta: p.meta,
      quantite: l.length,
    }),
  );
  const fabrications = elementsAFabriquer(model).map((e, i) =>
    sheetFabrication(e, { page: i + 1, total: 99, meta: p.meta, finition: p.finition }),
  );
  const toles = sheetsTolesAPlat(model, { page: 1, total: 99, meta: p.meta, finition: p.finition });
  return [...debits, ...fabrications, ...toles];
}

describe('cotation des façades', () => {
  it('n’écrit jamais deux cotes l’une sur l’autre', () => {
    /*
     * ⚠ Étendu aux façades le jour où elles sont passées de une à quatre. Une
     * façade vue de l'extérieur retourne le repère : la chaîne de cotes s'y
     * déroule de droite à gauche, et la cote totale bascule de l'autre côté de
     * la chaîne. C'est exactement le genre de basculement qui met deux nombres
     * au même endroit sans que personne le remarque avant l'impression.
     */
    for (const s of planchesEnsemble(DEFAULT_PROJECT)) {
      expect(recouvrements(s), s.titre).toEqual([]);
    }
  });
});

describe('cotation des planches d’atelier', () => {
  it('n’écrit jamais deux cotes l’une sur l’autre', () => {
    for (const s of planchesAtelier(DEFAULT_PROJECT)) {
      expect(recouvrements(s), s.titre).toEqual([]);
    }
  });

  it('tient sur tous les gabarits, treillis compris', () => {
    for (const t of TEMPLATES) {
      for (const s of planchesAtelier(t.build())) {
        expect(recouvrements(s), `${t.id} — ${s.titre}`).toEqual([]);
      }
    }
  });
});
