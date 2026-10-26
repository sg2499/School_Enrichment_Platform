"use client";

/**
 * The school's logo (#202) on a white tile, so any logo (dark, coloured or
 * transparent) reads on any background. Renders nothing until it has
 * loaded, or if the school has none.
 */
import { useEffect, useState } from "react";
import { getStoredUser } from "@/lib/auth";
import { useAuthedImage } from "@/lib/hooks/useAuthedImage";
import { SCHOOL_LOGO_EVENT } from "@/lib/schoolLogo";
import { cn } from "@/lib/utils";

/** The signed-in person's school logo address, following new uploads. */
export function useSchoolLogoUrl(initial?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(initial ?? null);
  useEffect(() => {
    if (initial === undefined) setUrl(getStoredUser()?.schoolLogoUrl ?? null);
    else setUrl(initial);
  }, [initial]);
  useEffect(() => {
    const onChange = (event: Event) =>
      setUrl((event as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(SCHOOL_LOGO_EVENT, onChange);
    return () => window.removeEventListener(SCHOOL_LOGO_EVENT, onChange);
  }, []);
  return url;
}

export function SchoolLogo({
  url,
  schoolName,
  className,
  tileClassName,
  decorative = false,
}: {
  url: string | null | undefined;
  schoolName?: string | null;
  /** The school's name is printed right beside it: the image says nothing more. */
  decorative?: boolean;
  /** Sizes the image (a height, with the width following the logo's shape). */
  className?: string;
  tileClassName?: string;
}) {
  const src = useAuthedImage(url);
  if (!src) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-white p-1.5 shadow-xs ring-1 ring-inset ring-black/5",
        tileClassName,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL of an image only signed-in people may load. */}
      <img
        src={src}
        alt={
          decorative ? "" : schoolName ? `${schoolName} logo` : "School logo"
        }
        data-school-logo=""
        className={cn("h-8 w-auto max-w-[9rem] object-contain", className)}
      />
    </span>
  );
}
