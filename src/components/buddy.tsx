/**
 * Petit bonhomme (SVG) : une forme colorée avec un visage qui exprime une humeur.
 * Le visage est toujours dessiné à l'encre, la forme garde sa couleur dans les deux
 * thèmes : le contraste visage / corps reste constant.
 */
import type { BuddyColor, BuddyShape, Mood } from "@/domain/mood";
import { cn } from "@/lib/cn";

export const BUDDY_FILL: Record<BuddyColor, string> = {
  green: "#8ee27a",
  yellow: "#ffd43b",
  orange: "#ff9f63",
  blue: "#8fb7ff",
  pink: "#ffa0d2",
  purple: "#c9a3ff",
  red: "#ff7d7d",
  gray: "#cfc9de",
};

const INK = "#17132b";
const CHEEK = "#ff6f9f";

/** Centre du visage selon la forme (le triangle a son « visage » plus bas). */
const FACE_CENTER: Record<BuddyShape, { x: number; y: number; scale: number }> = {
  circle: { x: 60, y: 64, scale: 1 },
  squircle: { x: 60, y: 64, scale: 1 },
  blob: { x: 58, y: 64, scale: 1 },
  triangle: { x: 60, y: 80, scale: 0.85 },
  flower: { x: 60, y: 62, scale: 0.9 },
  bolt: { x: 58, y: 58, scale: 0.7 },
};

/** Pétales pré-calculés (valeurs arrondies : rendu identique côté serveur et navigateur). */
const FLOWER_PETALS: [number, number][] = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return [Math.round((60 + 34 * Math.cos(a)) * 100) / 100, Math.round((62 + 34 * Math.sin(a)) * 100) / 100];
});

function Body({ shape, fill }: { shape: BuddyShape; fill: string }) {
  switch (shape) {
    case "circle":
      return <circle cx="60" cy="62" r="50" fill={fill} />;
    case "squircle":
      return <rect x="10" y="12" width="100" height="100" rx="32" fill={fill} />;
    case "blob":
      return <path d="M58 8c18-2 38 8 46 26s6 30 8 44-8 30-28 34-38 2-52-6S8 92 10 72 6 40 18 26 40 10 58 8z" fill={fill} />;
    case "triangle":
      return <path d="M60 10c5 0 9 3 12 8l42 74c5 9-1 20-12 20H18c-11 0-17-11-12-20L48 18c3-5 7-8 12-8z" fill={fill} />;
    case "flower":
      return (
        <g fill={fill}>
          {FLOWER_PETALS.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="22" />
          ))}
          <circle cx="60" cy="62" r="40" />
        </g>
      );
    case "bolt":
      return (
        <path
          d="M72 6L20 66h32l-14 48 60-66H66l16-42z"
          fill={fill}
          stroke={fill}
          strokeWidth="10"
          strokeLinejoin="round"
        />
      );
  }
}

