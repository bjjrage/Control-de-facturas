"use client";

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
  idle: { breathAmp: 0.018, breathSpeed: 2.1, bobAmp: 0.018, bobSpeed: 1.6, tiltX: 0, tiltZ: 0, lookSpeed: 0.35, lookAmp: 0.04, blinkRate: 0.3, hopAmp: 0, shakeAmp: 0, gray: 0 },
  thinking: { breathAmp: 0.014, breathSpeed: 2.8, bobAmp: 0.012, bobSpeed: 2, tiltX: 0.08, tiltZ: 0.12, lookSpeed: 1.35, lookAmp: 0.12, blinkRate: 0.5, hopAmp: 0, shakeAmp: 0, gray: 0 },
  listening: { breathAmp: 0.012, breathSpeed: 2.4, bobAmp: 0.01, bobSpeed: 2.6, tiltX: -0.07, tiltZ: 0, lookSpeed: 0.65, lookAmp: 0.05, blinkRate: 0.18, hopAmp: 0, shakeAmp: 0, gray: 0 },
  working: { breathAmp: 0.016, breathSpeed: 3, bobAmp: 0.024, bobSpeed: 3, tiltX: 0.035, tiltZ: 0, lookSpeed: 2.1, lookAmp: 0.08, blinkRate: 0.4, hopAmp: 0, shakeAmp: 0, gray: 0 },
  approval: { breathAmp: 0.014, breathSpeed: 3.8, bobAmp: 0.03, bobSpeed: 4.4, tiltX: -0.035, tiltZ: 0, lookSpeed: 2.7, lookAmp: 0.07, blinkRate: 0.75, hopAmp: 0.012, shakeAmp: 0, gray: 0 },
  success: { breathAmp: 0.018, breathSpeed: 2.2, bobAmp: 0.022, bobSpeed: 2.2, tiltX: -0.05, tiltZ: 0, lookSpeed: 0.55, lookAmp: 0.04, blinkRate: 0.2, hopAmp: 0.055, shakeAmp: 0, gray: 0 },
  error: { breathAmp: 0.012, breathSpeed: 4, bobAmp: 0.012, bobSpeed: 3.6, tiltX: 0.08, tiltZ: 0.07, lookSpeed: 1, lookAmp: 0.04, blinkRate: 0.8, hopAmp: 0, shakeAmp: 0.022, gray: 0 },
  disabled: { breathAmp: 0.005, breathSpeed: 1.1, bobAmp: 0, bobSpeed: 0, tiltX: 0.08, tiltZ: 0, lookSpeed: 0, lookAmp: 0, blinkRate: 0.05, hopAmp: 0, shakeAmp: 0, gray: 1 },
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function toon(color: number) {
  return new THREE.MeshToonMaterial({ color });
}

