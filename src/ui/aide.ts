import { normaliser } from './projet/rubriques';

/**
 * AIDE DES PARAMÈTRES — ce que veut dire chaque champ technique.
 *
 * ⚠ « Pince », « tombée d'about », « ψ0 », « course des oblongs » : la saisie
 * supposait le vocabulaire connu, et un jeune dessinateur devait ouvrir un
 * cours pour savoir ce qu'on lui demandait — ou, pire, devinait. Chaque champ
 * technique dit ici ce qu'il mesure, d'où à où, et ce qui en dépend.
 *
 * La clé est le libellé du champ (sa ligne, ou « rubrique — sous-ligne ») ;
 * `fiche` lève les homonymes : « Traverses » est un profil dans le portique et
 * une limite de flèche dans les charges.
 */

interface Entree {
  readonly cle: string;
  readonly fiche?: string;
  readonly texte: string;
}

const ENTREES: readonly Entree[] = [
  // Trame
  { cle: 'Travées', fiche: 'Trame', texte: 'Intervalles entre portiques le long du bâtiment : n travées donnent n + 1 files de portiques, numérotées 1, 2, 3… sur les plans.' },
  { cle: 'Entraxe des portiques', texte: 'Distance d’axe en axe entre deux portiques. C’est la portée des pannes et des lisses ; couramment 5 000 à 8 000 mm en bâtiment industriel.' },
  { cle: 'Portée', fiche: 'Trame', texte: 'Largeur du portique, de nu extérieur à nu extérieur des poteaux.' },
  { cle: 'Hauteur à l’égout', texte: 'Du pied de poteau (arase de la fondation) au-dessus de la traverse, au droit du poteau.' },
  { cle: 'Pente', fiche: 'Trame', texte: 'Pente des versants, en % ou en degrés selon l’unité choisie dans « Toiture » (10 % ≈ 5,7°).' },
  // Toiture et portique
  { cle: 'Versants dissymétriques', texte: 'Deux pentes différentes : le faîtage n’est plus au milieu de la portée.' },
  { cle: 'Portée par', texte: 'Traverse à âme pleine (portique en IPE ou HEA, avec jarrets) ou ferme treillis (membrures et barres), plus légère en grande portée.' },
  { cle: 'Nuance', texte: 'Qualité de l’acier, par sa limite d’élasticité en N/mm² : S235, S355… (EN 10025-2). Elle entre dans toutes les vérifications.' },
  { cle: 'Pieds de poteaux', texte: 'Articulé : platine à 2 tiges, aucun moment transmis à la fondation. Encastré : 4 tiges ou plus, moment repris par la fondation, portique plus raide.' },
  { cle: 'Jarret de genou', texte: 'Renfort soudé sous la traverse, près du poteau, là où le moment est le plus fort : il allège la traverse sur le reste du rampant.' },
  { cle: 'Jarret de genou — longueur', texte: 'Longueur du jarret le long de la traverse, depuis le poteau ; de l’ordre de 10 % de la portée.' },
  { cle: 'Jarret de genou — hauteur au genou', texte: 'Hauteur totale, traverse et jarret, au droit du poteau. Elle doit dépasser celle de la traverse seule.' },
  { cle: 'Jarret de faîtage', texte: 'Renfort sous l’assemblage des deux traverses au faîtage : plus de hauteur de platine, donc plus de rangées de boulons.' },
  { cle: 'Portique de pignon distinct', texte: 'Profils propres aux portiques de rive : ne portant qu’une demi-travée, ils peuvent être plus légers que les portiques courants.' },
  // Ossature secondaire
  { cle: 'Pannes — répartition', texte: 'Entraxe imposé : les pannes sont posées au plus à l’entraxe demandé, l’entraxe réel est coté sur les plans. Nombre imposé : l’entraxe en découle.' },
  { cle: 'Pannes — entraxe demandé', texte: 'Distance entre pannes mesurée le long du rampant. Elle se règle sur la portée admissible de la couverture (bac acier, panneau).' },
  { cle: 'Pannes — débord à l’égout', texte: 'Avancée de la toiture au-delà du nu du poteau, à l’égout.' },
  { cle: 'Pannes — panne sablière', texte: 'Panne posée à l’égout, en tête de long-pan : elle reçoit l’égout de la couverture et sert d’appui au bardage.' },
  { cle: 'Pannes — panne faîtière', texte: 'Panne posée au faîtage, de part et d’autre de l’assemblage des traverses.' },
  { cle: 'Pannes — liernes', texte: 'Tirants en rond qui relient les pannes entre elles : ils bloquent leur déversement et reprennent la composante de pente des charges.' },
  { cle: 'Pannes', fiche: 'Ossature', texte: 'Profils posés d’un portique à l’autre, perpendiculairement aux traverses : ils portent la couverture.' },
  { cle: 'diamètre du rond', texte: 'Diamètre des liernes en rond plein, couramment 12 à 16 mm.' },
  { cle: 'Lisses de bardage', texte: 'Profils horizontaux des façades : ils portent le bardage et transmettent le vent aux poteaux et aux potelets.' },
  { cle: 'répartition', fiche: 'Ossature', texte: 'Entraxe imposé : les éléments sont posés au plus à l’entraxe demandé, l’entraxe réel est coté sur les plans. Nombre imposé : l’entraxe en découle.' },
  { cle: 'entraxe demandé', fiche: 'Ossature', texte: 'Distance maximale entre deux éléments voisins ; l’entraxe réel, un peu plus serré pour tomber juste, est coté sur les plans.' },
  { cle: 'Pannes — files de liernes', texte: 'Nombre de lignes de liernes par travée : 1 à mi-portée, 2 aux tiers.' },
  { cle: 'Lisses de bardage — arase du soubassement', texte: 'Hauteur de la première lisse au-dessus du sol : le dessus du soubassement maçonné ou béton, quand il y en a un.' },
  { cle: 'Lisses de bardage — lisses sur pignons', texte: 'Poser des lisses aussi sur les façades pignons, en plus des long-pans.' },
  { cle: 'Potelets de pignon', texte: 'Poteaux secondaires des pignons : ils reprennent le vent sur la façade et portent les lisses, entre les poteaux d’angle.' },
  { cle: 'Potelets de pignon — course des oblongs de tête', texte: 'Jeu vertical des trous oblongs de l’attache de tête : le potelet ne doit pas porter la traverse de pignon quand elle fléchit. La vérification compare cette course à la flèche.' },
  { cle: 'Profil du chevêtre', texte: 'Profil des montants et linteaux qui encadrent une ouverture. Il a la hauteur des lisses : bardage plan, attaches plaquées.' },
  // Contreventements
  { cle: 'Poutre au vent', texte: 'Contreventement dans le plan de la toiture : il ramène le vent des pignons aux palées de stabilité des long-pans.' },
  { cle: 'Palées de stabilité', texte: 'Contreventement vertical des long-pans : il descend aux fondations les efforts longitudinaux : vent sur les pignons et stabilité d’ensemble.' },
  { cle: 'Pignon', fiche: 'Contreventements', texte: 'Contreventement dans le plan du pignon, entre potelets ou poteaux d’angle.' },
  { cle: 'disposition', fiche: 'Contreventements', texte: 'Croix de Saint-André (deux diagonales tendues), diagonale seule, ou K quand une ouverture doit rester libre.' },
  { cle: 'travées', fiche: 'Contreventements', texte: 'Travées contreventées. Sans choix, la première et la dernière ; sur un bâtiment long, une palée centrale laisse la dilatation se faire vers les pignons.' },
  // Assemblages
  { cle: 'épaisseur', fiche: 'Assemblages', texte: 'Épaisseur de la tôle. Une platine d’about trop mince plie avant que les boulons ne travaillent (effet de levier).' },
  { cle: 'boulons', fiche: 'Assemblages', texte: 'Diamètre (M16, M20…) et classe : 8.8 ou 10.9, soit une résistance à la traction de 800 ou 1 000 N/mm².' },
  { cle: 'rangées × files', texte: 'Rangées : lignes de boulons sur la hauteur de la platine. Files : colonnes sur sa largeur, en général 2, de part et d’autre de l’âme.' },
  { cle: 'pince', texte: 'Distance du bord de la tôle au centre du premier trou. Au moins 1,2 d0 (EN 1993-1-8, tableau 3.3) ; d0 est le diamètre du trou.' },
  { cle: 'entraxe de files', texte: 'Distance entre les deux files de boulons, de part et d’autre de l’âme. Au moins 2,4 d0 (EN 1993-1-8).' },
  { cle: 'débord', fiche: 'Assemblages', texte: 'Dépassement de la platine au-delà de la semelle de la traverse.' },
  { cle: 'tiges d’ancrage', texte: 'Tiges scellées dans la fondation qui tiennent la platine de pied : nombre et diamètre. 2 pour un pied articulé, 4 ou plus si encastré.' },
  { cle: 'scellement', texte: 'Longueur de la tige noyée dans le béton.' },
  { cle: 'mortier de calage', texte: 'Épaisseur du mortier sans retrait coulé sous la platine après réglage : elle laisse la place de caler le poteau d’aplomb et à niveau.' },
  { cle: 'bêche de cisaillement', texte: 'Plat ou profilé soudé sous la platine et noyé dans le béton : il reprend l’effort horizontal en pied, que les tiges reprennent mal.' },
  { cle: 'marge de tôle', texte: 'Tôle laissée au-delà du dernier trou d’un gousset, pour la pince et la découpe.' },
  { cle: 'Éclisse de continuité', texte: 'Raboutage de la traverse en deux tronçons, par plats boulonnés, quand elle est trop longue à transporter ou à galvaniser d’une pièce.' },
  { cle: 'platine', fiche: 'Assemblages', texte: 'Platine de pied de poteau : largeur, longueur et épaisseur. Elle répartit l’effort du poteau sur le béton.' },
  { cle: 'boulonnerie', fiche: 'Assemblages', texte: 'Boulons des attaches secondaires (pannes, lisses, contreventements) : diamètre et classe.' },
  { cle: 'cornière', fiche: 'Assemblages', texte: 'Profil de la cornière d’échantignolle.' },
  { cle: 'longueur', fiche: 'Assemblages', texte: 'Longueur du tronçon de cornière de chaque échantignolle.' },
  { cle: 'échantignolles', texte: 'Tronçons de cornière soudés sur la traverse qui reçoivent les pannes : ils les tiennent et les empêchent de basculer.' },
  // Charges
  { cle: 'Origine des charges', texte: 'Saisies à la main, ou calculées depuis le site (région de neige et de vent, terrain, altitude) selon l’EN 1991-1-3 et 1-4 et leur annexe nationale.' },
  { cle: 'Permanentes (couverture)', texte: 'Poids de la couverture, de l’isolation et des équipements suspendus, en kN/m² de toiture. Le poids de l’acier est compté à part.' },
  { cle: 'Poids propre de l’acier', texte: 'Ajoute automatiquement le poids des profils choisis. Le décocher ne sert qu’à recouper un calcul fait à la main.' },
  { cle: 'Exploitation', texte: 'Charge d’entretien de toiture (catégorie H de l’EN 1991-1-1), non cumulée avec la neige.' },
  { cle: 'Neige', fiche: 'Charges', texte: 'Charge de neige sur la toiture, en kN/m² de projection horizontale.' },
  { cle: 'Neige accidentelle', texte: 'Chute de neige exceptionnelle (zones de l’annexe nationale française), traitée en situation accidentelle.' },
  { cle: 'Vent — pression', texte: 'Pression du vent appliquée aux parois au vent, en kN/m².' },
  { cle: 'Vent — dépression', texte: 'Succion du vent sur la toiture, en kN/m² : c’est elle qui soulève les pannes et retourne les efforts.' },
  { cle: 'Traverses', fiche: 'Charges', texte: 'Flèche admise des traverses, en fraction de leur portée : L/200 signifie 1 mm de flèche par 200 mm de portée.' },
  { cle: 'Pannes', fiche: 'Charges', texte: 'Flèche admise des pannes, en fraction de leur portée (L/…). Elle conditionne la tenue de la couverture.' },
  { cle: 'Lisses', fiche: 'Charges', texte: 'Flèche admise des lisses sous le vent, en fraction de leur portée (L/…).' },
  { cle: 'Déplacement en tête', texte: 'Déplacement horizontal admis en tête de poteau, en fraction de la hauteur (H/…).' },
  { cle: 'γG / γQ', texte: 'Coefficients partiels des actions à l’ELU (EN 1990) : 1,35 sur les permanentes, 1,5 sur les variables.' },
  { cle: 'ψ0 neige / vent / exploitation', texte: 'Coefficients de combinaison (EN 1990) : la part d’une action variable retenue quand elle accompagne l’action principale.' },
  { cle: 'soudure des semelles', fiche: 'Assemblages', texte: 'Cordons d’angle des deux côtés de chaque semelle, gorge 0,7 × la plus mince des deux tôles ; ou soudure bout à bout à pleine pénétration, qui résiste comme la semelle elle-même. L’âme reste soudée par cordons d’angle.' },
  // Chiffrage
  { cle: 'Boulon posé', fiche: 'Chiffrage', texte: 'Prix moyen d’un boulon fourni et posé, rondelles et écrou compris, toutes tailles confondues.' },
  { cle: 'Heure d’atelier', fiche: 'Chiffrage', texte: 'Coût horaire chargé de l’atelier, débit et perçage compris. Il valorise le temps par pièce et la soudure.' },
  { cle: 'Temps par pièce', fiche: 'Chiffrage', texte: 'Manutention, réglage et contrôle de chaque pièce débitée, en heures : même une panne sans soudure en consomme.' },
  { cle: 'Cadence de soudure', fiche: 'Chiffrage', texte: 'Mètres de cordon déposés par heure d’atelier ; le temps de soudure en découle.' },
  { cle: 'Transport', fiche: 'Chiffrage', texte: 'Par tonne livrée, boulonnerie comprise. À zéro, le transport reste hors du total et le chiffrage le signale.' },
  { cle: 'Montage et levage', fiche: 'Chiffrage', texte: 'Par tonne d’acier montée, grue et nacelles comprises. À zéro, le montage reste hors du total.' },
  { cle: 'Frais généraux', fiche: 'Chiffrage', texte: 'Pourcentage du déboursé sec : structure, bureau d’études, assurances.' },
  { cle: 'Aléas', fiche: 'Chiffrage', texte: 'Pourcentage du déboursé sec réservé aux imprévus de fabrication et de chantier.' },
  { cle: 'Marge', fiche: 'Chiffrage', texte: 'Pourcentage du prix de revient — déboursé sec, frais généraux et aléas compris.' },
  // Traitement de surface
  { cle: 'Préparation', texte: 'Degré de propreté de l’acier avant peinture (ISO 8501-1). Sa 2½ : grenaillage très soigné, l’exigence courante.' },
  { cle: 'Corrosivité', texte: 'Catégorie d’ambiance (ISO 12944-2) : C1 intérieur sec, C3 urbain, C4 industriel ou côtier, C5 très agressif. Elle fixe le système de peinture.' },
  { cle: 'Nature', fiche: 'Traitement', texte: 'Peinture (système selon l’ISO 12944) ou galvanisation à chaud (EN ISO 1461).' },
  { cle: 'Primaire époxy zinc', texte: 'Couche du système de peinture : épaisseur de film sec en µm, et teinte RAL.' },
  { cle: 'Finition polyuréthane', texte: 'Couche du système de peinture : épaisseur de film sec en µm, et teinte RAL.' },
  { cle: 'Consigne', fiche: 'Traitement', texte: 'Texte libre reporté sur les plans et les documents de peinture.' },
  // Atelier
  { cle: 'Classe d’exécution', texte: 'EXC1 à EXC4 (EN 1090-2) : niveau d’exigence de fabrication et de contrôle. EXC2 est la classe courante d’un bâtiment.' },
  { cle: 'Barres laminées — longueur maxi', texte: 'Longueur commerciale des poutrelles approvisionnées, en général 12 000 mm : au-delà, la pièce est raboutée.' },
  { cle: 'Tubes et cornières — longueur maxi', texte: 'Longueur commerciale des tubes, cornières, ronds et plats approvisionnés : 6 000 ou 12 000 mm selon le produit.' },
  { cle: 'Tôles — longueur', texte: 'Format des tôles du commerce dans lesquelles la tôlerie est imbriquée, par exemple 3 000 × 1 500 mm.' },
  { cle: 'Tôles — largeur', texte: 'Format des tôles du commerce dans lesquelles la tôlerie est imbriquée, par exemple 3 000 × 1 500 mm.' },
  { cle: 'Trait de scie', texte: 'Matière perdue à chaque coupe, l’épaisseur de la lame.' },
  { cle: 'Tombée d’about', texte: 'Longueur perdue à chaque bout de barre pour l’équerrer avant la première coupe.' },
  { cle: 'Chute réutilisable dès', texte: 'Une chute au moins aussi longue est stockée pour réemploi ; plus courte, elle part à la ferraille.' },
  { cle: 'Chute maxi d’un schéma (au-delà : à longueur)', texte: 'Part de chute au-delà de laquelle le calepinage renonce à couper dans la barre : les pièces sont commandées à longueur chez le négociant.' },
  { cle: 'Jeu de découpe', texte: 'Espace laissé entre deux pièces imbriquées dans une tôle, et au bord : la saignée du découpage.' },
];

const INDEX = new Map<string, Entree[]>();
for (const e of ENTREES) {
  const k = normaliser(e.cle);
  INDEX.set(k, [...(INDEX.get(k) ?? []), e]);
}

/**
 * Aide d'un champ, d'après son libellé complet (« Pannes — liernes ») ou sa
 * seule ligne (« pince »), et la fiche où il se trouve.
 */
export function aideDuChamp(libelleComplet: string, ligne: string, fiche: string): string | null {
  const f = normaliser(fiche);
  for (const cle of [libelleComplet, ligne]) {
    const trouvee = (INDEX.get(normaliser(cle)) ?? []).find((e) => !e.fiche || f.startsWith(normaliser(e.fiche)));
    if (trouvee) return trouvee.texte;
  }
  return null;
}

/** Nombre d'entrées : pour les tests. */
export const NB_AIDES = ENTREES.length;
