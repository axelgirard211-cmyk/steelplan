import { useMemo, useState } from 'react';
import { buildSheets } from '../../core/drawing/buildSheets';
import { libelleEchelle } from '../../core/drawing/scale';
import type { Sheet, SheetKind } from '../../core/drawing/sheet';
import { sheetToSvg, tailleFeuille } from '../../render2d/svgString';
import { sheetToDxf } from '../../export/dxf';
import { buildBom } from '../../core/bom/index';
import { Visionneuse } from '../Visionneuse';
import { useChecksReport, useProjetEffectif, useStructuralModel } from '../../state/derived';
import { planchesDuPoste, POSTES, sheetsBordereau, type Poste } from '../../core/drawing/postes';
import { archiveDstv, archiveDxfToles, lotDstvDuModele } from '../fichiersMachine';

/**
 * Le moteur PDF ne se charge qu'au premier export.
 *
 * ⚠ Il pèse près de 400 ko avec ses dépendances, soit plus que tout le reste
 * de l'interface — et la plupart des sessions consultent les plans sans jamais
 * les exporter. Le charger au démarrage faisait payer à chacun ce qu'un seul
 * clic utilise.
 */
const pdf = (): Promise<typeof import('../../export/pdf')> => import('../../export/pdf');

const LIBELLES: Record<SheetKind, string> = {
  bordereau: 'Bordereau d’envoi',
  ensemble: 'Plans d’ensemble',
  elevation: 'Élévations',
  coupe: 'Coupes',
  debit: 'Plans de pièce (débit, perçage)',
  montage: 'Repérage et montage',
  fondations: 'Fondations et ancrages',
  fabrication: 'Plans d’assemblage',
  detail: 'Détails d’assemblage',
  nomenclature: 'Nomenclatures',
  atelier: 'Documents de poste',
};

/**
 * Consultation du dossier de plans.
 *
 * Le dossier est reconstruit depuis le modèle à chaque modification : il n'y a
 * rien à « régénérer » ni à resynchroniser. Ce qui est affiché est le SVG que
 * l'export PDF reprendra tel quel.
 */
