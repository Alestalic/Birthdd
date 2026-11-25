import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { DisorderAudioEngine } from '../audio/audioEngine';
import {
  getActiveGreetingSign,
  type CameraPreset,
} from '../constants/greeting';
import { UnknownPleasuresWorld } from './pulsarGeometry';

export interface SceneHandle {
  triggerRipple: (x?: number, z?: number, strength?: number) => void;
  resetWaves: () => void;
}

interface PulsarCanvasProps {
  audioEngine: DisorderAudioEngine;
  cameraPreset: CameraPreset;
  presetVersion: number;
  sceneHandleRef: MutableRefObject<SceneHandle | null>;
  signsContainerRef: MutableRefObject<HTMLDivElement | null>;
  onPlaybackSync: (state: {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    activeSignId: string | null;
  }) => void;
}

// Module-scope reusable math helpers — zero GC inside render loop
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
const _hitPoint = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function getPresetPose(
  preset: CameraPreset,
  aspect: number,
  outPos: THREE.Vector3,
  outTarget: THREE.Vector3,
): void {
  const isPortrait = aspect < 0.85;

  if (preset === 'side') {
    if (isPortrait) {
      // Portrait mobile side-view: sweeps across the 3D ridges in the lower-middle
      // frame, opening a clean dark sky above for the active birthday wish.
      outPos.set(-16.2, 6.2, 13.8);
      outTarget.set(0.3, 2.35, -0.3);
    } else {
      outPos.set(-13.8, 4.9, 10.6);
      outTarget.set(0.5, 1.45, -0.4);
    }
  } else if (preset === 'cover') {
    if (isPortrait) {
      outPos.set(0.0, 11.4, 19.6);
      outTarget.set(0.0, 1.55, 0.2);
    } else {
      outPos.set(0.0, 9.2, 15.2);
      outTarget.set(0.0, 1.05, 0.0);
    }
  } else {
    if (isPortrait) {
      outPos.set(-10.4, 2.9, 10.4);
      outTarget.set(0.5, 1.75, -1.2);
    } else {
      outPos.set(-9.2, 2.55, 8.8);
      outTarget.set(0.6, 1.3, -1.2);
    }
  }
}

