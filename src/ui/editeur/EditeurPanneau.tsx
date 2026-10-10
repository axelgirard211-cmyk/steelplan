import type { ElementEditable, EntiteDessin } from '../../core/drawing/retouches';
import type { Layer } from '../../core/drawing/scene';
import { ChampChoix, ChampNombre, ChampTexte } from '../champs';
import { num } from '../format';
import { ALIAS, LIBELLE_COMMANDE, type NomCommande } from './commandes';

/**
 * PROPRIÉTÉS — ce qu'on règle sans passer par la ligne de commande : calque et
 * hauteur des nouveaux tracés, calque et contenu de la sélection, et l'état des
 * retouches de la planche.
 */

export const CALQUES: readonly (readonly [Layer, string])[] = [
  ['contour', 'Contour (0,5)'],
  ['contour-fin', 'Contour fin (0,25)'],
  ['cachee', 'Cachée (tirets)'],
  ['axe', 'Axe (mixte)'],
  ['cotation', 'Cotation (0,18)'],
  ['texte', 'Texte'],
  ['reperage', 'Repérage (0,35)'],
  ['cartouche', 'Cartouche'],
];

const LIBELLE_CALQUE: Readonly<Partial<Record<Layer, string>>> = {
  ...Object.fromEntries(CALQUES),
  hachure: 'Hachures',
  cadre: 'Cadre',
};

const NATURE: Readonly<Record<EntiteDessin['kind'], string>> = {
  ligne: 'ligne',
  polyligne: 'polyligne',
  cercle: 'cercle',
  arc: 'arc',
  texte: 'texte',
  hachure: 'hachure',
  remplissage: 'remplissage',
  cote: 'cote',
};

export interface BilanRetouches {
  readonly ajouts: number;
  readonly masques: number;
  readonly aRevoir: number;
  readonly masquesCaducs: number;
}

