import type { ThemeSelections } from "@/types/studio";
import { exampleLocale, type ExampleLocale } from "@/lib/studio/example-locale";
import { DEFAULT_JOURNEY } from "./journeys";

/** A photo, drawing or voice message as the Studio stores it: `assetId` once
 * uploaded, `url` for the preview. The backend trusts only `assetId`. */
export interface GraduationMedia {
  url: string;
  mimeType?: string;
  filename?: string;
  assetId?: string;
}

export interface Stop {
  year: string;
  caption: string;
  /** Three letters; used by the airline journey only. */
  code?: string;
  photo?: GraduationMedia | null;
}

export interface Achievement {
  title: string;
  detail?: string;
  /** Printed on the airline journey's passport stamp. */
  place?: string;
}

export interface Person {
  name: string;
  /** A palette id (`journeys.ts`); empty means by position. */
  color?: string;
  emoji?: string;
  message: string;
  voice?: GraduationMedia | null;
  /** Untimed: shown beside the voice message while it plays. */
  voiceCaption?: string;
  drawing?: GraduationMedia | null;
}

export interface MessageGroup {
  label: string;
  people: Person[];
}

export interface Goal {
  text: string;
  /** Three letters; used by the airline journey only. */
  code?: string;
}

/**
 * The customer's inputs, flat by field id (the Studio's form is keyed that
 * way). The prototype's nested `GRAD` object maps onto this. Deliberately
 * absent (v1 scope, see the module's `index.ts`): the reply and its quick
 * reactions, `meta.id`, the date-format region (follows the language), the
 * chapter order (fixed), the branding switch (always shown), a send date and a
 * collection link.
 */
export interface GraduationValues {
  gradName: string;
  gradFullName: string;
  /** Four digits, kept as typed. */
  gradYear: string;
  gradDegree: string;
  gradSchool: string;
  /** `YYYY-MM-DD`. */
  gradDate: string;
  gradPhoto: GraduationMedia | null;

  pathEnabled: boolean;
  thenYear: string;
  thenText: string;
  thenPhoto: GraduationMedia | null;
  stops: Stop[];
  nowYear: string;
  nowText: string;
  nextText: string;
  nextPhoto: GraduationMedia | null;

  achievementsEnabled: boolean;
  achievements: Achievement[];

  messagesEnabled: boolean;
  messageGroups: MessageGroup[];

  goalsEnabled: boolean;
  goals: Goal[];

  letterEnabled: boolean;
  letterGreeting: string;
  letterParagraphs: { text: string }[];
  letterSignoff: string;
  letterSignatures: { name: string }[];

  endingLine: string;
  endingSub: string;

  /** The boarding pass; airline journey only. Empty falls back to the
   * journey's own translated defaults. */
  flightAirline: string;
  flightNumber: string;
  flightSeat: string;
  flightCabin: string;
  flightFromCode: string;
  flightFromCity: string;
  flightToCode: string;
  flightToCity: string;

  sound: boolean;
  showShare: boolean;
}

/** The text of the sample keepsake in each Studio language (25 Oct 2026:
 * /fr and /ar opened with the English one). The prototype's own Maya Chen;
 * the Arabic sample uses Arabic names so its sentences read one way. Codes,
 * colours, emoji and dates are shared below. No photos (those are the
 * customer's). Within GRADUATION_LIMITS in every language (tested). */
