"""The words in the files every customer receives, in the order's language
(owner's decision, 25 Oct 2026: they were English for every order).

Each document is paragraphs, wrapped when drawn (`bonuses._text_pdf`), so a
translation never needs hand-placed line breaks. `copy_for(order_locale)`
falls back to English for any language not listed.
"""

from __future__ import annotations

SUPPORTED = ("en", "fr", "ar")


def copy_locale(locale: str | None) -> str:
    return locale if locale in SUPPORTED else "en"


#: The QR card's caption when the order has nothing better (the names).
QR_DEFAULT_CAPTION = {
    "en": "Scan to open your keepsake",
    "fr": "Scannez pour ouvrir le souvenir",
    "ar": "امسح الرمز لفتح التُحفة",
}

#: The footer wordmark and closing signature.
SIGNATURE = {"en": "- Heartfolio", "fr": "- Heartfolio", "ar": "- هارتفوليو"}

#: The thank-you card, the same for every order (one per language). Worded
#: for every kind of order: a Digital-only order has no files, so it no longer
#: says "Your files are yours".
THANK_YOU = {
    "en": {
        "title": "Thank you.",
        "paragraphs": [
            "Someone made something for someone else, and that is the whole point of this. Thank you for letting us be part of it.",
            "Your keepsake is yours, to keep, print or share whenever you like.",
            "The link in your receipt opens your order on any device for 30 days. If it ever stops working, reply to that email and we will send you a fresh one.",
        ],
    },
    "fr": {
        "title": "Merci.",
        "paragraphs": [
            "Quelqu'un a créé quelque chose pour quelqu'un d'autre, et c'est tout le sens de ce que nous faisons. Merci de nous avoir laissés en faire partie.",
            "Votre souvenir est à vous : gardez-le, imprimez-le ou partagez-le quand vous le souhaitez.",
            "Le lien de votre reçu ouvre votre commande sur n'importe quel appareil pendant 30 jours. S'il ne fonctionne plus, répondez à cet e-mail et nous vous en enverrons un nouveau.",
        ],
    },
    "ar": {
        "title": "شكرًا لك.",
        "paragraphs": [
            "صنع أحدهم شيئًا لشخص آخر، وهذا هو جوهر ما نفعله. شكرًا لأنك سمحت لنا بأن نكون جزءًا منه.",
            "تُحفتك ملكك: احتفظ بها أو اطبعها أو شاركها متى شئت.",
            "يفتح الرابط الوارد في إيصالك طلبك على أي جهاز لمدة 30 يومًا. وإذا توقّف، ردّ على تلك الرسالة وسنرسل إليك رابطًا جديدًا.",
        ],
    },
}