export function EditeurPanneau({
  selection,
  calque,
  setCalque,
  hauteurTexte,
  setHauteurTexte,
  modifier,
  bilan,
  valider,
  reinitialiser,
  calquesPlanche,
  calquesMasques,
  basculerCalque,
}: {
  selection: readonly ElementEditable[];
  calque: Layer;
  setCalque: (l: Layer) => void;
  hauteurTexte: number;
  setHauteurTexte: (h: number) => void;
  modifier: (libelle: string, f: (e: EntiteDessin) => EntiteDessin) => void;
  bilan: BilanRetouches;
  valider: () => void;
  reinitialiser: () => void;
  /** Calques présents sur la planche, et leur nombre d'objets. */
  calquesPlanche: readonly (readonly [Layer, number])[];
  calquesMasques: ReadonlySet<Layer>;
  basculerCalque: (l: Layer) => void;
}): JSX.Element {
  const seul = selection.length === 1 ? selection[0]?.source : undefined;
  const calques = [...new Set(selection.map((el) => el.source.layer))];
  const natures = [...new Set(selection.map((el) => NATURE[el.source.kind]))];

  return (
    <aside className="editeur-panneau">
      <div className="fiche">
        <h3>Nouveaux tracés</h3>
        <dl className="paires">
          <dt>Calque courant</dt>
          <dd>
            <ChampChoix<Layer> valeur={calque} options={CALQUES} onChange={setCalque} />
          </dd>
          <dt>Hauteur de texte</dt>
          <dd>
            <ChampNombre valeur={hauteurTexte} pas={0.5} min={1} unite="mm" largeur={60} onChange={(v) => v > 0 && setHauteurTexte(v)} />
          </dd>
        </dl>
      </div>

      <div className="fiche">
        <h3>Calques affichés</h3>
        <ul className="calques-affiches">
          {calquesPlanche.map(([l, n]) => (
            <li key={l}>
              <label className="etiquette">
                <input type="checkbox" checked={!calquesMasques.has(l)} onChange={() => basculerCalque(l)} /> {LIBELLE_CALQUE[l] ?? l}
                <span className="compte"> {n}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="note" style={{ margin: '6px 0 0' }}>
          Un calque masqué ne se voit ni ne se sélectionne pendant l’édition ; il reste sur le plan imprimé.
        </p>
      </div>

      <div className="fiche">
        <h3>Sélection</h3>
        {selection.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            Cliquez un objet, ou tirez une fenêtre : vers la droite, les objets entièrement dedans ; vers la gauche, tous ceux qu’elle touche. Maj + clic retire de la sélection.
          </p>
        ) : (
          <dl className="paires">
            <dt>Objets</dt>
            <dd>
              {selection.length} — {natures.join(', ')}
            </dd>
            <dt>Calque</dt>
            <dd>
              <ChampChoix<Layer>
                valeur={calques.length === 1 ? (calques[0] as Layer) : ('' as Layer)}
                options={calques.length === 1 ? CALQUES : [['' as Layer, '(plusieurs)'], ...CALQUES]}
                onChange={(l) =>
                  modifier('Calque', (e) => (e.kind === 'hachure' || e.kind === 'cote' || !l ? e : { ...e, layer: l }))
                }
              />
            </dd>
            {seul?.kind === 'texte' && (
              <>
                <dt>Texte</dt>
                <dd>
                  <ChampTexte valeur={seul.texte} largeur="100%" onChange={(v) => v !== '' && modifier('Texte', (e) => (e.kind === 'texte' ? { ...e, texte: v } : e))} />
                </dd>
                <dt>Hauteur</dt>
                <dd>
                  <ChampNombre
                    valeur={seul.hauteur}
                    pas={0.5}
                    min={0.5}
                    unite="mm"
                    largeur={60}
                    onChange={(v) => v > 0 && modifier('Hauteur de texte', (e) => (e.kind === 'texte' ? { ...e, hauteur: v } : e))}
                  />
                </dd>
              </>
            )}
            {seul?.kind === 'cote' && (
              <>
                <dt>Texte imposé</dt>
                <dd>
                  <ChampTexte valeur={seul.texte} placeholder="longueur réelle" largeur="100%" onChange={(v) => modifier('Texte de cote', (e) => (e.kind === 'cote' ? { ...e, texte: v } : e))} />
                </dd>
              </>
            )}
          </dl>
        )}
      </div>

      <div className="fiche">
        <h3>Retouches de la planche</h3>
        <dl className="paires">
          <dt>Ajouts et modifications</dt>
          <dd>{num(bilan.ajouts, 0)}</dd>
          <dt>Effacements</dt>
          <dd>{num(bilan.masques, 0)}</dd>
        </dl>
        {/* ⚠ Le modèle a changé sous ces retouches : elles sont gardées, et signalées. */}
        {(bilan.aRevoir > 0 || bilan.masquesCaducs > 0) && (
          <ul className="anomalies" style={{ marginTop: 8 }}>
            <li className="avertissement">
              Le plan a été régénéré depuis : {bilan.aRevoir > 0 ? `${bilan.aRevoir} retouche(s) portent sur des objets qui ont changé (en orange)` : ''}
              {bilan.aRevoir > 0 && bilan.masquesCaducs > 0 ? ' ; ' : ''}
              {bilan.masquesCaducs > 0 ? `${bilan.masquesCaducs} effacement(s) ne trouvent plus leur objet` : ''}.
              <button type="button" className="plat" style={{ display: 'block', marginTop: 6 }} onClick={valider}>
                Marquer comme vérifiées
              </button>
            </li>
          </ul>
        )}
        {(bilan.ajouts > 0 || bilan.masques > 0) && (
          <button type="button" className="plat" style={{ marginTop: 8 }} onClick={reinitialiser}>
            Revenir à la planche générée
          </button>
        )}
        <p className="note" style={{ margin: '8px 0 0' }}>
          Les retouches sont enregistrées avec le projet et reprises par les exports PDF et DXF. Elles survivent aux modifications du modèle. Ctrl+Z les annule une à une.
        </p>
      </div>

      <div className="fiche">
        <h3>Commandes</h3>
        <table className="legende">
          <tbody>
            {(Object.keys(LIBELLE_COMMANDE) as NomCommande[]).map((c) => (
              <tr key={c}>
                <td className="nom">{LIBELLE_COMMANDE[c]}</td>
                <td className="nombre">
                  {Object.entries(ALIAS)
                    .filter(([alias, n]) => n === c && alias.length <= 3)
                    .map(([alias]) => alias)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note" style={{ margin: '8px 0 0' }}>
          Valeurs en mm réels, ramenées à l’échelle de la planche : <code>@500,200</code> relatif, <code>@1000&lt;45</code> polaire, <code>1000</code> dans la direction du pointeur. Entrée ou Espace valide, Échap annule, Entrée seule relance la dernière commande. F3 accrochage, F8 ortho, Suppr efface la sélection.
        </p>
      </div>
    </aside>
  );
}
