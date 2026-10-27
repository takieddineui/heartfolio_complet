# -*- coding: utf-8 -*-
"""All localized on-image copy for the social pack (en / fr / ar).

Honest claims only. Example messages are drawn from the project's own sample
content and the PUBLISHED guides, and are always framed as examples — never
as customer testimonials. No names, reviews, ratings or numbers are invented.
"""

LOCALES = ("en", "fr", "ar")

PRODUCT_NAME = {
    "love-story-timeline": {"en": "Love Story Timeline", "fr": "Frise d'histoire d'amour", "ar": "الخط الزمني لقصة الحب"},
    "song-poster":         {"en": "Song Poster", "fr": "Affiche musicale", "ar": "ملصق الأغنية"},
    "reasons-i-love-you":  {"en": "Reasons I Love You", "fr": "Les raisons pour lesquelles je t'aime", "ar": "أسباب حبي لك"},
    "graduation-keepsake": {"en": "Graduation Keepsake", "fr": "Souvenir de diplôme", "ar": "هدية التخرّج"},
}

PRODUCT_ONELINER = {
    "love-story-timeline": {"en": "Your relationship's moments, on one line.",
                            "fr": "Les moments de votre histoire, sur une seule ligne.",
                            "ar": "لحظات علاقتكما على خطٍّ واحد."},
    "song-poster":         {"en": "The song that mattered, turned into artwork.",
                            "fr": "La chanson qui compte, devenue une œuvre.",
                            "ar": "الأغنية التي تعني الكثير، صارت عملاً فنيًّا."},
    "reasons-i-love-you":  {"en": "Up to ten reasons, opened one at a time.",
                            "fr": "Jusqu'à dix raisons, ouvertes une à une.",
                            "ar": "حتى عشرة أسباب، تُفتح واحدًا تلو الآخر."},
    "graduation-keepsake": {"en": "A graduate's journey, from everyone who cheered.",
                            "fr": "Le parcours d'un diplômé, porté par tous ceux qui l'ont encouragé.",
                            "ar": "رحلة متخرّج، من كلّ من شجّعه."},
}

# ---- Style / theme display names (from the Studio's own message files) ----
LST_LAYOUTS = [
    ("neat-stack",          {"en": "Neat Stack", "fr": "Pile ordonnée", "ar": "تكديس مرتّب"}),
    ("alternating-tilt",    {"en": "Alternating Tilt", "fr": "Alternance inclinée", "ar": "تبادل مائل"}),
    ("overlapping-cascade", {"en": "Overlapping Cascade", "fr": "Cascade superposée", "ar": "تتابع متداخل"}),
    ("dotted-branching",    {"en": "Dotted Branching", "fr": "Ramifications pointillées", "ar": "تفرّعات منقّطة"}),
    ("horizontal-polaroid", {"en": "Horizontal Polaroids", "fr": "Polaroïds horizontaux", "ar": "بولارويد أفقي"}),
    ("horizontal-circles",  {"en": "Horizontal Circles", "fr": "Cercles horizontaux", "ar": "دوائر أفقية"}),
]
SP_THEMES = [
    ("player",       {"en": "Player", "fr": "Lecteur", "ar": "المشغّل"}),
    ("ledger",       {"en": "Ledger", "fr": "Journal", "ar": "السجل"}),
    ("ephemeris",    {"en": "Ephemeris", "fr": "Éphéméride", "ar": "التقويم الفلكي"}),
    ("contactsheet", {"en": "Contact Sheet", "fr": "Planche contact", "ar": "لوحة الصور"}),
    ("label",        {"en": "Label", "fr": "Étiquette", "ar": "الملصق"}),
    ("award",        {"en": "Award", "fr": "Trophée", "ar": "الجائزة"}),
    ("sleeve",       {"en": "Sleeve", "fr": "Pochette", "ar": "الغلاف"}),
    ("mosaic",       {"en": "Mosaic", "fr": "Mosaïque", "ar": "الفسيفساء"}),
]

