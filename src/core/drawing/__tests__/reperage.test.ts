import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetFacade, type Face } from '../sheets/facades';
import { buildSheets } from '../buildSheets';
import { sheetCoupe } from '../sheets/ensemble';

const FACES: Face[] = ['avant', 'arriere', 'ouest', 'est'];
const OPTS = { page: 1, total: 60, meta: DEFAULT_PROJECT.meta };

function planches(p = DEFAULT_PROJECT): Sheet[] {
  const m = buildProject(p);
  return [
    ...FACES.map((f) => sheetFacade(m, p, f, { ...OPTS, meta: p.meta })),
    sheetCoupe(m, p, 0, 'A', { ...OPTS, meta: p.meta }),
    sheetCoupe(m, p, 1, 'B', { ...OPTS, meta: p.meta }),
  ];
}

interface Boite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  texte: string;
}

/**
 * Boîtes des textes de repérage d'une planche.
 *
 * ⚠ La largeur est ESTIMÉE, exactement comme le fait le placeur. C'est
 * volontaire : le test doit mesurer ce que le placeur croit occuper, pas ce que
 * la police occupera vraiment — sinon il vérifierait la police et non le
 * placement.
 */
function boites(s: Sheet): Boite[] {
  return s.scene.entities
    .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
    .filter((e) => e.layer === 'reperage')
    .map((e) => {
      const l = e.texte.length * e.hauteur * 0.7;
      const x0 = e.ancrage === 'droite' ? e.at.x - l : e.ancrage === 'centre' ? e.at.x - l / 2 : e.at.x;
      return { x0, y0: e.at.y, x1: x0 + l, y1: e.at.y + e.hauteur, texte: e.texte };
    });
}

describe('repérage des pièces', () => {
  const PLANCHES = planches();

  it('nomme chaque repère visible sur la planche', () => {
    for (const s of PLANCHES) {
      const gras = s.scene.entities
        .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
        .filter((e) => e.layer === 'reperage' && e.gras);
      expect(gras.length, s.titre).toBeGreaterThan(3);
    }
  });

  it('porte le PROFIL sous chaque repère', () => {
    /*
     * La demande d'origine : lire sur le plan qu'une pièce est un IPE 400 sans
     * aller chercher la nomenclature.
     */
    for (const s of PLANCHES) {
      const textes = boites(s).map((b) => b.texte);
      expect(textes.some((x) => /^(IPE|HEA|HEB|UPE|UPN|CHS|L|Z|C|Rond|SHS|RHS)\b/.test(x)), s.titre).toBe(
        true,
      );
    }
  });

  it('NE SUPERPOSE JAMAIS deux étiquettes', () => {
    /*
     * ⚠ L'INVARIANT DE LISIBILITÉ. La première version étiquetait chaque
     * exemplaire de chaque repère : dix « PA1 · IPE 160 » s'empilaient sur la
     * ligne de pannes, et la planche devenait moins lisible que sans aucune
     * étiquette — puisque la bouillie cachait aussi le dessin. Rien ne le
     * signalait : le tracé restait valide, les textes justes, seule la lecture
     * était impossible.
     */
    for (const s of PLANCHES) {
      const bs = boites(s);
      const fautes: string[] = [];
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i] as Boite;
          const b = bs[j] as Boite;
          if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
            fautes.push(`${s.titre} : « ${a.texte} » et « ${b.texte} »`);
          }
        }
      }
      expect(fautes, fautes.join('\n')).toHaveLength(0);
    }
  });

  it('ne nomme un repère qu’UNE FOIS par planche', () => {
    // Dix pannes identiques portent le même repère précisément pour n'être
    // nommées qu'une fois.
    for (const s of PLANCHES) {
      const reperes = s.scene.entities
        .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
        .filter((e) => e.layer === 'reperage' && e.gras)
        .map((e) => e.texte);
      expect(new Set(reperes).size, s.titre).toBe(reperes.length);
    }
  });

  it('répartit les étiquettes sur la largeur, sans les tasser d’un côté', () => {
    /*
     * ⚠ Prendre le premier exemplaire venu de chaque repère les groupait tous à
     * gauche — là où tombe le premier de chaque série — laissant les quatre
     * cinquièmes de l'élévation nus. On vérifie donc que le nuage d'étiquettes
     * couvre une large part de la planche.
     */
    const facade = PLANCHES[0] as Sheet;
    const xs = boites(facade).map((b) => (b.x0 + b.x1) / 2);
    const etendue = Math.max(...xs) - Math.min(...xs);
    expect(etendue).toBeGreaterThan(150); // mm papier, sur une A3 de 420
  });

  it('tient sur tous les gabarits, sans chevauchement ni planche muette', () => {
    for (const [nom, gabarit] of Object.entries(TEMPLATES)) {
      for (const s of planches(gabarit.build())) {
        const bs = boites(s);
        expect(bs.length, `${nom} / ${s.titre}`).toBeGreaterThan(0);
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            const a = bs[i] as Boite;
            const b = bs[j] as Boite;
            const croise = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
            expect(croise, `${nom} / ${s.titre} : « ${a.texte} » et « ${b.texte} »`).toBe(false);
          }
        }
      }
    }
  });
});

