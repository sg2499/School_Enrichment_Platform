import { cn } from "@/lib/utils";

/**
 * Every graphic in the product is hand-built inline SVG or CSS -- no stock
 * imagery, no icon CDN, nothing that needs asset hosting. They share one
 * vocabulary: orbit rings (a learning path that keeps coming back around),
 * squared-paper grids, milestone dots, and a saffron spark for the moment
 * something is achieved.
 */

interface BackdropProps {
  className?: string;
  /**
   * Opt the blobs into cursor-follow depth. The parent must be the element
   * that writes `--pointer-x` / `--pointer-y` (see `.parallax-layer` in
   * globals.css). Off by default so dashboards stay perfectly static.
   */
  parallax?: boolean;
  /**
   * Darkens the outer edges so a full-height panel reads as a contained
   * composition instead of colour trailing off into nothing. Off by default
   * -- it is too heavy for the small hero cards on the dashboards.
   */
  vignette?: boolean;
}

/**
 * Each blob is two nested elements on purpose: the outer one owns position
 * and the pointer-driven `transform`, the inner one owns the looping drift
 * `transform`. One element cannot hold both, and splitting them also lets
 * the two motions run at completely different rates.
 */
function blobLayer(parallax: boolean, depth: string) {
  return parallax ? cn("parallax-layer", depth) : undefined;
}

/** Soft colour wash for page backgrounds. Purely decorative. */
export function AuroraBackdrop({ className, parallax = false }: BackdropProps) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className={cn("absolute -left-32 -top-40 h-[26rem] w-[26rem]", blobLayer(parallax, "parallax-2"))}>
        <div className="h-full w-full rounded-full bg-brand-300/35 blur-3xl animate-drift-wide" />
      </div>
      <div className={cn("absolute -right-24 top-10 h-80 w-80", blobLayer(parallax, "parallax-3"))}>
        <div className="h-full w-full rounded-full bg-saffron-200/55 blur-3xl animate-drift-alt [animation-delay:-11s]" />
      </div>
      <div className={cn("absolute bottom-[-12rem] left-1/3 h-96 w-96", blobLayer(parallax, "parallax-1"))}>
        <div className="h-full w-full rounded-full bg-jade-200/45 blur-3xl animate-drift [animation-duration:53s]" />
      </div>
      <div className="absolute inset-0 bg-grid opacity-40 mask-fade-b" />
    </div>
  );
}

/** Dark-side version, for the login brand panel and inverse cards. */
export function AuroraBackdropInverse({ className, parallax = false, vignette = false }: BackdropProps) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className={cn("absolute -left-28 top-[-8rem] h-[34rem] w-[34rem]", blobLayer(parallax, "parallax-2"))}>
        <div className="h-full w-full rounded-full bg-brand-500/50 blur-[120px] animate-drift-wide" />
      </div>
      <div className={cn("absolute right-[-9rem] top-[28%] h-[26rem] w-[26rem]", blobLayer(parallax, "parallax-4"))}>
        <div className="h-full w-full rounded-full bg-saffron-500/[0.28] blur-[120px] animate-drift-alt [animation-delay:-13s]" />
      </div>
      <div className={cn("absolute bottom-[-11rem] left-[18%] h-[22rem] w-[22rem]", blobLayer(parallax, "parallax-3"))}>
        <div className="h-full w-full rounded-full bg-jade-500/[0.24] blur-[110px] animate-drift [animation-duration:53s]" />
      </div>
      {/* A fourth, slower wash that only breathes in opacity -- it is what
          stops the composite from ever settling into an obvious cycle. */}
      <div className={cn("absolute left-[38%] top-[-4rem] h-[28rem] w-[28rem]", blobLayer(parallax, "parallax-1"))}>
        <div className="h-full w-full rounded-full bg-brand-400/[0.22] blur-[130px] animate-aurora-breathe" />
      </div>
      <div className="absolute inset-0 bg-grid-inverse opacity-70" />
      {vignette ? (
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_45%,transparent_32%,rgba(15,12,40,0.5)_100%)]" />
      ) : null}
    </div>
  );
}

/**
 * Login hero illustration: a chapter orbiting a core of practice, with the
 * five-day learning loop drawn as milestone dots and a saffron spark on the
 * day that has been mastered.
 */
