import { lettreDeCoupe } from '../../core/drawing/coupeRepere';
import { formatDate } from '../../core/drawing/layout';
import type { ProjectMeta, Revision } from '../../core/model/project';
import { useProjectStore } from '../../state/store';
import { ChampTexte } from '../champs';

/**
 * CARTOUCHE ET INDICES.
 *
 * ⚠⚠ Aucun de ces champs n'était modifiable. Tout le dossier sortait avec
 * « Nouveau projet », client « — », dessiné par « — », indice A pour l'éternité,
 * et le seul moyen d'y écrire était d'ouvrir le fichier à la main. Un dossier de
 * cinquante planches dont le cartouche ne dit ni pour qui ni par qui ne part pas
 * chez un client.
 *
 * L'historique des indices suit la règle du métier : on INSCRIT une diffusion au
 * moment où l'on envoie les plans, et l'objet dit ce qu'il faut regarder sur le
 * nouveau tirage. Inscrire une diffusion porte aussi son indice et sa date au
 * cartouche : les deux ne peuvent pas diverger par cette voie.
 */
export function CartoucheFiche(): JSX.Element {
  const meta = useProjectStore((s) => s.project.meta);
  const edit = useProjectStore((s) => s.edit);

  const majMeta = <K extends keyof ProjectMeta>(champ: K, libelle: string, v: ProjectMeta[K]): void =>
    edit(`Cartouche — ${libelle}`, (d) => {
      d.meta[champ] = v as never;
    });

  const majRevision = <K extends keyof Revision>(i: number, champ: K, v: Revision[K]): void =>
    edit(`Indice ${meta.revisions[i]?.indice ?? ''} — ${champ}`, (d) => {
      const r = d.meta.revisions[i];
      if (r) r[champ] = v;
    });

  const inscrire = (): void => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    /*
     * La PREMIÈRE inscription prend l'indice en cours (A, d'ordinaire) : c'est la
     * première diffusion. Les suivantes prennent la lettre d'après, en sautant I
     * et O comme pour les coupes — un indice « I » se lit comme un chiffre.
     */
    const indice = meta.revisions.length === 0 ? meta.indice || 'A' : indiceSuivant(meta.indice);
    edit(`Inscrire la diffusion ${indice}`, (d) => {
      d.meta.revisions.push({ indice, date: aujourdhui, objet: '', auteur: d.meta.dessinateur });
      d.meta.indice = indice;
      d.meta.date = aujourdhui;
    });
  };

  const retirerDerniere = (): void => {
    const derniere = meta.revisions[meta.revisions.length - 1];
    if (!derniere) return;
    edit(`Retirer la diffusion ${derniere.indice}`, (d) => {
      d.meta.revisions.pop();
      // Le cartouche revient à l'indice précédent, s'il y en a un.
      const precedente = d.meta.revisions[d.meta.revisions.length - 1];
      if (precedente) {
        d.meta.indice = precedente.indice;
        d.meta.date = precedente.date;
      }
    });
  };

  return (
    <div className="fiche">
      <h3>Cartouche et indices</h3>
      <dl className="paires">
        <dt>Projet</dt>
        <dd>
          <ChampTexte valeur={meta.nom} onChange={(v) => majMeta('nom', 'projet', v)} />
        </dd>
        <dt>Client</dt>
        <dd>
          <ChampTexte valeur={meta.client} onChange={(v) => majMeta('client', 'client', v)} />
        </dd>
        <dt>Chantier</dt>
        <dd>
          <ChampTexte
            valeur={meta.chantier}
            onChange={(v) => majMeta('chantier', 'chantier', v)}
            placeholder="adresse ou désignation"
          />
        </dd>
        <dt>Dessiné par</dt>
        <dd>
          <ChampTexte
            valeur={meta.dessinateur}
            onChange={(v) => majMeta('dessinateur', 'dessinateur', v)}
          />
        </dd>
        <dt>Indice en cours</dt>
        <dd className="derive">
          {meta.indice || 'A'} — {formatDate(meta.date)}
        </dd>
      </dl>

      {meta.revisions.length > 0 && (
        <div className="tableau-enveloppe">
          <table className="profils">
            <thead>
              <tr>
                <th className="designation">Indice</th>
                <th>Date</th>
                <th>Objet de la modification</th>
                <th>Auteur</th>
              </tr>
            </thead>
            <tbody>
              {/* La plus récente en haut, comme sur le tableau du cartouche. */}
              {[...meta.revisions.entries()].reverse().map(([i, r]) => (
                <tr key={`${r.indice}-${i}`}>
                  <td className="designation">{r.indice}</td>
                  <td>
                    <input
                      type="date"
                      value={r.date}
                      onChange={(e) => e.target.value && majRevision(i, 'date', e.target.value)}
                    />
                  </td>
                  <td>
                    <ChampTexte
                      valeur={r.objet}
                      onChange={(v) => majRevision(i, 'objet', v)}
                      largeur="100%"
                      placeholder="ce qui a changé sur ce tirage"
                    />
                  </td>
                  <td>
                    <ChampTexte valeur={r.auteur} onChange={(v) => majRevision(i, 'auteur', v)} largeur={90} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p>
        <button type="button" className="plat" onClick={inscrire}>
          {meta.revisions.length === 0
            ? `Inscrire la diffusion ${meta.indice || 'A'}`
            : `Nouvel indice ${indiceSuivant(meta.indice)}`}
        </button>{' '}
        {meta.revisions.length > 0 && (
          <button type="button" className="plat" onClick={retirerDerniere}>
            Retirer la dernière
          </button>
        )}
      </p>
      <p className="note">
        Le cartouche de chaque planche porte ces informations, et le tableau des indices les cinq
        dernières diffusions. Inscrire une diffusion au moment de l’envoi des plans : l’objet dit à
        l’atelier ce qu’il doit regarder sur le nouveau tirage.
      </p>
    </div>
  );
}

/** Lettre qui suit l'indice donné, dans la série des lettres lisibles. */
function indiceSuivant(indice: string): string {
  for (let rang = 0; rang < 24; rang += 1) {
    if (lettreDeCoupe(rang) === indice) return lettreDeCoupe(rang + 1);
  }
  return 'A';
}