export function PlansPanel(): JSX.Element {
  const model = useStructuralModel();
  const project = useProjetEffectif();
  const [choisie, setChoisie] = useState(0);
  const [fondClair, setFondClair] = useState(true);

  const bom = useMemo(() => buildBom(project, model), [project, model]);
  const checks = useChecksReport();
  const dossier = useMemo(
    () => buildSheets(model, project, bom, checks),
    [model, project, bom, checks],
  );
  /*
   * Le DOSSIER D'UN POSTE : son bordereau d'envoi, puis ses planches, chacune
   * avec son numéro dans le dossier complet. C'est ce qu'on imprime pour le
   * poste — et rien d'autre.
   */
  const [poste, setPoste] = useState<Poste | 'tous'>('tous');
  const vues = useMemo((): { sheet: Sheet; numero: number }[] => {
    if (poste === 'tous') return dossier.map((sheet, i) => ({ sheet, numero: i + 1 }));
    return [
      ...sheetsBordereau(poste, dossier, project.meta).map((sheet) => ({ sheet, numero: 0 })),
      ...planchesDuPoste(dossier, poste),
    ];
  }, [dossier, poste, project.meta]);
  const sheets = useMemo(() => vues.map((v) => v.sheet), [vues]);
  const sheet = (sheets[Math.min(choisie, sheets.length - 1)] ?? sheets[0]) as Sheet;
  const svg = useMemo(
    () =>
      sheetToSvg(sheet, fondClair ? {} : { encre: '#e6e9ef', papier: '#1b1f26' }),
    [sheet, fondClair],
  );
  const taille = tailleFeuille(sheet.format);

  // Regroupement par nature, dans l'ordre du dossier.
  const groupes = useMemo(() => {
    const m = new Map<SheetKind, { sheet: Sheet; index: number }[]>();
    for (const [i, s] of sheets.entries()) {
      const l = m.get(s.kind) ?? [];
      l.push({ sheet: s, index: i });
      m.set(s.kind, l);
    }
    return m;
  }, [sheets]);

  const [enCours, setEnCours] = useState<string | null>(null);

  const enregistrer = (blob: Blob, nom: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nomDeFichier = (suffixe: string): string => {
    const projet = (project.meta.nom || 'projet').replace(/[^\w-]+/g, '-');
    return `${projet}-${suffixe}`;
  };

  /**
   * L'export du dossier complet passe par plusieurs dizaines de planches : on
   * rend la main à l'interface avant de commencer, sinon la fenêtre se fige sans
   * que l'utilisateur sache pourquoi.
   */
  const exporterDossier = (): void => {
    setEnCours('dossier');
    setTimeout(() => {
      void pdf()
        .then(({ sheetsToPdf }) =>
          enregistrer(
            sheetsToPdf(sheets, { titre: project.meta.nom, auteur: project.meta.dessinateur }),
            nomDeFichier(poste === 'tous' ? 'dossier.pdf' : `dossier-${poste}.pdf`),
          ),
        )
        .finally(() => setEnCours(null));
    }, 30);
  };

  const exporterPlanche = (): void => {
    void pdf().then(({ sheetToPdf }) =>
      enregistrer(
        sheetToPdf(sheet, { titre: sheet.titre, auteur: project.meta.dessinateur }),
        nomDeFichier(`${sheet.id}.pdf`),
      ),
    );
  };

  /*
   * Les FICHIERS MACHINE du poste, à côté de ses planches : le perçage reçoit
   * son lot DSTV, la tôlerie ses DXF de découpe — le même envoi, le même jour,
   * au même indice que les plans qui les accompagnent.
   */
  const exporterFichiersMachine = (): void => {
    const nom = (project.meta.nom || 'projet').replace(/[^\w-]+/g, '-');
    const a =
      poste === 'percage'
        ? archiveDstv(lotDstvDuModele(model, project.meta), nom)
        : archiveDxfToles(model, nom);
    enregistrer(a.blob, a.nom);
  };

  const exporterDxf = (): void =>
    enregistrer(
      new Blob([sheetToDxf(sheet)], { type: 'application/dxf' }),
      nomDeFichier(`${sheet.id}.dxf`),
    );

  return (
    <>
      <nav className="laterale">
        <label className="etiquette" style={{ display: 'block', marginBottom: 10 }}>
          Dossier du poste
          <select
            value={poste}
            onChange={(e) => {
              setPoste(e.target.value as Poste | 'tous');
              setChoisie(0);
            }}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          >
            <option value="tous">Dossier complet ({dossier.length} pl.)</option>
            {POSTES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle} ({planchesDuPoste(dossier, x.id).length} pl.)
              </option>
            ))}
          </select>
        </label>
        {[...groupes.entries()].map(([kind, l]) => (
          <div key={kind} style={{ marginBottom: 10 }}>
            <div className="titre-groupe">{LIBELLES[kind]}</div>
            <ul className="familles">
              {l.map(({ sheet: s, index }) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={index === choisie}
                    onClick={() => setChoisie(index)}
                  >
                    <span>{s.titre}</span>
                    <span className="compte">{libelleEchelle(s.echelle)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <section className="principal plans">
        <div className="barre-outils">
          <span className="compte">
            {poste === 'tous'
              ? `Planche ${choisie + 1} / ${sheets.length}`
              : `${choisie + 1} / ${sheets.length} du poste${(vues[choisie]?.numero ?? 0) > 0 ? ` · planche ${vues[choisie]?.numero} du dossier` : ''}`}{' '}
            · {sheet.format} paysage ·{' '}
            {libelleEchelle(sheet.echelle)} · {sheet.scene.length} entités
          </span>
          <span className="separateur" />
          <button
            type="button"
            className="plat"
            onClick={() => setChoisie((c) => Math.max(0, c - 1))}
            disabled={choisie === 0}
          >
            Précédente
          </button>
          <button
            type="button"
            className="plat"
            onClick={() => setChoisie((c) => Math.min(sheets.length - 1, c + 1))}
            disabled={choisie >= sheets.length - 1}
          >
            Suivante
          </button>
          <label className="etiquette">
            <input
              type="checkbox"
              checked={fondClair}
              onChange={(e) => setFondClair(e.target.checked)}
            />{' '}
            Fond papier
          </label>
          <span className="separateur" />
          <button
            type="button"
            className="plat"
            onClick={exporterDossier}
            disabled={enCours !== null}
          >
            {enCours === 'dossier'
              ? 'Export en cours…'
              : poste === 'tous'
                ? `Dossier PDF (${sheets.length} pl.)`
                : `Dossier du poste PDF (${sheets.length} pl.)`}
          </button>
          {(poste === 'percage' || poste === 'tolerie') && (
            <button type="button" className="plat" onClick={exporterFichiersMachine}>
              {poste === 'percage' ? 'Fichiers DSTV (.zip)' : 'Fichiers DXF de découpe (.zip)'}
            </button>
          )}
          <button type="button" className="plat" onClick={exporterPlanche}>
            Planche PDF
          </button>
          <button type="button" className="plat" onClick={exporterDxf}>
            Planche DXF
          </button>
        </div>

        <Visionneuse svg={svg} largeur={taille.largeur} hauteur={taille.hauteur} cle={sheet.id} />

        <p className="note">
          Les cotes portent les valeurs du modèle, pas des mesures du dessin : un défaut de cadrage
          resterait un défaut de présentation, jamais une cote fausse. Le PDF est vectoriel et
          produit à l’échelle 1 en millimètres — une cote mesurée à la règle sur le tirage retombe
          sur la valeur du plan. Le DXF est en R12, lisible par tout logiciel de CAO ; ses cotes y
          sont éclatées en traits, ce format n’ayant pas d’entité de cotation.
        </p>
      </section>
    </>
  );
}
