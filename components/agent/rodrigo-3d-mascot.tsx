"use client";

// Rodrigo 2.5D — el mismo personaje aprobado, compuesto por capas.
// Las 5 capas (body/head/eyes/arm/clipboard) son recortes del render maestro
// del GLB aprobado: mismos píxeles, mismo rostro, mismas proporciones, mismo
// estilo. Comparten frame (772x831) y se apilan 1:1, así que en reposo la
// unión es invisible. La animación es CSS por estado (transforms + blink).
// Sin Three.js, sin GLB en producción, sin rig. Misma API:
// <Rodrigo3DMascot state={state} /> (consumidores intactos).

import type { SyntheticEvent } from "react";
import type { RodrigoState } from "@/lib/agent/rodrigo-state";
import "./rodrigo-mascot-layers.css";

const BASE = "/agent/rodrigo";

function hideLayer(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = "none";
}

function hideAll(event: SyntheticEvent<HTMLImageElement>): void {
  const root = event.currentTarget.closest(".rodrigo");
  if (root instanceof HTMLElement) root.style.display = "none";
}

export function Rodrigo3DMascot({ state }: { state: RodrigoState }) {
  return (
    <div className={`rodrigo rodrigo--${state}`} aria-hidden="true">
      <img
        className="rodrigo__layer rodrigo__body"
        src={`${BASE}/body.webp`}
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
        onError={hideAll}
      />
      <div className="rodrigo__head-group" aria-hidden="true">
        <img
          className="rodrigo__layer rodrigo__head"
          src={`${BASE}/head.webp`}
          alt=""
          draggable={false}
          loading="eager"
          decoding="async"
          onError={hideLayer}
        />
        <img
          className="rodrigo__layer rodrigo__socket"
          src={`${BASE}/socket.webp`}
          alt=""
          draggable={false}
          loading="eager"
          decoding="async"
          onError={hideLayer}
        />
        <img
          className="rodrigo__layer rodrigo__eyes"
          src={`${BASE}/eyes.webp`}
          alt=""
          draggable={false}
          loading="eager"
          decoding="async"
          onError={hideLayer}
        />
      </div>
      <img
        className="rodrigo__layer rodrigo__arm"
        src={`${BASE}/arm.webp`}
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
        onError={hideLayer}
      />
      <img
        className="rodrigo__layer rodrigo__clipboard"
        src={`${BASE}/clipboard.webp`}
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
        onError={hideLayer}
      />
    </div>
  );
}
