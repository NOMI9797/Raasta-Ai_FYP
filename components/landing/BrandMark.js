// Raasta-AI mark: "R" and "A" interlocked. The R's leg runs down into the A's left
// leg, so the two letters share one foot. `tile` puts it on a cobalt rounded square
// (header, favicon); without a tile the strokes are cobalt.
export const RA_PATHS = [
  "M7 25V7", // R stem
  "M7 7H11.5C14.6 7 16 9 16 11.5C16 14 14.6 16 11.5 16H7", // R bowl
  "M11 16L15 25L20 7L25 25", // R leg into the shared foot, then the A
  "M16.7 19H23.3", // A crossbar
];

const BrandMark = ({ size = 32, className = "", tile = true, title }) => {
  const stroke = tile ? "rgb(var(--raasta-white))" : "rgb(var(--raasta-cobalt))";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
    >
      {title && <title>{title}</title>}
      {tile && <rect width="32" height="32" rx="8" fill="rgb(var(--raasta-cobalt))" />}
      {RA_PATHS.map((d) => (
        <path key={d} d={d} stroke={stroke} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
};

export default BrandMark;
