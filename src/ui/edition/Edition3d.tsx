import { useEffect, useMemo, useRef, useState } from 'react';
import type { SteelGradeId } from '../../core/catalog/types';
import type { Vec3 } from '../../core/math/vec3';
import { prochainId } from '../../core/model/freeMembers';
import { Pointage, type PointCible } from '../../render3d/pointage';
import { SteelScene, type StandardView } from '../../render3d/scene';
import { useStructuralModel } from '../../state/derived';
import { useProjectStore } from '../../state/store';
import { ChampNombre, ChampNuance, ChampProfil } from '../champs';
import { mm } from '../format';
import { FichePiece3d } from './FichePiece3d';
import { VoirEn2d } from './VoirEn2d';
import { LIBELLE_TOLE } from '../../core/build/types';

/**
 * ÉDITION DU MODÈLE EN 3D.
 *
 * Deux outils, comme dans un modeleur de charpente :
 *  - SÉLECTIONNER une pièce pour la lire et la modifier — le profil d'une pièce
 *    générée vaut pour tout son poste, une barre ajoutée se règle entièrement ;
 *  - AJOUTER UNE BARRE entre deux points du modèle, accrochés aux extrémités
 *    et aux milieux des barres existantes, ou tapés au clavier. Les barres se
 *    chaînent : la suivante part de la fin de la précédente, jusqu'à Échap.
 *
 * Les barres ajoutées sont des barres libres du projet : elles entrent dans les
 * plans, la nomenclature et le poids, comme toutes les autres.
 */

type Outil = 'selection' | 'barre';

const VUES: readonly (readonly [StandardView, string])[] = [
  ['iso', 'Isométrique'],
  ['face', 'Face'],
  ['arriere', 'Arrière'],
  ['cote', 'Côté'],
  ['dessus', 'Dessus'],
];

const coordDe = (v: Vec3): string => `${mm(v.x)} / ${mm(v.y)} / ${mm(v.z)} mm`;

