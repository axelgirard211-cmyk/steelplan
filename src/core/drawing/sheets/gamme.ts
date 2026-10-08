import { getProfile } from '../../catalog/index';
import { designationDeTrou } from '../../geometry/holes';
import { cutAngleDeg } from '../../geometry/member';
import { designationSoudure, longueurDeposee } from '../../geometry/weld';
import {
  designationFinition,
  teinteFinition,
  zincExigible,
  type FinitionParams,
} from '../../model/finition';
import { debitDe, implantations, tolesDistinctes, type ElementFabrication } from './element';

/**
 * GAMME DE FABRICATION — l'ordre des postes, du débit à la peinture.
 *
 * ⚠ Un plan dit ce qu'il faut faire ; il ne dit pas dans quel ORDRE. En atelier
 * l'ordre n'est pas indifférent : on perce à plat avant d'assembler, on pointe
 * avant de souder, on contrôle avant d'envoyer peindre — et on ne peint jamais
 * une surface de contact d'assemblage boulonné. Une pièce soudée puis percée est
 * une pièce à refaire.
 *
 * Chaque ligne est tirée du modèle. Aucune n'est un texte générique : si la
 * gamme annonce quatre perçages Ø22, c'est qu'il y en a quatre.
 */

export interface EtapeGamme {
  readonly numero: number;
  readonly poste: string;
  readonly lignes: readonly string[];
}

const mm = (v: number): string => `${Math.round(v)} mm`;
const deg = (v: number): string => `${v.toFixed(1).replace('.', ',')}°`;

