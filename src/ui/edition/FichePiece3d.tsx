import { castDraft } from 'immer';
import type { SteelGradeId } from '../../core/catalog/types';
import type { StructuralModel } from '../../core/build/types';
import { postesActifs } from '../../core/checks/postes';
import type { Member } from '../../core/geometry/member';
import { decalageParDefaut, dupliquerEnSerie, longueurLibre } from '../../core/model/freeMembers';
import type { FreeMember, ProjectParams } from '../../core/model/project';
import { ROLE_LABELS } from '../../render3d/colorMaps';
import { useProjectStore } from '../../state/store';
import { ChampNombre, ChampNuance, ChampProfil, ChampTexte } from '../champs';
import { mm, num } from '../format';

/**
 * FICHE DE LA PIÈCE SÉLECTIONNÉE, dans la page d'édition 3D.
 *
 * ⚠ Une pièce GÉNÉRÉE ne se modifie pas seule : son profil est celui de son
 * poste — tous les poteaux, toutes les pannes. Changer un poteau à part
 * laisserait ses platines, ses perçages, ses assemblages et son calcul taillés
 * pour l'ancien profil. Le choix se fait donc pour le poste entier, et la fiche
 * dit combien de pièces il touche. Une barre AJOUTÉE, elle, se modifie
 * entièrement : c'est la vôtre.
 */

/** Écrit dans le brouillon les seules branches que `suivant` a changées. */
function appliquerProjet(d: ProjectParams, avant: ProjectParams, suivant: ProjectParams): void {
  const brouillon = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(suivant) as (keyof ProjectParams)[]) {
    if (suivant[k] !== avant[k]) brouillon[k] = castDraft(suivant[k]);
  }
}

export function FichePiece3d({ m, model, onSupprimee }: { m: Member; model: StructuralModel; onSupprimee: () => void }): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const libre = m.role === 'libre' ? project.freeMembers.find((f) => `LIBRE-${f.id}` === m.id) : undefined;
  if (libre) return <FicheBarreAjoutee b={libre} onSupprimee={onSupprimee} />;

  const poste = postesActifs(project).find((p) => p.concerne(m));
  const nombre = poste ? model.members.filter(poste.concerne).length : 0;
  const edit = useProjectStore.getState().edit;

  return (
    <div className="fiche">
      <h3>
        {m.assemblage || m.mark} — {ROLE_LABELS[m.role]}
      </h3>
      <dl className="paires">
        <dt>Position</dt>
        <dd>{m.position}</dd>
        <dt>Longueur à l’axe</dt>
        <dd className="derive">{mm(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z))} mm</dd>
        {poste ? (
          <>
            <dt>Profil du poste « {poste.libelle} »</dt>
            <dd>
              <ChampProfil
                valeur={poste.profil(project)}
                familles={poste.familles}
                onChange={(v) => edit(`Profil — ${poste.libelle}`, (d) => appliquerProjet(d as ProjectParams, project, poste.poser(project, v)))}
              />
            </dd>
          </>
        ) : (
          <>
            <dt>Profil</dt>
            <dd>{m.profileId}</dd>
          </>
        )}
        <dt>Nuance</dt>
        <dd>{m.grade}</dd>
      </dl>
      <p className="note" style={{ margin: '8px 0 0' }}>
        {poste
          ? `Le profil s’applique aux ${nombre} pièces du poste : platines, perçages, assemblages, calculs et plans suivent.`
          : 'Pièce dérivée d’une autre (attache, échantignolle, lierne…) : elle se règle dans l’onglet Projet.'}{' '}
        Pour retirer des pièces générées, changez les paramètres du projet (travées contreventées, potelets, lisses…).
      </p>
    </div>
  );
}

function FicheBarreAjoutee({ b, onSupprimee }: { b: FreeMember; onSupprimee: () => void }): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const edit = useProjectStore((s) => s.edit);
  type Modifiable = { -readonly [K in keyof FreeMember]: FreeMember[K] };
  const maj = (libelle: string, f: (x: Modifiable) => void): void =>
    edit(`${b.id} — ${libelle}`, (d) => {
      const x = d.freeMembers.find((y) => y.id === b.id);
      if (x) f(x as unknown as Modifiable);
    });
  const coord = (bout: 'start' | 'end', axe: 'x' | 'y' | 'z'): JSX.Element => (
    <span>
    <ChampNombre
      valeur={b[bout][axe] / 1000}
      pas={0.1}
      unite="m"
      largeur={70}
      onChange={(v) => maj(`${bout === 'start' ? 'origine' : 'extrémité'} ${axe.toUpperCase()}`, (x) => void ((x[bout] as { x: number; y: number; z: number })[axe] = v * 1000))}
    />
    </span>
  );

  return (
    <div className="fiche">
      <h3>Barre ajoutée {b.id}</h3>
      <dl className="paires">
        <dt>Désignation</dt>
        <dd>
          <ChampTexte valeur={b.label} placeholder="ex. bracon" largeur="100%" onChange={(v) => maj('désignation', (x) => void (x.label = v))} />
        </dd>
        <dt>Profil</dt>
        <dd>
          <ChampProfil valeur={b.profile} onChange={(v) => maj('profil', (x) => void (x.profile = v))} />
        </dd>
        <dt>Nuance</dt>
        <dd>
          <ChampNuance valeur={b.grade} onChange={(v: SteelGradeId) => maj('nuance', (x) => void (x.grade = v))} />
        </dd>
        <dt>Rotation du profil</dt>
        <dd>
          <ChampNombre valeur={b.rotation} pas={15} unite="°" largeur={60} onChange={(v) => maj('rotation', (x) => void (x.rotation = v))} />
        </dd>
        <dt>Origine X / Y / Z</dt>
        <dd className="coords">
          {coord('start', 'x')} {coord('start', 'y')} {coord('start', 'z')}
        </dd>
        <dt>Extrémité X / Y / Z</dt>
        <dd className="coords">
          {coord('end', 'x')} {coord('end', 'y')} {coord('end', 'z')}
        </dd>
        <dt>Longueur</dt>
        <dd className="derive">{num(longueurLibre(b), 0)} mm</dd>
      </dl>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="plat"
          onClick={() =>
            edit(`Dupliquer ${b.id}`, (d) => {
              for (const c of dupliquerEnSerie(b, decalageParDefaut(project), 1, d.freeMembers)) d.freeMembers.push(c);
            })
          }
          title="Copie décalée d’une travée"
        >
          Dupliquer (une travée plus loin)
        </button>
        <button
          type="button"
          className="plat"
          onClick={() => {
            edit(`Supprimer ${b.id}`, (d) => {
              const i = d.freeMembers.findIndex((x) => x.id === b.id);
              if (i >= 0) d.freeMembers.splice(i, 1);
            });
            onSupprimee();
          }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