export function PulsarCanvas({
  audioEngine,
  cameraPreset,
  presetVersion,
  sceneHandleRef,
  signsContainerRef,
  onPlaybackSync,
}: PulsarCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const presetRef = useRef<CameraPreset>(cameraPreset);
  const transitionActiveRef = useRef<boolean>(false);
  const onPlaybackSyncRef = useRef(onPlaybackSync);
  onPlaybackSyncRef.current = onPlaybackSync;

  useEffect(() => {
    presetRef.current = cameraPreset;
    transitionActiveRef.current = true;
  }, [cameraPreset, presetVersion]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x050507, 1);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050507);
    scene.fog = new THREE.FogExp2(0x050507, 0.031);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmremGenerator.dispose();

    // Warm/Cool 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x0b0b12, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4ea, 1.55);
    keyLight.position.set(-10, 16, 12);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -12;
      keyLight.shadow.camera.right = 12;
      keyLight.shadow.camera.top = 12;
      keyLight.shadow.camera.bottom = -12;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa5b4fc, 0.9);
    rimLight.position.set(12, 8, -14);
    scene.add(rimLight);

    const aspect = width / Math.max(1, height);
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.2, 120);
    getPresetPose(presetRef.current, aspect, _targetCamPos, _targetLookAt);
    camera.position.copy(_targetCamPos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(_targetLookAt);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 8.5;
    controls.maxDistance = 30.0;
    controls.minPolarAngle = 0.24;
    controls.maxPolarAngle = Math.PI * 0.475;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.7;
    controls.update();

    const handleControlStart = () => {
      transitionActiveRef.current = false;
    };
    controls.addEventListener('start', handleControlStart);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const world = new UnknownPleasuresWorld(maxAnisotropy);
    scene.add(world.root);

    sceneHandleRef.current = {
      triggerRipple: (x = 0, z = 0, strength = 1.25) => {
        world.triggerRipple(x, z, strength);
      },
      resetWaves: () => {
        world.resetWaves();
      },
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Tap-to-ripple interaction (distinguish taps from camera drags)
    let pointerDownX = 0;
    let pointerDownY = 0;
    let pointerDownTime = 0;

    const onPointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      pointerDownTime = performance.now();
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
      const elapsedTap = performance.now() - pointerDownTime;
      if (dist < 10 && elapsedTap < 360) {
        const rect = renderer.domElement.getBoundingClientRect();
        _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_pointerNdc, camera);
        if (_raycaster.ray.intersectPlane(_groundPlane, _hitPoint)) {
          world.triggerRipple(_hitPoint.x, _hitPoint.z, 1.35);
        } else {
          world.triggerRipple(0, 0, 1.2);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let contextLost = false;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      );
      transitionActiveRef.current = true;
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let elapsed = 0;
    let lastUiSync = 0;
    let prevActiveSignId: string | null = null;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;

      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += prefersReducedMotion ? dt * 0.25 : dt;

      const audioFrame = audioEngine.sample(elapsed, dt);
      const activeSign = getActiveGreetingSign(audioFrame.currentTime);
      const activeSignId = activeSign ? activeSign.id : null;

      // Fire a subtle radial wave from the exact center whenever a new wish arrives
      if (activeSignId && activeSignId !== prevActiveSignId) {
        world.triggerRipple(0, 0, 1.45);
      }
      prevActiveSignId = activeSignId;

      if (transitionActiveRef.current) {
        getPresetPose(presetRef.current, camera.aspect, _targetCamPos, _targetLookAt);

        if (!prefersReducedMotion && !isSoftwareGl) {
          const sway = audioFrame.isPlaying ? 1 : 0.45;
          _targetCamPos.x += Math.sin(elapsed * 0.34) * 0.55 * sway;
          _targetCamPos.y +=
            Math.cos(elapsed * 0.48) * 0.22 * sway + audioFrame.beatKick * 0.14;
        }

        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          _targetCamPos.x,
          3.4,
          dt,
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          _targetCamPos.y,
          3.4,
          dt,
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          _targetCamPos.z,
          3.4,
          dt,
        );

        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          _targetLookAt.x,
          3.8,
          dt,
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          _targetLookAt.y,
          3.8,
          dt,
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          _targetLookAt.z,
          3.8,
          dt,
        );

        if (
          camera.position.distanceToSquared(_targetCamPos) < 0.002 &&
          controls.target.distanceToSquared(_targetLookAt) < 0.002
        ) {
          transitionActiveRef.current = false;
        }
      } else if (!prefersReducedMotion && audioFrame.isPlaying) {
        const targetFov = 42 + audioFrame.beatKick * 1.2;
        if (Math.abs(camera.fov - targetFov) > 0.02) {
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 7.5, dt);
          camera.updateProjectionMatrix();
        }
      }

      controls.update();

      const isWarmMood =
        activeSign?.variant === 'name' || activeSign?.variant === 'love';
      world.update(audioFrame, elapsed, dt, activeSign !== null, isWarmMood);

      // Subtle 3D parallax sway on the floating wish sign driven directly via DOM transform
      if (signsContainerRef.current && !prefersReducedMotion) {
        const azimuth = Math.atan2(camera.position.x, camera.position.z);
        const shiftX = THREE.MathUtils.clamp((azimuth + 0.85) * 9, -12, 12);
        const shiftY = THREE.MathUtils.clamp(
          (camera.position.y - 5.5) * -1.3 - audioFrame.beatKick * 2.4,
          -10,
          10,
        );
        signsContainerRef.current.style.transform = `translate3d(${shiftX.toFixed(1)}px, ${shiftY.toFixed(1)}px, 0)`;
      }

      if (!contextLost) {
        renderer.render(scene, camera);
      }

      if (now - lastUiSync > 90) {
        lastUiSync = now;
        onPlaybackSyncRef.current({
          currentTime: audioFrame.currentTime,
          duration: audioFrame.duration,
          isPlaying: audioFrame.isPlaying,
          activeSignId,
        });
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('start', handleControlStart);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      sceneHandleRef.current = null;
      controls.dispose();
      world.dispose();
      envRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [audioEngine, sceneHandleRef, signsContainerRef]);

  if (webglUnavailable) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#050507] px-6 text-center">
        <svg
          viewBox="0 0 320 200"
          className="w-72 max-w-full opacity-80"
          aria-hidden="true"
        >
          {Array.from({ length: 18 }).map((_, i) => {
            const y = 24 + i * 9;
            return (
              <path
                key={i}
                d={`M 16 ${y} L 96 ${y} Q 128 ${y - 12 - (i % 4) * 5} 160 ${y - 4} Q 192 ${y - 16 - (i % 3) * 6} 224 ${y} L 304 ${y}`}
                fill="#050507"
                stroke="#f3f3f5"
                strokeWidth="1.2"
              />
            );
          })}
        </svg>
      </div>
    );
  }

  return <div ref={mountRef} className="fixed inset-0 w-full h-full z-0" />;
}
