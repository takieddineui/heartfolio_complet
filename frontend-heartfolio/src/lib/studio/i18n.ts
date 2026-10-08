import type { LocaleCode, ProductModuleMessages, ValidationError } from "@/types/studio";

/** Generic validation codes every module gets for free from the Shell's
 * own schema validator (`form-engine.ts`), independent of any product's
 * own content. A module's *domain* validation codes (e.g. Timeline's
 * "duplicateDate") are NOT listed here — those resolve against the
 * module's own `messages` dictionary instead (see `resolveValidationMessage`). */
const SHELL_VALIDATION_MESSAGES: Record<LocaleCode, Record<string, string>> = {
  en: {
    required: "{label} is required.",
    maxLength: "{label} must be {maxLength} characters or fewer.",
    minItems: "At least {minItems} required.",
    "media.tooLarge": "{filename} is larger than {maxSizeMb}MB. Please choose a smaller file.",
    "media.record": "Record",
    "media.stopRecording": "Stop",
    "media.recordUnavailable": "We couldn't access your microphone. Please check your browser and system permissions and try again.",
    "media.recordingNotSupported": "Voice recording isn't supported in this browser.",
    "media.unsupportedType": "{filename} isn't a supported format.",
    "media.uploadFailed": "We couldn't upload your photos. Please try again.",
  },
  fr: {
    required: "{label} est requis.",
    maxLength: "{label} ne doit pas dépasser {maxLength} caractères.",
    minItems: "Au moins {minItems} requis.",
    "media.tooLarge": "{filename} dépasse {maxSizeMb} Mo. Choisissez un fichier plus léger.",
    "media.record": "Enregistrer",
    "media.stopRecording": "Arrêter",
    "media.recordUnavailable": "Impossible d'accéder à votre microphone. Vérifiez les autorisations de votre navigateur et de votre système, puis réessayez.",
    "media.recordingNotSupported": "L'enregistrement vocal n'est pas pris en charge par ce navigateur.",
    "media.unsupportedType": "{filename} n'est pas un format pris en charge.",
    "media.uploadFailed": "Nous n'avons pas pu téléverser vos photos. Veuillez réessayer.",
  },
  ar: {
    required: "{label} مطلوب.",
    maxLength: "يجب ألا يتجاوز {label} {maxLength} حرفًا.",
    minItems: "مطلوب {minItems} على الأقل.",
    "media.tooLarge": "{filename} أكبر من {maxSizeMb} ميغابايت. اختر ملفًا أصغر.",
    "media.record": "تسجيل",
    "media.stopRecording": "إيقاف",
    "media.recordUnavailable": "تعذّر الوصول إلى الميكروفون. يرجى التحقق من أذونات المتصفح والنظام ثم المحاولة مرة أخرى.",
    "media.recordingNotSupported": "تسجيل الصوت غير مدعوم في هذا المتصفح.",
    "media.unsupportedType": "{filename} ليس بصيغة مدعومة.",
    "media.uploadFailed": "تعذّر رفع صورك. يرجى المحاولة مرة أخرى.",
  },
};

/** Shell-owned checkout UI copy, following the exact same pattern as
 * `SHELL_VALIDATION_MESSAGES` above — these strings belong to the Shell
 * (checkout flow chrome), not to any Product Module, so they don't
 * belong in a module's `messages` dictionary. */
