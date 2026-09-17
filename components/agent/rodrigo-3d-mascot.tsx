"use client";

// Rodrigo 3D — mascota procedural con Three.js (sin PNG, sin iframe, sin video).
// Caricatura premium de construcción: casco amarillo, cuerpo redondeado,
// ojos expresivos. Liviano: una sola escena, DPR limitado, pausa en tab
// oculta y cleanup total de renderer/listeners/geometrías.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { RodrigoState } from "@/lib/agent/rodrigo-state";

const MAX_DPR = 1.5;

type AnimTargets = {
  breathAmp: number;
  breathSpeed: number;
  bobAmp: number;
  bobSpeed: number;
  tiltX: number;
  tiltZ: number;
  lookSpeed: number;
  lookAmp: number;
  blinkRate: number;
  hopAmp: number;
  shakeAmp: number;
  gray: number;
};

const STATE_TARGETS: Record<RodrigoState, AnimTargets> = {
  idle: { breathAmp: 0.035, breathSpeed: 2.2, bobAmp: 0.03, bobSpeed: 1.6, tiltX: 0, tiltZ: 0, lookSpeed: 0.4, lookAmp: 0.08, blinkRate: 0.35, hopAmp: 0, shakeAmp: 0, gray: 0 },
  thinking: { breathAmp: 0.02, breathSpeed: 3.2, bobAmp: 0.015, bobSpeed: 2.2, tiltX: 0.1, tiltZ: 0.22, lookSpeed: 1.6, lookAmp: 0.3, blinkRate: 0.7, hopAmp: 0, shakeAmp: 0, gray: 0 },
  listening: { breathAmp: 0.015, breathSpeed: 2.6, bobAmp: 0.01, bobSpeed: 3.0, tiltX: -0.14, tiltZ: 0, lookSpeed: 0.8, lookAmp: 0.12, blinkRate: 0.15, hopAmp: 0, shakeAmp: 0, gray: 0 },
  working: { breathAmp: 0.03, breathSpeed: 3.4, bobAmp: 0.05, bobSpeed: 3.4, tiltX: 0.06, tiltZ: 0, lookSpeed: 2.4, lookAmp: 0.2, blinkRate: 0.5, hopAmp: 0, shakeAmp: 0, gray: 0 },
  approval: { breathAmp: 0.02, breathSpeed: 4.2, bobAmp: 0.07, bobSpeed: 5.0, tiltX: -0.06, tiltZ: 0, lookSpeed: 3.0, lookAmp: 0.16, blinkRate: 0.9, hopAmp: 0.02, shakeAmp: 0, gray: 0 },
  success: { breathAmp: 0.04, breathSpeed: 2.4, bobAmp: 0.04, bobSpeed: 2.0, tiltX: -0.1, tiltZ: 0, lookSpeed: 0.6, lookAmp: 0.1, blinkRate: 0.2, hopAmp: 0.09, shakeAmp: 0, gray: 0 },
  error: { breathAmp: 0.02, breathSpeed: 4.6, bobAmp: 0.02, bobSpeed: 4.0, tiltX: 0.12, tiltZ: 0.1, lookSpeed: 1.2, lookAmp: 0.1, blinkRate: 0.9, hopAmp: 0, shakeAmp: 0.035, gray: 0 },
  disabled: { breathAmp: 0.008, breathSpeed: 1.2, bobAmp: 0, bobSpeed: 0, tiltX: 0.16, tiltZ: 0, lookSpeed: 0, lookAmp: 0, blinkRate: 0.05, hopAmp: 0, shakeAmp: 0, gray: 1 },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function Rodrigo3DMascot({ state }: { state: RodrigoState }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<RodrigoState>(state);
  stateRef.current = state;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const width = mount.clientWidth || 84;
    const height = mount.clientHeight || 84;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 20);
    camera.position.set(0, 0.55, 4.4);
    camera.lookAt(0, 0.45, 0);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(2.5, 4, 3.5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffe7c2, 0.9);
    fillLight.position.set(-3, 1, 2);
    scene.add(fillLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));

    const toon = (color: number) =>
      new THREE.MeshToonMaterial({ color, gradientMap: null });

    const root = new THREE.Group();
    scene.add(root);
    const body = new THREE.Group();
    root.add(body);
    const head = new THREE.Group();
    head.position.y = 0.62;
    body.add(head);

    // Cuerpo redondeado
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), toon(0xff9d2e));
    torso.scale.set(1, 1.12, 0.88);
    torso.position.y = -0.15;
    body.add(torso);

    // Casco: cúpula + visera + nervio central
    const helmetMat = toon(0xffc21a);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    dome.position.y = 0.72;
    head.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.09, 24), helmetMat);
    brim.position.y = 0.72;
    head.add(brim);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.85), helmetMat);
    ridge.position.y = 1.12;
    head.add(ridge);

    // Ojos expresivos
    const eyeWhiteMat = toon(0xffffff);
    const pupilMat = toon(0x233043);
    const leftEye = new THREE.Group();
    const rightEye = new THREE.Group();
    for (const [group, x] of [[leftEye, -0.2], [rightEye, 0.2]] as const) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), eyeWhiteMat);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), pupilMat);
      pupil.position.z = 0.115;
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      spark.position.set(0.025, 0.025, 0.165);
      group.add(white, pupil, spark);
      group.position.set(x, 0.62, 0.42);
      group.userData.pupil = pupil;
      group.userData.spark = spark;
      head.add(group);
    }

    // Mejillas + sonrisa
    const cheekMat = new THREE.MeshBasicMaterial({ color: 0xe2703a, transparent: true, opacity: 0.55 });
    for (const x of [-0.34, 0.34]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), cheekMat);
      cheek.position.set(x, 0.42, 0.5);
      cheek.scale.set(1, 0.7, 0.4);
      head.add(cheek);
    }
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.028, 8, 20, Math.PI * 0.85),
      toon(0x7c3f12)
    );
    smile.position.set(0, 0.4, 0.55);
    smile.rotation.z = Math.PI + (Math.PI - Math.PI * 0.85) / 2;
    head.add(smile);

    // Brazos simples
    const armMat = toon(0xe8891f);
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 6, 12), armMat);
    leftArm.position.set(-0.68, -0.2, 0);
    leftArm.rotation.z = 0.5;
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.68;
    rightArm.rotation.z = -0.5;
    body.add(leftArm, rightArm);

    const grayables: THREE.MeshToonMaterial[] = [torso.material as THREE.MeshToonMaterial, helmetMat, armMat];
    const baseColors = grayables.map((m) => m.color.clone());

    let raf = 0;
    let running = true;
    const clock = new THREE.Clock();
    const current: AnimTargets = { ...STATE_TARGETS.idle };
    let nextBlinkAt = 1.2;
    let blinkT = -1;

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) clock.getDelta();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onResize = () => {
      const w = mount.clientWidth || width;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (!running) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const target = STATE_TARGETS[stateRef.current];
      const k = 1 - Math.exp(-dt * 6);
      (Object.keys(target) as (keyof AnimTargets)[]).forEach((key) => {
        current[key] = lerp(current[key], target[key], k);
      });

      // Respiración + flotación + salto/sacudida por estado
      const breathe = 1 + Math.sin(t * current.breathSpeed) * current.breathAmp;
      body.scale.set(1, breathe, 1);
      root.position.y =
        Math.sin(t * current.bobSpeed) * current.bobAmp +
        (current.hopAmp > 0 ? Math.abs(Math.sin(t * 5)) * current.hopAmp : 0);
      root.position.x = current.shakeAmp > 0 ? Math.sin(t * 28) * current.shakeAmp : 0;
      root.rotation.y = Math.sin(t * 0.7) * 0.12;

      // Cabeza: inclinación + mirada
      head.rotation.x = lerp(head.rotation.x, current.tiltX + Math.sin(t * current.lookSpeed) * 0.05, k);
      head.rotation.z = lerp(head.rotation.z, current.tiltZ, k);
      const lookX = Math.sin(t * current.lookSpeed) * current.lookAmp;
      const lookY = Math.cos(t * current.lookSpeed * 0.7) * current.lookAmp * 0.6;
      for (const g of [leftEye, rightEye]) {
        g.userData.pupil.position.x = lookX;
        g.userData.pupil.position.y = lookY;
        g.userData.spark.position.x = 0.025 + lookX;
        g.userData.spark.position.y = 0.025 + lookY;
      }

      // Parpadeo
      if (t >= nextBlinkAt && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.12;
        const s = blinkT >= 1 ? 1 : 1 - Math.sin(Math.min(blinkT, 1) * Math.PI) * 0.9;
        leftEye.scale.y = s;
        rightEye.scale.y = s;
        if (blinkT >= 1) {
          blinkT = -1;
          const rate = Math.max(current.blinkRate, 0.03);
          nextBlinkAt = t + 1.5 + Math.random() * 3 * (1 - Math.min(rate, 1));
        }
      }

      // Desaturado cuando está deshabilitado
      const gray = current.gray;
      grayables.forEach((m, i) => {
        if (gray <= 0.01) {
          m.color.copy(baseColors[i]);
        } else {
          const lum = baseColors[i].r * 0.3 + baseColors[i].g * 0.6 + baseColors[i].b * 0.1;
          m.color.setRGB(
            lerp(baseColors[i].r, lum, gray),
            lerp(baseColors[i].g, lum, gray),
            lerp(baseColors[i].b, lum, gray)
          );
        }
      });

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
    // Solo se monta una vez: el estado vivo viaja por stateRef (no recrear escena).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} aria-hidden="true" className="h-full w-full" />;
}
