import { listerBoulons, percagesDesBarres } from '../../core/build/bolts';
import { haunchMassKg, plateMassKg } from '../../core/build/buildProject';
import { LIBELLE_TOLE, type StructuralModel } from '../../core/build/types';
import { boulonCommande } from '../../core/bom/boulonnerie';
import { cutLengths, memberMassKg, type Member, type MemberRole } from '../../core/geometry/member';
import { v3 } from '../../core/math/vec3';
import type { ProjectParams } from '../../core/model/project';
import { Geometrie, type Repere } from './geometrie';
import { guidIfc } from './guid';
import {
  corpsDeBarre,
  corpsDeGrugeage,
  corpsDeJarret,
  corpsDePercage,
  corpsDeTole,
  repereDeBoulon,
  solidesDeBoulon,
  type Corps,
} from './pieces';
import { en, entier, FichierStep, type, type Ref, type Valeur } from './step';

/**
 * MAQUETTE IFC — la charpente telle que la reçoivent l'architecte, le BET fluides
 * et l'entreprise générale.
 *
 * IFC4 (ISO 16739-1:2018). Chaque pièce y est ce qu'elle est au plan : un
 * poteau est un IfcColumn de profil IPE 400 recoupé à ses abouts, un boulon un
 * IfcMechanicalFastener M20×60 10.9, et les pièces soudées en atelier sont
 * réunies dans l'IfcElementAssembly qui porte leur repère d'assemblage — c'est
 * l'unité qui se lève et se monte.
 *
 * ⚠ Les repères, profils, nuances et masses partent dans un jeu de propriétés
 * « SteelPlan_Piece » PARTAGÉ par toutes les pièces d'un même repère : c'est ce
 * qu'on filtre et ce qu'on quantifie dans un logiciel de synthèse.
 */

export interface OptionsIfc {
  /** Date de l'export ; maintenant par défaut. Fixée, le fichier est reproductible. */
  readonly horodatage?: Date;
  /**
   * Évider les barres de leurs perçages et grugeages. FAUX par défaut.
   *
   * ⚠ La synthèse n'en a pas besoin, et tous les lecteurs ne savent pas les
   * soustraire : relue par web-ifc, la maquette est juste pièce par pièce sans
   * eux, mais certaines combinaisons de trous y font échouer la soustraction —
   * un poteau ressort avec cinq fois son volume. La fabrication a ses fichiers
   * DSTV, qui portent chaque trou.
   */
  readonly percages?: boolean;
}

export interface MaquetteIfc {
  readonly contenu: string;
  readonly nom: string;
  readonly compte: {
    readonly barres: number;
    readonly jarrets: number;
    readonly toles: number;
    readonly boulons: number;
    readonly ouvertures: number;
    readonly assemblages: number;
    readonly entites: number;
  };
}

type Entite = 'IFCCOLUMN' | 'IFCBEAM' | 'IFCMEMBER';

/** Classe IFC de chaque rôle, son type prédéfini et son nom au singulier. */
const CLASSES: Readonly<Record<MemberRole, { readonly entite: Entite; readonly type: string; readonly libelle: string }>> = {
  poteau: { entite: 'IFCCOLUMN', type: 'COLUMN', libelle: 'Poteau' },
  potelet: { entite: 'IFCCOLUMN', type: 'COLUMN', libelle: 'Potelet' },
  traverse: { entite: 'IFCBEAM', type: 'BEAM', libelle: 'Traverse' },
  console: { entite: 'IFCBEAM', type: 'BEAM', libelle: 'Console de débord' },
  jarret: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Jarret' },
  panne: { entite: 'IFCMEMBER', type: 'PURLIN', libelle: 'Panne' },
  lisse: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Lisse de bardage' },
  chevetre: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Chevêtre d’ouverture' },
  'membrure-sup': { entite: 'IFCMEMBER', type: 'CHORD', libelle: 'Membrure supérieure' },
  'membrure-inf': { entite: 'IFCMEMBER', type: 'CHORD', libelle: 'Membrure inférieure' },
  montant: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Montant de ferme' },
  diagonale: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Diagonale de ferme' },
  contreventement: { entite: 'IFCMEMBER', type: 'BRACE', libelle: 'Contreventement' },
  lierne: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Lierne' },
  attache: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Cornière d’attache' },
  equerre: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Équerre de lisse' },
  libre: { entite: 'IFCMEMBER', type: 'MEMBER', libelle: 'Barre libre' },
};