const EXAMPLES: Record<ExampleLocale, {
  gradName: string;
  gradFullName: string;
  gradDegree: string;
  gradSchool: string;
  thenText: string;
  stops: [string, string, string, string];
  nowText: string;
  nextText: string;
  achievements: [string, string, string][];
  groups: [string, string];
  people: [string, string, string, string, string, string];
  messages: [string, string, string, string, string, string];
  goals: [string, string, string, string, string];
  letterGreeting: string;
  letterParagraphs: [string, string, string];
  letterSignoff: string;
  endingLine: string;
  endingSub: string;
}> = {
  en: {
    gradName: "Maya",
    gradFullName: "Maya Chen",
    gradDegree: "BA (Hons) Architecture",
    gradSchool: "University of Edinburgh",
    thenText: "A five-year-old who drew houses on every wall in the flat.",
    stops: ["First day of school", "The Lego city phase", "Art prize, age 13", "Studio all-nighter no. 47"],
    nowText: "An architect, with a first-class degree to prove it.",
    nextText: "A junior designer role at a studio in Copenhagen, starting in September.",
    achievements: [
      ["First-class honours", "Top of the year in design studio", "EDINBURGH"],
      ["Dean's list", "Three years running", "ACADEMIA"],
      ["RIBA award shortlist", "For the riverside library", "LONDON"],
      ["Exchange year", "And surprisingly good Danish", "COPENHAGEN"],
      ["Society president", "Forty sketchers, one sketchbook", "STUDIO 4"],
      ["47 all-nighters", "Fuelled entirely by toast", "THE LIBRARY"],
    ],
    groups: ["From home", "From friends"],
    people: ["Mum", "Dad", "Kai", "Jonah", "Priya", "Sam"],
    messages: [
      "I still have every drawing you ever stuck on the fridge. Now I get to see your buildings on real streets. I am so, so proud of you.",
      "You worked harder than anyone I know, and you stayed kind while you did it. That's the real achievement. Well done, kiddo.",
      "Can you design me a treehouse with a slide. And a zip line. Well done Maya.",
      "Four years of sharing a desk, a kettle and about a thousand deadlines. Copenhagen has no idea what is coming. So proud of you!",
      "You're the only person I know who sketches the queue at the supermarket. Never stop. Love you, superstar.",
      "From drawing on the walls to designing actual walls. Ten-year-old me would be very impressed.",
    ],
    goals: [
      "Start at the studio in Copenhagen",
      "Become a fully qualified architect",
      "Learn to cycle in Copenhagen without getting lost",
      "Build Kai that treehouse",
      "Visit every Alvar Aalto building",
    ],
    letterGreeting: "Dear Maya,",
    letterParagraphs: [
      "Today you are wearing a cap and gown, but we still see the little girl with crayon all over her hands, explaining exactly where the front door of her house would go.",
      "You did this through late nights, hard days and more toast than any person should eat. We could not be prouder of who you have become.",
      "The world is about to get a little more beautiful. Go and build it.",
    ],
    letterSignoff: "With all our love,",
    endingLine: "Congratulations, Maya!",
    endingSub: "Your next chapter starts now.",
  },
  fr: {
    gradName: "Maya",
    gradFullName: "Maya Chen",
    gradDegree: "Licence d'architecture",
    gradSchool: "Université d'Édimbourg",
    thenText: "Une enfant de cinq ans qui dessinait des maisons sur tous les murs de l'appartement.",
    stops: ["Premier jour d'école", "La période des villes en Lego", "Prix d'art, à 13 ans", "Nuit blanche à l'atelier n° 47"],
    nowText: "Architecte, avec un diplôme mention très bien pour le prouver.",
    nextText: "Un poste de jeune designer dans une agence de Copenhague, dès septembre.",
    achievements: [
      ["Mention très bien", "Première de sa promo en atelier", "ÉDIMBOURG"],
      ["Tableau d'honneur", "Trois années de suite", "UNIVERSITÉ"],
      ["Sélectionnée au prix RIBA", "Pour la bibliothèque au bord du fleuve", "LONDRES"],
      ["Année d'échange", "Et un danois étonnamment bon", "COPENHAGUE"],
      ["Présidente d'association", "Quarante dessinateurs, un seul carnet", "ATELIER 4"],
      ["47 nuits blanches", "Entièrement aux tartines", "LA BIBLIOTHÈQUE"],
    ],
    groups: ["De la maison", "Des amis"],
    people: ["Maman", "Papa", "Kai", "Jonah", "Priya", "Sam"],
    messages: [
      "J'ai gardé tous les dessins que tu as collés sur le frigo. Maintenant, je vais voir tes bâtiments dans de vraies rues. Je suis tellement, tellement fière de toi.",
      "Tu as travaillé plus dur que n'importe qui, et tu es restée gentille en le faisant. C'est ça, la vraie réussite. Bravo, ma grande.",
      "Tu peux me dessiner une cabane avec un toboggan. Et une tyrolienne. Bravo Maya.",
      "Quatre ans à partager un bureau, une bouilloire et un bon millier de rendus. Copenhague ne sait pas ce qui l'attend. Tellement fier de toi !",
      "Tu es la seule personne que je connaisse qui dessine la file d'attente au supermarché. N'arrête jamais. Je t'adore, ma star.",
      "Des dessins sur les murs aux vrais murs. Moi à dix ans, j'aurais été très impressionné.",
    ],
    goals: [
      "Commencer à l'agence de Copenhague",
      "Devenir architecte diplômée",
      "Apprendre à faire du vélo à Copenhague sans se perdre",
      "Construire la cabane de Kai",
      "Visiter tous les bâtiments d'Alvar Aalto",
    ],
    letterGreeting: "Chère Maya,",
    letterParagraphs: [
      "Aujourd'hui, tu portes la toge et la toque, mais nous voyons encore la petite fille aux mains pleines de crayon, qui expliquait exactement où irait la porte d'entrée de sa maison.",
      "Tu y es arrivée à force de nuits tardives, de journées difficiles et de plus de tartines qu'on ne devrait en manger. Nous ne pourrions pas être plus fiers de la personne que tu es devenue.",
      "Le monde est sur le point de devenir un peu plus beau. Va le construire.",
    ],
    letterSignoff: "Avec tout notre amour,",
    endingLine: "Félicitations, Maya !",
    endingSub: "Ton prochain chapitre commence maintenant.",
  },
  ar: {
    gradName: "سلمى",
    gradFullName: "سلمى الخطيب",
    gradDegree: "بكالوريوس الهندسة المعمارية",
    gradSchool: "جامعة إدنبرة",
    thenText: "طفلة في الخامسة ترسم بيوتًا على كل جدار في الشقة.",
    stops: ["أول يوم في المدرسة", "مرحلة مدن الليغو", "جائزة الفن في الثالثة عشرة", "سهرة المرسم رقم 47"],
    nowText: "مهندسة معمارية، بمرتبة الشرف الأولى.",
    nextText: "وظيفة مصمّمة مبتدئة في مكتب بكوبنهاغن، تبدأ في سبتمبر.",
    achievements: [
      ["مرتبة الشرف الأولى", "الأولى على دفعتها في مرسم التصميم", "إدنبرة"],
      ["قائمة العميد", "ثلاث سنوات متتالية", "الجامعة"],
      ["مرشّحة لجائزة RIBA", "عن مكتبة ضفة النهر", "لندن"],
      ["سنة تبادل", "ودنماركية جيدة على نحو مفاجئ", "كوبنهاغن"],
      ["رئيسة الجمعية", "أربعون رسامًا ودفتر رسم واحد", "المرسم 4"],
      ["47 ليلة سهر", "على الخبز المحمّص وحده", "المكتبة"],
    ],
    groups: ["من البيت", "من الأصدقاء"],
    people: ["ماما", "بابا", "كريم", "يوسف", "ريم", "سارة"],
    messages: [
      "ما زلت أحتفظ بكل رسمة علّقتِها على الثلاجة. والآن سأرى مبانيكِ في شوارع حقيقية. أنا فخورة بكِ جدًا جدًا.",
      "عملتِ بجدّ أكثر من أي شخص أعرفه، وبقيتِ طيبة وأنتِ تفعلين ذلك. هذا هو الإنجاز الحقيقي. أحسنتِ يا صغيرتي.",
      "هل تصمّمين لي بيتًا على شجرة فيه زحليقة؟ وحبل انزلاق. أحسنتِ يا سلمى.",
      "أربع سنوات نتقاسم فيها مكتبًا وغلاية ونحو ألف موعد تسليم. كوبنهاغن لا تعرف ما ينتظرها. فخور بكِ جدًا!",
      "أنتِ الوحيدة التي أعرفها ترسم طابور السوبرماركت. لا تتوقفي أبدًا. أحبكِ يا نجمة.",
      "من الرسم على الجدران إلى تصميم جدران حقيقية. كنت سأنبهر بهذا وأنا في العاشرة.",
    ],
    goals: [
      "البدء في مكتب كوبنهاغن",
      "أن أصبح مهندسة معمارية معتمدة",
      "تعلّم ركوب الدراجة في كوبنهاغن دون أن أضيع",
      "بناء بيت الشجرة لكريم",
      "زيارة كل مباني ألفار آلتو",
    ],
    letterGreeting: "عزيزتنا سلمى،",
    letterParagraphs: [
      "اليوم ترتدين ثوب التخرّج وقبعته، لكننا ما زلنا نرى الطفلة الصغيرة ويداها ملطّختان بأقلام التلوين، تشرح بالضبط أين سيكون باب بيتها.",
      "وصلتِ إلى هنا عبر ليالٍ طويلة وأيام صعبة، وخبز محمّص أكثر مما ينبغي لأي إنسان. لا يمكن أن نكون أكثر فخرًا بمن أصبحتِ.",
      "العالم على وشك أن يصبح أجمل قليلًا. اذهبي وابنيه.",
    ],
    letterSignoff: "مع كل حبنا،",
    endingLine: "مبروك يا سلمى!",
    endingSub: "فصلك التالي يبدأ الآن.",
  },
};

