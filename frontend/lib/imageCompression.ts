/** Resizes and re-encodes an arbitrary image file entirely in the browser
 * before it's ever uploaded (19 Aug 2026, Shailesh: "we never know what
 * image the user is gonna upload so we need to keep that in mind always").
 *
 * Before this, the profile-photo upload sent whatever file was picked
 * straight to the backend, which rejected anything over 350KB -- but did
 * no compression itself despite its own error message claiming it had. A
 * raw phone-camera photo is routinely 3-10MB and several thousand pixels
 * on a side, so in practice almost every real upload failed. This runs
 * unconditionally on every file, regardless of its original size or
 * dimensions, and produces a small JPEG that comfortably clears the
 * backend's limit without the person needing to resize anything themselves
 * first.
 *
 * Uses createImageBitmap + <canvas> rather than an <img> element -- it
 * decodes off the main thread, and `imageOrientation: "from-image"`
 * guarantees EXIF rotation (near-universal on phone photos) is respected
 * consistently across browsers, where an <img>'s default handling of that
 * has historically been inconsistent.
 */
export interface CompressImageOptions {
  /** Longest side, in pixels, after resizing. A profile photo is always
   *  displayed small (an avatar), so there's no reason to keep a
   *  multi-thousand-pixel original. */
  maxDimension?: number;
  /** Stop reducing quality/size once the output is at or under this. */
  targetBytes?: number;
}

// Tuned generously (19 Aug 2026, Shailesh: "we do not want users to upload
// images and then see them as weird blurry pics") -- deliberately well
// above what a 32-56px avatar actually needs today, so there's real
// headroom for a bigger display context later (e.g. a full account/profile
// page) without ever needing to revisit this. 1024px and 600KB still sit
// comfortably under the backend's 2MB safety-net limit with room to spare.
const DEFAULT_OPTIONS: Required<CompressImageOptions> = {
  maxDimension: 1024,
  targetBytes: 600_000,
};

export async function compressImageForUpload(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { maxDimension, targetBytes } = { ...DEFAULT_OPTIONS, ...options };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Covers genuinely unsupported formats (e.g. HEIC/HEIF straight off an
    // iPhone camera roll, which most non-Safari browsers can't decode via
    // canvas -- Safari itself usually auto-converts HEIC to JPEG at the
    // file picker before this code ever runs, so this mainly bites Chrome/
    // Firefox/Android users), corrupted files, or non-image files wearing
    // an image extension -- surfaced clearly here, before any network
    // call, instead of as a confusing size-limit error from the backend.
    throw new Error(
      "That file isn't a supported image. If it's a HEIC photo from an iPhone, try Settings > Camera > " +
        "Formats > Most Compatible, or upload a JPG, PNG, or WEBP instead.",
    );
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Your browser can't process images. Please try a different device or browser.");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Step quality down until it fits rather than assuming one quality
    // level works for every photo -- a busy/detailed image compresses far
    // less than a plain portrait at the same JPEG quality setting. Floor
    // raised to 0.6 (was 0.4) and the step made finer -- below ~0.6, JPEG
    // artifacting starts to actually look "weird and blurry" the way
    // Shailesh flagged, so this prefers shrinking dimensions (below) over
    // ever crossing that floor.
    let quality = 0.92;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > targetBytes && quality > 0.6) {
      quality -= 0.06;
      blob = await canvasToBlob(canvas, quality);
    }

    // Still too big even at the quality floor (an unusually large or
    // detailed source image) -- shrink the target dimensions further and
    // recurse, instead of dropping quality any further. Floor of 480px
    // keeps real headroom above every avatar size this product actually
    // renders today (32-56px) even after a couple of recursive shrinks.
    if (blob.size > targetBytes && maxDimension > 480) {
      return compressImageForUpload(file, { maxDimension: Math.round(maxDimension * 0.8), targetBytes });
    }

    return new File([blob], "profile.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image. Please try a different file."))),
      "image/jpeg",
      quality,
    );
  });
}