function Face({ mood }: { mood: Mood }) {
  const stroke = { stroke: INK, strokeWidth: 4.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const eyesY = -6;
  const mouthY = 10;
  const cheeks = (
    <>
      <ellipse cx="-24" cy={mouthY - 4} rx="7" ry="4.5" fill={CHEEK} opacity="0.55" />
      <ellipse cx="24" cy={mouthY - 4} rx="7" ry="4.5" fill={CHEEK} opacity="0.55" />
    </>
  );
  switch (mood) {
    case "joy":
      return (
        <g>
          <path d={`M-20 ${eyesY + 2} q6 -9 12 0`} {...stroke} />
          <path d={`M8 ${eyesY + 2} q6 -9 12 0`} {...stroke} />
          <path d={`M-15 ${mouthY - 2} h30 q0 17 -15 17 q-15 0 -15 -17z`} fill={INK} />
          <ellipse cx="0" cy={mouthY + 10} rx="7" ry="4" fill={CHEEK} />
          {cheeks}
        </g>
      );
    case "happy":
      return (
        <g>
          <circle cx="-13" cy={eyesY} r="5" fill={INK} />
          <circle cx="13" cy={eyesY} r="5" fill={INK} />
          <path d={`M-13 ${mouthY} q13 12 26 0`} {...stroke} />
          {cheeks}
        </g>
      );
    case "calm":
      return (
        <g>
          <path d={`M-20 ${eyesY - 2} q6 7 12 0`} {...stroke} />
          <path d={`M8 ${eyesY - 2} q6 7 12 0`} {...stroke} />
          <path d={`M-9 ${mouthY + 2} q9 7 18 0`} {...stroke} />
        </g>
      );
    case "meh":
      return (
        <g>
          <circle cx="-13" cy={eyesY} r="5" fill={INK} />
          <circle cx="13" cy={eyesY} r="5" fill={INK} />
          <path d={`M-20 ${eyesY - 11} l12 3`} {...stroke} />
          <path d={`M10 ${eyesY - 8} l12 -3`} {...stroke} />
          <path d={`M-11 ${mouthY + 4} h22`} {...stroke} />
        </g>
      );
    case "worried":
      return (
        <g>
          <circle cx="-13" cy={eyesY} r="5" fill={INK} />
          <circle cx="13" cy={eyesY} r="5" fill={INK} />
          <path d={`M-21 ${eyesY - 8} l11 -5`} {...stroke} />
          <path d={`M10 ${eyesY - 13} l11 5`} {...stroke} />
          <path d={`M-10 ${mouthY + 8} q10 -9 20 0`} {...stroke} />
        </g>
      );
    case "stressed":
      return (
        <g>
          <circle cx="-13" cy={eyesY} r="8" fill="#fff" stroke={INK} strokeWidth="3.5" />
          <circle cx="13" cy={eyesY} r="8" fill="#fff" stroke={INK} strokeWidth="3.5" />
          <circle cx="-12" cy={eyesY + 1} r="3.2" fill={INK} />
          <circle cx="14" cy={eyesY + 1} r="3.2" fill={INK} />
          <path d={`M-14 ${mouthY + 6} q3.5 -5 7 0 t7 0 t7 0 t7 0`} {...stroke} strokeWidth="4" />
          <path d="M30 -28c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" fill="#7cc4ff" stroke={INK} strokeWidth="2" />
        </g>
      );
    case "sleepy":
      return (
        <g>
          <path d={`M-20 ${eyesY} q6 5 12 0`} {...stroke} />
          <path d={`M8 ${eyesY} q6 5 12 0`} {...stroke} />
          <ellipse cx="0" cy={mouthY + 6} rx="4.5" ry="5.5" fill={INK} />
          <text x="22" y="-22" fontSize="16" fontWeight="800" fill={INK} fontFamily="system-ui, sans-serif">
            z
          </text>
          <text x="32" y="-34" fontSize="11" fontWeight="800" fill={INK} fontFamily="system-ui, sans-serif">
            z
          </text>
        </g>
      );
    case "love":
      return (
        <g>
          {[-13, 13].map((x) => (
            <path key={x} d={`M${x} ${eyesY + 5} l-7-7a4 4 0 0 1 7-5a4 4 0 0 1 7 5z`} fill="#ff4f7b" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          ))}
          <path d={`M-12 ${mouthY + 1} q12 12 24 0`} {...stroke} />
          {cheeks}
        </g>
      );
  }
}

export function Buddy({
  mood,
  shape = "circle",
  color = "yellow",
  size = 48,
  label,
  animate = false,
  className,
}: {
  mood: Mood;
  shape?: BuddyShape;
  color?: BuddyColor;
  size?: number;
  label?: string;
  animate?: boolean;
  className?: string;
}) {
  const face = FACE_CENTER[shape];
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn("shrink-0 overflow-visible", animate && "buddy-bounce", className)}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {label ? <title>{label}</title> : null}
      <g className="buddy-body">
        <Body shape={shape} fill={BUDDY_FILL[color]} />
        <g transform={`translate(${face.x} ${face.y}) scale(${face.scale})`}>
          <Face mood={mood} />
        </g>
      </g>
    </svg>
  );
}

/** Groupe décoratif de bonshommes (écrans d'accueil, états vides). */
export function BuddyCrowd({ className }: { className?: string }) {
  const crowd: { mood: Mood; shape: BuddyShape; color: BuddyColor; size: number; x: string; y: string; r: number }[] = [
    { mood: "calm", shape: "circle", color: "green", size: 110, x: "8%", y: "4%", r: -6 },
    { mood: "joy", shape: "flower", color: "yellow", size: 96, x: "52%", y: "0%", r: 8 },
    { mood: "meh", shape: "squircle", color: "orange", size: 88, x: "70%", y: "38%", r: 10 },
    { mood: "happy", shape: "bolt", color: "yellow", size: 92, x: "34%", y: "34%", r: -8 },
    { mood: "worried", shape: "blob", color: "pink", size: 84, x: "0%", y: "44%", r: 4 },
    { mood: "sleepy", shape: "blob", color: "blue", size: 100, x: "18%", y: "66%", r: -4 },
    { mood: "stressed", shape: "triangle", color: "red", size: 92, x: "58%", y: "66%", r: 6 },
  ];
  return (
    <div className={cn("relative", className)} aria-hidden>
      {crowd.map((b, i) => (
        <div key={i} className="buddy-pop absolute" style={{ left: b.x, top: b.y, transform: `rotate(${b.r}deg)`, animationDelay: `${i * 70}ms` }}>
          <Buddy mood={b.mood} shape={b.shape} color={b.color} size={b.size} className="buddy-hover" />
        </div>
      ))}
    </div>
  );
}
