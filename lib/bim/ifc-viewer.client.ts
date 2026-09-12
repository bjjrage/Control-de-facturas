// Viewer 3D mínimo para el tab BIM: orbit/pan/zoom, selección por click con
// raycasting, highlight del seleccionado y fit-to-selection/fit-all. Nada de
// edición, mediciones, clash detection ni 4D — eso está fuera de alcance a
// propósito (ver PR).
//
// Geometría vía web-ifc (LoadAllGeometry), render vía three.js. Un THREE.Group
// por elemento IFC, taggeado con userData.expressId = FlatMesh.expressID —
// ese mismo expressID es el que persistimos en bim_elements.express_id, así
// que la correspondencia viewer <-> bim_element es directa y unívoca.
"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as WebIFC from "web-ifc";

const HIGHLIGHT_COLOR = new THREE.Color(0xff7a00);

export interface IfcViewerHandle {
  loadFromBuffer(buffer: Uint8Array): Promise<{ elementCount: number }>;
  selectByExpressId(expressId: number | null): void;
  fitAll(): void;
  fitSelection(): void;
  dispose(): void;
}

interface ElementEntry {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  originalMaterials: THREE.Material[];
}

export function createIfcViewer(
  container: HTMLElement,
  options: { onSelect?: (expressId: number | null) => void } = {}
): IfcViewerHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f5);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(20, 20, 20);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(30, 50, 20);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-30, -10, -20);
  scene.add(dirLight2);

  const modelRoot = new THREE.Group();
  scene.add(modelRoot);

  const elementsByExpressId = new Map<number, ElementEntry>();
  let selectedExpressId: number | null = null;
  let api: WebIFC.IfcAPI | null = null;
  let modelID: number | null = null;
  let raf = 0;

  function resize() {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function buildGeometry(vertexData: Float32Array, indexData: Uint32Array): THREE.BufferGeometry {
    // web-ifc entrega los vértices intercalados [x,y,z, nx,ny,nz] por vértice.
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(vertexData.length / 2);
    const normals = new Float32Array(vertexData.length / 2);
    for (let i = 0; i < vertexData.length / 6; i++) {
      positions[i * 3] = vertexData[i * 6];
      positions[i * 3 + 1] = vertexData[i * 6 + 1];
      positions[i * 3 + 2] = vertexData[i * 6 + 2];
      normals[i * 3] = vertexData[i * 6 + 3];
      normals[i * 3 + 1] = vertexData[i * 6 + 4];
      normals[i * 3 + 2] = vertexData[i * 6 + 5];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indexData, 1));
    return geometry;
  }

  function raycastSelect(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(modelRoot.children, true);
    const hit = intersects.find((i) => typeof i.object.userData.expressId === "number");
    const expressId = hit ? (hit.object.userData.expressId as number) : null;
    selectByExpressId(expressId);
    options.onSelect?.(expressId);
  }
  renderer.domElement.addEventListener("click", (e) => raycastSelect(e.clientX, e.clientY));

  function resetHighlight() {
    if (selectedExpressId == null) return;
    const entry = elementsByExpressId.get(selectedExpressId);
    if (entry) {
      entry.meshes.forEach((mesh, i) => {
        mesh.material = entry.originalMaterials[i];
      });
    }
    selectedExpressId = null;
  }

  function selectByExpressId(expressId: number | null) {
    resetHighlight();
    if (expressId == null) return;
    const entry = elementsByExpressId.get(expressId);
    if (!entry) return;
    entry.meshes.forEach((mesh) => {
      const highlighted = (mesh.material as THREE.MeshLambertMaterial).clone();
      highlighted.emissive = HIGHLIGHT_COLOR;
      highlighted.emissiveIntensity = 0.6;
      mesh.material = highlighted;
    });
    selectedExpressId = expressId;
  }

  function boundsOf(objects: THREE.Object3D[]): THREE.Box3 | null {
    if (objects.length === 0) return null;
    const box = new THREE.Box3();
    for (const obj of objects) box.expandByObject(obj);
    return box;
  }

  function fitToBox(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const distance = maxDim * 1.8;
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    controls.target.copy(center);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function fitAll() {
    // Box3.expandByObject usa matrixWorld — sin esto, un fitAll() llamado
    // antes del primer render (ej. justo tras cargar el modelo) mide con la
    // matriz identidad en vez de la transformación real de cada elemento.
    modelRoot.updateMatrixWorld(true);
    const box = boundsOf(modelRoot.children);
    console.log("[bim-viewer-diag2] fitAll box =", box, "children=", modelRoot.children.length);
    if (box) fitToBox(box);
    console.log("[bim-viewer-diag2] camera after fitAll", camera.position.toArray(), "target", controls.target.toArray(), "near/far", camera.near, camera.far);
  }

  function fitSelection() {
    if (selectedExpressId == null) return fitAll();
    const entry = elementsByExpressId.get(selectedExpressId);
    if (!entry) return fitAll();
    modelRoot.updateMatrixWorld(true);
    const box = boundsOf(entry.meshes);
    if (box) fitToBox(box);
  }

  async function loadFromBuffer(buffer: Uint8Array): Promise<{ elementCount: number }> {
    api = new WebIFC.IfcAPI();
    api.SetWasmPath("/wasm/", true);
    await api.Init();
    modelID = api.OpenModel(buffer);
    if (modelID < 0) throw new Error("No se pudo abrir el modelo IFC para visualizarlo.");

    const geometryCache = new Map<number, THREE.BufferGeometry>();
    const flatMeshes = api.LoadAllGeometry(modelID);

    for (let i = 0; i < flatMeshes.size(); i++) {
      const flatMesh = flatMeshes.get(i);
      const group = new THREE.Group();
      group.userData.expressId = flatMesh.expressID;
      const meshes: THREE.Mesh[] = [];
      const originalMaterials: THREE.Material[] = [];

      for (let g = 0; g < flatMesh.geometries.size(); g++) {
        const placed = flatMesh.geometries.get(g);
        let geometry = geometryCache.get(placed.geometryExpressID);
        if (!geometry) {
          const ifcGeometry = api.GetGeometry(modelID, placed.geometryExpressID);
          const vertexData = api.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize());
          const indexData = api.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize());
          geometry = buildGeometry(vertexData, indexData);
          geometryCache.set(placed.geometryExpressID, geometry);
          ifcGeometry.delete();
        }

        const { x: r, y: gC, z: b, w: a } = placed.color;
        const material = new THREE.MeshLambertMaterial({
          color: new THREE.Color(r, gC, b),
          transparent: a < 1,
          opacity: a,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));
        mesh.userData.expressId = flatMesh.expressID;
        group.add(mesh);
        meshes.push(mesh);
        originalMaterials.push(material);
      }

      modelRoot.add(group);
      elementsByExpressId.set(flatMesh.expressID, { group, meshes, originalMaterials });
    }

    fitAll();
    return { elementCount: elementsByExpressId.size };
  }

  function dispose() {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    controls.dispose();
    for (const entry of elementsByExpressId.values()) {
      entry.meshes.forEach((m) => {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
      });
    }
    if (api && modelID != null) {
      try {
        api.CloseModel(modelID);
      } catch {
        // modelo ya cerrado
      }
    }
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  }

  return { loadFromBuffer, selectByExpressId, fitAll, fitSelection, dispose };
}
