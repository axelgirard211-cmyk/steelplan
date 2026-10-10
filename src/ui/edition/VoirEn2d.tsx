import { useMemo, useState } from 'react';
import { planchesDeLaPiece } from '../../core/drawing/planchesDeLaPiece';
import { useNavigation } from '../../state/navigation';
import { useDossier } from '../useDossier';
import '../theme/edition.css';

/**
 * « VOIR EN 2D » — les planches où figure la pièce sélectionnée en 3D.
 *
 * Un clic ouvre la planche dans la page d'édition, cadrée sur la pièce et ses
 * repères sélectionnés : on passe du modèle au plan sans chercher la planche.
 */

const VISIBLES = 6;

export function VoirEn2d({ debit, assemblage }: { debit: string; assemblage: string }): JSX.Element | null {
  const { dossier, index } = useDossier();
  const voirEn2d = useNavigation((s) => s.voirEn2d);
  const [tout, setTout] = useState(false);
  const planches = useMemo(() => planchesDeLaPiece(dossier, index, { debit, assemblage }), [dossier, index, debit, assemblage]);

  if (debit === '' && assemblage === '') return null;
  const affichees = tout ? planches : planches.slice(0, VISIBLES);
  return (
    <div className="voir-en-2d">
      <h3 style={{ marginTop: 14 }}>Voir en 2D</h3>
      {planches.length === 0 ? (
        <p className="note" style={{ margin: 0 }}>
          Cette pièce ne figure encore sur aucune planche.
        </p>
      ) : (
        <ul className="liste-planches">
          {affichees.map((p) => (
            <li key={p.sheet.id}>
              <button type="button" className="plat" onClick={() => voirEn2d(p.sheet.id, p.reperes)} title={`Ouvrir « ${p.sheet.titre} » cadrée sur ${p.reperes.join(', ')}`}>
                {p.sheet.titre}
              </button>
            </li>
          ))}
        </ul>
      )}
      {planches.length > VISIBLES && !tout && (
        <button type="button" className="plat" style={{ marginTop: 4 }} onClick={() => setTout(true)}>
          + {planches.length - VISIBLES} autre(s) planche(s)
        </button>
      )}
    </div>
  );
}
