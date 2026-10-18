import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import type { ActiveBus } from '@/lib/types';

export const NTU_CENTER: [number, number] = [103.6835, 1.3455];
const SCALE = 2.5;

// Bus body dimensions in metres (before SCALE): a 12 m Singapore city bus.
const LENGTH = 12;
const WIDTH = 2.5;
const HEIGHT = 3.2;

function buildBusMesh(): THREE.Group {
  const group = new THREE.Group();
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, LENGTH, HEIGHT * 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  chassis.position.z = HEIGHT * 0.4 + 0.4;
  group.add(chassis);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(WIDTH * 1.02, LENGTH * 1.01, HEIGHT * 0.2), new THREE.MeshBasicMaterial({ color: 0xff7200 }));
  roof.position.z = HEIGHT * 0.9 + 0.4;
  group.add(roof);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(WIDTH * 1.01, LENGTH * 0.9, HEIGHT * 0.25), new THREE.MeshBasicMaterial({ color: 0x1e293b }));
  windows.position.z = HEIGHT * 0.6 + 0.4;
  group.add(windows);

  const lightGeo = new THREE.BoxGeometry(0.5, 0.15, 0.35);
  for (const x of [-WIDTH / 2 + 0.4, WIDTH / 2 - 0.4]) {
    const head = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d6 }));
    head.position.set(x, LENGTH / 2 + 0.05, 1.0);
    group.add(head);
    const tail = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    tail.position.set(x, -LENGTH / 2 - 0.05, 1.0);
    group.add(tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const y of [-LENGTH / 2 + 2, LENGTH / 2 - 2.5]) {
    for (const x of [-WIDTH / 2, WIDTH / 2]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, y, 0.5);
      group.add(wheel);
    }
  }
  return group;
}

/**
 * MapLibre custom layer drawing live LTA buses as 3D Three.js meshes.
 * Everything is placed in local metres relative to NTU_CENTER so 32-bit float
 * shaders keep full precision; the Mercator transform is done in float64 on the CPU.
 */
export class ThreeBusLayer implements CustomLayerInterface {
  id = 'ntu-bus-3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map?: MapLibreMap;
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private template = buildBusMesh();
  private meshes = new Map<string, THREE.Group>();
  private origin = maplibregl.MercatorCoordinate.fromLngLat(NTU_CENTER, 0);
  private metersPerUnit = 1 / this.origin.meterInMercatorCoordinateUnits();

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.meshes.clear();
  }

  setBuses(buses: ActiveBus[]) {
    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.id);
      let mesh = this.meshes.get(bus.id);
      if (!mesh) {
        mesh = this.template.clone();
        mesh.scale.setScalar(SCALE);
        this.meshes.set(bus.id, mesh);
        this.scene.add(mesh);
      }
      const mc = maplibregl.MercatorCoordinate.fromLngLat([bus.lng, bus.lat], 0);
      // Mercator y grows southward; local frame is x=east, y=north, z=up.
      mesh.position.set((mc.x - this.origin.x) * this.metersPerUnit, -(mc.y - this.origin.y) * this.metersPerUnit, 0.5);
      mesh.rotation.z = (-bus.bearing * Math.PI) / 180;
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
    this.map?.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput | Float64Array) {
    if (!this.renderer || this.meshes.size === 0) return;
    const raw = options instanceof Float64Array ? options : (options?.defaultProjectionData?.mainMatrix ?? (options as CustomRenderMethodInput).modelViewProjectionMatrix);
    const m = new THREE.Matrix4().fromArray(raw as ArrayLike<number> as number[]);
    const s = 1 / this.metersPerUnit;
    const l = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(s, -s, s));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    // No triggerRepaint() here: buses only move when setBuses() runs (every 5 s), which already
    // requests a repaint. Repainting from render() kept the whole map redrawing at 60 fps forever.
  }
}
