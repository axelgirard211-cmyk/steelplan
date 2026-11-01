import { useMemo, useState } from 'react';
import { libelleEchelle } from '../../core/drawing/scale';
import type { Sheet, SheetKind } from '../../core/drawing/sheet';
import { sheetToSvg, tailleFeuille } from '../../render2d/svgString';
import { dxfEnOctets, sheetToDxf } from '../../export/dxf';
import { Visionneuse } from '../Visionneuse';
import { Editeur } from '../editeur/Editeur';
import { appliquerRetouches } from '../../core/drawing/retouches';
import { SAISIE_INVALIDE, useEtatModele, useProjetEffectif, useStructuralModel } from '../../state/derived';
import { useDossier } from '../useDossier';
import { normaliser } from '../projet/rubriques';
import { planchesDuPoste, POSTES, sheetsBordereau, type Poste } from '../../core/drawing/postes';
import { archiveDstv, archiveDxfToles, lotDstvDuModele } from '../fichiersMachine';
import { useNavigation } from '../../state/navigation';
import { ChoixDuPoste } from './ChoixDuPoste';

/**
 * Le moteur PDF ne se charge qu'au premier export.
 *
 * ⚠ Il pèse près de 400 ko avec ses dépendances, soit plus que tout le reste
 * de l'interface — et la plupart des sessions consultent les plans sans jamais
 * les exporter. Le charger au démarrage faisait payer à chacun ce qu'un seul
 * clic utilise.
 */
const pdf = (): Promise<typeof import('../../export/pdf')> => import('../../export/pdf');

export const LIBELLES: Record<SheetKind, string> = {
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
  // Le poste d'abord : tant qu'aucun n'est choisi, on demande lequel.
  const poste = useNavigation((s) => s.postePlans);
  return poste === null ? <ChoixDuPoste /> : <PlanchesDuPoste poste={poste} />;
}

