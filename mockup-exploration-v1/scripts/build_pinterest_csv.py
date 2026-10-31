# -*- coding: utf-8 -*-
"""Pinterest bulk-upload CSVs for the minimalist mockup library.

One CSV per language (42 pins each: 14 designs x 3 variants), written to
heartfolio-mockup-library/pinterest/pinterest-bulk-<lang>.csv.

Columns (the order Pinterest's bulk-create template uses, as reported by users;
compare with the template Pinterest offers in the upload dialog before the
first real upload): Title, Media URL, Pinterest board, Description, Link,
Publish date, Keywords.

Copy follows the social pack's honesty rules (social/README.md): instant
private link + QR card, print-ready file included, nothing shipped or printed,
the soundwave is designed per order, and every mockup is labelled illustrative.
No prices. The site has pages in en/fr/ar only, so es/ru/zh-CN pins link to the
English product page.

  python build_pinterest_csv.py [--image-base-url URL] [--start-date YYYY-MM-DD]
                                [--per-day N] [--no-dates]
"""
from __future__ import annotations
import argparse, csv, json
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[2]
LIB = REPO / "heartfolio-mockup-library"
OUT = LIB / "pinterest"

SITE = "https://www.theheartfolio.com"
SITE_LOCALES = {"en", "fr", "ar"}
RAW_BASE = ("https://raw.githubusercontent.com/takieddineui/heartfolio_complet/"
            "claude/heartfolio-social-content-qukyfl/heartfolio-mockup-library")
SLUG = {"love-story-timeline": "love-story-timeline", "song-poster": "song-poster"}
LANGS = ["en", "fr", "ar", "es", "ru", "zh-CN"]
VARIANTS = ["studio-white", "gallery-white", "concrete-oak"]
LST = ["neat-stack", "overlapping-cascade", "alternating-tilt",
       "dotted-branching", "horizontal-polaroid", "horizontal-circles"]
SONG = ["player", "ledger", "ephemeris", "contactsheet", "label", "award", "sleeve", "mosaic"]
# Style names are the Studio's own labels and stay in English in every language.
STYLE = {"neat-stack": "Neat Stack", "overlapping-cascade": "Overlapping Cascade",
         "alternating-tilt": "Alternating Tilt", "dotted-branching": "Dotted Branching",
         "horizontal-polaroid": "Horizontal Polaroids", "horizontal-circles": "Horizontal Circles",
         "player": "Player", "ledger": "Ledger", "ephemeris": "Ephemeris",
         "contactsheet": "Contact Sheet", "label": "Label", "award": "Award",
         "sleeve": "Sleeve", "mosaic": "Mosaic"}
PRODUCT_OF = {**{d: "love-story-timeline" for d in LST}, **{d: "song-poster" for d in SONG}}
SLOTS = ["09:00:00", "13:00:00", "19:00:00"]
MAX_TITLE, MAX_DESC = 100, 500          # conservative: below Pinterest's own limits

def hooks(*texts):
    return dict(zip(LST + SONG, texts))

