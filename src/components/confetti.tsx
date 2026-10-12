"use client";

/** Confettis décoratifs (désactivés par la préférence « moins de mouvement »). */
export function Confetti({ count = 26 }: { count?: number }) {
  const colors = ["#ffd43b", "#8ee27a", "#ff9f63", "#8fb7ff", "#ffa0d2", "#c9a3ff", "#ff7d7d"];
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = (i % 9) * 0.12;
        const dx = ((i * 53) % 60) - 30;
        return (
          <span
            key={i}
            className="absolute top-0 block"
            style={{
              left: `${left}%`,
              width: i % 3 === 0 ? 10 : 7,
              height: i % 3 === 0 ? 10 : 14,
              borderRadius: i % 2 ? 999 : 3,
              background: colors[i % colors.length],
              animation: `confetti-fall ${2.4 + (i % 5) * 0.3}s ease-in ${delay}s 1 both`,
              ["--dx" as string]: `${dx}vw`,
            }}
          />
        );
      })}
    </div>
  );
}
