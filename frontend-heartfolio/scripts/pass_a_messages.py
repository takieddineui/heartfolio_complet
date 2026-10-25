import json, collections

LOCALES = ["en", "fr", "ar"]

# ---------------------------------------------------------------------
# Per-locale replacement content. Every key here maps to an exact final
# value; nothing is derived at runtime from this script — the derived
# starting price lives in code (pricing.tsx), not in these strings.
# ---------------------------------------------------------------------

NAV_CTA = {
    "en": "Create a keepsake",
    "fr": "Créer un souvenir",
    "ar": "أنشئ تُحفة",
}

HERO_SUBHEAD = {
    "en": "Heartfolio turns a date, a place, a song or a story into a personalized digital keepsake — designed by us, and ready to be experienced however suits the moment.",
    "fr": "Heartfolio transforme une date, un lieu, une chanson ou une histoire en un souvenir numérique personnalisé — conçu par nos soins, à vivre comme vous le souhaitez.",
    "ar": "يحوّل هارتفوليو تاريخًا أو مكانًا أو أغنيةً أو حكايةً إلى تُحفة رقمية مخصّصة — نصمّمها نحن، لتعيشها كما يناسبك.",
}

HERO_DEFINITION = {
    "en": "Beautiful personalized digital keepsakes for the moments worth remembering.",
    "fr": "De beaux souvenirs numériques personnalisés pour les moments qui méritent d'être gardés.",
    "ar": "تُحف رقمية جميلة ومخصّصة للحظات التي تستحق أن تُتذكَّر.",
}

FINAL_CTA_TRUST = {
    "en": "Delivered instantly. Yours to keep.",
    "fr": "Livré instantanément. À vous de le garder.",
    "ar": "تصلك فورًا. تبقى لك.",
}

# ---- Pricing (full section rewrite) ----
PRICING = {
    "en": {
        "eyebrow": "Pricing",
        "title": "Simple, transparent pricing.",
        "subtitle": "Each keepsake has its own available formats and pricing — see exactly what's included before you begin.",
        "note": "Formats vary by keepsake — see each product's own page for what's included. Printing and framing are never included unless a keepsake's offering says otherwise.",
        "single": {
            "badge": "Every keepsake, personalized",
            "priceNote": "starting price across the collection",
            "description": "However you choose to keep it — Digital, Printable, Wallpaper and more where available — pricing is shown clearly on every keepsake's own page.",
            "features": [
                "Personalized to your own story, every time",
                "Customize and preview your keepsake as many times as you like before you buy",
                "Download your finished keepsake after purchase",
                "Digital, Printable, Wallpaper and more, where available",
            ],
            "cta": "See prices for every keepsake",
            "reassurance": "Download your finished keepsake after purchase.",
        },
        "from": "From {price}",
    },
    "fr": {
        "eyebrow": "Tarifs",
        "title": "Des tarifs simples et transparents.",
        "subtitle": "Chaque souvenir a ses propres formats disponibles et son propre tarif — vous voyez exactement ce qui est inclus avant de commencer.",
        "note": "Les formats varient selon le souvenir — consultez la page de chaque création pour savoir ce qui est inclus. L'impression et l'encadrement ne sont jamais inclus, sauf mention contraire sur la création elle-même.",
        "single": {
            "badge": "Chaque souvenir, personnalisé",
            "priceNote": "prix de départ sur l'ensemble de la collection",
            "description": "Quelle que soit la façon dont vous voulez le garder — Numérique, Imprimable, Fond d'écran et plus selon la création — le tarif est indiqué clairement sur la page de chaque souvenir.",
            "features": [
                "Personnalisé selon votre propre histoire, à chaque fois",
                "Personnalisez et prévisualisez votre souvenir autant de fois que vous le souhaitez avant l'achat",
                "Téléchargez votre souvenir terminé après l'achat",
                "Numérique, Imprimable, Fond d'écran et plus, selon la création",
            ],
            "cta": "Voir les tarifs de chaque souvenir",
            "reassurance": "Téléchargez votre souvenir terminé après l'achat.",
        },
        "from": "À partir de {price}",
    },
    "ar": {
        "eyebrow": "الأسعار",
        "title": "أسعار بسيطة وواضحة.",
        "subtitle": "لكل تُحفة صيغها المتاحة وسعرها الخاص — تعرف بالضبط ما هو مشمول قبل أن تبدأ.",
        "note": "تختلف الصيغ المتاحة من تُحفة إلى أخرى — راجع صفحة كل تُحفة لمعرفة ما هو مشمول. الطباعة والتأطير غير مشمولين أبدًا ما لم تنصّ التحفة نفسها على خلاف ذلك.",
        "single": {
            "badge": "كل تُحفة، مخصّصة لك",
            "priceNote": "أدنى سعر عبر المجموعة",
            "description": "أيًّا كانت الطريقة التي تريد الاحتفاظ بها — رقمية، قابلة للطباعة، خلفية هاتف وغيرها حين تتوفّر — يظهر السعر بوضوح في صفحة كل تُحفة.",
            "features": [
                "مخصّصة لحكايتك أنت، في كل مرة",
                "خصّص وعاين تُحفتك بقدر ما تشاء قبل الشراء",
                "نزّل تُحفتك النهائية بعد الشراء",
                "رقمية، قابلة للطباعة، خلفية هاتف وغيرها، حين تتوفّر",
            ],
            "cta": "اطّلع على أسعار كل التُحف",
            "reassurance": "نزّل تُحفتك النهائية بعد الشراء.",
        },
        "from": "ابتداءً من {price}",
    },
}