COPY = {
 "en": dict(
  prod={"love-story-timeline": "Love Story Timeline", "song-poster": "Song Poster"},
  kind={"love-story-timeline": "personalized love story timeline poster, printable",
        "song-poster": "custom song poster with soundwave art, printable"},
  sep=": ",
  hook=hooks("New love gift", "First anniversary gift", "10-year anniversary gift",
             "Engagement and wedding gift", "Long-distance relationship gift", "Parents' love story gift",
             "First dance song gift", "Long marriage gift", "Long-distance love song gift",
             "Anniversary song gift", "Wedding song gift", "Milestone song gift",
             "Classic love song gift", "New love song gift"),
  desc={"love-story-timeline": "Your most meaningful dated moments on one line, each with its own photo and caption. "
        "The {style} layout of Heartfolio's Love Story Timeline: pay once, get a private link and a QR card instantly, "
        "plus a print-ready file to frame at home. {scene} Nothing is shipped or printed for you.",
        "song-poster": "The song that means something, set as soundwave artwork with the title, the artist and your moment. "
        "The {style} theme of Heartfolio's Song Poster: a soundwave designed for your order, a private link and a QR card "
        "instantly, plus a print-ready file to frame at home. {scene} Nothing is shipped or printed for you."},
  scene={"studio-white": "Illustrative mockup: black frame on a soft white wall.",
         "gallery-white": "Illustrative mockup: slim black frame on a bright gallery wall.",
         "concrete-oak": "Illustrative mockup: oak frame on a light concrete wall."},
  look={"gallery-white": "gallery wall", "concrete-oak": "oak frame"},
  board={"love-story-timeline": "Love story timeline posters (printable)", "song-poster": "Song posters (printable)"},
  kw={"love-story-timeline": "couple gift, anniversary gift, timeline poster, personalized poster, valentines gift, wall decor, printable gift, love story, unique gift",
      "song-poster": "music gift, song poster, soundwave art, wedding gift, first dance, personalized gift, wall decor, printable gift, couple gift"}),
 "fr": dict(
  prod={"love-story-timeline": "Frise d'histoire d'amour", "song-poster": "Affiche musicale"},
  kind={"love-story-timeline": "frise d'histoire d'amour à imprimer",
        "song-poster": "affiche musicale personnalisée à imprimer"},
  sep=" : ",
  hook=hooks("Cadeau pour un nouvel amour", "Cadeau de premier anniversaire de couple", "Cadeau pour 10 ans d'amour",
             "Cadeau de fiançailles et de mariage", "Cadeau pour une relation à distance", "Cadeau pour l'histoire d'amour de vos parents",
             "Cadeau chanson de la première danse", "Cadeau pour de longues années de mariage", "Chanson d'amour à distance",
             "Cadeau chanson d'anniversaire de couple", "Cadeau chanson de mariage", "Cadeau chanson pour une étape marquante",
             "Cadeau chanson d'amour classique", "Cadeau chanson d'un nouvel amour"),
  desc={"love-story-timeline": "Vos moments les plus marquants sur une seule ligne, chacun avec sa photo et sa légende. "
        "Modèle {style} de la Frise d'histoire d'amour Heartfolio : paiement unique, lien privé et carte QR reçus tout de suite, "
        "et un fichier prêt à imprimer à encadrer chez vous. {scene} Rien n'est expédié ni imprimé pour vous.",
        "song-poster": "La chanson qui compte, mise en scène en onde sonore avec le titre, l'artiste et votre moment. "
        "Thème {style} de l'Affiche musicale Heartfolio : une onde sonore conçue pour votre commande, un lien privé et une carte QR "
        "reçus tout de suite, et un fichier prêt à imprimer à encadrer chez vous. {scene} Rien n'est expédié ni imprimé pour vous."},
  scene={"studio-white": "Maquette illustrative : cadre noir sur un mur blanc doux.",
         "gallery-white": "Maquette illustrative : cadre noir fin sur un mur de galerie lumineux.",
         "concrete-oak": "Maquette illustrative : cadre en chêne sur un mur de béton clair."},
  look={"gallery-white": "mur galerie", "concrete-oak": "cadre chêne"},
  board={"love-story-timeline": "Frises d'histoire d'amour à imprimer", "song-poster": "Affiches musicales à imprimer"},
  kw={"love-story-timeline": "cadeau couple, cadeau anniversaire de couple, frise chronologique, affiche personnalisée, cadeau Saint-Valentin, décoration murale, cadeau à imprimer, histoire d'amour, cadeau original",
      "song-poster": "cadeau musique, affiche chanson, affiche onde sonore, cadeau mariage, première danse, cadeau personnalisé, décoration murale, cadeau à imprimer, cadeau couple"}),
 "ar": dict(
  prod={"love-story-timeline": "الخط الزمني لقصة الحب", "song-poster": "ملصق الأغنية"},
  kind={"love-story-timeline": "ملصق خط زمني مخصص لقصة حبكما للطباعة",
        "song-poster": "ملصق أغنية مخصص بموجة صوتية للطباعة"},
  sep=": ",
  hook=hooks("هدية لحب جديد", "هدية أول ذكرى سنوية", "هدية عشر سنوات من الحب",
             "هدية خطوبة وزفاف", "هدية لعلاقة عن بُعد", "هدية لقصة حب الوالدين",
             "هدية أغنية الرقصة الأولى", "هدية لسنوات زواج طويلة", "أغنية حب عن بُعد",
             "هدية أغنية الذكرى السنوية", "هدية أغنية الزفاف", "هدية أغنية لمناسبة مميزة",
             "هدية أغنية حب كلاسيكية", "هدية أغنية لحب جديد"),
  desc={"love-story-timeline": "أهم لحظاتكما المؤرَّخة على خط واحد، لكل لحظة صورتها وتعليقها. "
        "تصميم {style} من الخط الزمني لقصة الحب في Heartfolio: دفع لمرة واحدة، ورابط خاص وبطاقة QR فورًا، "
        "وملف جاهز للطباعة لتؤطّره في بيتك. {scene} لا يُشحن ولا يُطبع شيء نيابةً عنك.",
        "song-poster": "الأغنية التي تعني لك الكثير، بتصميم موجة صوتية مع العنوان والفنان ولحظتك. "
        "سمة {style} من ملصق الأغنية في Heartfolio: موجة صوتية مصمَّمة لطلبك، ورابط خاص وبطاقة QR فورًا، "
        "وملف جاهز للطباعة لتؤطّره في بيتك. {scene} لا يُشحن ولا يُطبع شيء نيابةً عنك."},
  scene={"studio-white": "نموذج توضيحي: إطار أسود على جدار أبيض ناعم.",
         "gallery-white": "نموذج توضيحي: إطار أسود رفيع على جدار معرض مضيء.",
         "concrete-oak": "نموذج توضيحي: إطار من خشب البلوط على جدار إسمنتي فاتح."},
  look={"gallery-white": "جدار معرض", "concrete-oak": "إطار بلوط"},
  board={"love-story-timeline": "الخط الزمني لقصة الحب للطباعة", "song-poster": "ملصقات الأغاني للطباعة"},
  kw={"love-story-timeline": "هدية للأزواج, هدية ذكرى سنوية, خط زمني, ملصق مخصص, هدية عيد الحب, ديكور جداري, هدية للطباعة, قصة حب, هدية مميزة",
      "song-poster": "هدية موسيقية, ملصق أغنية, موجة صوتية, هدية زفاف, الرقصة الأولى, هدية مخصصة, ديكور جداري, هدية للطباعة, هدية للأزواج"}),
 "es": dict(
  prod={"love-story-timeline": "Línea de tiempo de tu historia de amor", "song-poster": "Póster de canción"},
  kind={"love-story-timeline": "póster de amor para imprimir",
        "song-poster": "póster de canción para imprimir"},
  sep=": ",
  hook=hooks("Regalo para un amor nuevo", "Regalo de primer aniversario", "Regalo para 10 años juntos",
             "Regalo de compromiso y boda", "Regalo para una relación a distancia", "Regalo para la historia de amor de tus padres",
             "Regalo con la canción del primer baile", "Regalo para un matrimonio de muchos años", "Canción de amor a distancia",
             "Regalo con la canción del aniversario", "Regalo con la canción de la boda", "Regalo con la canción de un momento importante",
             "Regalo con una canción de amor clásica", "Regalo con la canción de un amor nuevo"),
  desc={"love-story-timeline": "Tus momentos más importantes en una sola línea, cada uno con su foto y su texto. "
        "Diseño {style} de la Línea de tiempo de Heartfolio: pago único, enlace privado y tarjeta QR al instante, "
        "y un archivo listo para imprimir que enmarcas en casa. {scene} No se envía ni se imprime nada por ti.",
        "song-poster": "La canción que significa algo, convertida en arte de onda de sonido con el título, el artista y tu momento. "
        "Tema {style} del Póster de canción de Heartfolio: una onda de sonido diseñada para tu pedido, enlace privado y tarjeta QR "
        "al instante, y un archivo listo para imprimir que enmarcas en casa. {scene} No se envía ni se imprime nada por ti."},
  scene={"studio-white": "Maqueta ilustrativa: marco negro sobre una pared blanca suave.",
         "gallery-white": "Maqueta ilustrativa: marco negro fino sobre una pared de galería luminosa.",
         "concrete-oak": "Maqueta ilustrativa: marco de roble sobre una pared de hormigón claro."},
  look={"gallery-white": "pared galería", "concrete-oak": "marco roble"},
  board={"love-story-timeline": "Historias de amor: pósters para imprimir", "song-poster": "Pósters de canciones para imprimir"},
  kw={"love-story-timeline": "regalo para parejas, regalo de aniversario, línea de tiempo, póster personalizado, regalo San Valentín, decoración de pared, regalo para imprimir, historia de amor, regalo original",
      "song-poster": "regalo musical, póster de canción, onda de sonido, regalo de boda, primer baile, regalo personalizado, decoración de pared, regalo para imprimir, regalo para parejas"}),
 "ru": dict(
  prod={"love-story-timeline": "Лента времени вашей истории любви", "song-poster": "Постер песни"},
  kind={"love-story-timeline": "постер с историей любви для печати",
        "song-poster": "постер песни со звуковой волной для печати"},
  sep=": ",
  hook=hooks("Подарок на новую любовь", "Подарок на первую годовщину", "Подарок на 10 лет вместе",
             "Подарок на помолвку и свадьбу", "Подарок для отношений на расстоянии", "Подарок к истории любви родителей",
             "Подарок с песней первого танца", "Подарок на долгие годы брака", "Песня о любви на расстоянии",
             "Подарок с песней годовщины", "Подарок с песней свадьбы", "Подарок с песней важного момента",
             "Подарок с классической песней о любви", "Подарок с песней новой любви"),
  desc={"love-story-timeline": "Самые важные моменты на одной линии, у каждого своё фото и подпись. "
        "Макет {style} из «Ленты времени» Heartfolio: оплата один раз, личная ссылка и QR-карточка сразу, "
        "а также файл, готовый к печати, чтобы вставить в раму дома. {scene} Ничего не отправляется и не печатается за вас.",
        "song-poster": "Песня, которая что-то значит, в виде звуковой волны с названием, исполнителем и вашим моментом. "
        "Тема {style} из «Постера песни» Heartfolio: звуковая волна создаётся для вашего заказа, личная ссылка и QR-карточка сразу, "
        "а также файл, готовый к печати, чтобы вставить в раму дома. {scene} Ничего не отправляется и не печатается за вас."},
  scene={"studio-white": "Иллюстративный макет: чёрная рама на мягкой белой стене.",
         "gallery-white": "Иллюстративный макет: тонкая чёрная рама на светлой галерейной стене.",
         "concrete-oak": "Иллюстративный макет: дубовая рама на светлой бетонной стене."},
  look={"gallery-white": "светлая стена", "concrete-oak": "дубовая рама"},
  board={"love-story-timeline": "Постеры с историей любви для печати", "song-poster": "Постеры песен для печати"},
  kw={"love-story-timeline": "подарок для пары, подарок на годовщину, лента времени, персональный постер, подарок на 14 февраля, декор стен, подарок для печати, история любви, оригинальный подарок",
      "song-poster": "музыкальный подарок, постер песни, звуковая волна, свадебный подарок, первый танец, персональный подарок, декор стен, подарок для печати, подарок для пары"}),
 "zh-CN": dict(
  prod={"love-story-timeline": "爱情故事时间线", "song-poster": "歌曲海报"},
  kind={"love-story-timeline": "定制爱情故事时间线海报（可打印）",
        "song-poster": "定制歌曲声波海报（可打印）"},
  sep="：",
  hook=hooks("新恋情礼物", "第一个纪念日礼物", "十周年纪念礼物",
             "订婚与婚礼礼物", "异地恋礼物", "父母的爱情故事礼物",
             "第一支舞歌曲礼物", "长久婚姻礼物", "异地恋情歌礼物",
             "纪念日歌曲礼物", "婚礼歌曲礼物", "重要时刻歌曲礼物",
             "经典情歌礼物", "新恋情歌曲礼物"),
  desc={"love-story-timeline": "把最重要的日子放在同一条时间线上，每个时刻都配有照片和文字。"
        "Heartfolio 爱情故事时间线的 {style} 版式：一次付费，立即获得专属私密链接和二维码卡片，另含可打印文件，在家装裱即可。"
        "{scene}不会为你寄送或代印任何实物。",
        "song-poster": "把对你有意义的那首歌做成声波艺术，配上歌名、歌手和属于你们的时刻。"
        "Heartfolio 歌曲海报的 {style} 主题：声波为你的订单专门设计，立即获得专属私密链接和二维码卡片，另含可打印文件，在家装裱即可。"
        "{scene}不会为你寄送或代印任何实物。"},
  scene={"studio-white": "示意样机：柔和白墙上的黑色画框。",
         "gallery-white": "示意样机：明亮画廊墙面上的细黑画框。",
         "concrete-oak": "示意样机：浅色水泥墙上的橡木画框。"},
  look={"gallery-white": "画廊墙", "concrete-oak": "橡木画框"},
  board={"love-story-timeline": "爱情故事时间线（可打印）", "song-poster": "歌曲海报（可打印）"},
  kw={"love-story-timeline": "情侣礼物, 纪念日礼物, 时间线, 定制海报, 情人节礼物, 墙面装饰, 可打印礼物, 爱情故事, 创意礼物",
      "song-poster": "音乐礼物, 歌曲海报, 声波海报, 婚礼礼物, 第一支舞, 定制礼物, 墙面装饰, 可打印礼物, 情侣礼物"}),
}

