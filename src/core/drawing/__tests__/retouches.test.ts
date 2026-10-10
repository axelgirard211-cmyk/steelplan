import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { buildBom } from '../../bom/index';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { buildSheets } from '../buildSheets';
import { translation, transformer } from '../geometrie2d';
import {
  ajouter,
  appliquerRetouches,
  copier,
  effacer,
  elementsEditables,
  empreintes,
  modifier,
  retouchesVides,
  valider,
  type RetouchesDePlanche,
} from '../retouches';
import { pt } from '../scene';
import type { Sheet } from '../sheet';

/**
 * RETOUCHES DU DESSINATEUR.
 *
 * ⚠ La promesse est double : une retouche SURVIT à la régénération du dossier,
 * et une retouche dont le plan a changé sous elle est SIGNALÉE — jamais
 * appliquée à l'aveugle, jamais perdue en silence.
 */

const dossier = (p: ProjectParams): Sheet[] => {
  const m = buildProject(p);
  return buildSheets(m, p, buildBom(p, m), runChecks(p, m));
};
const planche = (p: ProjectParams, id: string): Sheet => {
  const s = dossier(p).find((x) => x.id === id);
  if (!s) throw new Error(`planche ${id} absente`);
  return s;
};

const D = DEFAULT_PROJECT;
const ID = dossier(D).find((s) => s.id.startsWith('detail'))?.id ?? 'plan';
const S = planche(D, ID);
let n = 0;
const id = (): string => `t${++n}`;

describe('empreintes des entités générées', () => {
  it('sont STABLES d’une régénération à l’autre', () => {
    // ⚠ Sans cela, chaque modification du modèle — même sans rapport — rendrait
    // toutes les retouches « à revoir ».
    expect(empreintes(planche(D, ID).scene.entities)).toEqual(empreintes(S.scene.entities));
  });

  it('sont uniques sur la planche, doublons compris', () => {
    const e = empreintes(S.scene.entities);
    expect(new Set(e).size).toBe(e.length);
  });
});

describe('composition sur la planche', () => {
  const elements = elementsEditables(S, undefined);
  const texte = elements.find((el) => el.source.kind === 'texte' && el.ref.type === 'generee');

  it('sans retouche, rend la planche telle quelle', () => {
    expect(appliquerRetouches(S, undefined).sheet).toBe(S);
    expect(elements).toHaveLength(S.scene.length);
  });

  it('efface une entité générée, et elle seule', () => {
    if (!texte) throw new Error('aucun texte');
    const r = effacer(retouchesVides(ID), [texte.ref]);
    const out = appliquerRetouches(S, r).sheet;
    expect(out.scene.length).toBe(S.scene.length - 1);
  });

  it('ajoute les tracés du dessinateur par-dessus', () => {
    const r = ajouter(retouchesVides(ID), [{ kind: 'ligne', a: pt(10, 10), b: pt(50, 10), layer: 'contour' }], id);
    expect(appliquerRetouches(S, r).sheet.scene.length).toBe(S.scene.length + 1);
  });

  it('modifie une entité générée en la masquant et en gardant son ORIGINE', () => {
    if (!texte) throw new Error('aucun texte');
    const r = modifier(retouchesVides(ID), [texte], (e) => transformer(e, translation(5, 0)), id);
    expect(r.masques).toHaveLength(1);
    expect(r.ajouts[0]?.origine).toBe(r.masques[0]);
    const out = appliquerRetouches(S, r);
    expect(out.sheet.scene.length).toBe(S.scene.length);
    expect(out.aRevoir).toBe(0);
  });

  it('modifie un ajout sur place, et efface un ajout sans laisser de trace', () => {
    const r1 = ajouter(retouchesVides(ID), [{ kind: 'cercle', c: pt(20, 20), r: 3, layer: 'contour' }], id);
    const el = elementsEditables(S, r1).find((x) => x.ref.type === 'ajout');
    if (!el) throw new Error('ajout absent');
    const r2 = modifier(r1, [el], (e) => transformer(e, translation(1, 1)), id);
    expect(r2.ajouts).toHaveLength(1);
    expect(r2.masques).toHaveLength(0);
    expect(effacer(r2, [el.ref]).ajouts).toHaveLength(0);
  });

  it('copie sans toucher à la source', () => {
    if (!texte) throw new Error('aucun texte');
    const r = copier(retouchesVides(ID), [texte], (e) => transformer(e, translation(0, 10)), id);
    expect(r.masques).toEqual([]);
    expect(r.ajouts[0]?.origine).toBe('');
  });

  it('dessine une cote avec la longueur RÉELLE, à l’échelle de la planche', () => {
    const r = ajouter(retouchesVides(ID), [{ kind: 'cote', a: pt(10, 10), b: pt(30, 10), decalage: 5, texte: '', layer: 'cotation' }], id);
    const textes = appliquerRetouches(S, r).sheet.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));
    expect(textes).toContain(String(20 * S.echelle));
  });
});

describe('après régénération', () => {
  it('signale une retouche dont l’entité d’origine a changé, et la garde', () => {
    /*
     * ⚠ Le dessinateur a déplacé la cote de portée ; puis la portée change et
     * la cote générée porte une autre valeur. Sa version déplacée reste — on ne
     * jette pas son travail — mais elle est signalée : le plan a bougé sous elle.
     */
    const plan = planche(D, 'plan');
    const cible = elementsEditables(plan, undefined).find((el) => el.source.kind === 'texte' && el.source.texte === String(D.grid.span));
    if (!cible) throw new Error('cote de portée absente du plan');
    const r: RetouchesDePlanche = modifier(retouchesVides('plan'), [cible], (e) => transformer(e, translation(2, 2)), id);
    const autre = planche({ ...D, grid: { ...D.grid, span: D.grid.span + 2000 } }, 'plan');
    const out = appliquerRetouches(autre, r);
    expect(out.aRevoir).toBe(1);
    expect(out.masquesCaducs).toBe(1);
    // Et sur la planche inchangée, rien à revoir.
    expect(appliquerRetouches(plan, r).aRevoir).toBe(0);
    // Une fois vérifiée, la retouche devient un ajout ordinaire.
    const v = valider(r, autre);
    expect(appliquerRetouches(autre, v).aRevoir).toBe(0);
    expect(v.masques).toEqual([]);
  });

  it('garde intactes les retouches d’une planche que la modification ne touche pas', () => {
    const r = ajouter(retouchesVides(ID), [{ kind: 'ligne', a: pt(10, 10), b: pt(50, 10), layer: 'contour' }], id);
    const autre = planche({ ...D, finition: { ...D.finition, note: 'autre consigne' } }, ID);
    expect(appliquerRetouches(autre, r).aRevoir).toBe(0);
  });
});
