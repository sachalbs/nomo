/**
 * Fix Landmark Content - Enrichit le contenu des grands arrêts
 *
 * Usage: npx tsx scripts/fix-landmark-content.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

// ============================================================================
// DONNEES ENRICHIES DES GRANDS ARRETS
// ============================================================================

interface LandmarkData {
  themes: string[];
  content: string;
}

const LANDMARK_CONTENT: Record<string, LandmarkData> = {
  "Jand'heur": {
    themes: ["responsabilité du fait des choses", "présomption de responsabilité", "gardien", "article 1242"],
    content: `Arrêt Jand'heur - Cour de cassation, Chambres réunies, 13 février 1930

Faits : Le 22 avril 1925, un camion appartenant à la société 'Aux Galeries Belfortaises' renversa et blessa grièvement une mineure, Lise Jand'heur, alors qu'elle traversait la chaussée.

Solution : Les Chambres réunies cassent la décision des juges du fond et posent le principe que la présomption de responsabilité établie par l'article 1384 alinéa 1er du Code civil à l'encontre de celui qui a sous sa garde la chose inanimée qui a causé un dommage à autrui ne peut être détruite que par la preuve d'un cas fortuit ou de force majeure ou d'une cause étrangère qui ne lui soit pas imputable. Il ne suffit pas de prouver qu'il n'a commis aucune faute.

Portée : Cet arrêt fondateur consacre le régime de responsabilité du fait des choses comme une responsabilité de plein droit (objective), applicable à toutes les choses inanimées sans distinction. Le gardien est présumé responsable du seul fait du dommage causé par sa chose.`,
  },

  "Franck": {
    themes: ["garde de la chose", "usage direction contrôle", "vol", "transfert de garde"],
    content: `Arrêt Franck - Cour de cassation, Chambres réunies, 2 décembre 1941

Faits : Dans la nuit du 24 au 25 décembre 1929, une voiture appartenant au docteur Franck, confiée à son fils mineur, a été volée. Au cours de la même nuit, cette voiture, sous la conduite du voleur, a renversé et blessé mortellement le facteur Connot.

Solution : Les Chambres réunies rejettent le pourvoi et considèrent que le docteur Franck, 'privé de l'usage, de la direction et du contrôle de sa voiture, n'en avait plus la garde et n'était plus dès lors soumis à la présomption de responsabilité édictée par l'article 1384, alinéa 1er, du Code civil'.

Portée : Cet arrêt définit la garde comme une notion de fait reposant sur trois critères cumulatifs : l'usage, la direction et le contrôle de la chose. Il consacre la conception matérielle de la garde, dissociant garde et propriété. Le voleur devient gardien de la chose volée.`,
  },

  "Desmares": {
    themes: ["faute de la victime", "force majeure", "exonération", "responsabilité du fait des choses"],
    content: `Arrêt Desmares - Cour de cassation, 2e chambre civile, 21 juillet 1982, n°81-12.850

Portée : L'arrêt Desmares pose le principe selon lequel la faute de la victime n'exonère le gardien de sa responsabilité que si elle présente les caractères de la force majeure (extériorité, imprévisibilité, irrésistibilité). Cette solution rigoureuse supprime le partage de responsabilité en cas de simple faute de la victime.`,
  },

  "Gabillet": {
    themes: ["garde", "discernement", "mineur", "infans"],
    content: `Arrêt Gabillet - Cour de cassation, Assemblée plénière, 9 mai 1984

Portée : L'Assemblée plénière affirme que le discernement n'a pas à être recherché chez le gardien d'une chose. Un enfant, même très jeune (infans), peut être qualifié de gardien s'il a l'usage, le contrôle et la direction de la chose. La responsabilité du fait des choses est une responsabilité objective qui ne requiert pas la capacité de discernement.`,
  },

  "Fullenwarth": {
    themes: ["responsabilité parentale", "faute du mineur", "fait causal"],
    content: `Arrêt Fullenwarth - Cour de cassation, Assemblée plénière, 9 mai 1984

Portée : L'Assemblée plénière abandonne l'exigence d'une faute du mineur pour engager la responsabilité de ses parents. Il suffit désormais d'établir qu'un fait quelconque du mineur a été la cause directe du dommage. Cette solution objective la responsabilité parentale et facilite l'indemnisation des victimes.`,
  },

  "Bertrand": {
    themes: ["responsabilité parentale", "cohabitation", "présomption"],
    content: `Arrêt Bertrand - Cour de cassation, 2e chambre civile, 19 février 1997

Portée : La Cour de cassation retient une conception large de la cohabitation au sens de l'article 1384 alinéa 4 (devenu 1242). Les parents restent responsables même si l'enfant ne vit pas temporairement avec eux au moment des faits, dès lors que la résidence habituelle de l'enfant est chez ses parents.`,
  },

  "Levert": {
    themes: ["responsabilité parentale", "fait causal", "instrument du dommage"],
    content: `Arrêt Levert - Cour de cassation, 2e chambre civile, 8 février 2001

Portée : Confirmation et renforcement de la jurisprudence Fullenwarth. La responsabilité des parents est engagée du seul fait que l'enfant a été l'instrument du dommage. Cette formulation consacre une responsabilité parentale objective, facilitant l'indemnisation des victimes.`,
  },

  "Blieck": {
    themes: ["responsabilité du fait d'autrui", "principe général", "article 1242", "associations"],
    content: `Arrêt Blieck - Cour de cassation, Assemblée plénière, 29 mars 1991, n°89-15.231

Faits : Un handicapé mental, placé dans un centre d'aide par le travail (CAT), avait mis le feu à une forêt voisine.

Solution : L'Assemblée plénière affirme que l'article 1384 alinéa 1er (devenu 1242) pose un principe général de responsabilité du fait d'autrui applicable aux personnes ayant accepté la charge d'organiser et de contrôler, à titre permanent, le mode de vie d'autrui.

Portée : Cet arrêt majeur consacre un principe général de responsabilité du fait d'autrui au-delà des cas expressément prévus par la loi. Il étend la responsabilité aux associations et organismes ayant la garde d'autrui.`,
  },

  "Costedoat": {
    themes: ["immunité du préposé", "responsabilité des commettants", "limites de mission"],
    content: `Arrêt Costedoat - Cour de cassation, Assemblée plénière, 25 février 2000, n°97-17.378

Faits : Un préposé, pilote d'hélicoptère, avait causé des dommages en effectuant des épandages de produits phytosanitaires.

Solution : L'Assemblée plénière pose le principe que 'n'engage pas sa responsabilité à l'égard des tiers le préposé qui agit sans excéder les limites de la mission qui lui a été impartie par son commettant'.

Portée : Cet arrêt consacre l'immunité civile du préposé agissant dans le cadre de sa mission. Seul le commettant est responsable, sauf faute pénale intentionnelle ou dépassement des limites de la mission.`,
  },

  "Perruche": {
    themes: ["préjudice de naissance", "handicap", "diagnostic prénatal", "vie dommageable"],
    content: `Arrêt Perruche - Cour de cassation, Assemblée plénière, 17 novembre 2000, n°99-13.701

Faits : Nicolas Perruche est né lourdement handicapé après que les médecins ont manqué le diagnostic de rubéole de sa mère, qui aurait avorté si elle avait été correctement informée.

Solution : L'Assemblée plénière reconnaît à l'enfant né handicapé le droit d'être indemnisé de son préjudice.

Portée : Arrêt très controversé admettant le préjudice de l'enfant du fait de sa naissance avec un handicap. Cette solution a été remise en cause par la loi anti-Perruche du 4 mars 2002 (loi Kouchner).`,
  },

  "Erika": {
    themes: ["préjudice écologique", "environnement", "marée noire", "responsabilité pénale"],
    content: `Arrêt Erika - Cour de cassation, Chambre criminelle, 25 septembre 2012, n°10-82.938

Faits : Le naufrage du pétrolier Erika en décembre 1999 a provoqué une marée noire catastrophique sur les côtes françaises.

Solution : La Chambre criminelle confirme la condamnation pour pollution maritime et reconnaît le préjudice écologique comme réparable.

Portée : Arrêt historique consacrant la réparation du préjudice écologique pur, distinct des préjudices économiques et moraux. Cette jurisprudence a été codifiée par la loi du 8 août 2016 (articles 1246 et suivants du Code civil).`,
  },

  "Canal de Craponne": {
    themes: ["imprévision", "force obligatoire du contrat", "révision judiciaire", "article 1195"],
    content: `Arrêt Canal de Craponne - Cour de cassation, Chambre civile, 6 mars 1876

Faits : Un contrat de 1567 prévoyait une redevance fixe pour l'entretien d'un canal d'irrigation. Trois siècles plus tard, cette redevance était devenue dérisoire en raison de l'évolution monétaire.

Solution : La Cour de cassation rejette la demande de révision du contrat, affirmant que 'dans aucun cas, il n'appartient aux tribunaux, quelque équitable que puisse leur paraître leur décision, de prendre en considération le temps et les circonstances pour modifier les conventions des parties'.

Portée : Cet arrêt consacre le rejet de la théorie de l'imprévision en droit privé français, au nom de la force obligatoire des contrats. Cette position a été nuancée par la réforme du droit des contrats de 2016 (article 1195 du Code civil).`,
  },

  "Chronopost": {
    themes: ["clause limitative de responsabilité", "obligation essentielle", "cause", "article 1170"],
    content: `Arrêt Chronopost - Cour de cassation, Chambre commerciale, 22 octobre 1996, n°93-18.632

Faits : La société Chronopost avait livré en retard des plis contenant une soumission à un appel d'offres. La clause limitative de responsabilité du contrat limitait l'indemnisation au prix du transport.

Solution : La Cour de cassation juge que 'en raison du manquement à cette obligation essentielle, la clause limitative de responsabilité du contrat, qui contredisait la portée de l'engagement pris, devait être réputée non écrite'.

Portée : Arrêt fondateur posant qu'une clause limitative ne peut contredire l'obligation essentielle du contrat. Ce principe a été codifié à l'article 1170 du Code civil par la réforme de 2016.`,
  },

  "Baldus": {
    themes: ["erreur sur les qualités essentielles", "authenticité", "œuvre d'art", "nullité"],
    content: `Arrêt Baldus - Cour de cassation, 1ère chambre civile, 3 mai 2000, n°98-11.381

Faits : Un vendeur avait cédé des photographies de Baldus à un prix dérisoire, ignorant leur valeur artistique.

Solution : La Cour de cassation refuse d'annuler la vente pour erreur, considérant que l'acheteur n'avait pas d'obligation d'informer le vendeur de la valeur des biens.

Portée : Cet arrêt confirme l'absence de devoir général d'information de l'acheteur sur la valeur du bien. Il distingue la réticence dolosive (sanction du silence frauduleux) de la simple absence d'information sur la valeur.`,
  },

  "Poussin": {
    themes: ["erreur sur la substance", "vices du consentement", "authenticité", "nullité"],
    content: `Arrêt Poussin - Cour de cassation, 1ère chambre civile, 22 février 1978

Faits : Un tableau vendu comme étant de l'école des Carrache s'est révélé être une œuvre authentique de Nicolas Poussin, d'une valeur bien supérieure.

Portée : La Cour de cassation définit l'erreur sur la substance comme l'erreur portant sur les qualités substantielles de la chose, c'est-à-dire celles qui ont été déterminantes du consentement. L'authenticité d'une œuvre d'art est une qualité substantielle justifiant la nullité pour erreur.`,
  },

  "Huard": {
    themes: ["bonne foi", "exécution du contrat", "obligation de renégociation"],
    content: `Arrêt Huard - Cour de cassation, Chambre commerciale, 3 novembre 1992, n°90-18.547

Faits : Un distributeur de carburant contestait le refus de son fournisseur de renégocier les conditions du contrat devenues déséquilibrées.

Solution : La Cour de cassation impose au contractant de mettre son partenaire en mesure de pratiquer un prix concurrentiel, au nom de l'exigence de bonne foi dans l'exécution du contrat.

Portée : Cet arrêt illustre le devoir de coopération entre contractants et l'obligation de renégociation fondée sur la bonne foi contractuelle (article 1104 du Code civil).`,
  },

  "Manoukian": {
    themes: ["rupture des négociations", "bonne foi", "responsabilité précontractuelle", "abus"],
    content: `Arrêt Manoukian - Cour de cassation, Chambre commerciale, 26 novembre 2003, n°00-10.243

Faits : Des négociations avancées en vue de la cession d'une société avaient été brutalement rompues.

Solution : La Cour de cassation retient la responsabilité de celui qui rompt brutalement des négociations avancées, au mépris de la confiance légitime créée chez son partenaire.

Portée : Cet arrêt consacre le principe de la responsabilité pour rupture abusive des pourparlers, désormais codifié à l'article 1112 du Code civil.`,
  },

  "Boot Shop": {
    themes: ["opposabilité du contrat", "tiers", "effet relatif", "responsabilité"],
    content: `Arrêt Boot Shop - Cour de cassation, Assemblée plénière, 6 octobre 2006, n°05-13.255

Faits : Un tiers invoquait l'inexécution d'un contrat auquel il n'était pas partie pour fonder son action en responsabilité.

Solution : L'Assemblée plénière affirme que 'le tiers à un contrat peut invoquer, sur le fondement de la responsabilité délictuelle, un manquement contractuel dès lors que ce manquement lui a causé un dommage'.

Portée : Cet arrêt consacre l'opposabilité du contrat aux tiers et leur permet d'invoquer un manquement contractuel comme fondement de leur action délictuelle.`,
  },

  "Faurecia II": {
    themes: ["clause limitative", "faute lourde", "obligation essentielle"],
    content: `Arrêt Faurecia II - Cour de cassation, Chambre commerciale, 29 juin 2010, n°09-11.841

Faits : Un fournisseur informatique avait livré un logiciel défaillant. Sa responsabilité était limitée par une clause du contrat.

Solution : La Cour de cassation précise que la faute lourde fait obstacle à l'application d'une clause limitative de responsabilité.

Portée : Cet arrêt complète la jurisprudence Chronopost en précisant que la faute lourde (définie comme la négligence d'une extrême gravité) neutralise les clauses limitatives.`,
  },

  "Besse": {
    themes: ["chaînes de contrats", "action directe", "sous-traitance", "effet relatif"],
    content: `Arrêt Besse - Cour de cassation, Assemblée plénière, 12 juillet 1991, n°90-13.602

Faits : Un maître de l'ouvrage agissait contre un sous-traitant pour malfaçons.

Solution : L'Assemblée plénière refuse l'action directe contractuelle du maître de l'ouvrage contre le sous-traitant, consacrant la distinction entre groupes de contrats translatifs de propriété (action directe possible) et non translatifs (action délictuelle seulement).

Portée : Cet arrêt limite l'action directe aux chaînes translatives de propriété et maintient le principe de l'effet relatif des contrats.`,
  },

  "Blanco": {
    themes: ["responsabilité de l'État", "service public", "compétence juridiction administrative", "autonomie droit administratif"],
    content: `Arrêt Blanco - Tribunal des conflits, 8 février 1873

Faits : Agnès Blanco, âgée de 5 ans, a été renversée et grièvement blessée par un wagonnet d'une manufacture de tabac exploitée par l'État à Bordeaux. Son père a saisi les tribunaux judiciaires pour faire déclarer l'État civilement responsable.

Solution : Le Tribunal des conflits attribue la compétence à la juridiction administrative, considérant que 'la responsabilité, qui peut incomber à l'État, pour les dommages causés aux particuliers par le fait des personnes qu'il emploie dans le service public, ne peut être régie par les principes qui sont établis dans le Code civil, pour les rapports de particulier à particulier'.

Portée : Arrêt fondateur du droit administratif français. Il consacre : 1) La responsabilité de l'État (fin de l'irresponsabilité) ; 2) L'autonomie du droit administratif par rapport au droit civil ; 3) Le service public comme critère de compétence du juge administratif.`,
  },

  "Terrier": {
    themes: ["contrat administratif", "service public", "collectivités locales", "compétence"],
    content: `Arrêt Terrier - Conseil d'État, 6 février 1903

Faits : Le département de Saône-et-Loire avait organisé la destruction des vipères en promettant des primes. M. Terrier, ayant détruit des vipères, réclamait le paiement de primes que le département refusait.

Portée : Le Conseil d'État affirme sa compétence pour les litiges relatifs aux services publics locaux. Il étend le critère du service public dégagé par l'arrêt Blanco aux collectivités territoriales.`,
  },

  "Benjamin": {
    themes: ["liberté de réunion", "police administrative", "proportionnalité", "contrôle du juge"],
    content: `Arrêt Benjamin - Conseil d'État, 19 mai 1933

Faits : Le maire de Nevers avait interdit une conférence littéraire de René Benjamin, invoquant des risques de troubles à l'ordre public liés aux protestations de syndicats d'instituteurs.

Solution : Le Conseil d'État annule l'arrêté d'interdiction, considérant que 'l'éventualité de troubles, alléguée par le maire de Nevers, ne présentait pas un degré de gravité tel qu'il n'ait pu, sans interdire la conférence, maintenir l'ordre en édictant les mesures de police qu'il lui appartenait de prendre'.

Portée : Arrêt fondateur du contrôle de proportionnalité des mesures de police. Le juge administratif vérifie que l'autorité de police a choisi la mesure la moins restrictive des libertés pour atteindre l'objectif de maintien de l'ordre public.`,
  },

  "Dehaene": {
    themes: ["droit de grève", "fonctionnaires", "service public", "limitations"],
    content: `Arrêt Dehaene - Conseil d'État, 7 juillet 1950

Faits : Des fonctionnaires avaient fait grève malgré l'interdiction édictée par une circulaire gouvernementale et avaient été sanctionnés.

Solution : Le Conseil d'État reconnaît que le droit de grève est applicable aux agents publics en vertu du Préambule de 1946, mais admet que le gouvernement peut en limiter l'exercice pour assurer la continuité du service public.

Portée : Cet arrêt reconnaît le droit de grève des fonctionnaires tout en admettant des restrictions justifiées par les nécessités du service public.`,
  },

  "Dame Lamotte": {
    themes: ["recours pour excès de pouvoir", "principe général du droit", "recours juridictionnel"],
    content: `Arrêt Ministre de l'Agriculture c/ Dame Lamotte - Conseil d'État, 17 février 1950

Faits : Une loi de Vichy avait prévu que certaines décisions administratives ne pouvaient faire l'objet d'aucun recours.

Solution : Le Conseil d'État affirme qu'il 'résulte des principes généraux du droit' que tout acte administratif peut être contesté devant le juge de l'excès de pouvoir.

Portée : Consécration du recours pour excès de pouvoir comme principe général du droit. Cette garantie fondamentale assure aux administrés un droit au juge contre toute décision administrative.`,
  },

  "Barel": {
    themes: ["égalité d'accès aux emplois publics", "discrimination politique", "concours", "liberté d'opinion"],
    content: `Arrêt Barel - Conseil d'État, 28 mai 1954

Faits : M. Barel, candidat au concours de l'ENA, s'était vu refuser l'autorisation de se présenter au concours, apparemment en raison de ses opinions communistes.

Solution : Le Conseil d'État annule le refus, considérant que l'administration ne peut écarter un candidat en se fondant exclusivement sur ses opinions politiques.

Portée : Affirmation du principe d'égal accès aux emplois publics (article 6 DDHC) et de la liberté d'opinion.`,
  },

  "Jacques Vabre": {
    themes: ["primauté du droit communautaire", "traité", "loi", "contrôle de conventionnalité"],
    content: `Arrêt Jacques Vabre - Cour de cassation, Chambre mixte, 24 mai 1975

Faits : La société Cafés Jacques Vabre contestait l'application d'une taxe fiscale contraire au traité de Rome.

Solution : La Cour de cassation accepte d'écarter une loi postérieure contraire au traité, affirmant la primauté du droit communautaire.

Portée : Arrêt fondateur du contrôle de conventionnalité par le juge judiciaire. La Cour de cassation fait prévaloir le traité sur la loi, même postérieure.`,
  },

  "Nicolo": {
    themes: ["primauté du droit international", "traité", "loi", "contrôle de conventionnalité"],
    content: `Arrêt Nicolo - Conseil d'État, Assemblée, 20 octobre 1989

Faits : M. Nicolo contestait les élections européennes de 1989, arguant que la participation des électeurs des DOM-TOM était contraire au traité de Rome.

Solution : Le Conseil d'État accepte d'examiner la compatibilité de la loi électorale avec le traité de Rome, opérant ainsi un contrôle de conventionnalité.

Portée : Revirement majeur. Le Conseil d'État abandonne la théorie de la 'loi-écran' et accepte de faire prévaloir un traité sur une loi postérieure. Il s'aligne sur la jurisprudence Jacques Vabre de la Cour de cassation (1975).`,
  },

  "Morsang-sur-Orge": {
    themes: ["dignité humaine", "ordre public", "police administrative", "lancer de nain"],
    content: `Arrêt Commune de Morsang-sur-Orge - Conseil d'État, Assemblée, 27 octobre 1995

Faits : Des maires avaient interdit des spectacles de 'lancer de nain' organisés dans des discothèques.

Solution : Le Conseil d'État valide l'interdiction, considérant que 'le respect de la dignité de la personne humaine est une des composantes de l'ordre public'.

Portée : La dignité humaine devient une composante autonome de l'ordre public. Elle est d'ordre public et ne peut faire l'objet d'un consentement.`,
  },

  "KPMG": {
    themes: ["sécurité juridique", "principe général du droit", "mesures transitoires", "changement de réglementation"],
    content: `Arrêt Société KPMG et autres - Conseil d'État, Assemblée, 24 mars 2006

Faits : Un décret modifiant brutalement les règles applicables aux commissaires aux comptes était contesté pour l'absence de mesures transitoires.

Solution : Le Conseil d'État consacre le principe de sécurité juridique comme principe général du droit et impose à l'administration d'édicter des mesures transitoires lorsqu'une nouvelle réglementation est susceptible de porter une atteinte excessive à des situations juridiques existantes.

Portée : Consécration du principe de sécurité juridique en droit administratif.`,
  },

  "Danthony": {
    themes: ["vice de procédure", "illégalité", "garantie", "influence sur décision"],
    content: `Arrêt Danthony et autres - Conseil d'État, Assemblée, 23 décembre 2011

Solution : Le Conseil d'État juge qu'un vice de procédure n'entache d'illégalité la décision que 's'il ressort des pièces du dossier qu'il a été susceptible d'exercer, en l'espèce, une influence sur le sens de la décision prise ou qu'il a privé les intéressés d'une garantie'.

Portée : Cette jurisprudence relativise l'effet des vices de procédure en exigeant qu'ils aient eu une incidence réelle.`,
  },

  "Czabaj": {
    themes: ["délai de recours", "sécurité juridique", "délai raisonnable", "notification"],
    content: `Arrêt Czabaj - Conseil d'État, Assemblée, 13 juillet 2016

Solution : Le Conseil d'État pose le principe qu'au-delà d'un délai raisonnable, fixé à un an sauf circonstances particulières, une décision ne peut plus être contestée, même en l'absence de notification des délais de recours.

Portée : Au nom de la sécurité juridique, le Conseil d'État limite la possibilité de contester indéfiniment une décision administrative.`,
  },

  "Liberte d'association": {
    themes: ["liberté d'association", "PFRLR", "Préambule", "bloc de constitutionnalité"],
    content: `Décision Liberté d'association - Conseil constitutionnel, 16 juillet 1971, n°71-44 DC

Faits : Une loi soumettant la constitution des associations à un contrôle préalable du préfet était contestée.

Solution : Le Conseil constitutionnel censure la loi au visa du Préambule de la Constitution de 1958 qui renvoie au Préambule de 1946.

Portée : Décision fondatrice. Le Conseil constitutionnel intègre le Préambule et les principes qu'il mentionne dans le bloc de constitutionnalité.`,
  },

  "IVG": {
    themes: ["contrôle de conventionnalité", "traité", "Constitution", "compétence"],
    content: `Décision IVG - Conseil constitutionnel, 15 janvier 1975, n°74-54 DC

Faits : La loi Veil relative à l'interruption volontaire de grossesse était contestée comme contraire à la Convention européenne des droits de l'homme.

Solution : Le Conseil constitutionnel refuse d'examiner la conformité de la loi à la Convention européenne, considérant que ce contrôle ne relève pas de sa compétence.

Portée : Le Conseil constitutionnel se déclare incompétent pour le contrôle de conventionnalité, laissant cette mission aux juridictions ordinaires.`,
  },

  "Mariage pour tous": {
    themes: ["mariage", "couples de même sexe", "égalité", "liberté du mariage"],
    content: `Décision Mariage pour tous - Conseil constitutionnel, 17 mai 2013, n°2013-669 DC

Faits : La loi ouvrant le mariage aux couples de personnes de même sexe était contestée.

Solution : Le Conseil constitutionnel valide la loi, considérant que le législateur peut librement définir les conditions du mariage.

Portée : Validation de l'évolution du droit de la famille. Le Conseil confirme la large marge d'appréciation du législateur en matière de mariage et de filiation.`,
  },

  "Mercier": {
    themes: ["responsabilité médicale", "obligation de moyens", "contrat médical"],
    content: `Arrêt Mercier - Cour de cassation, Chambre civile, 20 mai 1936

Faits : Un patient reprochait à son médecin un traitement aux rayons X ayant causé des brûlures.

Solution : La Cour de cassation affirme qu'il se forme entre le médecin et son client 'un véritable contrat comportant, pour le praticien, l'engagement de lui donner des soins consciencieux, attentifs et conformes aux données acquises de la science'.

Portée : Arrêt fondateur de la responsabilité médicale contractuelle. Le médecin est tenu d'une obligation de moyens : il doit mettre en œuvre tous les moyens appropriés sans garantir la guérison.`,
  },

  "Pelletier": {
    themes: ["faute personnelle", "faute de service", "responsabilité agent public", "compétence"],
    content: `Arrêt Pelletier - Tribunal des conflits, 30 juillet 1873

Faits : Un préfet avait fait saisir un journal. Le directeur du journal demandait réparation du préjudice devant les tribunaux judiciaires.

Solution : Le Tribunal des conflits distingue la faute personnelle, détachable du service et engageant la responsabilité personnelle de l'agent devant le juge judiciaire, de la faute de service, engageant la responsabilité de l'administration devant le juge administratif.

Portée : Arrêt fondateur de la distinction faute personnelle/faute de service.`,
  },

  "Lemaire": {
    themes: ["responsabilité du fait des choses", "acceptation des risques", "sport"],
    content: `Arrêt Lemaire - Cour de cassation, Assemblée plénière, 9 mai 1984

Portée : L'Assemblée plénière écarte la théorie de l'acceptation des risques comme cause d'exonération de la responsabilité du fait des choses. La victime qui participe à une activité dangereuse ne renonce pas pour autant à son droit à réparation.`,
  },

  "Fragonard": {
    themes: ["erreur sur la substance", "aléa", "authenticité", "œuvre d'art"],
    content: `Arrêt Fragonard - Cour de cassation, 1ère chambre civile, 24 mars 1987

Faits : Un tableau vendu avec une attribution incertaine ('attribué à Fragonard') s'est révélé être une œuvre authentique.

Portée : La Cour de cassation précise que lorsque les parties ont accepté un aléa sur l'authenticité, l'erreur ne peut être invoquée. L'aléa sur la qualité substantielle chasse l'erreur.`,
  },
};

// ============================================================================
// UTILITAIRES
// ============================================================================

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      console.log(`  ⚠️  Erreur embedding (tentative ${attempt}/${maxRetries})`);
      if (attempt < maxRetries) {
        await sleep(5000);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Failed to generate embedding");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(65));
  console.log("        FIX LANDMARK CONTENT - Enrichissement des arrêts");
  console.log("=".repeat(65));
  console.log("\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error("❌ Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get all landmark cases
  console.log("📋 Récupération des grands arrêts...\n");
  const { data: landmarks, error } = await supabase
    .from("court_decisions")
    .select("id, landmark_name, content")
    .eq("is_landmark", true);

  if (error) {
    console.error("❌ Erreur:", error.message);
    process.exit(1);
  }

  if (!landmarks || landmarks.length === 0) {
    console.log("⚠️  Aucun grand arrêt trouvé (is_landmark = true)");
    process.exit(0);
  }

  console.log(`📊 ${landmarks.length} grands arrêts trouvés\n`);
  console.log("-".repeat(65));

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (let i = 0; i < landmarks.length; i++) {
    const landmark = landmarks[i];
    const progress = `[${i + 1}/${landmarks.length}]`;
    const name = landmark.landmark_name;

    if (!name) {
      console.log(`${progress} ⏭️  ID ${landmark.id} - pas de landmark_name`);
      skipped++;
      continue;
    }

    // Find enriched content
    const enrichedData = LANDMARK_CONTENT[name];

    if (!enrichedData) {
      console.log(`${progress} ⚠️  ${name} - pas de contenu enrichi disponible`);
      notFound++;
      continue;
    }

    console.log(`${progress} 🔄 ${name}...`);

    try {
      // Generate new embedding
      console.log(`  🧠 Génération embedding...`);
      const embedding = await generateEmbeddingWithRetry(enrichedData.content);

      // Update database by landmark_name
      const { error: updateError } = await supabase
        .from("court_decisions")
        .update({
          content: enrichedData.content,
          summary: enrichedData.content.substring(0, 500),
          embedding: embedding,
        })
        .eq("landmark_name", name)
        .eq("is_landmark", true);

      if (updateError) {
        console.log(`  ❌ Erreur update: ${updateError.message}`);
      } else {
        console.log(`  ✅ Mis à jour avec succès`);
        updated++;
      }
    } catch (error) {
      console.log(`  ❌ Erreur: ${error instanceof Error ? error.message : error}`);
    }

    // Rate limiting
    await sleep(1000);
  }

  // Summary
  console.log("\n");
  console.log("=".repeat(65));
  console.log("                      RÉSUMÉ");
  console.log("=".repeat(65));
  console.log("\n");

  console.log(`   ✅ Mis à jour:           ${updated}`);
  console.log(`   ⏭️  Sans landmark_name:   ${skipped}`);
  console.log(`   ⚠️  Contenu non trouvé:   ${notFound}`);
  console.log(`   📊 Total traité:         ${landmarks.length}`);

  if (notFound > 0) {
    console.log("\n   Arrêts sans contenu enrichi:");
    landmarks.forEach((l) => {
      if (l.landmark_name && !LANDMARK_CONTENT[l.landmark_name]) {
        console.log(`      - ${l.landmark_name}`);
      }
    });
  }

  console.log("\n");
  console.log("=".repeat(65));
  console.log("\n");
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
