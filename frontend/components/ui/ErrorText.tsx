import { Fragment } from "react";

// The server's reference format (backend/app/core/error_handling.py).
const REFERENCE = /(SE-[0-9A-Z]{4}-[0-9A-Z]{4})/;

/**
 * A message with any SE-XXXX-XXXX reference in it kept on one line and set
 * a little heavier (3 Oct 2026). A reference is something a person reads
 * out or copies; broken across two lines at its hyphen -- which is where a
 * narrow card breaks it -- it reads as two things. The characters are left
 * exactly as they are, so what is copied is what the server logged.
 *
 * Anything that is not a plain string is returned untouched.
 */
export function ErrorText({ children }: { children: React.ReactNode }) {
  if (typeof children !== "string" || !REFERENCE.test(children)) return <>{children}</>;
  return (
    <>
      {children.split(REFERENCE).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="whitespace-nowrap font-semibold">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