COLUMNS = ["Title", "Media URL", "Pinterest board", "Description", "Link", "Publish date", "Keywords"]

def order():
    """Variant by variant, alternating the two products, so neighbouring pins differ."""
    seq = []
    for v in VARIANTS:
        for a, b in zip(LST + [None, None], SONG):
            for d in (a, b):
                if d: seq.append((d, v))
    return seq

def link(lang, product, design, variant):
    loc = lang if lang in SITE_LOCALES else "en"
    utm = f"utm_source=pinterest&utm_medium=social&utm_campaign=mockups-{lang}&utm_content={design}-{variant}"
    return f"{SITE}/{loc}/products/{SLUG[product]}?{utm}"

def build(lang, base, start, per_day):
    c = COPY[lang]
    rows, seq = [], order()
    for i, (design, variant) in enumerate(seq):
        product = PRODUCT_OF[design]
        rel = f"{product}/{lang}/{design}/{variant}.jpg"
        assert (LIB / rel).exists(), rel
        title = c["hook"][design] + c["sep"] + c["kind"][product]
        if variant != "studio-white":          # Pinterest rejects duplicate titles within a file
            title += f" ({c['look'][variant]})"
        desc = c["desc"][product].format(style=STYLE[design], scene=c["scene"][variant])
        pub = ""
        if start:
            slot = SLOTS[i % per_day] if per_day <= len(SLOTS) else SLOTS[i % len(SLOTS)]
            pub = f"{(start + timedelta(days=i // per_day)).isoformat()}T{slot}"
        rows.append({"Title": title, "Media URL": f"{base}/{quote(rel)}", "Pinterest board": c["board"][product],
                     "Description": desc, "Link": link(lang, product, design, variant),
                     "Publish date": pub, "Keywords": c["kw"][product], "_variant": variant})
    return rows

