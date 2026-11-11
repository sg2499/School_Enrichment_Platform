/**
 * A question's drawn picture (#218, 11 Nov 2026): a mirror line on a grid,
 * block letters, a shape or a map key. The SVG is drawn on the server from
 * numbers and a few escaped labels only (backend app/services/figures.py),
 * never from anything a person typed as markup, so it is shown as given.
 * Drawn on a white card so it reads the same in light and dark themes.
 */
export function QuestionFigure({ svg, className = "" }: { svg?: string | null; className?: string }) {
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label="Figure for this question"
      className={`my-3 inline-block max-w-full overflow-x-auto rounded-lg border border-line bg-white p-2 ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