# ---- WhyHeartfolio ----
WHY_INSTANT_DESC = {
    "en": "Delivered the moment you buy — your keepsake's native experience, plus Printable and other formats where available.",
    "fr": "Livré dès l'achat — l'expérience propre à votre souvenir, avec les formats Imprimable et autres lorsqu'ils sont proposés.",
    "ar": "تصلك لحظة الشراء — تجربة تحفتك الأصلية، إضافة إلى نسخة الطباعة وغيرها حين تتوفر.",
}

WHY_US_POINTS = {
    "en": ["A few beautiful moods", "Guided, one moment at a time", "High-resolution files, instantly", "Delivered the moment you buy"],
    "fr": ["Quelques ambiances magnifiques", "Guidé, un instant à la fois", "Fichiers haute résolution, instantanément", "Livré dès l'achat"],
    "ar": ["أجواء جميلة قليلة", "موجَّه، لحظة تلو الأخرى", "ملفات عالية الدقة، فورًا", "تصلك لحظة الشراء"],
}

# ---- Faq ----
FAQ_PREVIEW_ANSWER = {
    "en": "Yes — what you see while creating is a true render of your keepsake, not a placeholder mockup. What arrives is what you saw.",
    "fr": "Oui — ce que vous voyez pendant la création est un rendu fidèle de votre souvenir, pas une simple maquette. Ce que vous recevez est ce que vous avez vu.",
    "ar": "نعم — ما تراه أثناء الإنشاء هو انعكاس حقيقي لتحفتك، لا مجرد نموذج أولي. ما يصلك هو ما رأيته بالضبط.",
}

FAQ_INCOMPLETE_ANSWER = {
    "en": "That's alright. An approximate time still produces something beautiful and accurate, and we'll gently guide you if something's missing.",
    "fr": "Ce n'est pas grave. Une heure approximative suffit à produire un résultat beau et fidèle, et nous vous guiderons doucement s'il manque un détail.",
    "ar": "لا بأس بذلك. وقت تقريبي يكفي لإنتاج نتيجة جميلة ودقيقة، وسنرشدك بلطف إن كان هناك تفصيل ناقص.",
}

# ---- GiftOccasions CTAs ----
OCCASION_CTA = {
    "en": {
        "anniversary": "Explore anniversary keepsakes",
        "wedding": "Explore wedding keepsakes",
        "newBaby": "Explore new baby keepsakes",
        "inMemory": "Explore memorial keepsakes",
        "newChapter": "Explore new chapter keepsakes",
    },
    "fr": {
        "anniversary": "Découvrir les souvenirs d'anniversaire",
        "wedding": "Découvrir les souvenirs de mariage",
        "newBaby": "Découvrir les souvenirs de naissance",
        "inMemory": "Découvrir les souvenirs commémoratifs",
        "newChapter": "Découvrir les souvenirs de nouveau chapitre",
    },
    "ar": {
        "anniversary": "استكشف تُحف الذكرى السنوية",
        "wedding": "استكشف تُحف الزفاف",
        "newBaby": "استكشف تُحف المولود الجديد",
        "inMemory": "استكشف التُحف التذكارية",
        "newChapter": "استكشف تُحف الفصل الجديد",
    },
}

