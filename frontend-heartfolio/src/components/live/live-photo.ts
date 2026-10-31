/**
 * A customer's photo on a live page (31 Oct 2026). The payload carries it as
 * `photo_payload` builds it (`apps/assets/services.py`): `url` (the 960 px
 * WebP copy, or the full photo when it has no copies), `srcset` of every web
 * copy (480, 960 and 1600 px wide) and the photo's `width` and `height`.
 * With `sizes` the browser downloads the smallest copy that is sharp on its
 * screen: about 90 KB on a phone where the full photo was 3-4 MB.
 *
 * Every field but `url` is optional: a photo stored before the copies
 * existed, and the Studio's own preview (a local file), have only `url`.
 */
export interface LivePhoto {
  url?: string;
  srcset?: string;
  width?: number;
  height?: number;
}

/** `<img>` source attributes for `photo` shown at `sizes`. */
export function livePhotoSources(photo: LivePhoto, sizes: string): { src?: string; srcSet?: string; sizes?: string } {
  return photo.srcset ? { src: photo.url, srcSet: photo.srcset, sizes } : { src: photo.url };
}

/** `width`/`height` attributes, so the page reserves the photo's box before
 * it loads. Only for an image whose CSS lets its height follow its width
 * (`height: auto`); a fixed box (a disc, a card) keeps its own. */
export function livePhotoSize(photo: LivePhoto): { width?: number; height?: number } {
  return photo.width && photo.height ? { width: photo.width, height: photo.height } : {};
}
