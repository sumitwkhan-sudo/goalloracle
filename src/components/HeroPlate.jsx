import React, { useCallback, useRef, useState } from 'react';

/**
 * HeroPlate — a 3D tilt card that replaces the flat stadium wallpaper in
 * the Landing hero. Listens to cursor position and sets CSS custom
 * properties (--mx, --my, --hover) that drive the plate's transform and
 * the blend-mode overlays (specular hotspot, warm gleam, iridescent sheen,
 * gold halo). All visual tuning lives in styles.css under `.hero-plate*`.
 *
 * Respects `prefers-reduced-motion` via a CSS media query — no JS guard
 * needed since the transforms are driven entirely by CSS custom properties.
 */
export default function HeroPlate({ title, subtitle, imageUrl }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);

  const handleMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    el.style.setProperty('--mx', x.toFixed(3));
    el.style.setProperty('--my', y.toFixed(3));
  }, []);

  const handleEnter = useCallback(() => {
    setHover(true);
    const el = ref.current;
    if (el) el.style.setProperty('--hover', '1');
  }, []);

  const handleLeave = useCallback(() => {
    setHover(false);
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--hover', '0');
    el.style.setProperty('--mx', '0.5');
    el.style.setProperty('--my', '0.5');
  }, []);

  const style = imageUrl ? { '--hero-plate-image': `url('${imageUrl}')` } : undefined;

  return (
    <div
      ref={ref}
      className={`hero-plate${hover ? ' hero-plate-hover' : ''}`}
      style={style}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="hero-plate-inner">
        <div className="hero-plate-image" />
        <div className="hero-plate-overlay" />
        <div className="hero-plate-sheen" />
        <div className="hero-plate-gleam" />
        <div className="hero-plate-specular" />
        <div className="hero-plate-content">
          <h1 className="hero-plate-title">{title}</h1>
          {subtitle && <p className="hero-plate-subtitle">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
