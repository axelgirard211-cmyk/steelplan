import { useMemo, useState } from 'react';
import {
  boulonnerieToCsv,
  buildBom,
  chiffrageToCsv,
  colisageToCsv,
  debitToCsv,
  souduresToCsv,
  tolesToCsv,
  totauxToCsv,
} from '../../core/bom/index';
import { colisage, masseALivrer } from '../../core/bom/colisage';
import { valoriser } from '../../core/bom/valorisation';
import { archiveDstv, archiveDxfToles, lotDstvDuModele } from '../fichiersMachine';
import { SAISIE_INVALIDE, useEtatModele, useProjetEffectif, useStructuralModel } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { ChiffrageFiche } from './ChiffrageFiche';
import { kg, mm, num } from '../format';

type Onglet =
  | 'debit'
  | 'toles'
  | 'boulons'
  | 'soudures'
  | 'colisage'
  | 'chiffrage'
  | 'synthese';

const TITRES: Record<Onglet, string> = {
  debit: 'Liste de débit',
  toles: 'Tôles d’assemblage',
  boulons: 'Boulonnerie',
  soudures: 'Soudures',
  colisage: 'Colisage',
  chiffrage: 'Chiffrage',
  synthese: 'Synthèse',
};

/**
 * Consultation et export des nomenclatures.
 *
 * Comme les plans, elles sont recalculées depuis le modèle : il n'y a rien à
 * régénérer. Les mêmes chiffres alimentent l'écran, les planches du dossier PDF
 * et les fichiers CSV.
 */
