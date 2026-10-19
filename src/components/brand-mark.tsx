// Isotipo de Fitt Global, vectorizado del logo oficial. Se pinta con
// currentColor: el contenedor decide el tono contra los tokens del tema.
const PATH =
  "M 342 66.890 C 242.333 102.832, 169.523 165.330, 131.488 247.587 C 123.212 265.484, 110.689 303.023, 112.418 304.751 C 112.601 304.935, 116.043 299.103, 120.065 291.793 C 149.194 238.849, 193.619 190.895, 246.113 155.729 C 281.060 132.319, 312.793 120.906, 321.819 128.502 C 328.230 133.896, 330.115 141.929, 327.684 153.500 C 326.875 157.350, 326.346 160.643, 326.508 160.818 C 326.797 161.129, 332.044 153.909, 339.457 143 C 351.042 125.951, 356.267 109.613, 356.405 90 C 356.493 77.528, 354.722 62.923, 353.137 63.052 C 352.787 63.080, 347.775 64.807, 342 66.890 M 272.500 189.380 C 195.353 218.749, 140.576 266.016, 108.960 330.500 C 99.700 349.386, 88.528 380.862, 90.416 382.749 C 90.592 382.925, 93.383 378.227, 96.618 372.308 C 125.128 320.146, 176.841 269.256, 225.500 245.477 C 253.261 231.911, 264.891 232.219, 268.111 246.606 C 269.080 250.933, 269.027 253.021, 267.828 257.930 C 265.955 265.597, 266.944 264.882, 275.117 252.664 C 289.926 230.524, 294.096 213.664, 290.678 189.750 C 289.657 182.608, 290.255 182.620, 272.500 189.380";

export function BrandMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="58 58 330 330" width={size} height={size} className={className} aria-hidden="true">
      <path d={PATH} fill="currentColor" />
    </svg>
  );
}

/** Logo completo: isotipo blanco sobre fondo negro, invertido en modo oscuro. */
export function BrandTile({ size = 28, className = "rounded-lg" }: { size?: number; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-[var(--text-primary)] text-[var(--surface-1)] ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Fitt Global"
    >
      <BrandMark size={Math.round(size * 0.78)} />
    </span>
  );
}