/** Les planches du dossier choisi : liste, visionneuse, exports. */
function PlanchesDuPoste({ poste }: { poste: Poste | 'tous' }): JSX.Element {
  const model = useStructuralModel();
  const project = useProjetEffectif();
  /*
   * ⚠ Saisie invalide : les planches montrent le DERNIER ÉTAT VALIDE. Les
   * regarder est utile ; les envoyer en atelier sous le nom du projet saisi ne
   * l'est pas — l'export attend que la saisie soit corrigée.
   */
  const { aJour } = useEtatModele();
  const horsExport = aJour ? undefined : SAISIE_INVALIDE;
  const [erreurExport, setErreurExport] = useState<string | null>(null);
  const [choisie, setChoisie] = useState(0);
  const [fondClair, setFondClair] = useState(true);

  const { dossier, retouches: parPlanche } = useDossier();
  /*
   * Le DOSSIER D'UN POSTE : son bordereau d'envoi, puis ses planches, chacune
   * avec son numéro dans le dossier complet. C'est ce qu'on imprime pour le
   * poste — et rien d'autre.
   */
  const choisirPoste = useNavigation((s) => s.choisirPoste);
  const vues = useMemo((): { sheet: Sheet; numero: number }[] => {
    if (poste === 'tous') return dossier.map((sheet, i) => ({ sheet, numero: i + 1 }));
    return [
      ...sheetsBordereau(poste, dossier, project.meta).map((sheet) => ({ sheet, numero: 0 })),
      ...planchesDuPoste(dossier, poste),
    ];
  }, [dossier, poste, project.meta]);
  /*
   * ⚠ Les RETOUCHES du dessinateur se posent sur les planches générées : c'est
   * la planche retouchée qu'on affiche, qu'on exporte et qu'on imprime. Elles
   * sont lues dans la saisie, pas dans le projet effectif : une retouche ne
   * régénère rien.
   */
  const generees = useMemo(() => vues.map((v) => v.sheet), [vues]);
  const sheets = useMemo(() => generees.map((s) => appliquerRetouches(s, parPlanche.get(s.id)).sheet), [generees, parPlanche]);
  const indexChoisi = Math.min(choisie, sheets.length - 1);
  const sheet = (sheets[indexChoisi] ?? sheets[0]) as Sheet;
  const generee = (generees[indexChoisi] ?? generees[0]) as Sheet;
  const [edition, setEdition] = useState(false);
  const svg = useMemo(
    () =>
      sheetToSvg(sheet, fondClair ? {} : { encre: '#e6e9ef', papier: '#1b1f26' }),
    [sheet, fondClair],
  );
  const taille = tailleFeuille(sheet.format);

  /*
   * ⚠ Un dossier courant compte une centaine de planches : on cherchait
   * « Assemblage TR1C » en faisant défiler la liste. Le filtre garde la
   * numérotation et la navigation du dossier, il ne fait que masquer.
   */
  const [filtre, setFiltre] = useState('');
  // Regroupement par nature, dans l'ordre du dossier.
  const groupes = useMemo(() => {
    const q = normaliser(filtre);
    const m = new Map<SheetKind, { sheet: Sheet; index: number }[]>();
    for (const [i, s] of sheets.entries()) {
      if (q && !normaliser(`${s.titre} ${LIBELLES[s.kind]}`).includes(q)) continue;
      const l = m.get(s.kind) ?? [];
      l.push({ sheet: s, index: i });
      m.set(s.kind, l);
    }
    return m;
  }, [sheets, filtre]);

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
    setErreurExport(null);
    setTimeout(() => {
      void pdf()
        .then(({ sheetsToPdf }) =>
          enregistrer(
            sheetsToPdf(sheets, { titre: project.meta.nom, auteur: project.meta.dessinateur }),
            nomDeFichier(poste === 'tous' ? 'dossier.pdf' : `dossier-${poste}.pdf`),
          ),
        )
        .catch((e: unknown) => setErreurExport(`Export du dossier impossible : ${e instanceof Error ? e.message : String(e)}`))
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
      new Blob([dxfEnOctets(sheetToDxf(sheet))], { type: 'application/dxf' }),
      nomDeFichier(`${sheet.id}.dxf`),
    );

  return (
    <>
      <nav className="laterale">
        {/* Le dossier ouvert, et le chemin pour en changer. */}
        <div className="poste-courant">
          <span className="titre-groupe">Dossier</span>
          <strong>{poste === 'tous' ? 'Dossier complet' : (POSTES.find((x) => x.id === poste)?.libelle ?? poste)}</strong>
          <span className="compte">{sheets.length} planches</span>
          <button type="button" className="plat" onClick={() => choisirPoste(null)}>
            Changer de poste
          </button>
        </div>
        <input
          type="search"
          className="filtre-planches"
          placeholder="Filtrer les planches (TR1, détail, façade…)"
          aria-label="Filtrer les planches"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFiltre('');
            // Entrée : la première planche trouvée.
            const premiere = [...groupes.values()][0]?.[0];
            if (e.key === 'Enter' && premiere) setChoisie(premiere.index);
          }}
        />
        {groupes.size === 0 && <p className="note">Aucune planche ne correspond.</p>}
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
                    <span>
                      {s.titre}
                      {parPlanche.has(s.id) ? <span title="Planche retouchée à la main"> ✎</span> : null}
                    </span>
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
            className="primaire"
            onClick={exporterDossier}
            disabled={enCours !== null || !aJour}
            title={horsExport}
          >
            {enCours === 'dossier'
              ? 'Export en cours…'
              : poste === 'tous'
                ? `Dossier PDF (${sheets.length} pl.)`
                : `Dossier du poste PDF (${sheets.length} pl.)`}
          </button>
          {(poste === 'percage' || poste === 'tolerie') && (
            <button type="button" className="plat" onClick={exporterFichiersMachine} disabled={!aJour} title={horsExport}>
              {poste === 'percage' ? 'Fichiers DSTV (.zip)' : 'Fichiers DXF de découpe (.zip)'}
            </button>
          )}
          {!edition && (
            <button type="button" className="plat" onClick={() => setEdition(true)} title="Retoucher la planche comme dans un logiciel de DAO">
              Modifier la planche
            </button>
          )}
          <button type="button" className="plat" onClick={exporterPlanche} disabled={!aJour} title={horsExport}>
            Planche PDF
          </button>
          <button type="button" className="plat" onClick={exporterDxf} disabled={!aJour} title={horsExport}>
            Planche DXF
          </button>
        </div>

        {erreurExport && (
          <p className="note erreur" role="alert">
            {erreurExport}
          </p>
        )}

        {edition ? (
          <Editeur key={generee.id} sheet={generee} retouches={parPlanche.get(generee.id)} fondClair={fondClair} onQuitter={() => setEdition(false)} />
        ) : (
          <Visionneuse svg={svg} largeur={taille.largeur} hauteur={taille.hauteur} cle={sheet.id} />
        )}

        {!edition && <p className="note">
          Les cotes portent les valeurs du modèle, pas des mesures du dessin : un défaut de cadrage
          resterait un défaut de présentation, jamais une cote fausse. Le PDF est vectoriel et
          produit à l’échelle 1 en millimètres — une cote mesurée à la règle sur le tirage retombe
          sur la valeur du plan. Le DXF est en R12, lisible par tout logiciel de CAO ; ses cotes y
          sont éclatées en traits, ce format n’ayant pas d’entité de cotation.
        </p>}
      </section>
    </>
  );
}
