import type { GuideTranslation } from "@/lib/guides/types";

/** Written in French, not translated (27 Oct 2026). DRAFT for the owner's
 *  review; published together with the English. The same honest claims:
 *  the link and QR card arrive the moment they pay, nothing about how long
 *  the making takes. No gendered agreements, no point médian (CLAUDE.md). */
export const fr: GuideTranslation = {
  slug: "cadeau-de-derniere-minute-personnalise",
  title: "Cadeaux de dernière minute qui restent personnels",
  metaTitle: "Cadeau de dernière minute personnalisé : idées",
  description:
    "Des idées de cadeaux de dernière minute qui restent personnels : ce que vous pouvez faire ce soir, ce qui arrive dès le paiement, et comment l'offrir le jour J.",
  published: "2026-10-27",
  updated: "2026-10-27",
  status: "draft",
  intro:
    "C'est demain, ou c'est aujourd'hui. Les cadeaux de dernière minute ont mauvaise réputation, parce qu'on finit souvent par attraper quelque chose d'impersonnel dans le magasin le plus proche. Pourtant, un cadeau peut arriver tard et rester personnel : ce qui le rend personnel, c'est ce qu'il contient, pas la date à laquelle on l'a acheté. Voici des idées qui demandent une soirée plutôt qu'une semaine, ce qu'on peut offrir quand plus rien ne peut être livré à temps, et comment bien l'offrir le jour J.",
  blocks: [
    { type: "h2", text: "Ce qui rend un cadeau de dernière minute personnel" },
    {
      type: "p",
      text: "La seule chose qu'on ne peut pas rattraper à la dernière minute, c'est le temps passé avant. On peut en revanche en passer maintenant, et une soirée de vraie réflexion, ça se voit. Trois règles aident :",
    },
    {
      type: "list",
      items: [
        "Parlez de l'autre, pas de l'occasion : ses habitudes, vos moments, ce que vous êtes les seules personnes à savoir.",
        "Servez-vous de ce que vous avez déjà : les photos de votre téléphone, vos anciens messages, la chanson qui est la vôtre.",
        "Restez petit et sincère plutôt que grand et bâclé. Une page honnête vaut mieux qu'un cadeau cher choisi au hasard.",
      ],
    },

    { type: "h2", text: "Des idées qui demandent une soirée" },
    {
      type: "list",
      items: [
        "Une lettre sur cette année : ce qu'elle a été, et ce que l'autre a fait que vous avez remarqué.",
        "La liste des raisons pour lesquelles vous l'aimez, précises plutôt que générales.",
        "Une playlist de vos chansons dans l'ordre, avec un mot pour chacune.",
        "Une invitation écrite à la main : le jour, l'heure, et ce que vous allez faire.",
        "Le plat d'un voyage fait ensemble, cuisiné ce soir.",
      ],
    },

    { type: "h2", text: "Quand plus rien ne peut arriver à temps" },
    {
      type: "p",
      text: "Tout ce qui est physique demande un magasin ou une livraison. Un souvenir numérique, ni l'un ni l'autre. Les souvenirs Heartfolio sont livrés dès le paiement : un lien privé vers sa page et une carte QR, sur l'écran de confirmation et dans votre e-mail. Les souvenirs imprimables sont aussi livrés avec des fichiers prêts à imprimer, pour un imprimeur ou votre propre imprimante.",
    },
    {
      type: "p",
      text: "Le temps de création dépend de vous : de ce que vous écrivez et du nombre de photos que vous ajoutez. Vous voyez exactement ce que la personne recevra avant de payer, et rien ne lui parvient tant que vous n'avez pas envoyé le lien vous-même : c'est vous qui choisissez le moment.",
    },

    { type: "h2", text: "Trois idées qui fonctionnent au dernier moment" },
    { type: "h3", text: "Vos raisons" },
    {
      type: "p",
      text: "Si vous pouvez écrire ce soir dix phrases vraies à son sujet, vous tenez un cadeau. Les petits moments précis touchent le plus : « tu tiens encore la porte avec le pied quand tu as les mains pleines » en dit plus que « tu penses toujours aux autres ».",
    },
    {
      type: "capture",
      product: "reasons-i-love-you",
      caption: "Un exemple : le bocal s'ouvre et un petit mot se déplie, une raison à la fois.",
    },
    {
      type: "product",
      product: "reasons-i-love-you",
      note: "Jusqu'à dix de vos raisons dans un bocal de petits mots, une marguerite, un jeu de cœurs ou des biscuits de fortune, à ouvrir une à une depuis un lien sur son téléphone. Prêt à envoyer dès le paiement.",
    },

    { type: "h3", text: "Votre chanson" },
    {
      type: "p",
      text: "La plupart des couples ont une chanson. Retrouvez son lien sur YouTube et écrivez une phrase sur ce qui en fait la vôtre : c'est le cœur du cadeau.",
    },
    {
      type: "capture",
      product: "song-poster",
      caption: "Un exemple : le disque, puis l'onde sonore qui se remplit pendant que la chanson joue.",
    },
    {
      type: "product",
      product: "song-poster",
      note: "Une affiche pour votre chanson et une page qui la joue, avec un mot de vous. Il faut le lien YouTube de la chanson. La page est prête dès le paiement, et la version imprimable y ajoute des fichiers prêts à imprimer.",
    },

    { type: "h3", text: "Pour une remise de diplôme demain" },
    {
      type: "p",
      text: "Racontez le parcours de la personne diplômée : les photos au fil des années, ses réussites, et les messages de celles et ceux qui l'ont encouragée. Ce soir, demandez à quelques proches un mot ou un court message vocal par texto, puis ajoutez-les vous-même.",
    },
    {
      type: "capture",
      product: "graduation-keepsake",
      caption: "Un exemple : la carte d'embarquement, puis le hublot qui s'ouvre sur la remise des diplômes.",
    },
    {
      type: "product",
      product: "graduation-keepsake",
      note: "Son parcours avec vos photos, ses réussites et les messages que vous rassemblez, raconté comme un voyage à ouvrir sur son téléphone. Prêt à envoyer dès le paiement.",
    },

    { type: "h2", text: "Comment l'offrir le jour J" },
    {
      type: "list",
      items: [
        "Envoyez le lien avec un message de votre main, au moment choisi : au réveil, ou juste avant de vous retrouver.",
        "Montrez la carte QR sur votre téléphone quand vous êtes ensemble, ou imprimez-la et glissez-la dans une carte.",
        "Pour une fête, une carte QR imprimée sur la table permet à tout le monde de l'ouvrir.",
        "Si vous êtes loin, appelez pendant l'ouverture.",
      ],
    },

    { type: "h2", text: "Ce qu'il vaut mieux éviter" },
    {
      type: "list",
      items: [
        "De longues excuses pour le retard. Offrez le cadeau ; il parle de lui-même.",
        "Faire croire qu'il vous a pris des semaines. Ce n'est pas nécessaire.",
        "Un lien sans un mot. Ajoutez une phrase à vous, même courte.",
      ],
    },
    {
      type: "p",
      text: "Un cadeau fait la veille, avec une vraie attention dedans, reste un cadeau fait pour l'autre. C'est ce qu'on retient, pas la date à laquelle on a commencé.",
    },
  ],
};