# ---- Honest claim snippets ----
CLAIM = {
    "instant":  {"en": "Delivered instantly", "fr": "Livré instantanément", "ar": "تصلك فورًا"},
    "noapp":    {"en": "No app. No account.", "fr": "Sans application. Sans compte.", "ar": "دون تطبيق. دون حساب."},
    "linkqr":   {"en": "Opened from a link or a QR card", "fr": "Ouvert depuis un lien ou une carte QR", "ar": "تُفتح من رابط أو بطاقة QR"},
    "printready": {"en": "Print-ready files for the ones made to frame",
                   "fr": "Fichiers prêts à imprimer, pour ceux faits pour être encadrés",
                   "ar": "ملفات جاهزة للطباعة لما صُنع ليُؤطَّر"},
    "payonce":  {"en": "Pay once — ready instantly", "fr": "Un seul paiement — prêt aussitôt", "ar": "ادفع مرة واحدة — جاهزة فورًا"},
    "noship":   {"en": "Nothing is shipped", "fr": "Rien n'est expédié", "ar": "لا يُشحن شيء"},
    "madekept": {"en": "Made in minutes. Kept for years.", "fr": "Fait en quelques minutes. Gardé des années.", "ar": "يُصنع في دقائق. يبقى لسنوات."},
    "openslow": {"en": "It opens one moment at a time.", "fr": "Il s'ouvre un moment à la fois.", "ar": "يُفتح لحظةً تلو الأخرى."},
}

TAG = {
    "example": {"en": "Example message — written for a Heartfolio keepsake",
                "fr": "Exemple de message — écrit pour un souvenir Heartfolio",
                "ar": "مثال على رسالة — كُتبت لتُحفة من Heartfolio"},
    "example_short": {"en": "Example message", "fr": "Exemple de message", "ar": "مثال على رسالة"},
    "style": {"en": "STYLE", "fr": "STYLE", "ar": "الأسلوب"},
    "theme": {"en": "THEME", "fr": "THÈME", "ar": "الطابع"},
    "swipe": {"en": "Swipe →", "fr": "Faites glisser →", "ar": "← اسحب"},
    "site":  {"en": "theheartfolio.com", "fr": "theheartfolio.com", "ar": "theheartfolio.com"},
    "realprint": {"en": "Real print — rendered by Heartfolio",
                  "fr": "Impression réelle — rendue par Heartfolio",
                  "ar": "طباعة حقيقية — من إنتاج Heartfolio"},
}

URL = "theheartfolio.com"

# ---- Example quotes (from sample content + PUBLISHED guides) ----
DEDICATION = {  # Love Story Timeline sample dedication
    "en": "Every love story is beautiful, but ours is my favorite.",
    "fr": "Toutes les histoires d'amour sont belles, mais la nôtre est ma préférée.",
    "ar": "كلّ قصص الحب جميلة، لكنّ قصّتنا هي المفضّلة لديّ.",
}
SONG_DEDICATION = {  # Song Poster sample dedication
    "en": "For every night we danced before the dishes were done.",
    "fr": "Pour chaque soir où l'on a dansé avant d'avoir fait la vaisselle.",
    "ar": "لكلّ ليلةٍ رقصنا فيها قبل أن ننهي غسل الأطباق.",
}
REASONS_FINALE = {  # Reasons I Love You sample finale line
    "en": "And the reason above all: you are you. I choose you, every time.",
    "fr": "Et la raison avant toutes les autres : tu es toi. Je te choisis, à chaque fois.",
    "ar": "والسبب الأهمّ من كلّ ذلك: أنكِ أنتِ. أختاركِ في كلّ مرّة.",
}

# Example reason lines — EN & FR from the PUBLISHED reasons guide; AR from
# the sample content (the Arabic guide is not published). Grouped.
REASONS_EXAMPLES = {
    "en": {
        "Small, everyday things": [
            "You make my coffee before yours, even when you're late.",
            "The way you hum when you cook, always the same three songs.",
            "You leave the last bite for me without saying anything.",
        ],
        "How they are with other people": [
            "You talk to waiters the way you talk to your friends.",
            "You never make anyone feel stupid for asking.",
            "You call your grandmother every Sunday, and you actually listen.",
        ],
        "Moments you won't forget": [
            "The night you drove four hours because I didn't want to be alone.",
            "How calm you were at the hospital, when I wasn't.",
        ],
    },
    "fr": {
        "Les petits riens du quotidien": [
            "Tu ris de tes blagues avant d'arriver à la chute.",
            "La voix que tu prends pour parler au chat.",
            "Tu rends les mardis ordinaires dignes d'être retenus.",
        ],
        "Sa façon d'être avec les autres": [
            "Tu parles aux serveurs comme à tes amis.",
            "Avec toi, personne ne se sent bête de poser une question.",
            "Tu appelles ta grand-mère tous les dimanches, et tu l'écoutes vraiment.",
        ],
        "Des moments inoubliables": [
            "La nuit où tu as fait quatre heures de route parce que je ne voulais pas rester sans toi.",
            "Ton calme à l'hôpital, quand moi je n'en avais plus.",
        ],
    },
    "ar": {
        "أشياء صغيرة من كلّ يوم": [
            "طريقتك في الضحك على نكاتك قبل أن تصلي إلى نهايتها.",
            "كيف تجعلين أيام الثلاثاء العادية تستحقّ أن تُذكر.",
            "ما زلتِ تقولين صباح الخير وكأنكِ تعنينها حقًّا. كلّ يوم.",
        ],
        "طريقتها مع الآخرين": [
            "طريقتك في الغناء في السيارة، بصوت عالٍ ونغمة خاطئة قليلًا.",
            "أنكِ تجعلينني أرغب في أن أكون ألطف وأهدأ وأشجع، فقط لأنكِ أنتِ.",
        ],
    },
}

