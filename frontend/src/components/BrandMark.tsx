/**
 * The InventDB PMS keystone, traced verbatim from the logo redesign package
 * (Logo redesign request/assets/logo-3c/keystone-open-currentcolor.svg).
 *
 * An open arch — the load-bearing keystone of a building — with the doorway
 * filled. The delivered artwork ships in three colourways (accent #9184d9,
 * light #e9e9ed, currentColor); we take the currentColor cut so the mark
 * inherits whatever it sits in rather than hardcoding a fourth palette into
 * the app: white on the brand gradient in the sidebar tile and the login hero,
 * Orbital Indigo / Wisteria Bloom anywhere it lands on a plain surface.
 *
 * The source viewBox is 0 0 128 128; we crop to the glyph's stroked bounds
 * (x 5.5–122.5, y 7.5–122.5 once the 13px round-capped stroke is accounted
 * for) so the mark fills its box at 19–26px instead of floating in the
 * asset's own padding. Clear space is handled by the container.
 */
export function BrandMark({
  size = 20,
  title,
}: {
  size?: number;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="4 5 120 120"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path
        d="M12 116 L12 54 L64 14 L116 54 L116 116"
        fill="none"
        stroke="currentColor"
        strokeWidth={13}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <rect x="48" y="78" width="32" height="38" rx="5" fill="currentColor" />
    </svg>
  );
}

export default BrandMark;
