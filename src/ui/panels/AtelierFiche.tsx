import { useMemo } from 'react';
import { calepiner, tauxDeChute } from '../../core/bom/calepinage';
import { imbriquer } from '../../core/bom/imbrication';
import { CLASSES_EXECUTION, type ClasseExecution } from '../../core/model/atelier';
import { useStructuralModel } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { ChampChoix, ChampNombre } from '../champs';
import { num } from '../format';

/**
 * ATELIER — ce que le bureau d'études sait de l'atelier qui fabriquera.
 *
 * Ces réglages ne changent pas la structure : ils décident de la COMMANDE
 * (barres et tôles du commerce, trait de scie, tombées) et des CONTRÔLES
 * (classe d'exécution). Le bilan affiché dessous se recalcule à chaque saisie :
 * c'est ce qui permet de voir qu'une barre de 15 m économise une demi-tonne.
 */
export function AtelierFiche(): JSX.Element {
  const a = useProjectStore((s) => s.project.atelier);
  const edit = useProjectStore((s) => s.edit);
  const model = useStructuralModel();

  const bilan = useMemo(() => {
    const c = calepiner(model, a);
    const t = imbriquer(model, a);
    const commandee = c.reduce((s, x) => s + x.masseCommandee, 0) + t.reduce((s, x) => s + x.masseCommandee, 0);
    const pire = [...c].sort((x, y) => tauxDeChute(y) - tauxDeChute(x))[0];
    return {
      barres: c.reduce((s, x) => s + x.barres, 0),
      toles: t.reduce((s, x) => s + x.toles, 0),
      commandee,
      chute: commandee - model.stats.massKg,
      pire,
    };
  }, [model, a]);

  const champ = (libelle: string, maj: (v: number) => void, valeur: number, unite: string, pas = 1) => (
    <>
      <dt>{libelle}</dt>
      <dd>
        <ChampNombre valeur={valeur} pas={pas} min={0} unite={unite} onChange={maj} />
      </dd>
    </>
  );
  return (
    <div className="fiche">
      <h3>Atelier</h3>
      <dl className="paires">
        <dt>Classe d’exécution</dt>
        <dd>
          <ChampChoix<ClasseExecution>
            valeur={a.classeExecution}
            options={CLASSES_EXECUTION.map((c) => [c, `${c} (EN 1090-2)`] as const)}
            onChange={(v) => edit('Classe d’exécution', (d) => void (d.atelier.classeExecution = v))}
          />
        </dd>
        {champ('Barres laminées — longueur maxi', (v) => edit('Barres laminées', (d) => void (d.atelier.barreLaminee = v)), a.barreLaminee, 'mm', 1000)}
        {champ('Tubes et cornières — longueur maxi', (v) => edit('Barres de tubes', (d) => void (d.atelier.barreTube = v)), a.barreTube, 'mm', 1000)}
        {champ('Trait de scie', (v) => edit('Trait de scie', (d) => void (d.atelier.traitDeScie = v)), a.traitDeScie, 'mm')}
        {champ('Tombée d’about', (v) => edit('Tombée d’about', (d) => void (d.atelier.tombee = v)), a.tombee, 'mm')}
        {champ('Chute réutilisable dès', (v) => edit('Chute réutilisable', (d) => void (d.atelier.chuteReutilisable = v)), a.chuteReutilisable, 'mm', 100)}
        {champ(
          'Chute maxi d’un schéma (au-delà : à longueur)',
          (v) => edit('Chute maximale', (d) => void (d.atelier.chuteMaxi = Math.min(1, Math.max(0.01, v / 100)))),
          Math.round(a.chuteMaxi * 100),
          '%',
          5,
        )}
        {champ('Tôles — longueur', (v) => edit('Format de tôle', (d) => void (d.atelier.toleLongueur = v)), a.toleLongueur, 'mm', 500)}
        {champ('Tôles — largeur', (v) => edit('Format de tôle', (d) => void (d.atelier.toleLargeur = v)), a.toleLargeur, 'mm', 500)}
        {champ('Jeu de découpe', (v) => edit('Jeu de découpe', (d) => void (d.atelier.jeuDecoupe = v)), a.jeuDecoupe, 'mm')}
        <dt>Commande</dt>
        <dd className="derive">
          {bilan.barres} barres, {bilan.toles} tôles — {num(bilan.commandee, 0)} kg achetés, dont{' '}
          {num(bilan.chute, 0)} kg de chutes
        </dd>
        {bilan.pire && tauxDeChute(bilan.pire) > 0.25 && (
          <>
            <dt>À surveiller</dt>
            <dd className="derive">
              {bilan.pire.profil} : {num(tauxDeChute(bilan.pire) * 100, 0)} % de chute — commander à longueur ?
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
