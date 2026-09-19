// The three.js half of a 3D surface. Loaded on demand so the rest of the app never
// pays for three.js. Matte porcelain: vertex colours, a hairline grid on top, and the
// zero-P&L floor the surface stands on.
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Mesh } from "../lib/surface";
import { PALETTES } from "../lib/colors";
import { usePrefersReducedMotion } from "../lib/motion";
import { nearestCell } from "../lib/surfaceLabels";
import { useTheme } from "../lib/theme";

const CAMERA: [number, number, number] = [1.8, 1.55, 1.8];
const TARGET: [number, number, number] = [0, 0.48, 0];
const CAMERA_DISTANCE = Math.hypot(
  CAMERA[0] - TARGET[0],
  CAMERA[1] - TARGET[1],
  CAMERA[2] - TARGET[2],
);

/** The grid runs x,z over [-1, 1]; these are the same mappings the mesh was built from. */
const xOf = (col: number, cols: number) => (cols < 2 ? 0 : (col / (cols - 1)) * 2 - 1);
const zOf = (row: number, rows: number) => (rows < 2 ? 0 : (row / (rows - 1)) * 2 - 1);

/** About five labels per axis: enough to read the scale, few enough not to crowd. */
function ticks(labels: string[]): { i: number; label: string }[] {
  const n = labels.length;
  if (n <= 5) return labels.map((label, i) => ({ i, label }));
  const idx = new Set<number>();
  for (let k = 0; k < 5; k++) idx.add(Math.round((k * (n - 1)) / 4));
  return [...idx].sort((a, b) => a - b).map((i) => ({ i, label: labels[i] }));
}

export interface SurfaceCanvasProps {
  mesh: Mesh;
  rowLabels: string[];
  colLabels: string[];
  colorFor: (normalized: number, raw: number) => string;
  markers?: { col?: number; label: string }[];
  onHover: (cell: { row: number; col: number } | null) => void;
}

