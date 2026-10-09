import { getProfile } from '../../core/catalog/index';
import { designationDeTrou } from '../../core/geometry/holes';
import { LIBELLE_TOLE, type Haunch, type Plate } from '../../core/build/types';
import { haunchMassKg, plateMassKg } from '../../core/build/buildProject';
import {
  cutAngleDeg,
  cutLengths,
  memberMassKg,
  memberPaintM2,
  type Member,
} from '../../core/geometry/member';
import { RATIO_LABELS } from '../../core/checks/types';
import { ratioColor, ROLE_LABELS } from '../../render3d/colorMaps';
import { useChecksReport } from '../../state/derived';
import { cm4, kg, mm, num } from '../format';

/**
 * FICHES DE LA PIÈCE SÉLECTIONNÉE en vue 3D : barre, tôle ou jarret.
 *
 * Ce qu'on lit en cliquant une pièce, c'est sa FICHE DE DÉBIT — profil,
 * longueurs, coupes, masse — tirée des mêmes fonctions que les plans de débit.
 * Elle ne recalcule rien : une valeur différente ici et sur le plan serait une
 * valeur fausse à l'un des deux endroits.
 */

export function FicheBarre({ m }: { m: Member }): JSX.Element {
  const p = getProfile(m.profileId);
  const l = cutLengths(m);
  return (
    <div className="fiche">
      <h3>
        Repère {m.assemblage || m.mark} — {ROLE_LABELS[m.role]}
      </h3>
      <dl className="paires">
        <dt>Position</dt>
        <dd>{m.position}</dd>
        {/* Le repère peint (assemblage) et celui de la barre à débiter ne
            coïncident pas toujours : une pièce soudée porte celui de son porteur. */}
        {(m.assemblage !== m.mark || m.porteur !== null) && (
          <>
            <dt>Pièce de débit</dt>
            <dd>
              {m.mark}
              {m.porteur !== null ? ' — soudée en atelier sur son porteur' : ''}
            </dd>
          </>
        )}
        <dt>Profil</dt>
        <dd>{p.id}</dd>
        <dt>Nuance</dt>
        <dd>{m.grade}</dd>
        <dt>Longueur à l’axe</dt>
        <dd className="derive">{mm(l.axis)} mm</dd>
        <dt>Fibre la plus longue</dt>
        <dd className="derive">{mm(l.max)} mm</dd>
        <dt>Fibre la plus courte</dt>
        <dd className="derive">{mm(l.min)} mm</dd>
        <dt>Coupe origine</dt>
        <dd className="derive">{num(cutAngleDeg(m, 'start'), 1)} °</dd>
        <dt>Coupe extrémité</dt>
        <dd className="derive">{num(cutAngleDeg(m, 'end'), 1)} °</dd>
        <dt>Masse</dt>
        <dd className="derive">{kg(memberMassKg(m))} kg</dd>
        <dt>Surface à peindre</dt>
        <dd className="derive">{num(memberPaintM2(m), 2)} m²</dd>
        <dt>Inertie Iy</dt>
        <dd>{cm4(p.Iy)} cm⁴</dd>
      </dl>
      <TauxDeLaPiece mark={m.mark} />
      {m.holes.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Perçages ({m.holes.length})</h3>
          <table className="legende">
            <thead>
              <tr>
                <td className="nom">Depuis l’about</td>
                <td className="nombre">y</td>
                <td className="nombre">z</td>
                <td className="nombre">Ø</td>
              </tr>
            </thead>
            <tbody>
              {m.holes.map((t, k) => (
                <tr key={k}>
                  <td className="nom derive">{mm(t.s)} mm</td>
                  <td className="nombre">{num(t.at.y, 1)}</td>
                  <td className="nombre">{num(t.at.z, 1)}</td>
                  <td className="nombre">{num(t.d, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {m.notches.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Grugeages ({m.notches.length})</h3>
          <table className="legende">
            <tbody>
              {m.notches.map((n, k) => (
                <tr key={k}>
                  <td className="nom">{n.side === 'sup' ? 'semelle sup.' : n.side === 'inf' ? 'semelle inf.' : n.side}</td>
                  <td className="nombre derive">
                    {mm(n.s0)} → {mm(n.s1)}
                  </td>
                  <td className="nombre">−{num(n.depth, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ margin: '4px 0 0' }}>{m.notches[0]?.reason}</p>
        </>
      )}

      <h3 style={{ marginTop: 14 }}>Points de travail</h3>
      <dl className="paires">
        <dt>Origine</dt>
        <dd className="derive">
          {mm(m.start.x)} / {mm(m.start.y)} / {mm(m.start.z)}
        </dd>
        <dt>Extrémité</dt>
        <dd className="derive">
          {mm(m.end.x)} / {mm(m.end.y)} / {mm(m.end.z)}
        </dd>
      </dl>
    </div>
  );
}

/**
 * Taux de travail de la pièce, tel que le colore la vue 3D.
 *
 * ⚠ La couleur seule ne suffit pas : entre 0,94 et 0,96 elle change de bande,
 * et c'est le chiffre, avec le critère qui gouverne, qui décide si l'on garde
 * le profil. Une pièce sans ligne est dite non vérifiée — jamais laissée muette.
 */
function TauxDeLaPiece({ mark }: { mark: string }): JSX.Element {
  const rapport = useChecksReport();
  const ligne = rapport.lines.find((l) => l.mark === mark);
  const exclue = rapport.nonVerifiables.find((n) => n.mark === mark);
  return (
    <>
      <h3 style={{ marginTop: 14 }}>Vérification</h3>
      <dl className="paires">
        <dt>Taux de travail</dt>
        <dd>
          <span
            className="pastille"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, background: `#${ratioColor(ligne?.ratio).toString(16).padStart(6, '0')}` }}
          />
          {ligne ? <strong>{num(ligne.ratio, 2)}</strong> : 'non vérifié'}
        </dd>
        {ligne && (
          <>
            <dt>Critère qui gouverne</dt>
            <dd>{RATIO_LABELS[ligne.gouverne]}</dd>
            <dt>Combinaison</dt>
            <dd>{ligne.combinaison}</dd>
          </>
        )}
      </dl>
      {!ligne && (
        <p className="note" style={{ margin: '4px 0 0' }}>
          {exclue?.raison ?? 'SteelPlan ne vérifie pas cette pièce.'}
        </p>
      )}
    </>
  );
}

export function FicheTole({ pl }: { pl: Plate }): JSX.Element {
  const ys = pl.outline.map((q) => q.y);
  const zs = pl.outline.map((q) => q.z);
  return (
    <div className="fiche">
      <h3>
        Repère {pl.mark} — {LIBELLE_TOLE[pl.kind]}
      </h3>
      <dl className="paires">
        <dt>Position</dt>
        <dd>{pl.position}</dd>
        <dt>Dimensions</dt>
        <dd className="derive">
          {mm(Math.max(...ys) - Math.min(...ys))} × {mm(Math.max(...zs) - Math.min(...zs))} mm
        </dd>
        <dt>Épaisseur</dt>
        <dd>{num(pl.thickness, 0)} mm</dd>
        <dt>Nuance</dt>
        <dd>{pl.grade}</dd>
        <dt>Perçages</dt>
        <dd className="derive">
          {pl.holes.length}
          {pl.holes.length > 0 ? ` × ${[...new Set(pl.holes.map((h) => designationDeTrou(h)))].join(' / ')}` : ''}
        </dd>
        <dt>Masse</dt>
        <dd className="derive">{kg(plateMassKg(pl))} kg</dd>
      </dl>
      {pl.holes.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Implantation des trous</h3>
          <table className="legende">
            <tbody>
              {pl.holes.map((h, k) => (
                <tr key={k}>
                  <td className="nom">Trou {k + 1}</td>
                  <td className="nombre derive">{num(h.at.y, 1)}</td>
                  <td className="nombre derive">{num(h.at.z, 1)}</td>
                  <td className="nombre">{designationDeTrou(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function FicheJarret({ h }: { h: Haunch }): JSX.Element {
  const longueur = Math.hypot(h.tip.x - h.root.x, h.tip.y - h.root.y, h.tip.z - h.root.z);
  const profil = getProfile(h.profileId);
  return (
    <div className="fiche">
      <h3>Repère {h.mark} — Jarret</h3>
      <dl className="paires">
        <dt>Position</dt>
        <dd>{h.position}</dd>
        <dt>Découpé dans</dt>
        <dd>{profil.id}</dd>
        <dt>Nuance</dt>
        <dd>{h.grade}</dd>
        <dt>Longueur</dt>
        <dd className="derive">{mm(longueur)} mm</dd>
        <dt>Hauteur du renfort</dt>
        <dd className="derive">{mm(h.rootDepth)} mm</dd>
        <dt>Hauteur totale au genou</dt>
        <dd className="derive">{mm(h.rootDepth + profil.h)} mm</dd>
        <dt>Longueur de la semelle</dt>
        <dd className="derive">{mm(Math.hypot(longueur, h.rootDepth))} mm</dd>
        <dt>Masse</dt>
        <dd className="derive">{kg(haunchMassKg(h))} kg</dd>
      </dl>
    </div>
  );
}