# ---- FeaturedKeepsakes ----
FEATURED = {
    "en": {
        "title": "A keepsake for every\nkind of moment.",
        "subtitle": "Every Heartfolio keepsake starts with something only you have — a date, a place, a song, a story of your own. Choose the one that fits the moment.",
        "cta": "Explore all keepsakes",
        "digitalNote": "Every keepsake is a personalized digital experience — with Printable and Wallpaper available for the keepsakes that offer them.",
    },
    "fr": {
        "title": "Un souvenir pour chaque\ninstant qui compte.",
        "subtitle": "Chaque souvenir Heartfolio part de quelque chose que vous seul possédez — une date, un lieu, une chanson, une histoire bien à vous. Choisissez celui qui correspond au moment.",
        "cta": "Explorer tous les souvenirs",
        "digitalNote": "Chaque souvenir est une expérience numérique personnalisée — avec les versions Imprimable et Fond d'écran disponibles pour les souvenirs qui les proposent.",
    },
    "ar": {
        "title": "تُحفة لكل لحظة\nمهما كان نوعها.",
        "subtitle": "كل تُحفة من هارتفوليو تبدأ بشيء لا يملكه سواك — تاريخ، مكان، أغنية، أو حكاية تخصّك. اختر ما يناسب اللحظة.",
        "cta": "استكشف كل التُحف",
        "digitalNote": "كل تُحفة هي تجربة رقمية مخصّصة — مع توفّر نسختي الطباعة وخلفية الهاتف للتحف التي تشملهما.",
    },
}

# ---- Footer ----
FOOTER_DIGITAL_NOTICE = {
    "en": "Heartfolio sells digital keepsakes. Each one is a personalized digital experience — with Printable and other formats available on some keepsakes — and there is no physical item and nothing is shipped.",
    "fr": "Heartfolio vend des souvenirs numériques. Chacun est une expérience numérique personnalisée — avec les formats Imprimable et autres disponibles sur certains souvenirs — et il n'y a aucun article physique, rien n'est expédié.",
    "ar": "يبيع هارتفوليو تُحفًا رقمية. كل واحدة منها تجربة رقمية مخصّصة — مع توفّر نسخ الطباعة وغيرها على بعض التُحف — ولا يوجد أي منتج مادي، ولا شيء يُشحن.",
}

# ---- Collection (page) ----
COLLECTION_DIGITAL_NOTE = {
    "en": "Every keepsake is a digital-first experience, with Printable and other formats available where offered. Nothing is shipped; printing and framing are yours to arrange.",
    "fr": "Chaque souvenir est avant tout une expérience numérique, avec les formats Imprimable et autres disponibles lorsqu'ils sont proposés. Rien n'est expédié ; l'impression et l'encadrement restent à votre charge.",
    "ar": "كل تُحفة هي في الأساس تجربة رقمية، مع توفّر نسخة الطباعة وغيرها حين تُطرح. لا شيء يُشحن؛ والطباعة والتأطير يبقيان من ترتيبك.",
}

COLLECTION_OCCASION = {
    "en": {
        "occasionHeading": "Keepsakes for {occasion}",
        "occasionFallback": "More keepsakes for this occasion are on the way — here's the full collection for now.",
        "occasionViewAll": "View all keepsakes",
    },
    "fr": {
        "occasionHeading": "Souvenirs pour {occasion}",
        "occasionFallback": "D'autres souvenirs pour cette occasion arrivent bientôt — voici la collection complète pour l'instant.",
        "occasionViewAll": "Voir tous les souvenirs",
    },
    "ar": {
        "occasionHeading": "تُحف لمناسبة {occasion}",
        "occasionFallback": "المزيد من التُحف لهذه المناسبة في الطريق — إليك المجموعة كاملة في الوقت الحالي.",
        "occasionViewAll": "عرض كل التُحف",
    },
}

# ---- ProductPage.createYours label (§17) ----
PRODUCT_PAGE_CREATE_YOURS = {
    "en": "Create your keepsake",
    "fr": "Créez votre souvenir",
    "ar": "أنشئ تُحفتك",
}