export function gammeDeFabrication(
  e: ElementFabrication,
  finition: FinitionParams,
): EtapeGamme[] {
  const etapes: EtapeGamme[] = [];
  const pousser = (poste: string, lignes: string[]): void => {
    if (lignes.length > 0) etapes.push({ numero: etapes.length + 1, poste, lignes });
  };

  const m = e.membre;
  const d = debitDe(m);
  const a0 = cutAngleDeg(m, 'start');
  const a1 = cutAngleDeg(m, 'end');

  /* --- 1. Débit --- */
  const debit = [`${d.profil} — nuance ${m.grade} — ${e.quantite} pièce(s)`];
  if (a0 <= 0.05 && a1 <= 0.05) {
    debit.push(`Longueur de coupe : ${mm(d.axe)}, coupes d’équerre aux deux abouts`);
  } else if (Math.abs(d.maxi - d.mini) < 0.5) {
    /*
     * ⚠ Toutes les fibres de même longueur ne veut PAS dire coupes d'équerre :
     * deux coupes biaises PARALLÈLES — une traverse sciée d'aplomb au genou et
     * au faîtage — donnent la même longueur partout. La gamme annonçait alors
     * « coupes d'équerre » sur une pièce à scier à 84,3° aux deux bouts.
     */
    debit.push(`Longueur de coupe : ${mm(d.axe)} sur toutes les fibres — coupes biaises parallèles`);
  } else {
    /*
     * ⚠ Sur une coupe biaise, c'est la fibre la PLUS LONGUE qu'on trace et qu'on
     * scie ; la longueur à l'axe ne se mesure nulle part sur la pièce. Donner
     * seulement celle-ci obligerait le débiteur à la reconstruire — et il se
     * tromperait un jour sur deux.
     */
    debit.push(`Longueur à l’axe : ${mm(d.axe)} — à tracer : ${mm(d.maxi)} (fibre longue)`);
    debit.push(`Fibre courte : ${mm(d.mini)}`);
  }
  if (a0 > 0.05) debit.push(`Coupe about origine : ${deg(90 - a0)} sur la scie`);
  if (a1 > 0.05) debit.push(`Coupe about extrémité : ${deg(90 - a1)} sur la scie`);
  /*
   * La fente qui reçoit le plat d'about se scie au débit, tube encore nu : une
   * fois l'autre about équipé, la pièce ne repasse plus sur la scie.
   */
  for (const f of m.fentes ?? []) {
    debit.push(
      `Fendre l’about ${f.about === 'origine' ? 'origine' : 'extrémité'} sur ${mm(f.longueur)}, ` +
        `largeur ${f.largeur} mm, dans le plan du plat d’attache`,
    );
  }
  pousser('DÉBIT', debit);

  /*
   * --- 2. Perçage ---
   *
   * ⚠ Les trous de la BARRE et ceux des TÔLES. Ne compter que la barre laissait
   * les platines hors gamme : une platine d'about porte huit trous Ø22 que rien
   * n'annonçait au poste de perçage, alors que la barre, elle, n'en a aucun.
   */
  const percage = groupesDeTrous(m.holes.map((h) => h.d)).map(
    ([diam, n]) => `${n} trou(s) Ø${diam} sur la barre — cotés sur la vue de l’élément`,
  );
  for (const { pl, nombre } of tolesDistinctes(e)) {
    const parForme = new Map<string, number>();
    for (const h of pl.holes) parForme.set(designationDeTrou(h), (parForme.get(designationDeTrou(h)) ?? 0) + 1);
    for (const [forme, n] of parForme) {
      percage.push(
        `${n * nombre} trou(s) ${forme} sur ${pl.mark}${nombre > 1 ? ` (${nombre} tôles)` : ''} — cotés sur la vue à plat`,
      );
    }
  }
  if (percage.length > 0) {
    // Percer à plat, avant tout assemblage : une fois la platine soudée, la
    // perceuse ne passe plus.
    percage.push('À exécuter AVANT assemblage, pièces à plat');
  }
  pousser('PERÇAGE', percage);

  /* --- 3. Grugeage --- */
  pousser(
    'GRUGEAGE',
    m.notches.map(
      (n) =>
        `Entaille ${n.side === 'sup' ? 'semelle supérieure' : 'semelle inférieure'} : ` +
        `de ${mm(n.s0)} à ${mm(n.s1)}, profondeur ${mm(n.depth)}${n.reason ? ` (${n.reason})` : ''}`,
    ),
  );

  /* --- 4. Assemblage et pointage --- */
  const assemblage = implantations(e).map(({ pl, depuisAbout, about, fente }) => {
    const nomAbout = about === 'origine' ? 'origine' : 'extrémité';
    const pose = fente
      ? `engagé de ${mm(fente.longueur)} dans la fente de l’about ${nomAbout}, saillie ${mm(fente.saillie)}`
      : about === null
        ? `à ${mm(depuisAbout)} de l’about origine`
        : `soudée à plat sur l’about ${nomAbout}`;
    return `${pl.mark} ${pose} — ép. ${pl.thickness} mm`;
  });
  for (const j of e.jarrets) {
    assemblage.push(`${j.mark} — jarret ${getProfile(j.profileId).id}, découpé dans le profil`);
  }
  const pieces = new Map<string, number>();
  for (const x of e.pieces) pieces.set(x.mark, (pieces.get(x.mark) ?? 0) + 1);
  for (const [mark, n] of pieces) {
    assemblage.push(`${mark} × ${n} sur la semelle supérieure — implantées en cotes cumulées, vue de dessus`);
  }
  if (assemblage.length > 0) {
    assemblage.push('Pointer, contrôler l’équerrage, puis souder');
  }
  pousser('ASSEMBLAGE ET POINTAGE', assemblage);

  /* --- 5. Soudure --- */
  const soudure: string[] = [];
  const vues = new Set<string>();
  for (const w of e.soudures) {
    const t = designationSoudure(w);
    if (vues.has(t)) continue;
    vues.add(t);
    soudure.push(t);
  }
  if (soudure.length > 0) {
    const metres = e.soudures.reduce((s, w) => s + longueurDeposee(w), 0) / 1000;
    soudure.push(`Longueur totale déposée : ${metres.toFixed(2).replace('.', ',')} m par pièce`);
  }
  pousser('SOUDURE', soudure);

  /* --- 6. Contrôle --- */
  const controle = [`Longueur hors-tout : ${mm(d.maxi)}`];
  if (m.holes.length > 0) controle.push('Entraxes de perçage et pinces');
  if (e.toles.length > 0) controle.push('Implantation et équerrage des tôles');
  if (e.pieces.length > 0) controle.push('Implantation des pièces soudées, en long et en travers');
  if (e.soudures.length > 0) controle.push('Aspect des cordons, gorge au calibre');
  pousser('CONTRÔLE', controle);

  /* --- 7. Traitement de surface --- */
  pousser('TRAITEMENT DE SURFACE', lignesFinition(e, finition));

  return etapes;
}