# ---- Series A: 8 single posts (headline + optional subline) ----
A_POSTS = {
    "a1-lst-hero": {
        "head": {"en": "One story,\nsix ways to tell it",
                 "fr": "Une histoire,\nsix façons de la raconter",
                 "ar": "قصّة واحدة،\nستّ طرق لروايتها"},
        "sub": PRODUCT_ONELINER["love-story-timeline"],
    },
    "a4-song-hero": {
        "head": {"en": "Your song,\nas artwork",
                 "fr": "Votre chanson,\nen œuvre d'art",
                 "ar": "أغنيتكم،\nعملاً فنيًّا"},
        "sub": PRODUCT_ONELINER["song-poster"],
    },
    "a7-printready": {
        "head": {"en": "Print-ready.\nFramed by you.",
                 "fr": "Prêt à imprimer.\nEncadré par vous.",
                 "ar": "جاهز للطباعة.\nتؤطّره بنفسك."},
        "sub": {"en": "We make the file; you choose the frame. Nothing is shipped.",
                "fr": "Nous créons le fichier ; vous choisissez le cadre. Rien n'est expédié.",
                "ar": "نحن نصنع الملف، وأنت تختار الإطار. لا يُشحن شيء."},
    },
}

# ---- Series A carousel "One story, six styles" (cover copy) ----
A_CAROUSEL = {
    "title": {"en": "One story,\nsix styles", "fr": "Une histoire,\nsix styles", "ar": "قصّة واحدة،\nستّة أساليب"},
    "sub": {"en": "The same four moments, laid out six different ways. Same keepsake, your look.",
            "fr": "Les mêmes quatre moments, présentés de six façons. Même souvenir, votre style.",
            "ar": "اللحظات الأربع نفسها، مُقدَّمة بستّ طرق. التحفة نفسها، بأسلوبك."},
    "end": {"en": "Six styles. One is yours.", "fr": "Six styles. L'un est le vôtre.", "ar": "ستّة أساليب. واحدٌ منها لك."},
}

# ---- Series A reels (title cards) ----
A_REELS = {
    "ra1-lst": {
        "hook": {"en": "Six ways to tell\none love story", "fr": "Six façons de raconter\nune histoire d'amour", "ar": "ستّ طرق لرواية\nقصّة حبّ واحدة"},
        "end":  {"en": "Love Story Timeline", "fr": "Frise d'histoire d'amour", "ar": "الخط الزمني لقصة الحب"},
    },
    "ra2-song": {
        "hook": {"en": "Eight ways to\nsee a song", "fr": "Huit façons de\nvoir une chanson", "ar": "ثماني طرق\nلرؤية أغنية"},
        "end":  {"en": "Song Poster", "fr": "Affiche musicale", "ar": "ملصق الأغنية"},
    },
}

# ---- Series B: 6 single posts ----
B_POSTS = {
    "b1-scan": {
        "head": {"en": "They scan the card,\nor tap the link.",
                 "fr": "Ils scannent la carte,\nou touchent le lien.",
                 "ar": "يمسحون البطاقة،\nأو يفتحون الرابط."},
        "sub": {"en": "It opens on their phone — no app, no account.",
                "fr": "Ça s'ouvre sur leur téléphone — sans application, sans compte.",
                "ar": "يُفتح على هاتفهم — دون تطبيق، دون حساب."},
    },
    "b6-noapp": {
        "head": {"en": "No app.\nNo account.\nIt just opens.",
                 "fr": "Sans application.\nSans compte.\nÇa s'ouvre, c'est tout.",
                 "ar": "دون تطبيق.\nدون حساب.\nيُفتح ببساطة."},
        "sub": CLAIM["instant"],
    },
}