# ---- ProductPage.included (§12/§13) ----
INCLUDED_ITEMS = {
    "en": [
        "A personalized keepsake designed from the details you give us",
        "Your keepsake's native digital experience, ready the moment it's finished",
        "A print-ready PDF at 300 DPI for versions that include printing",
        "Customize and preview your keepsake as many times as you like before you buy",
    ],
    "fr": [
        "Un souvenir personnalisé créé à partir des détails que vous nous confiez",
        "L'expérience numérique propre à votre souvenir, prête dès qu'elle est terminée",
        "Un PDF prêt à imprimer en 300 DPI pour les versions qui incluent l'impression",
        "Personnalisez et prévisualisez votre souvenir autant de fois que vous le souhaitez avant l'achat",
    ],
    "ar": [
        "تُحفة مخصّصة مصمّمة من التفاصيل التي تعطينا إياها",
        "تجربة تحفتك الرقمية الأصلية، جاهزة فور انتهائها",
        "ملف PDF جاهز للطباعة بدقة 300 DPI في النسخ التي تشمل الطباعة",
        "خصّص وعاين تُحفتك بقدر ما تشاء قبل الشراء",
    ],
}

PRODUCT_PAGE_DIGITAL_NOTICE = {
    "en": "A digital keepsake experience. Nothing is shipped — some versions include files to download or print, shown below.",
    "fr": "Une expérience de souvenir numérique. Rien n'est expédié — certaines versions incluent des fichiers à télécharger ou à imprimer, présentés ci-dessous.",
    "ar": "تجربة تُحفة رقمية. لا شيء يُشحن — تتضمّن بعض النسخ ملفات للتنزيل أو الطباعة، موضّحة أدناه.",
}

# ---- Products.offerings (shared/global copy) ----
OFFERINGS_DIGITAL_DESC = {
    "en": "Your personalized keepsake as Heartfolio's native digital experience — the primary way to enjoy and share it.",
    "fr": "Votre souvenir personnalisé sous la forme d'une expérience numérique Heartfolio — la façon principale d'en profiter et de le partager.",
    "ar": "تحفتك المخصّصة بصيغتها الرقمية الأصلية من هارتفوليو — الطريقة الأساسية للاستمتاع بها ومشاركتها.",
}

OFFERINGS_COMPLETE_PACK_DESC = {
    "en": "Every version available for this keepsake, together in one purchase.",
    "fr": "Toutes les versions disponibles de ce souvenir, réunies en un seul achat.",
    "ar": "كل النسخ المتاحة لهذه التحفة، مجتمعةً في عملية شراء واحدة.",
}

OFFERING_DIGITAL_EXPERIENCE_DETAIL = {
    "en": "Personalized digital keepsake · yours to revisit",
    "fr": "Souvenir numérique personnalisé · à revivre quand vous le souhaitez",
    "ar": "تُحفة رقمية مخصّصة · تعود إليها متى شئت",
}

# ---- Where We Met (renamed from Heart Map) ----
WHERE_WE_MET = {
    "en": {
        "name": "Where We Met",
        "meta": {
            "title": "Where We Met — Personalized Map Print | Heartfolio",
            "description": "Where We Met turns the exact place something began into a quiet personalized map print — a digital keepsake from $12 USD, delivered instantly.",
            "imageAlt": "A personalized Heartfolio Where We Met map print marking the place where a story began",
        },
        "story": "Coordinates are unromantic until they are yours. Where We Met takes the exact spot — the corner, the bar, the bridge, the address you both still call 'the flat' — and draws its streets in fine linework, with a single mark where you stood and the coordinates set underneath.",
        "offerings": {
            "digital": {
                "description": "Your personalized digital map experience — the exact place, ready to revisit whenever you like.",
            },
        },
    },
    "fr": {
        "name": "Là où nous nous sommes rencontrés",
        "meta": {
            "title": "Là où nous nous sommes rencontrés — Carte personnalisée | Heartfolio",
            "description": "« Là où nous nous sommes rencontrés » transforme le lieu exact où tout a commencé en une carte personnalisée tout en retenue — un souvenir numérique à partir de $12 USD, livré instantanément.",
            "imageAlt": "Une carte Heartfolio personnalisée « Là où nous nous sommes rencontrés » marquant le lieu où une histoire a commencé",
        },
        "story": "Des coordonnées n'ont rien de romantique tant qu'elles ne sont pas les vôtres. « Là où nous nous sommes rencontrés » prend l'endroit exact — le coin de rue, le bar, le pont, l'adresse que vous appelez encore « l'appart » — et en dessine les rues au trait fin, avec un seul repère là où vous vous teniez et les coordonnées posées en dessous.",
        "offerings": {
            "digital": {
                "description": "Votre expérience de carte numérique personnalisée — le lieu exact, prêt à revivre quand vous le souhaitez.",
            },
        },
    },
    "ar": {
        "name": "حيث التقينا",
        "meta": {
            "title": "حيث التقينا — خريطة مخصّصة | هارتفوليو",
            "description": "تحوّل تُحفة «حيث التقينا» المكان الذي بدأ عنده كل شيء إلى خريطة مخصّصة هادئة — تُحفة رقمية ابتداءً من $12 USD، تصلك فورًا.",
            "imageAlt": "خريطة مخصّصة من هارتفوليو بعنوان «حيث التقينا» تحدّد المكان الذي بدأت عنده الحكاية",
        },
        "story": "الإحداثيات لا تعني شيئًا حتى تصير إحداثياتك. تأخذ «حيث التقينا» المكان بالضبط — الناصية، المقهى، الجسر، العنوان الذي ما زلتما تسمّيانه «الشقة» — وترسم شوارعه بخطوط رفيعة، مع علامة واحدة حيث وقفتما، والإحداثيات تحتها.",
        "offerings": {
            "digital": {
                "description": "تجربتك الرقمية المخصّصة لخريطتك — المكان بالضبط، جاهز لتعود إليه متى شئت.",
            },
        },
    },
}