export function LearningOrbit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 460 460" role="presentation" className={cn("h-full w-full", className)}>
      <defs>
        <linearGradient id="orbit-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
        </linearGradient>
        <linearGradient id="orbit-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDDC92" />
          <stop offset="100%" stopColor="#F08D0C" />
        </linearGradient>
        <linearGradient id="orbit-jade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#68D5A8" />
          <stop offset="100%" stopColor="#0A7D5C" />
        </linearGradient>
        <radialGradient id="orbit-core" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#8579D2" />
          <stop offset="100%" stopColor="#26215C" />
        </radialGradient>
      </defs>

      {/* Orbit rings */}
      <g className="animate-spin-slow" style={{ transformOrigin: "230px 230px" }}>
        <circle cx="230" cy="230" r="196" fill="none" stroke="rgba(255,255,255,0.16)" strokeDasharray="2 10" strokeLinecap="round" />
        <circle cx="230" cy="230" r="152" fill="none" stroke="rgba(255,255,255,0.22)" strokeDasharray="14 12" strokeLinecap="round" />
      </g>
      <circle cx="230" cy="230" r="112" fill="none" stroke="rgba(255,255,255,0.14)" />

      {/* Core -- an open chapter */}
      <g className="animate-float">
        <rect x="150" y="158" width="160" height="144" rx="22" fill="url(#orbit-core)" stroke="rgba(255,255,255,0.28)" />
        <path d="M230 176v112" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <g fill="rgba(255,255,255,0.85)">
          <rect x="166" y="192" width="50" height="7" rx="3.5" />
          <rect x="166" y="210" width="38" height="7" rx="3.5" opacity="0.7" />
          <rect x="166" y="228" width="44" height="7" rx="3.5" opacity="0.5" />
          <rect x="244" y="192" width="50" height="7" rx="3.5" />
          <rect x="244" y="210" width="42" height="7" rx="3.5" opacity="0.7" />
          <rect x="244" y="228" width="30" height="7" rx="3.5" opacity="0.5" />
        </g>
        {/* Mastery tick */}
        <circle cx="230" cy="268" r="16" fill="url(#orbit-jade)" />
        <path d="M223 268l5 5 9-10" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Five-day loop path */}
      <path
        d="M74 300c46 40 106 54 156 34s84-70 156-46"
        fill="none"
        stroke="rgba(249,171,43,0.55)"
        strokeWidth="2"
        strokeDasharray="620"
        className="animate-dash-draw [animation-delay:600ms]"
        strokeLinecap="round"
      />
      {[
        { cx: 74, cy: 300, done: true },
        { cx: 140, cy: 335, done: true },
        { cx: 214, cy: 341, done: true },
        { cx: 286, cy: 312, done: false },
        { cx: 386, cy: 288, done: false },
      ].map((dot) => (
        <circle
          key={`${dot.cx}-${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={dot.done ? 7 : 5.5}
          fill={dot.done ? "url(#orbit-spark)" : "rgba(255,255,255,0.28)"}
          stroke={dot.done ? "rgba(253,220,146,0.35)" : "rgba(255,255,255,0.4)"}
          strokeWidth={dot.done ? 6 : 1.5}
        />
      ))}

      {/* Floating subject tiles */}
      <g className="animate-float [animation-delay:-2.5s]">
        <rect x="42" y="118" width="96" height="62" rx="18" fill="url(#orbit-card)" stroke="rgba(255,255,255,0.24)" />
        <text x="66" y="150" fontSize="22" fontWeight="700" fill="#FDDC92" fontFamily="ui-sans-serif, system-ui">
          x&#178;
        </text>
        <rect x="66" y="160" width="48" height="5" rx="2.5" fill="rgba(255,255,255,0.4)" />
      </g>
      <g className="animate-float [animation-delay:-4.5s]">
        <rect x="316" y="96" width="102" height="62" rx="18" fill="url(#orbit-card)" stroke="rgba(255,255,255,0.24)" />
        <circle cx="348" cy="127" r="11" fill="none" stroke="#A1E9C7" strokeWidth="2.5" />
        <circle cx="348" cy="127" r="3" fill="#A1E9C7" />
        <rect x="368" y="118" width="36" height="5" rx="2.5" fill="rgba(255,255,255,0.5)" />
        <rect x="368" y="131" width="26" height="5" rx="2.5" fill="rgba(255,255,255,0.3)" />
      </g>
      <g className="animate-float [animation-delay:-6s]">
        <rect x="308" y="352" width="112" height="56" rx="18" fill="url(#orbit-card)" stroke="rgba(255,255,255,0.24)" />
        <rect x="326" y="372" width="8" height="16" rx="4" fill="#F9AB2B" />
        <rect x="342" y="366" width="8" height="22" rx="4" fill="#FDDC92" />
        <rect x="358" y="378" width="8" height="10" rx="4" fill="rgba(255,255,255,0.45)" />
        <rect x="374" y="360" width="8" height="28" rx="4" fill="#68D5A8" />
      </g>

      {/* Spark */}
      <g className="animate-float [animation-delay:-1.2s]">
        <path
          d="M112 62l6 16 16 6-16 6-6 16-6-16-16-6 16-6z"
          fill="url(#orbit-spark)"
          opacity="0.9"
        />
      </g>
    </svg>
  );
}

/** Student empty state -- a path with milestones still to unlock. */
export function PathIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 180" role="presentation" className={cn("h-40 w-auto", className)}>
      <defs>
        <linearGradient id="path-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDDC92" />
          <stop offset="100%" stopColor="#F08D0C" />
        </linearGradient>
      </defs>
      <rect x="8" y="20" width="244" height="142" rx="24" fill="#F3F2FC" />
      <path
        d="M36 132c34 6 46-38 78-38s44 44 82 30"
        fill="none"
        stroke="#CFCBF0"
        strokeWidth="3"
        strokeDasharray="9 10"
        strokeLinecap="round"
      />
      <circle cx="36" cy="132" r="11" fill="url(#path-spark)" />
      <path d="M31 132l4 4 7-8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="114" cy="95" r="9" fill="#FFFFFF" stroke="#CAC8D8" strokeWidth="2" />
      <circle cx="176" cy="118" r="9" fill="#FFFFFF" stroke="#CAC8D8" strokeWidth="2" />
      <g>
        <rect x="196" y="46" width="42" height="52" rx="12" fill="#FFFFFF" stroke="#E2E1EB" />
        <rect x="206" y="60" width="22" height="4" rx="2" fill="#CFCBF0" />
        <rect x="206" y="70" width="16" height="4" rx="2" fill="#E2E1EB" />
        <rect x="206" y="80" width="20" height="4" rx="2" fill="#E2E1EB" />
      </g>
      <g className="animate-float">
        <circle cx="70" cy="56" r="16" fill="#FFFFFF" stroke="#E2E1EB" />
        <path d="M63 56h14M70 49v14" stroke="#37BB8C" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Teacher empty state -- a roster grid waiting to be filled. */
export function RosterIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 180" role="presentation" className={cn("h-40 w-auto", className)}>
      <rect x="8" y="20" width="244" height="142" rx="24" fill="#F3F2FC" />
      <rect x="28" y="38" width="204" height="30" rx="12" fill="#FFFFFF" stroke="#E2E1EB" />
      <rect x="42" y="49" width="66" height="8" rx="4" fill="#CFCBF0" />
      <rect x="186" y="49" width="32" height="8" rx="4" fill="#FDDC92" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <g key={`${row}-${col}`}>
            <rect
              x={28 + col * 70}
              y={80 + row * 26}
              width="60"
              height="18"
              rx="9"
              fill="#FFFFFF"
              stroke="#E8E4DB"
            />
            <circle cx={40 + col * 70} cy={89 + row * 26} r="5" fill={row === 0 && col === 0 ? "#37BB8C" : "#E2E1EB"} />
            <rect x={50 + col * 70} y={86 + row * 26} width={col === 1 ? 24 : 30} height="6" rx="3" fill="#EFEFF4" />
          </g>
        )),
      )}
      <g className="animate-float">
        <circle cx="222" cy="140" r="18" fill="#FFFFFF" stroke="#E2E1EB" />
        <path d="M214 140h16M222 132v16" stroke="#4E42A0" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Admin empty state -- curriculum structure as stacked blueprint layers. */
export function BlueprintIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 180" role="presentation" className={cn("h-40 w-auto", className)}>
      <rect x="8" y="20" width="244" height="142" rx="24" fill="#F3F2FC" />
      <g>
        <rect x="40" y="112" width="180" height="30" rx="12" fill="#FFFFFF" stroke="#E2E1EB" />
        <rect x="54" y="123" width="70" height="8" rx="4" fill="#E2E1EB" />
        <rect x="188" y="123" width="18" height="8" rx="4" fill="#CFCBF0" />
      </g>
      <g className="animate-float [animation-delay:-2s]">
        <rect x="56" y="74" width="148" height="30" rx="12" fill="#FFFFFF" stroke="#E2E1EB" />
        <rect x="70" y="85" width="56" height="8" rx="4" fill="#CFCBF0" />
        <rect x="172" y="85" width="18" height="8" rx="4" fill="#A1E9C7" />
      </g>
      <g className="animate-float [animation-delay:-4s]">
        <rect x="72" y="36" width="116" height="30" rx="12" fill="#26215C" />
        <rect x="86" y="47" width="52" height="8" rx="4" fill="rgba(255,255,255,0.85)" />
        <circle cx="168" cy="51" r="6" fill="#F9AB2B" />
      </g>
      <path d="M130 66v8M130 104v8" stroke="#CFCBF0" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
    </svg>
  );
}