#: §18b, one sheet covering both print methods (printable orders only).
PRINT_ADVICE = {
    "en": {
        "title": "How to print your keepsake",
        "sections": [
            ("You received two versions of every size", [
                "Frameless - the artwork runs to the edge of the paper, with no border.",
                "With edges - the artwork sits inside a half-inch margin.",
                "They are different files, not the same file cropped. Use whichever matches how you intend to display it.",
            ]),
            ("The frameless version - glass or acrylic mounting", [
                "Ask a print shop for an acrylic mount, a glass print, or a face-mount. Say the artwork is full-bleed and must not be trimmed or scaled. These are pressed under or behind the surface, so nothing overlaps the print - which is why this version has no margin to lose.",
            ]),
            ("The with-edges version - an ordinary picture frame", [
                "Any print shop, or a home printer, on 200-250gsm matte or satin paper. Matte hides fingerprints and reflections; satin gives deeper colour.",
                "The half-inch margin is there so the frame's lip cannot cover any part of the design. Do not trim it off.",
                "Choose the frame size matching the file: A4 or A3, 8x10 or 16x20, 12x18 or 24x36.",
            ]),
            ("A few things worth knowing", [
                "Every file is 300 DPI, which is full photographic print quality.",
                "The larger size of each pair is the same file printed bigger - a poster at 24x36 lands around 150 DPI, which is normal at that viewing distance.",
                "Ask for no auto-enhance, no auto-crop and no colour correction. The colours were chosen deliberately.",
                "Both PNG and PDF are included. Most print shops prefer the PDF.",
            ]),
        ],
    },
    "fr": {
        "title": "Comment imprimer votre souvenir",
        "sections": [
            ("Vous avez reçu deux versions de chaque format", [
                "Sans marge : l'illustration va jusqu'au bord du papier, sans bordure.",
                "Avec marges : l'illustration est placée dans une marge d'un demi-pouce (1,27 cm).",
                "Ce sont deux fichiers différents, pas le même fichier recadré. Choisissez celui qui correspond à la façon dont vous comptez l'exposer.",
            ]),
            ("La version sans marge : montage sous verre ou acrylique", [
                "Demandez à un imprimeur un montage acrylique, un tirage sur verre ou un contrecollage (face-mount). Précisez que l'illustration est à fond perdu et ne doit être ni rognée ni redimensionnée. Le tirage est pressé sous ou derrière la surface, rien ne le recouvre : c'est pourquoi cette version n'a pas de marge à perdre.",
            ]),
            ("La version avec marges : un cadre photo ordinaire", [
                "N'importe quel imprimeur, ou une imprimante à la maison, sur papier mat ou satiné de 200 à 250 g/m². Le mat cache les traces de doigts et les reflets ; le satiné donne des couleurs plus profondes.",
                "La marge d'un demi-pouce empêche le rebord du cadre de couvrir une partie du dessin. Ne la coupez pas.",
                "Choisissez la taille de cadre correspondant au fichier : A4 ou A3, 8x10 ou 16x20, 12x18 ou 24x36 pouces.",
            ]),
            ("Bon à savoir", [
                "Chaque fichier est en 300 DPI, la qualité d'un tirage photo.",
                "Le plus grand format de chaque paire est le même fichier imprimé plus grand : une affiche de 24x36 pouces arrive autour de 150 DPI, ce qui est normal à cette distance.",
                "Demandez à ne pas appliquer d'amélioration automatique, de recadrage automatique ni de correction des couleurs. Les couleurs ont été choisies avec soin.",
                "Les fichiers PNG et PDF sont fournis. La plupart des imprimeurs préfèrent le PDF.",
            ]),
        ],
    },
    "ar": {
        "title": "كيف تطبع تُحفتك",
        "sections": [
            ("وصلتك نسختان من كل مقاس", [
                "بلا حواف: يمتد التصميم حتى طرف الورقة، بلا إطار.",
                "بحواف: يقع التصميم داخل هامش بعرض نصف بوصة (1.27 سم).",
                "إنهما ملفان مختلفان، وليسا الملف نفسه بعد قصّه. استخدم ما يناسب طريقة عرضك له.",
            ]),
            ("النسخة بلا حواف: التركيب على زجاج أو أكريليك", [
                "اطلب من مطبعة تركيبًا على الأكريليك أو طباعة على الزجاج أو تركيبًا أماميًا (face-mount). وأخبرهم أن التصميم يمتد حتى الحافة ويجب ألا يُقصّ أو يُعاد تحجيمه. تُضغط هذه الطباعة تحت السطح أو خلفه فلا يغطيها شيء، ولهذا ليس لهذه النسخة هامش تخسره.",
            ]),
            ("النسخة بحواف: إطار صور عادي", [
                "أي مطبعة، أو طابعة منزلية، على ورق مطفأ أو ساتان بوزن 200 إلى 250 غرامًا للمتر المربع. يخفي الورق المطفأ البصمات والانعكاسات، ويمنح الساتان ألوانًا أعمق.",
                "يوجد هامش نصف البوصة كي لا تغطي حافة الإطار أي جزء من التصميم. لا تقصّه.",
                "اختر مقاس الإطار المطابق للملف: A4 أو A3، أو 8x10 أو 16x20، أو 12x18 أو 24x36 بوصة.",
            ]),
            ("أشياء تستحق المعرفة", [
                "كل ملف بدقة 300 نقطة في البوصة، وهي جودة الطباعة الفوتوغرافية الكاملة.",
                "المقاس الأكبر في كل زوج هو الملف نفسه مطبوعًا بحجم أكبر: ملصق 24x36 بوصة يصل إلى نحو 150 نقطة في البوصة، وهذا طبيعي من تلك المسافة.",
                "اطلب عدم تطبيق أي تحسين تلقائي أو قصّ تلقائي أو تصحيح للألوان؛ فقد اختيرت الألوان بعناية.",
                "يتضمّن الطلب ملفات PNG وPDF، ومعظم المطابع تفضّل PDF.",
            ]),
        ],
    },
}