const SHELL_CHECKOUT_MESSAGES: Record<LocaleCode, Record<string, string>> = {
  en: {
    "checkout.selectPack": "Choose how you'd like to receive it",
    "checkout.noPacks": "No delivery options are available for this product yet.",
    "checkout.unitsHint": "Choose what you'd like — you can pick more than one.",
    "checkout.unitsSelectOne": "Choose at least one to continue.",
    "checkout.unitsUnavailable": "That combination isn't available.",
    "checkout.unitsSavings": "Together you save {price}.",
    "checkout.unitsContinue": "Continue",
    "checkout.included": "Includes",
    // Wallpaper is never its own purchasable pack — it only ever
    // appears as this checkbox, on Printable or Digital. {price} is a
    // DERIVED difference between two real DB prices (combo minus base),
    // computed at display time — never a hardcoded surcharge figure.
    "checkout.addWallpapers": "Add phone & desktop wallpapers (+{price})",
    "checkout.email": "Email",
    "checkout.emailHelp": "We'll use this to keep your files, since Heartfolio doesn't require an account.",
    "checkout.continueToPayment": "Continue to payment",
    "checkout.back": "Back",
    "checkout.subtotal": "Subtotal",
    "checkout.discount": "Discount",
    "checkout.total": "Total",
    "checkout.payWith": "You'll be redirected to our secure payment provider.",
    "checkout.payNow": "Pay securely",
    "checkout.preparing": "Preparing your order\u2026",
    "checkout.uploadingPhotos": "Uploading your photos\u2026",
    "checkout.savingProject": "Saving your design\u2026",
    "checkout.creatingOrder": "Creating your order\u2026",
    "checkout.confirming": "Confirming your payment\u2026",
    "checkout.confirmingBody": "This only takes a moment. Please keep this window open.",
    "checkout.pendingTitle": "Payment not confirmed yet",
    "checkout.pendingBody": "Your payment may still be going through. Keep this window open \u2014 it updates on its own as soon as the payment is confirmed.",
    "checkout.viewOrder": "View order status",
    "checkout.orderUnavailable": "We couldn't find that order. It may belong to a different browser or session \u2014 try opening it in the browser you used at checkout.",
    "checkout.downloadPack": "Download your keepsake",
    "checkout.downloadPrintable": "Printable files",
    "checkout.downloadWallpapers": "Wallpapers",
    "checkout.downloadBonuses": "Bonuses",
    "checkout.downloadLiveCards": "Download QR cards",
    "checkout.downloadGiftQr": "Download gift QR",
    "checkout.individualFiles": "Download individual files",
    "checkout.downloading": "Preparing your files\u2026",
    "checkout.downloadFailed": "That download didn't start. Please try again.",
    "checkout.downloadIncomplete": "That download didn't finish, so nothing was saved. Please try again.",
    "checkout.genericError": "Something went wrong. Please try again.",
    "checkout.invalidEmail": "Please enter a valid email address.",
    "checkout.incompletePhotos": "Please make sure a photo has been added everywhere it's needed, then try again.",
    "checkout.uploadFailedRetry": "One or more photos couldn't be uploaded. Please try again.",
    "checkout.processing": "Processing…",
    "checkout.successTitle": "Payment successful",
    "checkout.successBody": "Your order is paid and your files are ready.",
    "checkout.failedTitle": "Payment failed",
    "checkout.failedBody": "Your payment didn't go through, and nothing was charged. You can try again.",
    "checkout.cancelledTitle": "Payment cancelled",
    "checkout.cancelledBody": "Checkout was cancelled. Nothing was charged.",
    "checkout.tryAgain": "Try again",
    "checkout.close": "Close",
    "checkout.download": "Download",
    "checkout.qrForRecipient": "Recipient's QR",
    "checkout.qrRecipientAlt": "QR code for the gift recipient's live page",
    "checkout.qrRecipientCaption": "Give this to them — it opens the keepsake directly.",
    /* §10 / §7c — the review box on the thank-you page. */
    "feedback.title": "How did we do?",
    "feedback.subtitle": "A quick rating helps more than you'd think. A note helps even more.",
    "feedback.placeholder": "Anything you'd change, or anything you loved?",
    "feedback.rateAria": "Rate {n} out of 5",
    "feedback.submit": "Send feedback",
    "feedback.sending": "Sending…",
    "feedback.thanks": "Thank you — that genuinely helps.",
    "feedback.error": "That didn't send. Your keepsake is safe above; feel free to try again.",
    "otherProducts.title": "More from Heartfolio",
    "checkout.openOrderPage": "View your order",
    "preview.modes.label": "Preview as",
    "preview.modes.flat": "Artwork",
    "preview.modes.framed": "Framed",
    "preview.modes.device": "On a device",
    "preview.modes.live": "Live experience",
    "preview.devices.label": "Device",
    "preview.mounting.label": "Mounting",
    "preview.mounting.edged": "In a frame",
    "preview.mounting.frameless": "Frameless",
    "preview.finish.label": "Frame colour",
    "preview.finish.wood": "Wood",
    "preview.finish.black": "Black",
    "preview.devices.phone": "Phone",
    "preview.devices.tablet": "Tablet",
    "preview.devices.desktop": "Desktop",
    "preview.screen.label": "Screen",
    "preview.screen.lock": "Lock screen",
    "preview.screen.home": "Home screen",
    "preview.wallpaperKind.label": "Wallpaper",
    "preview.wallpaperKind.story": "Story",
    "preview.wallpaperKind.moment": "Moment",
    "preview.liveView.label": "View",
    "preview.liveView.keepsake": "Keepsake",
    "preview.liveView.qr": "QR card",
    "arTarget.working": "Preparing your AR card…",
    "arTarget.done": "Your AR card is ready to print.",
    "arTarget.deferred": "Your AR card is ready to print. The first scan may take a moment longer.",
    /* §2 — customer-facing deliverable names. These live in the SHELL
       dictionary, not a product module's, because print sizes and mounting
       variants are shared across every poster-shaped product (see
       lib/studio/print-sizes.ts) and because the order page renders without
       loading any module. The module's own `exports.*` labels carry the same
       wording for the Studio's export panel, which resolves through
       `resolveModuleText` instead — same strings, two resolvers, because the
       two surfaces have genuinely different message sources. */
    "deliverables.sizes.a4": "A4 / A3",
    "deliverables.sizes.classic": "Classic 8×10 in",
    "deliverables.sizes.poster": "Poster 12×18 in",
    "deliverables.mounting.frameless": "Frameless — for glass or acrylic mounting",
    "deliverables.mounting.edged": "With edges — for a traditional frame",
    "deliverables.wallpaper.phone": "Phone wallpaper",
    "deliverables.wallpaper.tablet": "Tablet wallpaper",
    "deliverables.wallpaper.desktop": "Desktop wallpaper",
    "deliverables.legacy.print": "Print-ready file (A4)",
    "deliverables.legacy.story": "Story image",
    "deliverables.legacy.square": "Square image",
    "deliverables.legacy.landscape": "Landscape image",
    "deliverables.legacy.portrait": "Portrait image",
  },
  fr: {
    "checkout.selectPack": "Choisissez comment le recevoir",
    "checkout.noPacks": "Aucune option de livraison n'est encore disponible pour ce produit.",
    "checkout.unitsHint": "Choisissez ce que vous souhaitez — vous pouvez en sélectionner plusieurs.",
    "checkout.unitsSelectOne": "Choisissez au moins une option pour continuer.",
    "checkout.unitsUnavailable": "Cette combinaison n'est pas disponible.",
    "checkout.unitsSavings": "En les prenant ensemble, vous économisez {price}.",
    "checkout.unitsContinue": "Continuer",
    "checkout.included": "Comprend",
    "checkout.addWallpapers": "Ajouter les fonds d'écran (+{price})",
    "checkout.email": "Email",
    "checkout.emailHelp": "Nous l'utilisons pour rattacher vos fichiers \u00e0 vous : Heartfolio ne demande pas de compte.",
    "checkout.continueToPayment": "Continuer vers le paiement",
    "checkout.back": "Retour",
    "checkout.subtotal": "Sous-total",
    "checkout.discount": "Remise",
    "checkout.total": "Total",
    "checkout.payWith": "Vous serez redirigé vers notre prestataire de paiement sécurisé.",
    "checkout.payNow": "Payer en toute sécurité",
    "checkout.preparing": "Préparation de votre commande\u2026",
    "checkout.uploadingPhotos": "Téléversement de vos photos\u2026",
    "checkout.savingProject": "Enregistrement de votre création\u2026",
    "checkout.creatingOrder": "Création de votre commande\u2026",
    "checkout.confirming": "Confirmation de votre paiement\u2026",
    "checkout.confirmingBody": "Cela ne prend qu\u2019un instant. Merci de garder cette fenêtre ouverte.",
    "checkout.pendingTitle": "Paiement pas encore confirmé",
    "checkout.pendingBody": "Votre paiement est peut-\u00eatre encore en cours. Gardez cette fen\u00eatre ouverte \u2014 la page se met \u00e0 jour d\u00e8s que le paiement est confirm\u00e9.",
    "checkout.viewOrder": "Voir l\u2019état de la commande",
    "checkout.orderUnavailable": "Commande introuvable. Elle appartient peut-\u00eatre \u00e0 un autre navigateur ou \u00e0 une autre session \u2014 essayez depuis le navigateur utilis\u00e9 lors du paiement.",
    "checkout.downloadPack": "Télécharger votre souvenir",
    "checkout.downloadPrintable": "Fichiers imprimables",
    "checkout.downloadWallpapers": "Fonds d\u2019écran",
    "checkout.downloadBonuses": "Bonus",
    "checkout.downloadLiveCards": "Télécharger les cartes QR",
    "checkout.downloadGiftQr": "Télécharger le QR du cadeau",
    "checkout.individualFiles": "Télécharger les fichiers séparément",
    "checkout.downloading": "Préparation de vos fichiers\u2026",
    "checkout.downloadFailed": "Le téléchargement n\u2019a pas démarré. Veuillez réessayer.",
    "checkout.downloadIncomplete": "Le téléchargement ne s’est pas terminé, rien n’a été enregistré. Veuillez réessayer.",
    "checkout.genericError": "Une erreur est survenue. Veuillez réessayer.",
    "checkout.invalidEmail": "Veuillez saisir une adresse e-mail valide.",
    "checkout.incompletePhotos": "Veuillez vérifier qu'une photo a été ajoutée partout où c'est nécessaire, puis réessayez.",
    "checkout.uploadFailedRetry": "Une ou plusieurs photos n'ont pas pu être envoyées. Veuillez réessayer.",
    "checkout.processing": "Traitement…",
    "checkout.successTitle": "Paiement réussi",
    "checkout.successBody": "Votre commande est payée, vos fichiers sont prêts.",
    "checkout.failedTitle": "Échec du paiement",
    "checkout.failedBody": "Votre paiement n'a pas abouti et rien n'a \u00e9t\u00e9 d\u00e9bit\u00e9. Vous pouvez r\u00e9essayer.",
    "checkout.cancelledTitle": "Paiement annulé",
    "checkout.cancelledBody": "Paiement annul\u00e9. Rien n'a \u00e9t\u00e9 d\u00e9bit\u00e9.",
    "checkout.tryAgain": "Réessayer",
    "checkout.close": "Fermer",
    "checkout.download": "Télécharger",
    "checkout.qrForRecipient": "QR du destinataire",
    "checkout.qrRecipientAlt": "QR code de la page en direct pour le destinataire du cadeau",
    "checkout.qrRecipientCaption": "Offrez-le au destinataire — il ouvre directement le souvenir.",
    "feedback.title": "Qu'en avez-vous pensé ?",
    "feedback.subtitle": "Une note rapide aide plus que vous ne le croyez. Un mot aide encore plus.",
    "feedback.placeholder": "Quelque chose à changer, ou quelque chose qui vous a plu ?",
    "feedback.rateAria": "Noter {n} sur 5",
    "feedback.submit": "Envoyer",
    "feedback.sending": "Envoi…",
    "feedback.thanks": "Merci — cela nous aide vraiment.",
    "feedback.error": "L'envoi a échoué. Votre souvenir reste disponible ci-dessus ; n'hésitez pas à réessayer.",
    "otherProducts.title": "Autres créations Heartfolio",
    "checkout.openOrderPage": "Voir votre commande",
    "preview.modes.label": "Aperçu",
    "preview.modes.flat": "Création",
    "preview.modes.framed": "Encadré",
    "preview.modes.device": "Sur un écran",
    "preview.modes.live": "Expérience en direct",
    "preview.devices.label": "Appareil",
    "preview.mounting.label": "Encadrement",
    "preview.mounting.edged": "Dans un cadre",
    "preview.mounting.frameless": "Sans cadre",
    "preview.finish.label": "Couleur du cadre",
    "preview.finish.wood": "Bois",
    "preview.finish.black": "Noir",
    "preview.devices.phone": "Téléphone",
    "preview.devices.tablet": "Tablette",
    "preview.devices.desktop": "Ordinateur",
    "preview.screen.label": "Écran",
    "preview.screen.lock": "Écran verrouillé",
    "preview.screen.home": "Écran d'accueil",
    "preview.wallpaperKind.label": "Fond d'écran",
    "preview.wallpaperKind.story": "Histoire",
    "preview.wallpaperKind.moment": "Moment",
    "preview.liveView.label": "Affichage",
    "preview.liveView.keepsake": "Souvenir",
    "preview.liveView.qr": "Carte QR",
    "arTarget.working": "Préparation de votre carte AR…",
    "arTarget.done": "Votre carte AR est prête à imprimer.",
    "arTarget.deferred": "Votre carte AR est prête à imprimer. Le premier scan prendra un instant de plus.",
    "deliverables.sizes.a4": "A4 / A3",
    "deliverables.sizes.classic": "Classique 8×10 po",
    "deliverables.sizes.poster": "Affiche 12×18 po",
    "deliverables.mounting.frameless": "Sans bordure — pour montage sur verre ou acrylique",
    "deliverables.mounting.edged": "Avec marges — pour un cadre traditionnel",
    "deliverables.wallpaper.phone": "Fond d'écran téléphone",
    "deliverables.wallpaper.tablet": "Fond d'écran tablette",
    "deliverables.wallpaper.desktop": "Fond d'écran ordinateur",
    "deliverables.legacy.print": "Fichier prêt à imprimer (A4)",
    "deliverables.legacy.story": "Image Story",
    "deliverables.legacy.square": "Image carrée",
    "deliverables.legacy.landscape": "Image paysage",
    "deliverables.legacy.portrait": "Image portrait",
  },
  ar: {
    "checkout.selectPack": "اختر كيف تريد استلامها",
    "checkout.noPacks": "لا تتوفر خيارات تسليم لهذا المنتج بعد.",
    "checkout.unitsHint": "اختر ما تريد — يمكنك اختيار أكثر من خيار.",
    "checkout.unitsSelectOne": "اختر خيارًا واحدًا على الأقل للمتابعة.",
    "checkout.unitsUnavailable": "هذه التركيبة غير متاحة.",
    "checkout.unitsSavings": "عند اختيارهما معًا توفّر {price}.",
    "checkout.unitsContinue": "متابعة",
    "checkout.included": "يشمل",
    "checkout.addWallpapers": "أضف خلفيات الهاتف وسطح المكتب (+{price})",
    "checkout.email": "البريد الإلكتروني",
    "checkout.emailHelp": "نستخدمه لربط ملفاتك بك، فـ Heartfolio لا يتطلب إنشاء حساب.",
    "checkout.continueToPayment": "المتابعة إلى الدفع",
    "checkout.back": "رجوع",
    "checkout.subtotal": "المجموع الفرعي",
    "checkout.discount": "الخصم",
    "checkout.total": "الإجمالي",
    "checkout.payWith": "سيتم تحويلك إلى مزوّد الدفع الآمن لدينا.",
    "checkout.payNow": "ادفع بأمان",
    "checkout.preparing": "جارٍ تجهيز طلبك…",
    "checkout.uploadingPhotos": "جارٍ رفع صورك…",
    "checkout.savingProject": "جارٍ حفظ تصميمك…",
    "checkout.creatingOrder": "جارٍ إنشاء طلبك…",
    "checkout.confirming": "جارٍ تأكيد الدفع…",
    "checkout.confirmingBody": "لن يستغرق ذلك سوى لحظة. يرجى إبقاء هذه النافذة مفتوحة.",
    "checkout.pendingTitle": "لم يتم تأكيد الدفع بعد",
    "checkout.pendingBody": "قد تكون عملية الدفع قيد المعالجة. أبقِ هذه النافذة مفتوحة — ستتحدّث الصفحة تلقائيًا بمجرد تأكيد الدفع.",
    "checkout.viewOrder": "عرض حالة الطلب",
    "checkout.orderUnavailable": "تعذّر العثور على هذا الطلب. قد يعود إلى متصفح أو جلسة أخرى — جرّب فتحه من المتصفح الذي استخدمته عند الدفع.",
    "checkout.downloadPack": "تنزيل تذكارك",
    "checkout.downloadPrintable": "ملفات الطباعة",
    "checkout.downloadWallpapers": "الخلفيات",
    "checkout.downloadBonuses": "الإضافات",
    "checkout.downloadLiveCards": "تنزيل بطاقات QR",
    "checkout.downloadGiftQr": "تنزيل رمز QR للهدية",
    "checkout.individualFiles": "تنزيل الملفات كلًّا على حدة",
    "checkout.downloading": "جارٍ تجهيز ملفاتك…",
    "checkout.downloadFailed": "لم يبدأ التنزيل. يرجى المحاولة مرة أخرى.",
    "checkout.downloadIncomplete": "لم يكتمل التنزيل، لذلك لم يتم حفظ أي شيء. يرجى المحاولة مرة أخرى.",
    "checkout.genericError": "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
    "checkout.invalidEmail": "يرجى إدخال بريد إلكتروني صالح.",
    "checkout.incompletePhotos": "يرجى التأكد من إضافة صورة في كل مكان مطلوب، ثم المحاولة مرة أخرى.",
    "checkout.uploadFailedRetry": "تعذّر رفع صورة واحدة أو أكثر. يرجى المحاولة مرة أخرى.",
    "checkout.processing": "جارٍ المعالجة…",
    "checkout.successTitle": "تم الدفع بنجاح",
    "checkout.successBody": "تم دفع طلبك وملفاتك جاهزة.",
    "checkout.failedTitle": "فشل الدفع",
    "checkout.failedBody": "لم تتم عملية الدفع ولم يُخصم أي مبلغ. يمكنك المحاولة مرة أخرى.",
    "checkout.cancelledTitle": "تم إلغاء الدفع",
    "checkout.cancelledBody": "تم إلغاء الدفع. لم يُخصم أي مبلغ.",
    "checkout.tryAgain": "حاول مرة أخرى",
    "checkout.close": "إغلاق",
    "checkout.download": "تنزيل",
    "checkout.qrForRecipient": "رمز QR للمستلم",
    "checkout.qrRecipientAlt": "رمز QR لصفحة الهدية المباشرة الخاصة بالمُستلِم",
    "checkout.qrRecipientCaption": "قدّمه للمستلم — فهو يفتح التذكار مباشرةً.",
    "feedback.title": "كيف كانت تجربتك؟",
    "feedback.subtitle": "تقييم سريع يساعدنا أكثر مما تتصوّر، وكلمة منك تساعد أكثر.",
    "feedback.placeholder": "هل من شيء كنت لتغيّره، أو شيء أعجبك؟",
    "feedback.rateAria": "تقييم {n} من ٥",
    "feedback.submit": "إرسال",
    "feedback.sending": "جارٍ الإرسال…",
    "feedback.thanks": "شكرًا لك — هذا يساعدنا فعلًا.",
    "feedback.error": "لم يُرسل التقييم. تُحفتك محفوظة أعلاه، ويمكنك المحاولة مجددًا.",
    "otherProducts.title": "المزيد من هارتفوليو",
    "checkout.openOrderPage": "عرض طلبك",
    "preview.modes.label": "المعاينة بصيغة",
    "preview.modes.flat": "التصميم",
    "preview.modes.framed": "بإطار",
    "preview.modes.device": "على جهاز",
    "preview.modes.live": "التجربة التفاعلية",
    "preview.devices.label": "الجهاز",
    "preview.mounting.label": "التركيب",
    "preview.mounting.edged": "داخل إطار",
    "preview.mounting.frameless": "بدون إطار",
    "preview.finish.label": "لون الإطار",
    "preview.finish.wood": "خشبي",
    "preview.finish.black": "أسود",
    "preview.devices.phone": "هاتف",
    "preview.devices.tablet": "لوحي",
    "preview.devices.desktop": "حاسوب",
    "preview.screen.label": "الشاشة",
    "preview.screen.lock": "شاشة القفل",
    "preview.screen.home": "الشاشة الرئيسية",
    "preview.wallpaperKind.label": "الخلفية",
    "preview.wallpaperKind.story": "القصة",
    "preview.wallpaperKind.moment": "لحظة",
    "preview.liveView.label": "العرض",
    "preview.liveView.keepsake": "التذكار",
    "preview.liveView.qr": "بطاقة QR",
    "arTarget.working": "جارٍ تجهيز بطاقة الواقع المعزّز…",
    "arTarget.done": "بطاقتك جاهزة للطباعة.",
    "arTarget.deferred": "بطاقتك جاهزة للطباعة. وقد يستغرق المسح الأول لحظة إضافية.",
    "deliverables.sizes.a4": "A4 / A3",
    "deliverables.sizes.classic": "كلاسيكي ٨×١٠ بوصة",
    "deliverables.sizes.poster": "ملصق ١٢×١٨ بوصة",
    "deliverables.mounting.frameless": "بلا حواف — للتثبيت على الزجاج أو الأكريليك",
    "deliverables.mounting.edged": "بحواف — للإطار التقليدي",
    "deliverables.wallpaper.phone": "خلفية للهاتف",
    "deliverables.wallpaper.tablet": "خلفية للوحي",
    "deliverables.wallpaper.desktop": "خلفية للحاسوب",
    "deliverables.legacy.print": "ملف جاهز للطباعة (A4)",
    "deliverables.legacy.story": "صورة ستوري",
    "deliverables.legacy.square": "صورة مربّعة",
    "deliverables.legacy.landscape": "صورة أفقية",
    "deliverables.legacy.portrait": "صورة عمودية",
  },
};