/* ================================================================== */
/* Renvois de détail                                                   */
/* ================================================================== */

describe('renvois de détail', () => {
  const P0 = DEFAULT_PROJECT;
  const DOSSIER = buildSheets(buildProject(P0), P0);
  const textesDe = (id: string): string[] =>
    (DOSSIER.find((s) => s.id === id)?.scene.entities ?? []).flatMap((e) =>
      e.kind === 'texte' && e.layer === 'reperage' ? [e.texte] : [],
    );

  it('chaque planche de détail porte une lettre, retrouvée en bulle sur sa vue d’ensemble', () => {
    /*
     * ⚠ Le LIEN entre les deux est tout l'objet du renvoi. Une lettre au titre
     * du détail sans bulle correspondante — ou l'inverse — renverrait à une
     * planche introuvable ; c'est pourquoi les deux sont tirées de la même
     * attribution, et pourquoi ce test les confronte.
     */
    const details = DOSSIER.filter((s) => s.kind === 'detail');
    expect(details.length).toBeGreaterThan(0);
    // Les nœuds du portique se renvoient sur la coupe ; l'attache de palée, sur
    // la façade du long pan où elle se voit.
    for (const d of details) {
      const lettre = /^Détail ([A-Z]) —/.exec(d.titre)?.[1];
      expect(lettre, d.titre).toBeDefined();
      const vue = d.id === 'detail-palee' ? 'facade-avant' : 'coupe-A';
      expect(textesDe(vue), `bulle ${lettre} sur ${vue}`).toContain(lettre);
    }
  });

  it('ne réemploie aucune lettre entre coupes et détails', () => {
    // « A » ne doit désigner qu'une chose dans tout le dossier.
    const lettres = DOSSIER.flatMap((s) => {
      const m = /^(?:Coupe ([A-Z])-|Détail ([A-Z]) —)/.exec(s.titre);
      return m ? [m[1] ?? m[2]] : [];
    });
    expect(new Set(lettres).size).toBe(lettres.length);
  });

  it('ne pose les renvois que sur la coupe de la file détaillée', () => {
    // Le pignon n'est PAS le nœud détaillé : y renvoyer ferait chercher sur
    // la planche de détail un assemblage qui n'est pas le sien.
    const lettresDetail = DOSSIER.filter((s) => s.kind === 'detail').map(
      (s) => /^Détail ([A-Z])/.exec(s.titre)?.[1],
    );
    const surLePignon = textesDe('coupe-B');
    for (const l of lettresDetail) expect(surLePignon).not.toContain(l);
  });
});