const PSET_COMMUN: Readonly<Record<Entite | 'IFCPLATE', string>> = {
  IFCCOLUMN: 'Pset_ColumnCommon',
  IFCBEAM: 'Pset_BeamCommon',
  IFCMEMBER: 'Pset_MemberCommon',
  IFCPLATE: 'Pset_PlateCommon',
};

const label = (t: string): Valeur => type('IFCLABEL', t);
const longueur = (v: number): Valeur => type('IFCPOSITIVELENGTHMEASURE', Math.max(v, 0.001));
const masse = (v: number): Valeur => type('IFCMASSMEASURE', Math.max(v, 0));

export function maquetteIfc(p: ProjectParams, model: StructuralModel, options: OptionsIfc = {}): MaquetteIfc {
  const f = new FichierStep();
  const g = new Geometrie(f);
  const meta = p.meta;
  const quand = options.horodatage ?? new Date();
  // Le projet entre dans la graine : deux bâtiments d'une même synthèse ne
  // doivent pas partager l'identifiant de leur poteau « 0-PG ».
  const graine = `${meta.chantier}|${meta.nom}`;
  const gid = (cle: string): string => guidIfc(`${graine}|${cle}`);

  /* --- Auteur, application, unités, contexte --- */
  const organisation = f.ajouter('IFCORGANIZATION', null, 'SteelPlan', null, null, null);
  const personne = f.ajouter('IFCPERSON', null, meta.dessinateur || 'SteelPlan', null, null, null, null, null, null);
  const auteur = f.ajouter('IFCPERSONANDORGANIZATION', personne, organisation, null);
  const application = f.ajouter('IFCAPPLICATION', organisation, '0.1.0', 'SteelPlan', 'SteelPlan');
  const oh = f.ajouter('IFCOWNERHISTORY', auteur, application, null, en('NOCHANGE'), null, null, null, entier(quand.getTime() / 1000));

  const unites = f.ajouter('IFCUNITASSIGNMENT', [
    f.ajouter('IFCSIUNIT', '*', en('LENGTHUNIT'), en('MILLI'), en('METRE')),
    f.ajouter('IFCSIUNIT', '*', en('AREAUNIT'), null, en('SQUARE_METRE')),
    f.ajouter('IFCSIUNIT', '*', en('VOLUMEUNIT'), null, en('CUBIC_METRE')),
    f.ajouter('IFCSIUNIT', '*', en('PLANEANGLEUNIT'), null, en('RADIAN')),
    f.ajouter('IFCSIUNIT', '*', en('MASSUNIT'), en('KILO'), en('GRAM')),
  ]);
  const contexte = f.ajouter('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', entier(3), 1e-5, g.placement(v3(0, 0, 0)), null);
  const corps3d = f.ajouter('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'Body', 'Model', '*', '*', '*', '*', contexte, null, en('MODEL_VIEW'), null);

  /* --- Structure spatiale : projet, site, bâtiment, niveau --- */
  const projet = f.ajouter(
    'IFCPROJECT',
    gid('projet'),
    oh,
    meta.nom || 'Projet SteelPlan',
    meta.client ? `Client : ${meta.client}` : null,
    null,
    meta.chantier || null,
    meta.indice ? `Indice ${meta.indice}` : null,
    [contexte],
    unites,
  );
  const plSite = g.placementLocal(null, null);
  const site = f.ajouter('IFCSITE', gid('site'), oh, meta.chantier || 'Site', null, null, plSite, null, null, en('ELEMENT'), null, null, null, null, null);
  const plBatiment = g.placementLocal(plSite, null);
  const batiment = f.ajouter('IFCBUILDING', gid('batiment'), oh, meta.nom || 'Bâtiment', 'Charpente métallique', null, plBatiment, null, null, en('ELEMENT'), null, null, null);
  const plNiveau = g.placementLocal(plBatiment, null);
  const niveau = f.ajouter('IFCBUILDINGSTOREY', gid('niveau'), oh, 'Niveau 0', null, null, plNiveau, null, null, en('ELEMENT'), 0);
  f.ajouter('IFCRELAGGREGATES', gid('rel:projet'), oh, null, null, projet, [site]);
  f.ajouter('IFCRELAGGREGATES', gid('rel:site'), oh, null, null, site, [batiment]);
  f.ajouter('IFCRELAGGREGATES', gid('rel:batiment'), oh, null, null, batiment, [niveau]);

  /* --- Collecteurs : contenus du niveau, matériaux, propriétés --- */
  const contenus: Ref[] = [];
  const materiaux = new Map<string, Ref[]>();
  const proprietes = new Map<string, { nom: string; valeurs: readonly (readonly [string, Valeur])[]; objets: Ref[] }>();
  const associer = (materiau: string, r: Ref): void => {
    const l = materiaux.get(materiau);
    if (l) l.push(r);
    else materiaux.set(materiau, [r]);
  };
  const decrire = (cle: string, nom: string, valeurs: readonly (readonly [string, Valeur])[], r: Ref): void => {
    const k = `${nom}|${cle}`;
    const d = proprietes.get(k);
    if (d) d.objets.push(r);
    else proprietes.set(k, { nom, valeurs, objets: [r] });
  };
  const forme = (c: Corps): Ref =>
    f.ajouter('IFCPRODUCTDEFINITIONSHAPE', null, null, [f.ajouter('IFCSHAPEREPRESENTATION', corps3d, 'Body', c.type, c.solides)]);

  /* --- Assemblages soudés : chaque pièce rattachée à sa pièce principale --- */
  const parId = new Map(model.members.map((m) => [m.id, m]));
  const racine = (id: string | null): Member | null => {
    const vus = new Set<string>();
    let m = id ? parId.get(id) : undefined;
    while (m?.porteur && !vus.has(m.id) && parId.has(m.porteur)) {
      vus.add(m.id);
      m = parId.get(m.porteur);
    }
    return m ?? null;
  };
  const effectifs = new Map<string, number>();
  const compter = (m: Member | null): void => {
    if (m) effectifs.set(m.id, (effectifs.get(m.id) ?? 0) + 1);
  };
  for (const m of model.members) compter(m.porteur ? racine(m.porteur) : m);
  for (const h of model.haunches) compter(racine(h.porteur));
  for (const pl of model.plates) compter(racine(pl.porteur));

  const assemblages = new Map<string, { ref: Ref; placement: Ref; parties: Ref[] }>();
  /** Placement parent d'une pièce : son assemblage s'il y en a un, le niveau sinon. */
  const parent = (chef: Member | null): { placement: Ref; parties: Ref[] } => {
    if (!chef || (effectifs.get(chef.id) ?? 0) < 2) return { placement: plNiveau, parties: contenus };
    let a = assemblages.get(chef.id);
    if (!a) {
      const placement = g.placementLocal(plNiveau, null);
      const ref = f.ajouter(
        'IFCELEMENTASSEMBLY',
        gid(`assemblage:${chef.id}`),
        oh,
        chef.assemblage || chef.mark,
        `Assemblage soudé en atelier — ${chef.position}`,
        null,
        placement,
        null,
        chef.id,
        en('FACTORY'),
        en('NOTDEFINED'),
      );
      contenus.push(ref);
      a = { ref, placement, parties: [] };
      assemblages.set(chef.id, a);
    }
    return a;
  };

  /* --- Barres, avec leurs perçages et grugeages --- */
  const percages = new Map<string, ReturnType<typeof percagesDesBarres>>();
  for (const t of percagesDesBarres(model.members)) {
    const l = percages.get(t.piece);
    if (l) l.push(t);
    else percages.set(t.piece, [t]);
  }
  /*
   * ⚠ UNE ouverture par barre, qui porte tous ses perçages et grugeages, et non
   * une par trou. Relue par web-ifc, une ouverture par trou faisait échouer la
   * soustraction sur certaines combinaisons — un poteau ressortait avec cinq
   * fois son volume — et le fichier comptait 1 500 ouvertures de plus.
   */
  let ouvertures = 0;
  const evider = (barre: Ref, placementBarre: Ref, m: Member, corps: readonly Corps[], nom: string): void => {
    if (corps.length === 0) return;
    const ouverture = f.ajouter(
      'IFCOPENINGELEMENT',
      gid(`ouverture:${m.id}`),
      oh,
      nom,
      null,
      null,
      g.placementLocal(placementBarre, null),
      forme({ repere: corps[0]?.repere as Repere, solides: corps.flatMap((c) => c.solides), type: 'SweptSolid' }),
      null,
      en('OPENING'),
    );
    f.ajouter('IFCRELVOIDSELEMENT', gid(`vide:${m.id}`), oh, null, null, barre, ouverture);
    ouvertures += corps.length;
  };

  for (const m of model.members) {
    const cl = CLASSES[m.role];
    const corps = corpsDeBarre(g, m);
    const dest = parent(m.porteur ? racine(m.porteur) : m);
    const placement = g.placementLocal(dest.placement, corps.repere);
    const ref = f.ajouter(
      cl.entite,
      gid(`barre:${m.id}`),
      oh,
      m.mark,
      `${cl.libelle} — ${m.position}`,
      m.profileId,
      placement,
      forme(corps),
      m.id,
      en(cl.type),
    );
    dest.parties.push(ref);
    associer(m.grade, ref);
    decrire(`${m.mark}|${m.assemblage}`, 'SteelPlan_Piece', [
      ['Repère', label(m.mark)],
      ['Repère d’assemblage', label(m.assemblage)],
      ['Fonction', label(cl.libelle)],
      ['Profil', label(m.profileId)],
      ['Nuance', label(m.grade)],
      ['Longueur de débit', longueur(cutLengths(m).max)],
      ['Masse unitaire', masse(memberMassKg(m))],
    ], ref);
    decrire(m.profileId, PSET_COMMUN[cl.entite], [
      ['Reference', type('IFCIDENTIFIER', m.profileId)],
      ['LoadBearing', type('IFCBOOLEAN', true)],
    ], ref);

    const trous = percages.get(m.id) ?? [];
    const nom = [trous.length > 0 ? `${trous.length} perçage${trous.length > 1 ? 's' : ''}` : '', m.notches.length > 0 ? `${m.notches.length} grugeage${m.notches.length > 1 ? 's' : ''}` : '']
      .filter(Boolean)
      .join(', ');
    if (options.percages) {
      evider(ref, placement, m, [...trous.map((t) => corpsDePercage(g, m, t)), ...m.notches.map((n) => corpsDeGrugeage(g, m, n))], nom);
    }
  }

  /* --- Jarrets --- */
  let jarrets = 0;
  for (const h of model.haunches) {
    const corps = corpsDeJarret(g, h);
    if (!corps) continue;
    const dest = parent(racine(h.porteur));
    const ref = f.ajouter(
      'IFCMEMBER',
      gid(`jarret:${h.id}`),
      oh,
      h.mark,
      `Jarret — ${h.position}`,
      h.profileId,
      g.placementLocal(dest.placement, corps.repere),
      forme(corps),
      h.id,
      en('MEMBER'),
    );
    dest.parties.push(ref);
    associer(h.grade, ref);
    decrire(h.mark, 'SteelPlan_Piece', [
      ['Repère', label(h.mark)],
      ['Fonction', label('Jarret')],
      ['Profil', label(`découpé dans ${h.profileId}`)],
      ['Nuance', label(h.grade)],
      ['Masse unitaire', masse(haunchMassKg(h))],
    ], ref);
    jarrets += 1;
  }

  /* --- Tôles --- */
  for (const pl of model.plates) {
    const corps = corpsDeTole(g, pl);
    const dest = parent(racine(pl.porteur));
    const nature = LIBELLE_TOLE[pl.kind];
    const ref = f.ajouter(
      'IFCPLATE',
      gid(`tole:${pl.id}`),
      oh,
      pl.mark,
      `${nature} — ${pl.position}`,
      `PL ${pl.thickness}`,
      g.placementLocal(dest.placement, corps.repere),
      forme(corps),
      pl.id,
      en('NOTDEFINED'),
    );
    dest.parties.push(ref);
    associer(pl.grade, ref);
    decrire(pl.mark, 'SteelPlan_Piece', [
      ['Repère', label(pl.mark)],
      ['Fonction', label(nature)],
      ['Épaisseur', longueur(pl.thickness)],
      ['Nuance', label(pl.grade)],
      ['Masse unitaire', masse(plateMassKg(pl))],
    ], ref);
    decrire(`PL ${pl.thickness}`, PSET_COMMUN.IFCPLATE, [
      ['Reference', type('IFCIDENTIFIER', `PL ${pl.thickness}`)],
      ['LoadBearing', type('IFCBOOLEAN', true)],
    ], ref);
  }

  /* --- Boulonnerie : une géométrie par modèle de boulon, posée à chaque emplacement --- */
  const modeles = new Map<string, Ref>();
  const identite = f.ajouter('IFCCARTESIANTRANSFORMATIONOPERATOR3D', null, null, g.point(v3(0, 0, 0)), 1, null);
  const boulons = listerBoulons(model.members, model.plates);
  for (const b of boulons) {
    const c = boulonCommande(b, p);
    const cle = `${b.kind}|${c.diameter}|${c.length}|${Math.round(b.grip * 2) / 2}`;
    let carte = modeles.get(cle);
    if (!carte) {
      const rep = f.ajouter('IFCSHAPEREPRESENTATION', corps3d, 'Body', 'SweptSolid', solidesDeBoulon(g, b, c.diameter, c.length));
      carte = f.ajouter('IFCREPRESENTATIONMAP', g.placement(v3(0, 0, 0)), rep);
      modeles.set(cle, carte);
    }
    const r: Repere = repereDeBoulon(b);
    const posee = f.ajouter('IFCMAPPEDITEM', carte, identite);
    const k = `${Math.round(b.at.x)},${Math.round(b.at.y)},${Math.round(b.at.z)}|${Math.round(b.axis.x)},${Math.round(b.axis.y)},${Math.round(b.axis.z)}`;
    const ref = f.ajouter(
      'IFCMECHANICALFASTENER',
      gid(`boulon:${k}`),
      oh,
      c.designation,
      c.usage,
      null,
      g.placementLocal(plNiveau, r),
      f.ajouter('IFCPRODUCTDEFINITIONSHAPE', null, null, [f.ajouter('IFCSHAPEREPRESENTATION', corps3d, 'Body', 'MappedRepresentation', [posee])]),
      null,
      c.diameter,
      c.length,
      en(c.piece === 'ancrage' ? 'ANCHORBOLT' : 'BOLT'),
    );
    contenus.push(ref);
    associer(`Classe ${c.cls}`, ref);
    decrire(`${c.designation}|${c.usage}`, 'SteelPlan_Boulon', [
      ['Désignation', label(c.designation)],
      ['Classe', label(c.cls)],
      ['Usage', type('IFCTEXT', c.usage)],
      ['Masse unitaire', masse(c.massUnit)],
    ], ref);
  }

  /* --- Relations : contenu du niveau, assemblages, matériaux, propriétés --- */
  for (const [id, a] of assemblages) {
    f.ajouter('IFCRELAGGREGATES', gid(`rel:assemblage:${id}`), oh, null, null, a.ref, a.parties);
  }
  f.ajouter('IFCRELCONTAINEDINSPATIALSTRUCTURE', gid('rel:niveau'), oh, null, null, contenus, niveau);
  for (const [nom, objets] of materiaux) {
    const materiau = f.ajouter('IFCMATERIAL', nom, null, 'Steel');
    f.ajouter('IFCRELASSOCIATESMATERIAL', gid(`materiau:${nom}`), oh, null, null, objets, materiau);
  }
  for (const [cle, d] of proprietes) {
    const valeurs = d.valeurs.map(([n, v]) => f.ajouter('IFCPROPERTYSINGLEVALUE', n, null, v, null));
    const jeu = f.ajouter('IFCPROPERTYSET', gid(`pset:${cle}`), oh, d.nom, null, valeurs);
    f.ajouter('IFCRELDEFINESBYPROPERTIES', gid(`rel:pset:${cle}`), oh, null, null, d.objets, jeu);
  }

  const nom = `${(meta.nom || 'projet').replace(/[^\w-]+/g, '-')}.ifc`;
  const contenu = f.ecrire({
    vue: 'ViewDefinition [DesignTransferView_V1.0]',
    nom,
    horodatage: heureLocale(quand),
    auteur: meta.dessinateur,
    organisation: '',
    preprocesseur: 'SteelPlan',
    application: 'SteelPlan 0.1.0',
    schema: 'IFC4',
  });
  return {
    contenu,
    nom,
    compte: {
      barres: model.members.length,
      jarrets,
      toles: model.plates.length,
      boulons: boulons.length,
      ouvertures,
      assemblages: assemblages.size,
      entites: f.nombre,
    },
  };
}

/** Date et heure LOCALES au format ISO 8601, sans fuseau — l'usage des fichiers IFC. */
function heureLocale(d: Date): string {
  const z = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}