function interpolateShell(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

/** Resolves Shell-owned checkout copy for the active locale, falling
 * back to English then the raw key — same degrade-gracefully contract as
 * `resolveModuleText`. */
export function resolveShellText(key: string, locale: string, params?: Record<string, string | number>): string {
  const localeCode = (locale in SHELL_CHECKOUT_MESSAGES ? locale : "en") as LocaleCode;
  const text = SHELL_CHECKOUT_MESSAGES[localeCode]?.[key] ?? SHELL_CHECKOUT_MESSAGES.en[key] ?? key;
  return params ? interpolateShell(text, params) : text;
}

/** Resolves a Shell-owned VALIDATION string (`SHELL_VALIDATION_MESSAGES`)
 * by a bare key, for UI copy that reads that same dictionary but isn't
 * itself a `ValidationError` — e.g. the record button's own label, which
 * has no error code to hand `resolveValidationMessage`. `resolveShellText`
 * cannot be reused for this: it only ever reads `SHELL_CHECKOUT_MESSAGES`,
 * a separate dictionary that has no `media.*` keys, so a `media.*` key
 * passed to it silently falls through to the raw key. Same fallback
 * contract as `resolveShellText`: locale, then English, then the raw key. */
export function resolveShellValidationText(
  key: string,
  locale: string,
  params?: Record<string, string | number>
): string {
  const localeCode = (locale in SHELL_VALIDATION_MESSAGES ? locale : "en") as LocaleCode;
  const text = SHELL_VALIDATION_MESSAGES[localeCode]?.[key] ?? SHELL_VALIDATION_MESSAGES.en[key] ?? key;
  return params ? interpolateShell(text, params) : text;
}

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

/** Resolves any translation *key* (field label, axis label, pricing rule
 * label, export format label, ...) against a module's own messages for
 * the active locale, falling back to English, then to the raw key —
 * missing translations degrade to visible-but-unlocalized text rather
 * than a crash or a blank field. */
export function resolveModuleText(
  key: string | undefined,
  locale: string,
  messages: ProductModuleMessages,
  params?: Record<string, string | number>
): string {
  if (!key) return "";
  const localeCode = (locale in messages ? locale : "en") as LocaleCode;
  const text = messages[localeCode]?.[key] ?? messages.en?.[key] ?? key;
  return params ? interpolate(text, params) : text;
}

/** A validation error's `code` is first looked up in the module's own
 * `messages` dictionary under `validation.<code>` (domain rules the
 * module authored itself), then in the Shell's generic messages (rules
 * every schema gets for free: required/maxLength/minItems). */
export function resolveValidationMessage(
  error: ValidationError,
  locale: string,
  messages: ProductModuleMessages
): string {
  const localeCode = (locale in messages || locale in SHELL_VALIDATION_MESSAGES ? locale : "en") as LocaleCode;

  /**
   * `error.params.label` is a schema i18n KEY (e.g. "fields.eventPhoto.label"),
   * not display text — every field schema in this codebase sets `label` to a
   * translation key, by design, so the same schema can drive both the field's
   * own input and its validation message.
   *
   * THIS WAS THE BUG. Both branches below used to hand `error.params`
   * straight to `interpolate()`, which does a blind `{label}` substitution
   * with whatever string sits in `params.label` — the raw key, unresolved.
   * The result was literally "fields.eventPhoto.label is required." shown
   * to a customer. Resolving `label` through `resolveModuleText` here,
   * once, before either branch runs, is what a schema key is FOR — the
   * field input and its error message read the same source and can no
   * longer drift into showing different things for the same field.
   */
  const resolvedParams: Record<string, string | number> | undefined = error.params?.label
    ? { ...error.params, label: resolveModuleText(String(error.params.label), locale, messages) }
    : error.params;

  const moduleKey = `validation.${error.code}`;
  const moduleText = messages[localeCode]?.[moduleKey] ?? messages.en?.[moduleKey];
  if (moduleText) return interpolate(moduleText, resolvedParams);

  const shellText = SHELL_VALIDATION_MESSAGES[localeCode]?.[error.code] ?? SHELL_VALIDATION_MESSAGES.en[error.code];
  return shellText ? interpolate(shellText, resolvedParams) : error.code;
}
