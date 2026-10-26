"""The receipt email in the order's language (owner's decision, 25 Oct 2026:
it was English for every order, subject included).

`PRODUCT_NAMES` repeats the storefront's product names
(`frontend-heartfolio/src/messages/<locale>.json`, `Products.<key>.name`),
keyed by `Product.name_i18n_key`;
`frontend-heartfolio/src/messages/email-product-names.test.ts` fails if they
drift apart (the frontend tests can read the backend, not the reverse).
"""

from __future__ import annotations

SUPPORTED = ("en", "fr", "ar")


def copy_locale(locale: str | None) -> str:
    return locale if locale in SUPPORTED else "en"


PRODUCT_NAMES = {
    "loveStoryTimeline": {"en": "Love Story Timeline", "fr": "Frise d'histoire d'amour", "ar": "الخط الزمني لقصة الحب"},
    "songPoster": {"en": "Song Poster", "fr": "Affiche musicale", "ar": "ملصق الأغنية"},
    "reasonsILoveYou": {"en": "Reasons I Love You", "fr": "Les raisons pour lesquelles je t'aime", "ar": "أسباب حبي لك"},
    "graduationKeepsake": {"en": "Graduation Keepsake", "fr": "Souvenir de diplôme", "ar": "هدية التخرّج"},
    "whereWeMet": {"en": "Where We Met", "fr": "Là où nous nous sommes rencontrés", "ar": "حيث التقينا"},
}

RECEIPT = {
    "en": {
        "subject": "Your Heartfolio order — {product}",
        "heading": "Thank you — your keepsake is ready",
        "paid": "Your payment for {product} has gone through.",
        "total": "Total paid: {total}",
        "button": "Open your order",
        "qr_alt": "Scan to open the keepsake",
        "qr_caption": "This QR card is for the gift — scanning it opens the keepsake directly on a phone. Print it, show it on a screen, or simply forward it as it is. It is attached to this email too.",
        "qr_text": "A QR card for the gift is attached — scanning it opens the keepsake directly on a phone. Print it, show it on a screen, or simply forward it as it is.",
        "gift_link": "Or send them the gift link:",
        "link_note": "This link works on any device and does not need a password. It stays valid for {days} days — if it ever stops working, just reply to this email and we will send a fresh one.",
        "reference": "Order reference: {reference}",
    },
    "fr": {
        "subject": "Votre commande Heartfolio — {product}",
        "heading": "Merci — votre souvenir est prêt",
        "paid": "Votre paiement pour « {product} » a bien été reçu.",
        "total": "Total payé : {total}",
        "button": "Ouvrir votre commande",
        "qr_alt": "Scannez pour ouvrir le souvenir",
        "qr_caption": "Cette carte QR est pour le cadeau : la scanner ouvre directement le souvenir sur un téléphone. Imprimez-la, montrez-la sur un écran ou transférez-la telle quelle. Elle est aussi jointe à cet e-mail.",
        "qr_text": "Une carte QR pour le cadeau est jointe : la scanner ouvre directement le souvenir sur un téléphone. Imprimez-la, montrez-la sur un écran ou transférez-la telle quelle.",
        "gift_link": "Ou envoyez le lien du cadeau :",
        "link_note": "Ce lien fonctionne sur tous les appareils, sans mot de passe. Il reste valable {days} jours ; s'il ne fonctionne plus, répondez simplement à cet e-mail et nous vous en enverrons un nouveau.",
        "reference": "Référence de commande : {reference}",
    },
    "ar": {
        "subject": "طلبك من هارتفوليو — {product}",
        "heading": "شكرًا لك — تُحفتك جاهزة",
        "paid": "تمّ دفع ثمن «{product}» بنجاح.",
        "total": "المبلغ المدفوع: {total}",
        "button": "افتح طلبك",
        "qr_alt": "امسح الرمز لفتح التُحفة",
        "qr_caption": "بطاقة QR هذه للهدية: مسحها يفتح التُحفة مباشرةً على الهاتف. اطبعها، أو اعرضها على شاشة، أو أعد توجيهها كما هي. وهي مرفقة بهذه الرسالة أيضًا.",
        "qr_text": "بطاقة QR للهدية مرفقة: مسحها يفتح التُحفة مباشرةً على الهاتف. اطبعها، أو اعرضها على شاشة، أو أعد توجيهها كما هي.",
        "gift_link": "أو أرسل رابط الهدية:",
        "link_note": "يعمل هذا الرابط على أي جهاز ولا يحتاج إلى كلمة مرور. ويبقى صالحًا لمدة {days} يومًا؛ وإذا توقّف، ردّ على هذه الرسالة وسنرسل إليك رابطًا جديدًا.",
        "reference": "رقم الطلب: {reference}",
    },
}


def product_name(i18n_key: str | None, slug: str, locale: str) -> str:
    names = PRODUCT_NAMES.get(i18n_key or "")
    if names:
        return names[copy_locale(locale)]
    return slug.replace("-", " ").title()