export function NomenclaturesPanel(): JSX.Element {
  const project = useProjetEffectif();
  const model = useStructuralModel();
  // Saisie invalide : on consulte le dernier état valide, on ne l'exporte pas.
  const { aJour } = useEtatModele();
  const bom = useMemo(() => buildBom(project, model), [project, model]);
  const col = useMemo(() => colisage(model), [model]);
  // Les prix de la saisie, même quand le modèle affiché est le dernier valide :
  // une grille corrigée doit se voir tout de suite.
  const prix = useProjectStore((s) => s.project.prix);
  const val = useMemo(() => valoriser(bom, project.finition, prix), [bom, project.finition, prix]);
  const [onglet, setOnglet] = useState<Onglet>('debit');

  const compte: Record<Onglet, number> = {
    debit: bom.debit.length,
    toles: bom.toles.length,
    boulons: bom.bolts.length,
    soudures: bom.welds.length,
    colisage: col.colis.length,
    chiffrage: 0,
    synthese: 0,
  };

  const projet = (project.meta.nom || 'projet').replace(/[^\w-]+/g, '-');

  const enregistrer = (blob: Blob, nom: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exporter = (): void => {
    const contenus: Record<Onglet, () => string> = {
      debit: () => debitToCsv(bom.debit),
      toles: () => tolesToCsv(bom.toles),
      boulons: () => boulonnerieToCsv(bom.bolts),
      soudures: () => souduresToCsv(bom.welds),
      colisage: () => colisageToCsv(col),
      chiffrage: () => chiffrageToCsv(val),
      synthese: () => totauxToCsv(bom.totals),
    };
    enregistrer(
      new Blob([contenus[onglet]()], { type: 'text/csv;charset=utf-8' }),
      `${projet}-${onglet}.csv`,
    );
  };

  /*
   * ⚠ Le lot DSTV part en ARCHIVE, pas en fichier unique : la commande numérique
   * lit un fichier par pièce. Les concaténer donnerait un texte qu'aucune
   * machine ne sait découper.
   */
  const lot = useMemo(() => lotDstvDuModele(model, project.meta), [model, project.meta]);
  const exporterDstv = (): void => {
    const a = archiveDstv(lot, projet);
    enregistrer(a.blob, a.nom);
  };
  const exporterDxf = (): void => {
    const a = archiveDxfToles(model, projet);
    enregistrer(a.blob, a.nom);
  };

  return (
    <>
      <nav className="laterale">
        <ul className="familles">
          {(Object.keys(TITRES) as Onglet[]).map((k) => (
            <li key={k}>
              <button type="button" aria-current={k === onglet} onClick={() => setOnglet(k)}>
                <span>{TITRES[k]}</span>
                {compte[k] > 0 && <span className="compte">{compte[k]}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="principal">
        <div className="barre-outils">
          <span className="compte">
            {bom.totals.pieceCount} pièces · {bom.totals.markCount} repères ·{' '}
            {num(bom.totals.massTotal, 0)} kg à livrer · {num(bom.totals.kgPerM2, 1)} kg/m²
          </span>
          <span className="separateur" />
          <button type="button" className="plat" onClick={exporter} disabled={!aJour} title={aJour ? undefined : SAISIE_INVALIDE}>
            Exporter en CSV
          </button>
          <button
            type="button"
            className="plat"
            onClick={exporterDstv}
            disabled={lot.fichiers.length === 0 || !aJour}
            title={!aJour ? SAISIE_INVALIDE : `${lot.fichiers.length} fichiers NC1 pour perceuse-scie à commande numérique`}
          >
            Lot DSTV ({lot.fichiers.length})
          </button>
          <button
            type="button"
            className="plat"
            onClick={exporterDxf}
            disabled={model.plates.length === 0 || !aJour}
            title={!aJour ? SAISIE_INVALIDE : "Un fichier DXF de découpe par repère de tôle, pour table d’oxycoupage ou plasma"}
          >
            Lot DXF tôles
          </button>
        </div>

        {onglet === 'debit' && (
          <Table
            entetes={['Rep.', 'Désignation', 'Profil', 'Nuance', 'Qté', 'Long.', 'Maxi', 'Coupes', 'Perç.', 'Grug.', 'kg/u', 'kg total']}
            lignes={bom.debit.map((l) => [
              l.mark,
              l.designation,
              l.profileId,
              l.grade,
              String(l.quantity),
              mm(l.length),
              mm(l.lengthMax),
              `${num(l.angleStart, 1)} / ${num(l.angleEnd, 1)}`,
              l.holes > 0 ? String(l.holes) : '—',
              l.notches > 0 ? String(l.notches) : '—',
              kg(l.massUnit),
              kg(l.massTotal),
            ])}
            total={['', '', '', '', '', '', '', '', '', '', '', kg(bom.totals.massMembers)]}
          />
        )}

        {onglet === 'toles' && (
          <Table
            entetes={['Rep.', 'Désignation', 'Nuance', 'Dimensions', 'Perçages', 'Qté', 'kg/u', 'kg total']}
            lignes={bom.toles.map((l) => [
              l.mark,
              l.designation,
              l.grade,
              `${mm(l.width)} × ${mm(l.height)} × ${num(l.thickness, 0)}`,
              l.holes > 0 ? `${l.holes} × Ø${num(l.holeDiameter, 0)}` : '—',
              String(l.quantity),
              num(l.massUnit, 2),
              kg(l.massTotal),
            ])}
            total={['', '', '', '', '', '', '', kg(bom.totals.massPlates)]}
          />
        )}

        {onglet === 'boulons' && (
          <Table
            entetes={['Désignation', 'Classe', 'Serrage', 'Qté', 'Emploi', 'kg/u', 'kg total']}
            lignes={bom.bolts.map((l) => [
              l.designation,
              l.cls,
              `${num(l.grip, 1)} mm`,
              String(l.count),
              l.usage,
              num(l.massUnit, 3),
              kg(l.massTotal),
            ])}
            total={['', '', '', String(bom.totals.boltCount), '', '', kg(bom.totals.massBolts)]}
          />
        )}

        {onglet === 'soudures' && (
          <Table
            entetes={['Désignation', 'Cordons', 'Longueur (m)', 'Emploi']}
            lignes={bom.welds.map((l) => [l.designation, String(l.count), num(l.metres, 2), l.note])}
            total={['', '', num(bom.totals.weldMetres, 1), '']}
          />
        )}

        {onglet === 'colisage' && (
          <>
            <Table
              entetes={['Colis', 'Phase de montage', 'Repères', 'Pièces', 'Long. maxi', 'Pièce la + lourde', 'Masse']}
              lignes={col.colis.map((c) => [
                String(c.numero),
                c.phase,
                c.lignes.map((l) => l.mark).join(', '),
                String(c.lignes.reduce((s, l) => s + l.nombre, 0)),
                mm(c.longueurMax),
                `${kg(c.masseUnitaireMax)} kg`,
                `${kg(c.masse)} kg`,
              ])}
              total={['', '', '', '', '', '', `${kg(col.masseTotale)} kg`]}
            />
            {col.horsGabarit.length > 0 && (
              <p className="note alerte">
                <strong>Hors gabarit — à transporter à part :</strong>{' '}
                {col.horsGabarit
                  .map((h) => `${h.mark} (${mm(h.longueur)}, ${kg(h.masse)} kg)`)
                  .join(' · ')}
                . Le {col.transport.libelle.toLowerCase()} ne les reçoit pas : convoi
                exceptionnel, ou éclissage à prévoir au bureau d’études.
              </p>
            )}
            <p className="note">
              {col.transport.libelle} — {mm(col.transport.longueurUtile)} utiles,{' '}
              {num(col.transport.chargeUtile / 1000, 1)} t de charge.{' '}
              <strong>Acier de charpente {kg(masseALivrer(col))} kg</strong>, hors gabarit
              compris. La boulonnerie ({kg(bom.totals.massBolts)} kg) voyage en caisses et
              n’entre dans aucun colis : le camion emporte {kg(bom.totals.massTotal)} kg, chiffre
              repris en synthèse. Les colis suivent l’ordre de montage : un camion qui arrive
              avec les pannes avant les poteaux fait attendre la grue.
            </p>
          </>
        )}

        {onglet === 'chiffrage' && (
          <>
            <Table
              entetes={['Poste', 'Quantité', 'Unité', 'Prix unitaire', 'Montant']}
              lignes={val.lignes.flatMap((l, i) => [
                // Le déboursé sec s'affiche avant le premier pourcentage, qui le prend pour base.
                ...(l.taux && !val.lignes[i - 1]?.taux ? [['Déboursé sec', '', '', '', `${num(val.deboursSec, 0)} €`]] : []),
                [
                  l.poste,
                  num(l.quantite, l.unite === 'kg' || l.taux ? 0 : 1),
                  l.unite,
                  l.taux ? `${num(l.prixUnitaire, 1)} %` : `${num(l.prixUnitaire, 2)} €`,
                  `${num(l.montant, 0)} €`,
                ],
              ])}
              total={['Total HT', '', '', '', `${num(val.total, 0)} €`]}
            />
            <p className="note">
              Soit <strong>{num(val.parKg, 2)} €/kg</strong> sur {kg(val.masseKg)} kg d’acier.
            </p>
            {val.nonChiffres.length > 0 ? (
              <p className="note alerte">
                <strong>Ce n’est pas un devis.</strong> Non chiffrés : {val.nonChiffres.join(', ')}. Renseignez-les
                dans la grille ci-dessous pour obtenir un prix de vente ; les prix par défaut sont indicatifs et
                doivent être remplacés par ceux de l’entreprise avant tout engagement.
              </p>
            ) : (
              <p className="note">
                Prix de vente établi avec la grille du projet : fourniture, atelier, traitement, transport, montage,
                frais généraux, aléas et marge. À contrôler avant tout engagement.
              </p>
            )}
            <ChiffrageFiche />
          </>
        )}

        {onglet === 'synthese' && <Synthese bom={bom} />}

        {lot.ecartes.length > 0 && onglet === 'debit' && (
          <p className="note alerte">
            <strong>Écartés du lot DSTV :</strong>{' '}
            {lot.ecartes.map((e) => `${e.mark} — ${e.raison}`).join(' · ')}. Ces repères sont à
            débiter d’après les plans.
          </p>
        )}

        <p className="note">
          Aucune valeur n’est recalculée ici : longueurs, angles et masses sont relus du modèle, qui
          les tient des mêmes fonctions que les plans de débit. Le CSV est au format français —
          séparateur point-virgule et virgule décimale — pour s’ouvrir directement dans un tableur.
        </p>
      </section>
    </>
  );
}

function Table({
  entetes,
  lignes,
  total,
}: {
  entetes: readonly string[];
  lignes: readonly (readonly string[])[];
  total?: readonly string[];
}): JSX.Element {
  return (
    <div className="tableau-enveloppe">
      <table className="profils">
        <thead>
          <tr>
            {entetes.map((e, i) => (
              <th key={i} className={i === 0 ? 'designation' : undefined}>
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              {l.map((v, j) => (
                <td key={j} className={j === 0 ? 'designation' : undefined}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="total">
              {total.map((v, j) => (
                <td key={j} className={j === 0 ? 'designation' : undefined}>
                  <strong>{v}</strong>
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Synthese({ bom }: { bom: ReturnType<typeof buildBom> }): JSX.Element {
  const t = bom.totals;
  const blocs: [string, [string, string][]][] = [
    [
      'Masses',
      [
        ['Barres', `${kg(t.massMembers)} kg`],
        ['Tôles d’assemblage', `${kg(t.massPlates)} kg`],
        ['Acier de charpente', `${kg(t.massSteel)} kg`],
        ['Boulonnerie', `${kg(t.massBolts)} kg`],
        ['Total à livrer', `${kg(t.massTotal)} kg`],
        ...Object.entries(t.massByGrade).map(
          ([n, m]) => [`dont ${n}`, `${kg(m ?? 0)} kg`] as [string, string],
        ),
      ],
    ],
    [
      'Quantités',
      [
        ['Pièces', String(t.pieceCount)],
        ['Repères distincts', String(t.markCount)],
        ['Boulons', String(t.boltCount)],
        ['Cordons de soudure', `${num(t.weldMetres, 1)} m`],
        ['Métal d’apport', `${num(t.weldMassKg, 2)} kg`],
      ],
    ],
    [
      'Surfaces',
      [
        ['Emprise au sol', `${num(t.footprintM2, 1)} m²`],
        ['Toiture développée', `${num(t.roofM2, 1)} m²`],
        ['À peindre ou galvaniser', `${num(t.paintM2, 1)} m²`],
        ['Ratio de charpente', `${num(t.kgPerM2, 1)} kg/m²`],
      ],
    ],
  ];

  return (
    <div className="grille-fiches">
      {blocs.map(([titre, valeurs]) => (
        <div className="fiche" key={titre}>
          <h3>{titre}</h3>
          <dl className="paires">
            {valeurs.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd className="derive">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