# ---- Love Story Timeline — Digital offering override (§12) ----
LST_DIGITAL_OVERRIDE = {
    "en": "Your personalized digital keepsake experience — the story laid out exactly as you built it, ready to revisit anytime.",
    "fr": "Votre expérience de souvenir numérique personnalisé — l'histoire mise en scène exactement comme vous l'avez construite, prête à revivre à tout moment.",
    "ar": "تجربة تُحفتك الرقمية المخصّصة — الحكاية مرتّبة تمامًا كما بنيتها، جاهزة لتعود إليها في أي وقت.",
}

# ---- Support email ----
SUPPORT_EMAIL = "support@theheartfolio.com"

# ---- Legal.refunds "We answer every request" (absolute claim) ----
REFUNDS_HOW_TO_ASK = {
    "en": "Write to {email} with the email address you used and what went wrong. A screenshot helps but is not required. We read and respond to every request.",
    "fr": "Écrivez à {email} en indiquant l'adresse e-mail utilisée et ce qui n'a pas fonctionné. Une capture d'écran aide, sans être obligatoire. Nous lisons et répondons à chaque demande.",
    "ar": "راسلنا على {email} مع البريد الإلكتروني الذي استخدمته وما الذي حدث. لقطة الشاشة تساعد لكنها ليست شرطًا. نقرأ كل طلب ونردّ عليه.",
}


def load(loc):
    return json.load(open(f"src/messages/{loc}.json"), object_pairs_hook=collections.OrderedDict)


def save(loc, d):
    json.dump(d, open(f"src/messages/{loc}.json", "w"), ensure_ascii=False, indent=2)


