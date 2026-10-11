import { useState } from 'react';
import { lireGrilleEntreprise, memoriserGrilleEntreprise } from '../../core/io/grilleEntreprise';
import { GRILLE_PAR_DEFAUT, type GrillePrix } from '../../core/model/prix';
import { useProjectStore } from '../../state/store';
import { ChampNombre } from '../champs';

/**
 * CHIFFRAGE — la grille de prix du projet.
 *
 * Elle s'enregistre avec le projet ; « Mémoriser comme grille de l'entreprise »
 * en fait la grille que reprendra chaque nouveau projet sur ce poste. Le total
 * se recalcule à chaque saisie, dans l'onglet Nomenclatures.
 */

type Numerique = Exclude<keyof GrillePrix, 'acier'>;

const CHAMPS: readonly { readonly cle: Numerique; readonly libelle: string; readonly unite: string; readonly pas: number }[] = [
  { cle: 'boulon', libelle: 'Boulon posé', unite: '€', pas: 0.1 },
  { cle: 'heureAtelier', libelle: 'Heure d’atelier', unite: '€/h', pas: 1 },
  { cle: 'heureParPiece', libelle: 'Temps par pièce', unite: 'h', pas: 0.05 },
  { cle: 'cadenceSoudure', libelle: 'Cadence de soudure', unite: 'm/h', pas: 0.5 },
  { cle: 'peinture', libelle: 'Peinture', unite: '€/m²', pas: 0.5 },
  { cle: 'galvanisation', libelle: 'Galvanisation', unite: '€/m²', pas: 0.5 },
  { cle: 'transport', libelle: 'Transport', unite: '€/t', pas: 5 },
  { cle: 'montage', libelle: 'Montage et levage', unite: '€/t', pas: 10 },
  { cle: 'fraisGeneraux', libelle: 'Frais généraux', unite: '%', pas: 1 },
  { cle: 'aleas', libelle: 'Aléas', unite: '%', pas: 1 },
  { cle: 'marge', libelle: 'Marge', unite: '%', pas: 1 },
];

export function ChiffrageFiche(): JSX.Element {
  const prix = useProjectStore((s) => s.project.prix);
  const edit = useProjectStore((s) => s.edit);
  const [message, setMessage] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState(() => lireGrilleEntreprise());

  const remplacer = (libelle: string, g: GrillePrix): void =>
    edit(libelle, (d) => {
      d.prix = g;
    });
  const dire = (t: string): void => {
    setMessage(t);
    setTimeout(() => setMessage(null), 3500);
  };

  return (
    <div className="fiche">
      <h3>Chiffrage</h3>
      <dl className="paires">
        {Object.keys(GRILLE_PAR_DEFAUT.acier).map((nuance) => (
          <Ligne key={nuance} libelle={`Acier ${nuance}`}>
            <ChampNombre
              valeur={prix.acier[nuance] ?? 0}
              pas={0.05}
              min={0}
              unite="€/kg"
              onChange={(v) => edit(`Prix de l’acier ${nuance}`, (d) => void (d.prix.acier = { ...d.prix.acier, [nuance]: v }))}
            />
          </Ligne>
        ))}
        {CHAMPS.map((c) => (
          <Ligne key={c.cle} libelle={c.libelle}>
            <ChampNombre
              valeur={prix[c.cle]}
              pas={c.pas}
              min={0}
              {...(c.unite === '%' ? { max: 100 } : {})}
              unite={c.unite}
              onChange={(v) => edit(`Grille de prix — ${c.libelle.toLowerCase()}`, (d) => void (d.prix[c.cle] = v))}
            />
          </Ligne>
        ))}
      </dl>
      <div className="barre-outils">
        <button
          type="button"
          className="plat"
          onClick={() => {
            if (memoriserGrilleEntreprise(prix)) {
              setEntreprise(prix);
              dire('Grille mémorisée : les nouveaux projets la reprendront.');
            } else dire('Mémorisation impossible : le stockage de ce navigateur est indisponible.');
          }}
          title="Les nouveaux projets créés sur ce poste reprendront cette grille."
        >
          Mémoriser comme grille de l’entreprise
        </button>
        <button
          type="button"
          className="plat"
          disabled={!entreprise}
          onClick={() => entreprise && remplacer('Grille de l’entreprise', entreprise)}
        >
          Reprendre la grille de l’entreprise
        </button>
        <button type="button" className="plat" onClick={() => remplacer('Prix par défaut', GRILLE_PAR_DEFAUT)}>
          Prix par défaut
        </button>
      </div>
      <p className="note">
        {message ??
          'À zéro, transport, montage, frais généraux, aléas et marge restent hors du total, et le chiffrage le dit.'}
      </p>
    </div>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <dt>{libelle}</dt>
      <dd>{children}</dd>
    </>
  );
}