const STOP_YEARS_AND_CODES: [string, string][] = [["2010", "SCH"], ["2014", "LEG"], ["2018", "ART"], ["2023", "UNI"]];
const PEOPLE_LOOKS: [string, string][] = [
  ["coral", "🏡"], ["sky", "☕"], ["amber", "🌳"], ["mint", "✏️"], ["berry", "🎉"], ["violet", "🏫"],
];
const GOAL_CODES = ["CPH", "ARB", "BKE", "TRE", "AAL"];

export function createInitialState(locale?: string): GraduationValues {
  const text = EXAMPLES[exampleLocale(locale)];
  const person = (index: number) => ({
    name: text.people[index]!,
    color: PEOPLE_LOOKS[index]![0],
    emoji: PEOPLE_LOOKS[index]![1],
    message: text.messages[index]!,
  });
  return {
    gradName: text.gradName,
    gradFullName: text.gradFullName,
    gradYear: "2027",
    gradDegree: text.gradDegree,
    gradSchool: text.gradSchool,
    gradDate: "2027-07-02",
    gradPhoto: null,

    pathEnabled: true,
    thenYear: "2005",
    thenText: text.thenText,
    thenPhoto: null,
    stops: STOP_YEARS_AND_CODES.map(([year, code], index) => ({ year, caption: text.stops[index]!, code })),
    nowYear: "2027",
    nowText: text.nowText,
    nextText: text.nextText,
    nextPhoto: null,

    achievementsEnabled: true,
    achievements: text.achievements.map(([title, detail, place]) => ({ title, detail, place })),

    messagesEnabled: true,
    messageGroups: [
      { label: text.groups[0], people: [person(0), person(1), person(2)] },
      { label: text.groups[1], people: [person(3), person(4), person(5)] },
    ],

    goalsEnabled: true,
    goals: text.goals.map((goal, index) => ({ text: goal, code: GOAL_CODES[index]! })),

    letterEnabled: true,
    letterGreeting: text.letterGreeting,
    letterParagraphs: text.letterParagraphs.map((paragraph) => ({ text: paragraph })),
    letterSignoff: text.letterSignoff,
    letterSignatures: [{ name: text.people[0] }, { name: text.people[1] }, { name: text.people[2] }],

    endingLine: text.endingLine,
    endingSub: text.endingSub,

    flightAirline: "",
    flightNumber: "",
    flightSeat: "",
    flightCabin: "",
    flightFromCode: "",
    flightFromCity: "",
    flightToCode: "",
    flightToCity: "",

    sound: true,
    showShare: true,
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return { journey: DEFAULT_JOURNEY };
}
