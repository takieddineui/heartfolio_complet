# -*- coding: utf-8 -*-
"""Curated Song Poster sample scenarios for the V2 customer-artwork library.

Eight fictional songs, one per CURRENT theme (player, ledger, ephemeris,
contactsheet, label, award, sleeve, mosaic), covering different genres, moods,
decades and relationship contexts. Each is authored natively in six languages
(en, fr, ar, es, ru, zh-CN).

All titles, artists and dedications are FICTIONAL — no real songs, no lyrics,
no copyrighted text. Fields obey the REAL Song Poster limits (audited from
backend/apps/delivery/product_renderers/song_poster/data.py):
  track <= 60 · artist <= 60 · dedication <= 180 (optional) · photo required ·
  youtubeUrl + matching youtubeVideoId required (validated, not drawn) ·
  theme in the 8 THEMES · sleevePalette in SLEEVE_PALETTES.

The sleeve theme draws the dedication around the disc in plain DejaVu
(letter-by-letter, no shaping — a product limitation), so the dedication is
left blank for ar/zh-CN on that theme only.
"""

LANGS = ("en", "fr", "ar", "es", "ru", "zh-CN")

SONG_SCENARIOS = [
    {
        "id": "sp1-first-dance", "theme": "player", "photo": "song-turntable.jpg",
        "genre": "indie acoustic", "mood": "tender", "decade": "2020s", "context": "first dance",
        "lang": {
            "en": {"track": "The Slow Part of the Song", "artist": "Paper Harbour",
                   "dedication": "Our first dance, and every kitchen one since."},
            "fr": {"track": "La partie lente de la chanson", "artist": "Les Quais de Papier",
                   "dedication": "Notre première danse, et toutes celles dans la cuisine depuis."},
            "ar": {"track": "المقطع الهادئ من الأغنية", "artist": "فرقة ميناء الورق",
                   "dedication": "رقصتنا الأولى، وكلّ رقصة في المطبخ بعدها."},
            "es": {"track": "La parte lenta de la canción", "artist": "Puerto de Papel",
                   "dedication": "Nuestro primer baile, y todos los de la cocina desde entonces."},
            "ru": {"track": "Тихая часть песни", "artist": "Бумажная Гавань",
                   "dedication": "Наш первый танец и все кухонные танцы с тех пор."},
            "zh-CN": {"track": "歌里最慢的那一段", "artist": "纸港乐队",
                   "dedication": "我们的第一支舞，和之后每一次在厨房里的旋转。"},
        },
    },
    {
        "id": "sp2-long-marriage", "theme": "ledger", "photo": "lst-home-keys.jpg",
        "genre": "singer-songwriter", "mood": "reflective", "decade": "2010s", "context": "long marriage",
        "lang": {
            "en": {"track": "Twenty Winters", "artist": "Eleanor Vance",
                   "dedication": "Twenty winters in, and you still warm the cold side of the bed."},
            "fr": {"track": "Vingt hivers", "artist": "Éléonore Vence",
                   "dedication": "Vingt hivers plus tard, tu réchauffes encore le côté froid du lit."},
            "ar": {"track": "عشرون شتاءً", "artist": "إليانور فانس",
                   "dedication": "بعد عشرين شتاءً، ما زلت تدفّئ الجانب البارد من السرير."},
            "es": {"track": "Veinte inviernos", "artist": "Leonor Vance",
                   "dedication": "Veinte inviernos después, aún calientas el lado frío de la cama."},
            "ru": {"track": "Двадцать зим", "artist": "Элеонора Ванс",
                   "dedication": "Двадцать зим спустя ты всё ещё греешь холодную сторону кровати."},
            "zh-CN": {"track": "二十个冬天", "artist": "伊琳·凡斯",
                   "dedication": "二十个冬天过去，你依旧温暖着床那一侧的寒冷。"},
        },
    },
    {
        "id": "sp3-long-distance", "theme": "ephemeris", "photo": "lst-trip-road.jpg",
        "genre": "dream-pop", "mood": "cosmic", "decade": "2020s", "context": "long distance",
        "lang": {
            "en": {"track": "Same Moon, Different Window", "artist": "Nova Atlas",
                   "dedication": "Six time zones apart, under one very patient moon."},
            "fr": {"track": "Même lune, autre fenêtre", "artist": "Nova Atlas",
                   "dedication": "Six fuseaux horaires d'écart, sous une même lune très patiente."},
            "ar": {"track": "القمر نفسه، نافذة أخرى", "artist": "نوفا أطلس",
                   "dedication": "تفصلنا ستّ مناطق زمنية، تحت قمرٍ واحدٍ صبور."},
            "es": {"track": "Misma luna, otra ventana", "artist": "Nova Atlas",
                   "dedication": "Seis husos horarios de distancia, bajo una misma luna paciente."},
            "ru": {"track": "Та же луна, другое окно", "artist": "Нова Атлас",
                   "dedication": "Шесть часовых поясов между нами, под одной терпеливой луной."},
            "zh-CN": {"track": "同一轮月，不同的窗", "artist": "新星图集",
                   "dedication": "相隔六个时区，共一轮很有耐心的月亮。"},
        },
    },
    {
        "id": "sp4-anniversary", "theme": "contactsheet", "photo": "reasons-coffee.jpg",
        "genre": "nostalgic pop", "mood": "bright", "decade": "2000s", "context": "anniversary",
        "lang": {
            "en": {"track": "Thirty-Six Frames", "artist": "The Weekenders",
                   "dedication": "A year of us, one frame at a time."},
            "fr": {"track": "Trente-six poses", "artist": "Les Flâneurs",
                   "dedication": "Une année de nous, une pose à la fois."},
            "ar": {"track": "ستّ وثلاثون لقطة", "artist": "فرقة نهاية الأسبوع",
                   "dedication": "عامٌ من قصّتنا، لقطةً تلو الأخرى."},
            "es": {"track": "Treinta y seis fotogramas", "artist": "Los Findes",
                   "dedication": "Un año de nosotros, un fotograma cada vez."},
            "ru": {"track": "Тридцать шесть кадров", "artist": "Уикендеры",
                   "dedication": "Год вместе, по одному кадру за раз."},
            "zh-CN": {"track": "三十六格", "artist": "周末人",
                   "dedication": "我们的一年，一格一格地数过来。"},
        },
    },
    {
        "id": "sp5-wedding", "theme": "label", "photo": "reasons-hands.jpg",
        "genre": "soul", "mood": "warm", "decade": "1970s", "context": "wedding",
        "lang": {
            "en": {"track": "Hold the Last Note", "artist": "Marvin & the Goldtones",
                   "dedication": "The song that played when you said I do."},
            "fr": {"track": "Tiens la dernière note", "artist": "Marvin & les Goldtones",
                   "dedication": "La chanson qui jouait quand tu as dit oui."},
            "ar": {"track": "امسك النغمة الأخيرة", "artist": "مارفن والنغمات الذهبية",
                   "dedication": "الأغنية التي عُزفت حين قلت نعم."},
            "es": {"track": "Sostén la última nota", "artist": "Marvin y los Goldtones",
                   "dedication": "La canción que sonaba cuando dijiste sí."},
            "ru": {"track": "Держи последнюю ноту", "artist": "Марвин и Голдтоунз",
                   "dedication": "Песня, что играла, когда ты сказала «да»."},
            "zh-CN": {"track": "留住最后一个音", "artist": "马文与金调乐队",
                   "dedication": "你说「我愿意」时，正放着这首歌。"},
        },
    },
    {
        "id": "sp6-milestone", "theme": "award", "photo": "grad-plans.jpg",
        "genre": "anthemic rock", "mood": "triumphant", "decade": "1980s", "context": "a shared milestone",
        "lang": {
            "en": {"track": "We Built This Anyway", "artist": "The Brave Ordinary",
                   "dedication": "For the year nobody thought we could, and we did."},
            "fr": {"track": "On l'a construit quand même", "artist": "Les Braves Ordinaires",
                   "dedication": "Pour l'année que personne ne croyait possible, et qu'on a vécue."},
            "ar": {"track": "بنيناه رغم كلّ شيء", "artist": "فرقة الشجعان العاديّين",
                   "dedication": "إلى العام الذي ظنّه الجميع مستحيلًا، وقد عشناه."},
            "es": {"track": "Lo construimos igual", "artist": "Los Valientes Comunes",
                   "dedication": "Por el año que nadie creyó posible, y lo logramos."},
            "ru": {"track": "Мы всё равно это построили", "artist": "Храбрые Обычные",
                   "dedication": "За год, в который никто не верил, а мы справились."},
            "zh-CN": {"track": "我们还是把它建起来了", "artist": "平凡的勇者",
                   "dedication": "敬那一年——没人看好，我们却做到了。"},
        },
    },
    {
        "id": "sp7-classic-love", "theme": "sleeve", "sleevePalette": "mustard", "photo": "song-turntable.jpg",
        "genre": "bossa jazz", "mood": "intimate", "decade": "1960s", "context": "a timeless love",
        "lang": {
            "en": {"track": "Coffee, Then the Rain", "artist": "Lúcia Amaro Trio",
                   "dedication": "Side A for the mornings, Side B for the storms."},
            "fr": {"track": "Le café, puis la pluie", "artist": "Lúcia Amaro Trio",
                   "dedication": "Face A pour les matins, face B pour les orages."},
            "ar": {"track": "قهوة، ثم المطر", "artist": "ثلاثي لوسيا أمارو",
                   "dedication": ""},
            "es": {"track": "Café, y luego la lluvia", "artist": "Trío Lúcia Amaro",
                   "dedication": "Cara A para las mañanas, cara B para las tormentas."},
            "ru": {"track": "Кофе, потом дождь", "artist": "Трио Лусии Амаро",
                   "dedication": "Сторона А для утра, сторона Б для гроз."},
            "zh-CN": {"track": "先是咖啡，然后下雨", "artist": "露西亚·阿马罗三重奏",
                   "dedication": ""},
        },
    },
    {
        "id": "sp8-new-love", "theme": "mosaic", "photo": "reasons-drive.jpg",
        "genre": "electronic pop", "mood": "joyful", "decade": "2020s", "context": "new love",
        "lang": {
            "en": {"track": "All Summer in a Day", "artist": "Marlo Quartz",
                   "dedication": "Three months in and already our whole soundtrack."},
            "fr": {"track": "Tout l'été en un jour", "artist": "Marlo Quartz",
                   "dedication": "Trois mois, et déjà toute notre bande-son."},
            "ar": {"track": "الصيف كلّه في يوم", "artist": "مارلو كوارتز",
                   "dedication": "ثلاثة أشهر فقط، وصارت كلّ موسيقانا."},
            "es": {"track": "Todo el verano en un día", "artist": "Marlo Quartz",
                   "dedication": "Tres meses y ya es toda nuestra banda sonora."},
            "ru": {"track": "Всё лето за один день", "artist": "Марло Кварц",
                   "dedication": "Три месяца — и уже весь наш саундтрек."},
            "zh-CN": {"track": "一天里过完整个夏天", "artist": "马洛石英",
                   "dedication": "才三个月，就成了我们全部的配乐。"},
        },
    },
]
