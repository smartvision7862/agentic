// Rotating wireframe globe — the HUD centerpiece and Jarvis trigger.
// Decoupled from app.js/hud.js via window events:
//   emits  "globe:click"            when the user taps the globe
//   listens "assistant:state" {state} → idle | listening | thinking | speaking
import * as THREE from "three";

const canvas = document.getElementById("globeCanvas");
const wrap = document.getElementById("globeClick");
if (canvas && wrap) initGlobe(canvas, wrap);

function initGlobe(canvas, wrap) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 3.0;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const globe = new THREE.Group();
  scene.add(globe);

  const RED = new THREE.Color(0xff2b2b);
  const WHITE = new THREE.Color(0xffffff);

  // Solid dark sphere core (so the back wireframe is occluded).
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.98, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x0a0608 })
  );
  globe.add(core);

  // Lat/long wireframe shell.
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 28, 20)),
    new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0.42 })
  );
  globe.add(wire);

  // Glowing surface points.
  const points = new THREE.Points(
    new THREE.SphereGeometry(1.01, 40, 30),
    new THREE.PointsMaterial({ color: WHITE, size: 0.012, transparent: true, opacity: 0.8 })
  );
  globe.add(points);

  // Equator highlight ring.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.18, 1.2, 96),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = Math.PI / 2.2;
  globe.add(ring);

  globe.rotation.z = 0.36; // subtle axial tilt

  // Expanding "sound waves" — concentric rings that pulse out on mic input.
  const waves = [];
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.27, 96),
      new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    w.rotation.x = Math.PI / 2.2;
    w.userData.phase = i / 3;
    globe.add(w);
    waves.push(w);
  }

  let baseSpeed = 0.0016;
  let speed = baseSpeed;
  let targetOpacity = 0.42;
  let micLevel = 0;      // 0..1 live mic amplitude
  let micSmooth = 0;

  function resize() {
    const w = wrap.clientWidth || 360;
    const h = wrap.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  // wrap can resize without a window resize (grid reflow) — observe it.
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);

  function animate() {
    requestAnimationFrame(animate);
    globe.rotation.y += speed;
    speed += (baseSpeed - speed) * 0.05;
    wire.material.opacity += (targetOpacity - wire.material.opacity) * 0.08;
    ring.rotation.z += 0.002;

    // Smooth the mic level and use it to pulse the globe + emit waves.
    micSmooth += (micLevel - micSmooth) * 0.25;
    const pulse = 1 + micSmooth * 0.12;
    globe.scale.setScalar(pulse);
    points.material.opacity = 0.55 + micSmooth * 0.45;
    const t = performance.now() / 1000;
    for (const w of waves) {
      const p = (t * 0.5 + w.userData.phase) % 1;          // 0→1 expansion cycle
      const s = 1 + p * (0.5 + micSmooth * 1.6);
      w.scale.setScalar(s);
      w.material.opacity = Math.max(0, (1 - p)) * 0.5 * micSmooth;
    }
    renderer.render(scene, camera);
  }
  animate();

  wrap.addEventListener("click", () => window.dispatchEvent(new CustomEvent("globe:click")));

  window.addEventListener("assistant:state", (e) => {
    const s = e.detail?.state;
    if (s === "listening") { speed = 0.012; targetOpacity = 0.85; wire.material.color.copy(WHITE); }
    else if (s === "thinking") { speed = 0.03; targetOpacity = 0.7; wire.material.color.copy(RED); }
    else if (s === "speaking") { speed = 0.008; targetOpacity = 0.6; wire.material.color.copy(RED); }
    else { targetOpacity = 0.42; wire.material.color.copy(RED); micLevel = 0; } // idle
  });

  // Live mic amplitude (0..1) from hud.js → drives the radiating waves.
  window.addEventListener("assistant:level", (e) => {
    micLevel = Math.max(0, Math.min(1, e.detail?.level || 0));
  });
}
