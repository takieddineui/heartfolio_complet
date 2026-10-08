# Compiling the shared AR target

One-time, on a developer machine. The output is committed; the server never
runs this.

## Why it is not part of the build

`mind-ar`'s compiler is JavaScript and pulls in `canvas` (native, needs
Cairo and Pango) and TensorFlow.js. Putting that in the Django image would
add roughly half a gigabyte and a second runtime for a job that produces the
same file every time.

Per-order cards are a different case and are compiled in the buyer's browser
at checkout — see `ar-target-compiler.tsx`.

## Steps

**1. Render the card artwork.**

```bash
cd backend/backend
python manage.py shell -c "
from apps.delivery.generic_card import render_generic_card
open('/tmp/shared-card.png','wb').write(render_generic_card())
"
```

**2. Compile it.**

```bash
cd tools/compile-shared-target
npm install          # needs libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev
node compile.mjs /tmp/shared-card.png
```

**3. Commit the result.**

```bash
mv heartfolio-card.mind ../../frontend/heartfolio/public/ar/targets/
```

That path is what `SHARED_TARGET_URL` in `ar-scene.tsx` expects. Until the
file exists, a shared-target card loads the scene and never finds anything
to track.

## When to re-run it

Whenever `generic_card.py` changes. The compiled target must match the
artwork that is actually printed — a card compiled from an older design
will not track the new one.
