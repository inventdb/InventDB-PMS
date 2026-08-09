import { BrandMark } from "./BrandMark";

/**
 * The full brand lockup — keystone, wordmark, and the expanded product name —
 * following assets/logo-3c/lockup-horizontal-{light,dark}.svg.
 *
 * The asset sets the wordmark at 32px with "PMS" in the accent colour, over a
 * 11px all-caps tagline tracked at 2.4 (0.22em). Those proportions are kept and
 * scaled down for in-app use; the colours come from theme tokens instead of the
 * asset's own hexes so the lockup follows light/dark. The one exception is the
 * login hero, where the lockup sits on the brand gradient and a purple accent
 * would vanish — see the `.login-hero` overrides in global.css.
 *
 * `tile` wraps the mark in the gradient chip used in the sidebar; without it
 * the mark is bare and inherits its colour, as it does on the hero.
 */
export function BrandLockup({
  size = "sm",
  tile = false,
  className = "",
}: {
  size?: "sm" | "lg";
  tile?: boolean;
  className?: string;
}) {
  const markSize = size === "lg" ? 34 : 19;
  const mark = <BrandMark size={markSize} title={tile ? undefined : "InventDB PMS"} />;

  return (
    <div className={`brand-lockup brand-lockup--${size} ${className}`.trim()}>
      {tile ? <span className="logo">{mark}</span> : mark}
      <span className="brand-lockup-text">
        <span className="brand-lockup-name">
          InventDB<span className="brand-lockup-pms">PMS</span>
        </span>
        <span className="brand-lockup-tag">Property Management System</span>
      </span>
    </div>
  );
}

export default BrandLockup;
