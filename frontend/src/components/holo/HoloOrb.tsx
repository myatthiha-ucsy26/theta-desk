// The three.js half of the holo band: the orb, one orbit per open position, a grid floor and a
// drift of particles. Loaded on demand so no other template pays for it.
import { Sparkles } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import type { OrbParams } from "../../lib/orb";

const TONES: Record<OrbParams["tone"], { core: string; glow: string }> = {
  profit: { core: "#22d3ee", glow: "#10b981" },
  loss: { core: "#fb7185", glow: "#be123c" },
  flat: { core: "#8b5cf6", glow: "#3b82f6" },
};

const RING_COLORS = ["#22d3ee", "#a855f7", "#34d399", "#60a5fa"];
/** How far the orb leans after the pointer, in radians (about 6°). */
const PARALLAX = 0.1;

function Orb({ rings, tone, spin, still }: OrbParams & { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const { core, glow } = TONES[tone];

  // Each orbit gets its own tilt and pace, so a full book reads as a gyroscope, not a stack.
  const orbits = useMemo(
    () =>
      Array.from({ length: rings }, (_, i) => ({
        radius: 1.25 + i * 0.16,
        tilt: [Math.PI / 2 + ((i % 3) - 1) * 0.35, (i * Math.PI) / rings, 0] as [number, number, number],
        pace: (i % 2 ? -1 : 1) * (1 + i * 0.15),
        color: RING_COLORS[i % RING_COLORS.length],
      })),
    [rings],
  );

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (!still) {
      g.rotation.y += delta * spin;
      ringRefs.current.forEach((m, i) => {
        if (m) m.rotation.z += delta * spin * orbits[i].pace;
      });
    }
    // Scrolling down past the band turns the orb a quarter further and lets it sink back.
    const scrolled = Math.min(1, window.scrollY / 320);
    const tx = still ? 0 : -state.pointer.y * PARALLAX + scrolled * (Math.PI / 2) * 0.35;
    const tz = still ? 0 : -state.pointer.x * PARALLAX;
    g.rotation.x += (tx - g.rotation.x) * 0.06;
    g.rotation.z += (tz - g.rotation.z) * 0.06;
    g.position.z += (-scrolled * 1.5 - g.position.z) * 0.08;
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.85, 64, 64]} />
        <meshStandardMaterial color={core} emissive={glow} emissiveIntensity={0.35} roughness={0.2} metalness={0.55} />
      </mesh>
      {/* A holographic lattice just off the surface. A smooth ball turning under fixed lights
          looks the same as one standing still; the lattice is what lets the spin be seen. */}
      <mesh scale={1.06}>
        <icosahedronGeometry args={[0.85, 2]} />
        <meshBasicMaterial color="#e0e7ff" wireframe transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {orbits.map((o, i) => (
        <mesh key={i} ref={(m) => { ringRefs.current[i] = m; }} rotation={o.tilt}>
          <torusGeometry args={[o.radius, 0.012, 12, 160]} />
          <meshBasicMaterial color={o.color} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export default function HoloOrb({ params, still }: { params: OrbParams; still: boolean }) {
  return (
    <Canvas camera={{ position: [0, 2.2, 5.4], fov: 42 }} onCreated={({ camera }) => camera.lookAt(0, -0.3, 0)} gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 3]} intensity={40} color="#a5f3fc" />
      <pointLight position={[-3, -1, 2]} intensity={25} color="#a855f7" />
      <Orb {...params} still={still} />
      <gridHelper args={[14, 28, "#3b82f6", "#1e3a8a"]} position={[0, -1.7, 0]}>
        <lineBasicMaterial attach="material" vertexColors transparent opacity={0.45} />
      </gridHelper>
      {!still && <Sparkles count={60} scale={[6, 3, 3]} size={2} speed={0.3} color="#a5b4fc" opacity={0.6} />}
      <fog attach="fog" args={["#060a14", 4, 11]} />
    </Canvas>
  );
}
