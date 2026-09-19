"use client";
import {useLocale} from "@/components/locale-provider";

import { useEffect, useId, useRef, useState } from "react";
import "./wafer-scene.css";
import { waferTiles, waferFailureTiles, WAFER_TILE_COUNT } from "@/lib/rtdi/wafer-illustration";

// Yield controls the red share; positions are illustrative, not a spatial defect map.
// One flat-bottom outline for both 3D layers, clipping and the inset rim.
function waferOutline(radius: number, bottom: number) {
  const halfFlat = Math.sqrt(radius ** 2 - (bottom - 200) ** 2);
  return `M${200 - halfFlat} ${bottom} A${radius} ${radius} 0 1 1 ${200 + halfFlat} ${bottom} Z`;
}
const WAFER = waferOutline(184, 370);
const WAFER_RIM = waferOutline(179, 365);

export default function WaferScene({ waferId, yieldRatio, devices }: { waferId?: string; yieldRatio?: number; devices?: number }) {
 const {t, locale} = useLocale();

  const failedTiles = waferFailureTiles(yieldRatio);
  const failed = waferTiles.filter(tile => failedTiles !== null && tile.rank < failedTiles);
  const knownYield = failedTiles !== null;
  const id = useId().replace(/:/g, "");
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [topView, setTopView] = useState(false);
  // Static on the server and before preferences/visibility have been checked.
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(false);
  const running = !paused && !reducedMotion && visible && tabVisible;
  const ref = (name: string) => `url(#${id}-${name})`;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(preference.matches);
    const syncTab = () => setTabVisible(document.visibilityState === "visible");
    syncPreference();
    syncTab();
    preference.addEventListener("change", syncPreference);
    document.addEventListener("visibilitychange", syncTab);
    // Unsupported observers leave a usable static illustration.
    const observer = typeof IntersectionObserver === "undefined" ? null :
      new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    observer?.observe(stage.current ?? element);
    if (!observer) setVisible(true);
    return () => {
      preference.removeEventListener("change", syncPreference);
      document.removeEventListener("visibilitychange", syncTab);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element || !running || topView) return;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const update = () => {
      frame = 0;
      element.style.setProperty("--wafer-pitch", `${34 - pointerY * 15}deg`);
      element.style.setProperty("--wafer-yaw", `${-18 + pointerX * 22}deg`);
      element.style.setProperty("--wafer-scroll", `${window.scrollY * .095}deg`);
    };
    // Event-driven, at most one pending frame. There is no JS animation loop.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointerX = Math.max(-1, Math.min(1, event.clientX / window.innerWidth * 2 - 1));
      pointerY = Math.max(-1, Math.min(1, event.clientY / window.innerHeight * 2 - 1));
      schedule();
    };
    const reset = () => { pointerX = 0; pointerY = 0; schedule(); };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [running, topView]);

  return (
    <figure className="wafer-scene" ref={root} data-running={running} data-top-view={topView}
      data-wafer={waferId ?? "none"} data-failed-tiles={failedTiles ?? "unknown"} data-tile-count={WAFER_TILE_COUNT}
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-caption`}>
      <div className="wafer-scene__stage" ref={stage} aria-hidden="true">
        <div className="wafer-scene__shadow" />
        <div className="wafer-scene__mount">
          <div className="wafer-scene__rotor">
            <svg className="wafer-scene__edge" viewBox="0 0 400 400" focusable="false">
              <defs>
                <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
                  <stop stopColor="#e9eff6" /><stop offset=".25" stopColor="#536477" />
                  <stop offset=".55" stopColor="#c5d0df" /><stop offset="1" stopColor="#283848" />
                </linearGradient>
              </defs>
              <path d={WAFER} fill={ref("edge")} stroke="#899aaa" strokeWidth="1.5" />
            </svg>
            <svg className="wafer-scene__face" viewBox="0 0 400 400" focusable="false">
              <defs>
                <clipPath id={`${id}-clip`}><path d={WAFER} /></clipPath>
                <linearGradient id={`${id}-silicon`} x1=".08" y1="0" x2=".93" y2="1">
                  <stop stopColor="#263c59" /><stop offset=".22" stopColor="#526b88" />
                  <stop offset=".42" stopColor="#b7c9d2" /><stop offset=".5" stopColor="#e3dfd4" />
                  <stop offset=".59" stopColor="#a89fae" /><stop offset=".73" stopColor="#53758a" />
                  <stop offset="1" stopColor="#172d46" />
                </linearGradient>
                <linearGradient id={`${id}-film`} x1="0" y1="1" x2="1" y2="0">
                  <stop stopColor="#5ab7b4" stopOpacity=".18" />
                  <stop offset=".32" stopColor="#8694cb" stopOpacity=".05" />
                  <stop offset=".5" stopColor="#d9afd1" stopOpacity=".32" />
                  <stop offset=".67" stopColor="#e3c792" stopOpacity=".14" />
                  <stop offset="1" stopColor="#86c8cd" stopOpacity=".3" />
                </linearGradient>
                <filter id={`${id}-glow`} x="-15%" y="-15%" width="130%" height="130%">
                  <feGaussianBlur stdDeviation="2.6" />
                </filter>
                <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2=".8" y2="1">
                  <stop stopColor="#fcfaf0" /><stop offset=".4" stopColor="#b0c2cd" />
                  <stop offset=".7" stopColor="#415568" /><stop offset="1" stopColor="#d6e8e8" />
                </linearGradient>
              </defs>
              <g clipPath={ref("clip")}>
                <path d={WAFER} fill={ref("silicon")} />
                <g className="wafer-scene__dies">{waferTiles.map(tile => <g key={tile.index}>
                  <rect data-die="true" data-failed={failedTiles !== null && tile.rank < failedTiles} x={tile.x - 6.5} y={tile.y - 6.5} width="13" height="13" rx=".65"
                    fill="#173147" fillOpacity=".32" stroke="#d4e5ec" strokeOpacity=".5" strokeWidth=".45" />
                  <path d={`M${tile.x - 4} ${tile.y + 4}v-8h8 M${tile.x - 2} ${tile.y - 1}h5 M${tile.x - 2} ${tile.y + 1}h3`} fill="none" stroke="#d9edf4" strokeOpacity=".32" strokeWidth=".45" />
                </g>)}</g>
                <g className="wafer-scene__fail-glow" filter={ref("glow")} fill="#ff3a47">{failed.map(tile =>
                  <rect key={tile.index} x={tile.x - 7} y={tile.y - 7} width="14" height="14" rx="1" />)}</g>
                <g className="wafer-scene__fail-tiles" fill="#f83c4c" stroke="#ffb0ad" strokeWidth=".65">{failed.map(tile =>
                  <rect key={tile.index} x={tile.x - 6.5} y={tile.y - 6.5} width="13" height="13" rx=".65" />)}</g>
                <path d={WAFER} fill={ref("film")} />
                <path d={WAFER_RIM} fill="none" stroke="#dbe9e8" strokeOpacity=".5" strokeWidth=".65" />
              </g>
              <path d={WAFER} fill="none" stroke={ref("bevel")} strokeWidth="2" />
            </svg>
          </div>
        </div>
      </div>

      <figcaption className="wafer-scene__footer">
        <div className="wafer-scene__readout" aria-live="polite" aria-atomic="true">
          <h2 id={`${id}-title`}>{waferId ? t("W{0} / Yield", waferId.padStart(2, "0")) : t("Wafer yield")}</h2>
          <p className="wafer-scene__yield">{knownYield ? (yieldRatio! * 100).toFixed(2) : "—"}<span>{knownYield ? "%" : t("No selection")}</span></p>
          <p className="wafer-scene__legend"><i aria-hidden="true" />{knownYield ? t("{0}% fail share", ((1 - yieldRatio!) * 100).toFixed(2)) : t("Yield unavailable")}{devices !== undefined && <span> / {devices.toLocaleString()} {t("devices")}</span>}</p>
        </div>
        <p id={`${id}-caption`}>{t("Yield illustration · red tiles show fail share.")}<br />{t("Positions are illustrative; rounded to 0.25%.")}</p>
        <div className="wafer-scene__controls">
          <button type="button" aria-pressed={topView} onClick={() => setTopView(value => !value)}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m10 3 7 4-7 4-7-4 7-4Zm-7 8 7 4 7-4M3 15l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {t("Top view")}</button>
          <button type="button" onClick={() => setPaused(value => !value)} disabled={reducedMotion}
            aria-label={reducedMotion ? t("Animation disabled by reduced-motion preference") : paused ? t("Resume wafer motion") : t("Pause wafer motion")}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {paused || reducedMotion ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
            </svg>
            {reducedMotion ? t("Reduced motion") : paused ? t("Resume") : t("Pause")}
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