function addMesh<T extends THREE.BufferGeometry>(
  parent: THREE.Object3D,
  geometry: T,
  material: THREE.Material,
  position: [number, number, number],
  scale?: [number, number, number],
  rotation?: [number, number, number]
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (scale) mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 20);
    camera.position.set(0, 0.6, 4.8);
    camera.lookAt(0, 0.55, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.5, 4.5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd58a, 1.2);
    rim.position.set(-3.5, 1.5, 2.5);
    scene.add(rim);

    const root = new THREE.Group();
    root.position.y = -0.05;
    scene.add(root);

    const body = new THREE.Group();
    root.add(body);

    const head = new THREE.Group();
    head.position.set(0, 0.72, 0.02);
    body.add(head);

    // Palette: rostro cálido + casco amarillo + uniforme azul petróleo + chaleco hi-vis.
    const skinMat = toon(0xf0b88e);
    const skinShadeMat = toon(0xd9976c);
    const helmetMat = toon(0xffc928);
    const helmetShadeMat = toon(0xe9a900);
    const navyMat = toon(0x223044);
    const vestMat = toon(0xff7a2f);
    const vestTrimMat = toon(0xffd85a);
    const gloveMat = toon(0xe8edf3);
    const bootMat = toon(0x1b2430);
    const whiteMat = toon(0xffffff);
    const eyeMat = toon(0x172033);
    const browMat = toon(0x503426);
    const mouthMat = toon(0x7b3f31);

    // Piernas y botas: base clara para que la silueta sea legible a 80px.
    const leftLeg = addMesh(body, new THREE.CapsuleGeometry(0.11, 0.28, 6, 12), navyMat, [-0.18, -0.66, 0], undefined, [0, 0, 0.03]);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.18;
    rightLeg.rotation.z = -0.03;
    body.add(rightLeg);

    addMesh(body, new THREE.SphereGeometry(0.16, 16, 12), bootMat, [-0.19, -0.9, 0.08], [1.15, 0.62, 1.3]);
    addMesh(body, new THREE.SphereGeometry(0.16, 16, 12), bootMat, [0.19, -0.9, 0.08], [1.15, 0.62, 1.3]);

    // Torso compacto con hombros marcados y chaleco frontal.
    const torso = addMesh(body, new THREE.SphereGeometry(0.48, 28, 20), navyMat, [0, -0.27, 0], [0.92, 1.08, 0.72]);
    addMesh(body, new THREE.SphereGeometry(0.42, 24, 18), vestMat, [0, -0.2, 0.28], [0.86, 0.82, 0.24]);
    addMesh(body, new THREE.BoxGeometry(0.07, 0.55, 0.06), vestTrimMat, [-0.13, -0.2, 0.49], undefined, [0, 0, 0.18]);
    addMesh(body, new THREE.BoxGeometry(0.07, 0.55, 0.06), vestTrimMat, [0.13, -0.2, 0.49], undefined, [0, 0, -0.18]);
    addMesh(body, new THREE.BoxGeometry(0.5, 0.055, 0.055), vestTrimMat, [0, -0.31, 0.5]);

    // Brazos separados del torso, con manos visibles.
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.48, -0.24, 0.02);
    leftArm.rotation.z = 0.2;
    body.add(leftArm);
    addMesh(leftArm, new THREE.CapsuleGeometry(0.09, 0.3, 6, 12), navyMat, [0, -0.1, 0]);
    addMesh(leftArm, new THREE.SphereGeometry(0.115, 16, 12), gloveMat, [-0.01, -0.34, 0.03], [0.95, 0.92, 0.9]);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.48;
    rightArm.rotation.z = -0.2;
    body.add(rightArm);

    // Cabeza grande: forma humana caricaturesca, no “bola pegada”.
    const face = addMesh(head, new THREE.SphereGeometry(0.5, 32, 24), skinMat, [0, 0.1, 0.02], [1, 0.93, 0.82]);
    addMesh(head, new THREE.SphereGeometry(0.16, 18, 14), skinShadeMat, [0, -0.01, 0.43], [0.72, 0.68, 0.62]);

    // Orejas pequeñas ayudan a leer la cabeza como personaje humano.
    addMesh(head, new THREE.SphereGeometry(0.105, 14, 12), skinShadeMat, [-0.49, 0.08, 0], [0.72, 1, 0.72]);
    addMesh(head, new THREE.SphereGeometry(0.105, 14, 12), skinShadeMat, [0.49, 0.08, 0], [0.72, 1, 0.72]);

    // Casco con copa, ala frontal real y nervio central.
    addMesh(head, new THREE.SphereGeometry(0.53, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat, [0, 0.43, -0.01], [1.02, 0.88, 1]);
    addMesh(head, new THREE.BoxGeometry(0.78, 0.09, 0.34), helmetMat, [0, 0.43, 0.27], [1, 1, 1]);
    addMesh(head, new THREE.BoxGeometry(0.1, 0.16, 0.58), helmetShadeMat, [0, 0.72, 0.03], undefined, [0.03, 0, 0]);
    addMesh(head, new THREE.BoxGeometry(0.52, 0.045, 0.08), helmetShadeMat, [0, 0.39, 0.47]);

    // Ojos grandes pero contenidos dentro del rostro, con pupilas y highlight.
    const leftEye = new THREE.Group();
    const rightEye = new THREE.Group();
    for (const [group, x] of [[leftEye, -0.18], [rightEye, 0.18]] as const) {
      addMesh(group, new THREE.SphereGeometry(0.13, 18, 14), whiteMat, [0, 0, 0], [1, 1.05, 0.68]);
      const pupil = addMesh(group, new THREE.SphereGeometry(0.065, 16, 12), eyeMat, [0, -0.005, 0.085], [1, 1, 0.75]);
      const spark = addMesh(group, new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), [0.02, 0.02, 0.13]);
      group.position.set(x, 0.12, 0.39);
      group.userData.pupil = pupil;
      group.userData.spark = spark;
      head.add(group);
    }

    // Cejas: responsables de gran parte de la expresividad a escala pequeña.
    const leftBrow = addMesh(head, new THREE.BoxGeometry(0.19, 0.035, 0.04), browMat, [-0.18, 0.29, 0.42], undefined, [0, 0, -0.08]);
    const rightBrow = addMesh(head, new THREE.BoxGeometry(0.19, 0.035, 0.04), browMat, [0.18, 0.29, 0.42], undefined, [0, 0, 0.08]);

    // Nariz mínima y sonrisa clara, evitando rasgos minúsculos que se pierden.
    addMesh(head, new THREE.SphereGeometry(0.055, 12, 10), skinShadeMat, [0, -0.01, 0.49], [0.75, 0.72, 0.75]);
    const smile = addMesh(head, new THREE.TorusGeometry(0.11, 0.023, 8, 20, Math.PI * 0.9), mouthMat, [0, -0.16, 0.49]);
    smile.rotation.z = Math.PI + (Math.PI - Math.PI * 0.9) / 2;

    // Pequeño cuello para separar visualmente cabeza y torso.
    addMesh(body, new THREE.CylinderGeometry(0.16, 0.19, 0.18, 18), skinShadeMat, [0, 0.29, 0]);

    const grayables = [
      skinMat,
      skinShadeMat,
      helmetMat,
      helmetShadeMat,
      navyMat,
      vestMat,
      vestTrimMat,
      gloveMat,
      bootMat,
      browMat,
      mouthMat,
    ];
    const baseColors = grayables.map((material) => material.color.clone());

    let raf = 0;
    let running = document.visibilityState === "visible";
    const clock = new THREE.Clock();
    const current: AnimTargets = { ...STATE_TARGETS.idle };
    let nextBlinkAt = 1.1;
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    };
    window.addEventListener("resize", onResize);

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (!running) return;

      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const target = STATE_TARGETS[stateRef.current];
      const k = 1 - Math.exp(-dt * 7);
      (Object.keys(target) as (keyof AnimTargets)[]).forEach((key) => {
        current[key] = lerp(current[key], target[key], k);
      });

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const motion = reducedMotion ? 0.2 : 1;

      const breathe = 1 + Math.sin(t * current.breathSpeed) * current.breathAmp * motion;
      torso.scale.y = 1.08 * breathe;
      root.position.y =
        -0.05 +
        Math.sin(t * current.bobSpeed) * current.bobAmp * motion +
        (current.hopAmp > 0 ? Math.abs(Math.sin(t * 5)) * current.hopAmp * motion : 0);
      root.position.x = current.shakeAmp > 0 ? Math.sin(t * 28) * current.shakeAmp * motion : 0;
      root.rotation.y = Math.sin(t * 0.55) * 0.035 * motion;

      head.rotation.x = lerp(head.rotation.x, current.tiltX + Math.sin(t * current.lookSpeed) * 0.02 * motion, k);
      head.rotation.z = lerp(head.rotation.z, current.tiltZ * motion, k);

      const lookX = Math.sin(t * current.lookSpeed) * current.lookAmp * motion;
      const lookY = Math.cos(t * current.lookSpeed * 0.7) * current.lookAmp * 0.45 * motion;
      for (const eye of [leftEye, rightEye]) {
        eye.userData.pupil.position.x = lookX;
        eye.userData.pupil.position.y = lookY;
        eye.userData.spark.position.x = 0.02 + lookX;
        eye.userData.spark.position.y = 0.02 + lookY;
      }

      // Expresión por estado: las cejas hacen que approval/error/thinking se lean incluso en miniatura.
      const stateNow = stateRef.current;
      const approval = stateNow === "approval" ? 1 : 0;
      const error = stateNow === "error" ? 1 : 0;
      const thinking = stateNow === "thinking" ? 1 : 0;
      leftBrow.rotation.z = lerp(leftBrow.rotation.z, -0.08 - approval * 0.18 + error * 0.22 - thinking * 0.06, k);
      rightBrow.rotation.z = lerp(rightBrow.rotation.z, 0.08 + approval * 0.18 - error * 0.22 + thinking * 0.16, k);

      if (t >= nextBlinkAt && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.12;
        const scaleY = blinkT >= 1 ? 1 : 1 - Math.sin(Math.min(blinkT, 1) * Math.PI) * 0.92;
        leftEye.scale.y = scaleY;
        rightEye.scale.y = scaleY;
        if (blinkT >= 1) {
          blinkT = -1;
          const rate = Math.max(current.blinkRate, 0.03);
          nextBlinkAt = t + 1.6 + Math.random() * 2.8 * (1 - Math.min(rate, 1));
        }
      }

      const gray = current.gray;
      grayables.forEach((material, index) => {
        const base = baseColors[index];
        if (gray <= 0.01) {
          material.color.copy(base);
          return;
        }
        const lum = base.r * 0.3 + base.g * 0.59 + base.b * 0.11;
        material.color.setRGB(
          lerp(base.r, lum, gray),
          lerp(base.g, lum, gray),
          lerp(base.b, lum, gray)
        );
      });

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} aria-hidden="true" className="h-full w-full" />;
}