/**
 * Le poste de peinture, avec ce qu'il lui faut et rien d'autre.
 *
 * ⚠ La surface est donnée PAR PIÈCE et pour le lot. Un peintre facture au mètre
 * carré : lui donner le total du bâtiment sans le ratio unitaire l'oblige à le
 * recalculer, et personne ne recalcule deux fois la même chose sans se tromper
 * une fois.
 */
function lignesFinition(e: ElementFabrication, f: FinitionParams): string[] {
  if (f.type === 'brut') {
    return ['Acier brut — aucun traitement', `Surface développée : ${surface(e)}`];
  }

  const out = [designationFinition(f)];

  if (f.type === 'galvanisation') {
    const epaisseurs = epaisseursDAcier(e);
    const exige = Math.max(...epaisseurs.map(zincExigible));
    out.push(
      `Épaisseurs d’acier de ${Math.min(...epaisseurs).toFixed(1)} à ` +
        `${Math.max(...epaisseurs).toFixed(1)} mm ⇒ ${exige} µm exigibles`,
      'Prévoir trous d’évent et d’écoulement sur les caissons fermés',
    );
  } else {
    out.push(`Préparation : ${f.preparation} (EN ISO 8501-1)`);
    for (const [i, c] of f.couches.entries()) {
      out.push(`Couche ${i + 1} : ${c.nom} — ${c.epaisseur} µm${c.ral ? ` — ${c.ral}` : ''}`);
    }
    const teinte = teinteFinition(f);
    if (teinte) out.push(`Teinte de finition : ${teinte}`);
  }

  out.push(`Surface développée : ${surface(e)}`);
  if (f.note) out.push(f.note);
  return out;
}

function surface(e: ElementFabrication): string {
  const un = e.surfaceUnitaire.toFixed(2).replace('.', ',');
  const total = (e.surfaceUnitaire * e.quantite).toFixed(2).replace('.', ',');
  return `${un} m²/pièce — ${total} m² pour ${e.quantite} pièce(s)`;
}

/** Trous regroupés par diamètre, du plus petit au plus grand. */
function groupesDeTrous(diametres: readonly number[]): [number, number][] {
  const parDiametre = new Map<number, number>();
  for (const d of diametres) parDiametre.set(d, (parDiametre.get(d) ?? 0) + 1);
  return [...parDiametre.entries()].sort((x, y) => x[0] - y[0]);
}

/** Épaisseurs d'acier présentes dans l'élément : elles fixent le zinc exigible. */
function epaisseursDAcier(e: ElementFabrication): number[] {
  const profil = getProfile(e.membre.profileId);
  const out: number[] = [];
  if (profil.shape === 'I' || profil.shape === 'U') out.push(profil.tw, profil.tf);
  else if (
    profil.shape === 'L' ||
    profil.shape === 'CHS' ||
    profil.shape === 'BOX' ||
    profil.shape === 'RECT'
  ) {
    out.push(profil.t);
  } else out.push(profil.h);
  for (const pl of tolesDistinctes(e)) out.push(pl.pl.thickness);
  return out.filter((x) => x > 0);
}