function Surface({ mesh, colorFor, onHover }: Pick<SurfaceCanvasProps, "mesh" | "colorFor" | "onHover">) {
  // The mockup's cyan, and the one colour that reads over both surfaces this draws: it leaves
  // the press-blue IV ramp behind on saturation alone, and the red/green P&L diverge on hue.
  const wire = PALETTES[useTheme()].accent;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const span = mesh.max - mesh.min || 1;
    const colors = new Float32Array(mesh.values.length * 3);
    const c = new THREE.Color();
    for (let i = 0; i < mesh.values.length; i++) {
      // The height is the value normalised; put it back on its own scale to colour it.
      c.set(colorFor(mesh.values[i], mesh.min + mesh.values[i] * span));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [mesh, colorFor]);

  return (
    <>
      <mesh
        geometry={geometry}
        onPointerMove={(e) => onHover(nearestCell(e.point.x, e.point.z, mesh.rows, mesh.cols))}
        onPointerOut={() => onHover(null)}
      >
        {/* Phong, at the mockup's shininess, rather than standard: the sheen it puts on a face
            turned away from the key light is what keeps the far side from going flat. */}
        <meshPhongMaterial
          vertexColors
          shininess={70}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <mesh geometry={geometry} renderOrder={1}>
        <meshBasicMaterial
          wireframe
          color={wire}
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function AxisLabels({ mesh, rowLabels, colLabels }: Pick<SurfaceCanvasProps, "mesh" | "rowLabels" | "colLabels">) {
  // Each axis is named along the near edge it runs down, so the two sets never share a corner.
  // Labelled at a fixed size: a reading like "7 days" wrapping to two lines stops being a tick.
  const TICK = "pointer-events-none whitespace-nowrap tabular-nums text-ink-2";
  return (
    <>
      {ticks(colLabels).map(({ i, label }) => (
        <Html key={`col-${i}`} position={[xOf(i, mesh.cols), 0, 1.32]} center className={TICK} style={{ fontSize: 11 }}>
          {label}
        </Html>
      ))}
      {ticks(rowLabels).map(({ i, label }) => (
        <Html key={`row-${i}`} position={[1.32, 0, zOf(i, mesh.rows)]} center className={TICK} style={{ fontSize: 11 }}>
          {label}
        </Html>
      ))}
    </>
  );
}

/** The node, and the halo the mockup's spot marker pulses out around it. */
const DOT = 0.014;
const HALO_IN = DOT * 1.22;
const HALO_OUT = DOT * 1.67;
/** Hairline-thin: the pole is a reading of height, not a shape of its own. */
const POLE = 0.0035;
/** The mockup rings the node in a cyan brighter than the node itself, so the pulse reads. */
const HALO_INK = "#00f2fe";
/**
 * The mockup's counter-light. Emerald rather than the theme's profit ink: this is a light
 * colour, and the profit ink is dark enough that it would read as a shadow instead.
 */
const EMERALD = "#10b981";
/**
 * three's lights have been physical since r155: an intensity of 1 is divided by pi on its way
 * into the diffuse term. The mockup was written against r125, before that, so the numbers it
 * lights with are about three times brighter than the same numbers are here — and the pastel,
 * faintly blown-out surface it gets from that is the whole look. Scaled back up to match.
 */
const LEGACY = Math.PI;

/**
 * One point marked on the surface: a node over the near edge, a pulse ring round it and a pole
 * down to the zero plane, which is how the mockup draws its spot.
 *
 * The near edge, not the far one — the surface in front of a far-edge node hides it, which is
 * all but the outermost one here. The pole is the part that carries information: it reads the
 * node's height as a distance above the floor rather than as a dot floating in space. No name of
 * its own, either: at this camera the marks for spot, short strike and breakeven land within a
 * few pixels of each other, so the names are read off the strip under the canvas.
 */
function Marker({ col, cols, y }: { col: number; cols: number; y: number }) {
  const accent = PALETTES[useTheme()].accent;
  const reduced = usePrefersReducedMotion();
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const elapsed = useRef(0);

  // The mockup's pulse: the halo swells outward and fades as it goes. Held still, at full
  // opacity, for anyone who has asked for less motion.
  useFrame((_, delta) => {
    elapsed.current += delta;
    const mesh = ring.current;
    const material = halo.current;
    if (!mesh || !material) return;
    const s = reduced ? 1 : 1 + Math.sin(elapsed.current * 3) * 0.25;
    mesh.scale.setScalar(s);
    material.opacity = 0.8 - (s - 1) * 1.5;
  });

  const x = xOf(col, cols);
  const top = y + 0.03;
  // A hair clear of the mesh's own edge, so the pole is not half swallowed by the surface behind it.
  const z = 1.006;

  return (
    <>
      <mesh position={[x, y / 2, z]}>
        <cylinderGeometry args={[POLE, POLE, Math.max(y, 0.002), 8]} />
        <meshBasicMaterial color={accent} transparent opacity={0.5} />
      </mesh>
      <mesh position={[x, top, z]}>
        <sphereGeometry args={[DOT, 20, 20]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <mesh ref={ring} position={[x, top, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[HALO_IN, HALO_OUT, 32]} />
        <meshBasicMaterial ref={halo} color={HALO_INK} side={THREE.DoubleSide} transparent opacity={0.8} />
      </mesh>
    </>
  );
}

/**
 * The zero-P&L floor. Without it the surface floats in empty space and its height reads as a
 * shape rather than as a distance from the worst case, which is what the numbers actually are.
 */
function Floor() {
  const { line, accent } = PALETTES[useTheme()];
  return (
    // The centre lines take the accent, as the mockup's grid helper does: they are the two
    // zero axes, and they are worth telling apart from the ticks around them.
    <gridHelper args={[2.2, 11, accent, line]}>
      <lineBasicMaterial attach="material" vertexColors transparent opacity={0.22} toneMapped={false} />
    </gridHelper>
  );
}

export default function SurfaceCanvas({
  mesh,
  rowLabels,
  colLabels,
  colorFor,
  markers = [],
  onHover,
}: SurfaceCanvasProps) {
  // Only the marks that landed on a column: a value off the ends of the grid has nowhere to sit.
  const placed = markers.filter((m): m is { col: number; label: string } => m.col !== undefined);
  const accent = PALETTES[useTheme()].accent;

  return (
    <Canvas
      camera={{ position: CAMERA, fov: 40 }}
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      // Untone-mapped, as the mockup renders: a filmic curve would desaturate the palette out
      // from under the numbers, and these colours are chosen to be read, not photographed.
      flat
    >
      {/* The mockup's rig, and the thing that actually gives the scene its colour: a white
          fill, the cyan key from the front right, and an emerald counter-light behind. Under
          white light alone the surface reads as neutral grey whatever the palette says. */}
      <ambientLight intensity={0.85 * LEGACY} />
      <directionalLight color={accent} position={[1.5, 2.5, 1]} intensity={1.2 * LEGACY} />
      <directionalLight color={EMERALD} position={[-1.5, 1, -1]} intensity={0.9 * LEGACY} />
      <Surface mesh={mesh} colorFor={colorFor} onHover={onHover} />
      <Floor />
      <AxisLabels mesh={mesh} rowLabels={rowLabels} colLabels={colLabels} />
      {placed.map((m) => (
        <Marker
          key={m.label}
          col={m.col}
          cols={mesh.cols}
          y={mesh.values[(mesh.rows - 1) * mesh.cols + m.col] ?? 0}
        />
      ))}
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={CAMERA_DISTANCE * 0.6}
        maxDistance={CAMERA_DISTANCE * 2}
        maxPolarAngle={Math.PI / 2 - 0.06}
        target={TARGET}
      />
    </Canvas>
  );
}