for loc in LOCALES:
    m = load(loc)

    # --- Nav ---
    m["Nav"]["cta"] = NAV_CTA[loc]
    m["Nav"]["secondary"].pop("track", None)
    m["Nav"]["secondary"].pop("account", None)

    # --- Hero ---
    m["Hero"]["subhead"] = HERO_SUBHEAD[loc]
    m["Hero"]["definition"] = HERO_DEFINITION[loc]

    # --- FinalCta ---
    m["FinalCta"]["trust"] = FINAL_CTA_TRUST[loc]
    m["FinalCta"]["cta"] = NAV_CTA[loc]

    # --- Pricing (full rewrite; "single.price" key removed — derived in code) ---
    p = PRICING[loc]
    m["Pricing"]["eyebrow"] = p["eyebrow"]
    m["Pricing"]["title"] = p["title"]
    m["Pricing"]["subtitle"] = p["subtitle"]
    m["Pricing"]["note"] = p["note"]
    m["Pricing"]["from"] = p["from"]
    m["Pricing"]["single"].pop("price", None)
    m["Pricing"]["single"].pop("digitalBadge", None)
    m["Pricing"]["single"]["badge"] = p["single"]["badge"]
    m["Pricing"]["single"]["priceNote"] = p["single"]["priceNote"]
    m["Pricing"]["single"]["description"] = p["single"]["description"]
    m["Pricing"]["single"]["features"] = p["single"]["features"]
    m["Pricing"]["single"]["cta"] = p["single"]["cta"]
    m["Pricing"]["single"]["reassurance"] = p["single"]["reassurance"]

    # --- WhyHeartfolio ---
    m["WhyHeartfolio"]["pillars"]["instant"]["description"] = WHY_INSTANT_DESC[loc]
    m["WhyHeartfolio"]["comparison"]["us"]["points"] = WHY_US_POINTS[loc]

    # --- Faq: remove account-based entries, rewrite two others ---
    m["Faq"]["items"].pop("lost", None)
    m["Faq"]["items"].pop("reorder", None)
    m["Faq"]["items"]["preview"]["answer"] = FAQ_PREVIEW_ANSWER[loc]
    m["Faq"]["items"]["incomplete"]["answer"] = FAQ_INCOMPLETE_ANSWER[loc]

    # --- GiftOccasions CTAs ---
    for key, cta in OCCASION_CTA[loc].items():
        m["GiftOccasions"]["items"][key]["cta"] = cta

    # --- FeaturedKeepsakes ---
    m["FeaturedKeepsakes"]["title"] = FEATURED[loc]["title"]
    m["FeaturedKeepsakes"]["subtitle"] = FEATURED[loc]["subtitle"]
    m["FeaturedKeepsakes"]["cta"] = FEATURED[loc]["cta"]
    m["FeaturedKeepsakes"]["digitalNote"] = FEATURED[loc]["digitalNote"]

    # --- Footer ---
    m["Footer"]["digitalNotice"] = FOOTER_DIGITAL_NOTICE[loc]

    # --- Collection ---
    m["Collection"]["digitalNote"] = COLLECTION_DIGITAL_NOTE[loc]
    m["Collection"]["occasionHeading"] = COLLECTION_OCCASION[loc]["occasionHeading"]
    m["Collection"]["occasionFallback"] = COLLECTION_OCCASION[loc]["occasionFallback"]
    m["Collection"]["occasionViewAll"] = COLLECTION_OCCASION[loc]["occasionViewAll"]

    # --- ProductPage ---
    m["ProductPage"]["createYours"] = PRODUCT_PAGE_CREATE_YOURS[loc]
    m["ProductPage"]["digitalNotice"] = PRODUCT_PAGE_DIGITAL_NOTICE[loc]
    m["ProductPage"]["included"]["items"] = INCLUDED_ITEMS[loc]
    # comingSoonNote / statusWaitlist / joinWaitlist / comingSoon remain —
    # still used for the status badge on the product page and for the
    # Continue-button labels inside /create.

    # --- Products.offerings (shared/global) ---
    m["Products"]["offerings"]["digital"]["description"] = OFFERINGS_DIGITAL_DESC[loc]
    m["Products"]["offerings"]["complete_pack"]["description"] = OFFERINGS_COMPLETE_PACK_DESC[loc]

    # --- Products.offeringDetails: digitalFiles -> digitalExperience ---
    details = m["Products"]["offeringDetails"]
    details.pop("digitalFiles", None)
    new_details = collections.OrderedDict()
    new_details["digitalExperience"] = OFFERING_DIGITAL_EXPERIENCE_DETAIL[loc]
    for k, v in details.items():
        new_details[k] = v
    m["Products"]["offeringDetails"] = new_details

    # --- Where We Met: rename Products.heartMap -> Products.whereWeMet ---
    heart_map = m["Products"].pop("heartMap")
    heart_map["name"] = WHERE_WE_MET[loc]["name"]
    heart_map["meta"] = WHERE_WE_MET[loc]["meta"]
    heart_map["story"] = WHERE_WE_MET[loc]["story"]
    heart_map["offerings"] = WHERE_WE_MET[loc]["offerings"]
    # Rebuild Products dict so whereWeMet takes heartMap's old position
    # rather than landing at the end — keeps the JSON file's product
    # ordering matching the registry's `order` field.
    new_products = collections.OrderedDict()
    for k, v in m["Products"].items():
        if k == "loveStoryTimeline":
            new_products["whereWeMet"] = heart_map
        new_products[k] = v
    if "whereWeMet" not in new_products:
        new_products["whereWeMet"] = heart_map
    m["Products"] = new_products

    # --- Love Story Timeline: Digital offering override (§12 example) ---
    m["Products"]["loveStoryTimeline"]["offerings"] = {
        "digital": {"description": LST_DIGITAL_OVERRIDE[loc]}
    }

    # --- Legal.refunds: soften the unqualified "we answer every request" ---
    m["Legal"]["refunds"]["sections"][-1]["body"][0] = REFUNDS_HOW_TO_ASK[loc]

    save(loc, m)
    print(loc, "done")