# ---- Series B carousel "How Heartfolio works" ----
B_HOW = {
    "cover": {"en": "How Heartfolio\nworks", "fr": "Comment fonctionne\nHeartfolio", "ar": "كيف يعمل\nHeartfolio"},
    "steps": [
        {"n": "1",
         "t": {"en": "You add the names, dates, photos and words.",
               "fr": "Vous ajoutez les prénoms, les dates, les photos et les mots.",
               "ar": "تضيف الأسماء والتواريخ والصور والكلمات."}},
        {"n": "2",
         "t": {"en": "We turn them into a keepsake — in your style.",
               "fr": "Nous en faisons un souvenir — à votre style.",
               "ar": "نحوّلها إلى تُحفة — بأسلوبك."}},
        {"n": "3",
         "t": {"en": "Pay once. A private link and a QR card are ready instantly.",
               "fr": "Un seul paiement. Un lien privé et une carte QR, prêts aussitôt.",
               "ar": "ادفع مرة واحدة. رابط خاص وبطاقة QR، جاهزان فورًا."}},
        {"n": "4",
         "t": {"en": "They scan or tap. It opens, one moment at a time.",
               "fr": "Ils scannent ou touchent. Ça s'ouvre, un moment à la fois.",
               "ar": "يمسحون أو يفتحون. يُفتح لحظةً تلو الأخرى."}},
    ],
    "footnote": {"en": "Love Story Timeline and Song Poster also come as print-ready files.",
                 "fr": "« Frise d'histoire d'amour » et « Affiche musicale » existent aussi en fichiers prêts à imprimer.",
                 "ar": "«الخط الزمني لقصة الحب» و«ملصق الأغنية» متوفّران أيضًا كملفات جاهزة للطباعة."},
}

# ---- Series B carousel "Reasons I love you: examples" ----
B_REASONS = {
    "cover": {"en": "Reasons I love you —\nwhat you could write",
              "fr": "Les raisons que j'aime en toi —\nce que vous pourriez écrire",
              "ar": "أسباب حبّي لك —\nما الذي يمكنك كتابته"},
    "cover_sub": {"en": "Ideas from our guide. Example messages, not customer quotes.",
                  "fr": "Des idées tirées de notre guide. Des exemples de messages, pas des avis clients.",
                  "ar": "أفكار من دليلنا. أمثلة على رسائل، لا اقتباسات من عملاء."},
    "end": {"en": "Up to ten reasons, opened one at a time.",
            "fr": "Jusqu'à dix raisons, ouvertes une à une.",
            "ar": "حتى عشرة أسباب، تُفتح واحدًا تلو الآخر."},
}

# ---- Series B reels (one per product): hook + beats ----
B_REELS = {
    "love-story-timeline": {
        "hook": {"en": "The moments only\nyou two remember", "fr": "Les moments que vous\nseuls vous rappelez", "ar": "اللحظات التي\nلا يتذكّرها سواكما"},
        "beats": [
            {"en": "A few dated moments, with photos.", "fr": "Quelques moments datés, avec des photos.", "ar": "بضع لحظات مؤرّخة، مع الصور."},
            {"en": "Opened from a link or a QR card.", "fr": "Ouvert depuis un lien ou une carte QR.", "ar": "تُفتح من رابط أو بطاقة QR."},
        ],
    },
    "song-poster": {
        "hook": {"en": "A song you can\nsee, and play", "fr": "Une chanson à\nvoir et à écouter", "ar": "أغنية تُرى\nوتُشغَّل"},
        "beats": [
            {"en": "Soundwave artwork, titled and dated.", "fr": "Une œuvre en onde sonore, titrée et datée.", "ar": "عمل فنّي بموجة صوتية، بعنوان وتاريخ."},
            {"en": "A page that plays it from the link.", "fr": "Une page qui la joue depuis le lien.", "ar": "صفحة تشغّلها من الرابط."},
        ],
    },
    "reasons-i-love-you": {
        "hook": {"en": "Ten reasons,\nopened one by one", "fr": "Dix raisons,\nouvertes une à une", "ar": "عشرة أسباب،\nتُفتح واحدًا واحدًا"},
        "beats": [
            {"en": "A jar, a daisy, a deck of hearts.", "fr": "Un bocal, une marguerite, un jeu de cœurs.", "ar": "جرّة، زهرة، مجموعة قلوب."},
            {"en": "A private page, no app to install.", "fr": "Une page privée, aucune application à installer.", "ar": "صفحة خاصة، دون تطبيق تثبّته."},
        ],
    },
    "graduation-keepsake": {
        "hook": {"en": "The whole journey,\nnot just the day", "fr": "Tout le parcours,\npas seulement le jour J", "ar": "الرحلة كاملة،\nلا اليوم وحده"},
        "beats": [
            {"en": "From the first drawing to the next chapter.", "fr": "Du premier dessin au prochain chapitre.", "ar": "من أول رسمة إلى الفصل التالي."},
            {"en": "With messages from everyone who cheered.", "fr": "Avec les messages de tous ceux qui l'ont encouragé.", "ar": "مع رسائل من كلّ من شجّعه."},
        ],
    },
}