def validate(lang, rows):
    assert len(rows) == 42, (lang, len(rows))
    assert len({r["Media URL"] for r in rows}) == 42
    assert len({r["Title"] for r in rows}) == 42, (lang, "duplicate titles")
    for r in rows:
        assert 0 < len(r["Title"]) <= MAX_TITLE, (lang, len(r["Title"]), r["Title"])
        assert 0 < len(r["Description"]) <= MAX_DESC, (lang, len(r["Description"]))
        assert "{" not in r["Description"] and "{" not in r["Title"]
        if lang == "fr": assert "·" not in r["Title"] + r["Description"]   # no point médian

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image-base-url", default=RAW_BASE, help="public URL that serves heartfolio-mockup-library/")
    ap.add_argument("--start-date", default=(date.today() + timedelta(days=1)).isoformat())
    ap.add_argument("--per-day", type=int, default=3, choices=[1, 2, 3])
    ap.add_argument("--exclude-variant", action="append", default=[], choices=VARIANTS,
                    help="leave these variants out and name the file -remaining (rows keep their dates)")
    ap.add_argument("--lang", action="append", choices=LANGS, help="only these languages (default: all)")
    ap.add_argument("--no-dates", action="store_true", help="leave Publish date empty")
    a = ap.parse_args()
    base = a.image_base_url.rstrip("/")
    start = None if a.no_dates else date.fromisoformat(a.start_date)
    OUT.mkdir(parents=True, exist_ok=True)
    summary = []
    for lang in (a.lang or LANGS):
        rows = build(lang, base, start, a.per_day)
        validate(lang, rows)
        rows = [r for r in rows if r["_variant"] not in a.exclude_variant]
        path = OUT / f"pinterest-bulk-{lang}{'-remaining' if a.exclude_variant else ''}.csv"
        with open(path, "w", newline="", encoding="utf-8") as fh:        # plain UTF-8, no BOM
            w = csv.DictWriter(fh, fieldnames=COLUMNS, quoting=csv.QUOTE_MINIMAL, extrasaction="ignore")
            w.writeheader(); w.writerows(rows)
        last = rows[-1]["Publish date"] or "-"
        summary.append({"lang": lang, "file": path.name, "pins": len(rows), "boards": sorted({r["Pinterest board"] for r in rows}),
                        "first": rows[0]["Publish date"] or "-", "last": last})
        print(f"{path.name}: {len(rows)} pins · {rows[0]['Publish date'] or 'no dates'} → {last}")
    if not (a.exclude_variant or a.lang):
        json.dump(summary, open(OUT / "summary.json", "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