export function Edition3d(): JSX.Element {
  const model = useStructuralModel();
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  const conteneur = useRef<HTMLDivElement>(null);
  const scene = useRef<SteelScene | null>(null);
  const pointage = useRef<Pointage | null>(null);

  const [outil, setOutil] = useState<Outil>('selection');
  const [selection, setSelection] = useState<string | null>(null);
  const [premier, setPremier] = useState<Vec3 | null>(null);
  const [survol, setSurvol] = useState<PointCible | null>(null);
  const [profil, setProfil] = useState('IPE 200');
  const [nuance, setNuance] = useState<SteelGradeId>('S235');
  const [saisie, setSaisie] = useState({ ax: 0, ay: 0, az: 0, bx: 6000, by: 0, bz: 0 });

  // Rappels relus à chaque appel : la scène les garde, l'état de React change.
  const outilRef = useRef(outil);
  outilRef.current = outil;
  const surPoint = useRef<(c: PointCible) => void>(() => undefined);

  const creer = (a: Vec3, b: Vec3): void => {
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1) return;
    edit('Ajouter une barre (3D)', (d) => {
      d.freeMembers.push({ id: prochainId(d.freeMembers), profile: profil, grade: nuance, start: a, end: b, rotation: 0, label: '' });
    });
  };

  surPoint.current = (c: PointCible): void => {
    if (!premier) {
      setPremier(c.p);
      return;
    }
    creer(premier, c.p);
    // Chaînage : la barre suivante part de la fin de celle-ci.
    setPremier(c.p);
  };

  useEffect(() => {
    if (!conteneur.current) return undefined;
    const s = new SteelScene(conteneur.current, {
      onSelect: (id) => {
        if (outilRef.current === 'selection') setSelection(id);
      },
      onMeasure: () => undefined,
      onHover: () => undefined,
    });
    scene.current = s;
    // La scène ne dessine qu'à la demande : le marqueur et l'élastique du pointage
    // bougent sans elle, il faut donc redemander une image à chaque survol.
    const p = new Pointage(s, {
      onSurvol: (c) => {
        setSurvol(c);
        s.demanderRendu();
      },
      onPoint: (c) => surPoint.current(c),
    });
    pointage.current = p;
    return () => {
      p.dispose();
      s.dispose();
      scene.current = null;
      pointage.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setModel(model);
    scene.current?.setSelected(selection);
    pointage.current?.setCibles(model.members);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => scene.current?.setSelected(selection), [selection]);
  useEffect(() => {
    pointage.current?.setActif(outil === 'barre', premier);
    scene.current?.demanderRendu();
  }, [outil, premier]);

  const choisir = (o: Outil): void => {
    setOutil(o);
    setPremier(null);
    if (o === 'barre') setSelection(null);
  };

  // Échap : on lâche le premier point, puis on revient à la sélection.
  useEffect(() => {
    const touche = (e: KeyboardEvent): void => {
      const cible = e.target as { tagName?: string };
      if (cible?.tagName === 'INPUT' || cible?.tagName === 'SELECT' || cible?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (premier) setPremier(null);
        else if (outil === 'barre') setOutil('selection');
        else setSelection(null);
      }
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [premier, outil]);

  const membres = useMemo(() => new Map(model.members.map((m) => [m.id, m])), [model]);
  const choisi = selection ? membres.get(selection) : undefined;
  // Tôles et jarrets se sélectionnent aussi : on les lit, et on ouvre leurs planches.
  const tole = selection && !choisi ? model.plates.find((p) => p.id === selection) : undefined;
  const jarret = selection && !choisi && !tole ? model.haunches.find((h) => h.id === selection) : undefined;
  const ajoutees = project.freeMembers.length;

  const champ = (k: keyof typeof saisie): JSX.Element => (
    <span>
      <ChampNombre valeur={saisie[k]} pas={100} unite="mm" largeur={70} onChange={(v) => setSaisie((x) => ({ ...x, [k]: v }))} />
    </span>
  );

  return (
    <div className="edition3d">
      <div className="edition3d-vue">
        <div className="edition3d-outils">
          {VUES.map(([v, l]) => (
            <button key={v} type="button" className="plat" onClick={() => scene.current?.setView(v)}>
              {l}
            </button>
          ))}
          <button type="button" className="plat" onClick={() => scene.current?.recadrer()}>
            Recadrer
          </button>
          <button type="button" className="plat" onClick={() => selection && scene.current?.cadrerSur(selection)} disabled={!selection}>
            Cadrer sur la sélection
          </button>
        </div>
        <div ref={conteneur} className="edition3d-canevas" />
        <div className="edition3d-etat">
          {outil === 'barre'
            ? `${premier ? `Depuis ${coordDe(premier)} — cliquez le point suivant, Échap pour arrêter` : 'Cliquez le premier point (extrémité ou milieu d’une barre)'}${survol ? ` · ${survol.nature === 'milieu' ? 'milieu' : 'extrémité'} ${coordDe(survol.p)}` : ''}`
            : 'Cliquez une pièce pour la modifier · glisser pour tourner · clic droit pour déplacer · molette pour zoomer · double-clic pour cadrer'}
        </div>
      </div>

      <aside className="edition3d-panneau">
        <div className="fiche">
          <h3>Outils</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`plat${outil === 'selection' ? ' actif' : ''}`} onClick={() => choisir('selection')}>
              Sélectionner
            </button>
            <button type="button" className={`plat${outil === 'barre' ? ' actif' : ''}`} onClick={() => choisir('barre')}>
              Ajouter une barre
            </button>
          </div>
          <p className="note" style={{ margin: '8px 0 0' }}>
            {model.stats.memberCount} barres dans le modèle, dont {ajoutees} ajoutée(s) à la main.
          </p>
        </div>

        {outil === 'barre' && (
          <div className="fiche">
            <h3>Nouvelle barre</h3>
            <dl className="paires">
              <dt>Profil</dt>
              <dd>
                <ChampProfil valeur={profil} onChange={setProfil} />
              </dd>
              <dt>Nuance</dt>
              <dd>
                <ChampNuance valeur={nuance} onChange={setNuance} />
              </dd>
            </dl>
            <p className="note" style={{ margin: '8px 0' }}>
              Cliquez deux points dans la vue, ou tapez leurs coordonnées (origine du bâtiment au pied de la première file).
            </p>
            <dl className="paires">
              <dt>Origine X / Y / Z</dt>
              <dd className="coords">
                {champ('ax')} {champ('ay')} {champ('az')}
              </dd>
              <dt>Extrémité X / Y / Z</dt>
              <dd className="coords">
                {champ('bx')} {champ('by')} {champ('bz')}
              </dd>
            </dl>
            <button
              type="button"
              className="primaire"
              style={{ marginTop: 8 }}
              onClick={() => creer({ x: saisie.ax, y: saisie.ay, z: saisie.az }, { x: saisie.bx, y: saisie.by, z: saisie.bz })}
            >
              Créer la barre ({mm(Math.hypot(saisie.bx - saisie.ax, saisie.by - saisie.ay, saisie.bz - saisie.az))} mm)
            </button>
          </div>
        )}

        {outil === 'selection' &&
          (choisi ? (
            <FichePiece3d m={choisi} model={model} onSupprimee={() => setSelection(null)} />
          ) : tole || jarret ? (
            <div className="fiche">
              <h3>
                {tole ? `${tole.mark} — ${LIBELLE_TOLE[tole.kind]}` : `${jarret?.mark} — jarret`}
              </h3>
              <dl className="paires">
                <dt>Position</dt>
                <dd>{tole ? tole.position : 'sous la traverse, au genou'}</dd>
                {tole && (
                  <>
                    <dt>Épaisseur</dt>
                    <dd>{tole.thickness} mm</dd>
                  </>
                )}
              </dl>
              <p className="note" style={{ margin: '8px 0 0' }}>
                Pièce d’assemblage : elle se règle dans l’onglet Projet, rubrique Assemblages.
              </p>
              <VoirEn2d debit={tole?.mark ?? jarret?.mark ?? ''} assemblage="" />
            </div>
          ) : (
            <div className="fiche">
              <h3>Sélection</h3>
              <p className="note" style={{ margin: 0 }}>
                Cliquez une pièce. Le profil d’une pièce générée se change pour tout son poste ; une barre ajoutée se modifie, se duplique ou se supprime.
              </p>
            </div>
          ))}
      </aside>
    </div>
  );
}
