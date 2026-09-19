"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./wafer-scene.css";

// Deliberately regular illustration: no spatial measurements or bin results.
const WAFER = "M194 383.9 A184 184 0 1 1 206 383.9 L200 376 Z";

/** Standalone overview panel. CSS is included; no data or props are required. */
export default function WaferScene() {
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
    observer?.observe(element);
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
      const bounds = element.getBoundingClientRect();
      const scrollTilt = Math.max(-1, Math.min(1,
        (bounds.top + bounds.height / 2 - window.innerHeight / 2) / window.innerHeight));
      element.style.setProperty("--wafer-pitch", `${64 + pointerY * 3 + scrollTilt * 4}deg`);
      element.style.setProperty("--wafer-yaw", `${-14 + pointerX * 8}deg`);
    };
    // Event-driven, at most one pending frame. There is no JS animation loop.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const bounds = element.getBoundingClientRect();
      pointerX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      pointerY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      schedule();
    };
    const reset = () => { pointerX = 0; pointerY = 0; schedule(); };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerleave", reset);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [running, topView]);

  return (
    <figure className="wafer-scene" ref={root} data-running={running} data-top-view={topView}
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-caption`}>
      <div className="wafer-scene__header">
        <div>
          <h2 id={`${id}-title`}>Silicon wafer</h2>
        </div>
        <span className="wafer-scene__tag">3D study</span>
      </div>

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
                <pattern id={`${id}-dies`} width="24" height="28" patternUnits="userSpaceOnUse" x="8" y="4">
                  <rect x="1.5" y="1.5" width="21" height="25" rx=".6" fill="#172a40" fillOpacity=".11" stroke="#14283d" strokeOpacity=".72" strokeWidth=".7" />
                  <path d="M3 25V3H21 M5 7H18 M5 9H18 M5 11H13 M16 14H20V23H16Z M5 16H12V23H5Z" fill="none" stroke="#d6e5e9" strokeOpacity=".45" strokeWidth=".55" />
                  <path d="M0 0H24V28" fill="none" stroke="#e7e8de" strokeOpacity=".72" strokeWidth=".65" />
                </pattern>
                <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2=".8" y2="1">
                  <stop stopColor="#fcfaf0" /><stop offset=".4" stopColor="#b0c2cd" />
                  <stop offset=".7" stopColor="#415568" /><stop offset="1" stopColor="#d6e8e8" />
                </linearGradient>
              </defs>
              <g clipPath={ref("clip")}>
                <path d={WAFER} fill={ref("silicon")} />
                <circle cx="200" cy="200" r="177" fill={ref("dies")} />
                <path d={WAFER} fill={ref("film")} />
                <circle cx="200" cy="200" r="179" fill="none" stroke="#dbe9e8" strokeOpacity=".5" strokeWidth=".65" />
              </g>
              <path d={WAFER} fill="none" stroke={ref("bevel")} strokeWidth="2" />
            </svg>
          </div>
        </div>
      </div>

      <figcaption className="wafer-scene__footer">
        <p id={`${id}-caption`}>Illustration · no wafer-map data</p>
        <div className="wafer-scene__controls">
          <button type="button" aria-pressed={topView} onClick={() => setTopView(value => !value)}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m10 3 7 4-7 4-7-4 7-4Zm-7 8 7 4 7-4M3 15l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            Top view
          </button>
          <button type="button" onClick={() => setPaused(value => !value)} disabled={reducedMotion}
            aria-label={reducedMotion ? "Animation disabled by reduced-motion preference" : paused ? "Resume wafer motion" : "Pause wafer motion"}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {paused || reducedMotion ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
            </svg>
            {reducedMotion ? "Reduced motion" : paused ? "Resume" : "Pause"}
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
