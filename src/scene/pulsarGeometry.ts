import * as THREE from 'three';
import { SPECTRUM_BINS, type AudioFrameData } from '../audio/audioEngine';

export const RIDGE_COUNT = 68;
export const SAMPLES_PER_RIDGE = 180;
export const FIELD_WIDTH = 13.4;
export const FIELD_DEPTH = 16.8;

interface RowMicroProfile {
  /** Tiny deterministic FFT bin shift so adjacent lines stay nearly identical yet organic */
  binShift: number;
  /** Subtle horizontal micro-shift of center peak */
  centerShift: number;
  /** Organic gain variation around 1.0 (0.89..1.11) */
  gain: number;
  /** Subtle needle-comb phase offset for realistic 3D depth texture */
  combPhase: number;
}

interface CentralBeacon {
  group: THREE.Group;
  stem: THREE.Mesh;
  innerRing: THREE.Mesh;
  outerRing: THREE.Mesh;
  tip: THREE.Mesh;
  stemMat: THREE.MeshStandardMaterial;
  innerRingMat: THREE.MeshBasicMaterial;
  outerRingMat: THREE.MeshBasicMaterial;
  tipMat: THREE.MeshBasicMaterial;
  flare: number;
}

function createStarTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.28, 'rgba(244, 244, 248, 0.72)');
  grad.addColorStop(0.65, 'rgba(210, 214, 224, 0.14)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.5,
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.32)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBrushedDeckTexture(anisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#09090d';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y += 2) {
    const shade =
      10 + Math.floor(Math.sin(y * 0.43) * 3 + (y % 4 === 0 ? 2 : 0));
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 3})`;
    ctx.fillRect(0, y, w, 1);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let i = 16; i < w; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 6);
    ctx.lineTo(i, 16);
    ctx.moveTo(i, h - 6);
    ctx.lineTo(i, h - 16);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Deterministic hash in [-1, 1] for subtle per-row organic variation.
 */
function hashSigned(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Synchronous 3D Unknown Pleasures Equalizer:
 * - All 68 lines react simultaneously in real time to live FFT audio (zero row lag).
 * - Dense, razor-sharp needle spikes concentrate in the center of every line and
 *   taper smoothly down to flat margins toward the left and right edges.
 * - Subtle deterministic micro-variation per line preserves organic 3D depth while
 *   keeping the entire stack jumping in unison.
 */
export class UnknownPleasuresWorld {
  public readonly root = new THREE.Group();
  private readonly ridgeGeometries: THREE.BufferGeometry[] = [];
  private readonly ridgeMaterial: THREE.ShaderMaterial;

  // Precomputed per-sample horizontal coordinates and center-weighted equalizer envelopes
  private readonly sampleCentered = new Float32Array(SAMPLES_PER_RIDGE);
  private readonly sampleBaseBin = new Float32Array(SAMPLES_PER_RIDGE);
  private readonly sampleEnvelope = new Float32Array(SAMPLES_PER_RIDGE);
  private readonly rowProfiles: RowMicroProfile[] = [];

  // Reusable per-frame base equalizer spike curve across X (zero GC)
  private readonly baseSpikeCurve = new Float32Array(SAMPLES_PER_RIDGE);
  private readonly prevHeights: Float32Array[] = [];

  private readonly beacon: CentralBeacon;
  private readonly starPoints: THREE.Points;
  private readonly starBaseY: Float32Array;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private boostPulse = 0;
  private centerHeight = 0.25;

  constructor(maxAnisotropy: number) {
    // 1. Precompute horizontal sample tables (center x=0 -> tallest sharp spikes, edges -> flat calm)
    for (let s = 0; s < SAMPLES_PER_RIDGE; s++) {
      const u = s / (SAMPLES_PER_RIDGE - 1);
      const c = u * 2 - 1; // [-1, 1]
      const absC = Math.abs(c);

      this.sampleCentered[s] = c;

      // Symmetric frequency mapping: center gets punchy bass/snare/low-mid bins,
      // stepping outward across upper mids & hi-hats toward the tapering flanks.
      const binRatio = Math.min(1, absC / 0.78);
      this.sampleBaseBin[s] = Math.pow(binRatio, 1.15) * (SPECTRUM_BINS - 2);

      // Center-peaked Gaussian equalizer envelope × crisp flat outer margin fade
      // Note: THREE.MathUtils.smoothstep(x, min, max) requires min < max!
      const bell = Math.exp(-(c * c) / 0.145);
      const shoulder = 0.3 * Math.exp(-Math.pow(absC - 0.25, 2) / 0.048);
      const edgeCalm = 1 - THREE.MathUtils.smoothstep(absC, 0.44, 0.92);
      this.sampleEnvelope[s] = (bell + shoulder) * edgeCalm;
    }

    // 2. Precompute subtle per-row micro-profiles so all 68 rows move in unison
    // with just enough organic character to look deeply 3D from the side-view.
    for (let r = 0; r < RIDGE_COUNT; r++) {
      const rowNorm = r / (RIDGE_COUNT - 1);
      const zCenterBoost = 1.0 + 0.07 * Math.cos((rowNorm - 0.5) * Math.PI);
      this.rowProfiles.push({
        binShift: hashSigned(r * 1.7 + 0.3) * 1.65,
        centerShift: hashSigned(r * 3.1 + 2.4) * 0.022,
        gain: (0.91 + (hashSigned(r * 5.3 + 1.1) * 0.5 + 0.5) * 0.19) * zCenterBoost,
        combPhase: hashSigned(r * 7.9 + 4.2) * 0.85,
      });
      this.prevHeights.push(new Float32Array(SAMPLES_PER_RIDGE));
    }

    // 3. Hidden-line occlusion obsidian skirt + anti-aliased crisp white crest ink shader
    this.ridgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBeat: { value: 0 },
        uWarmth: { value: 0 },
        uFogColor: { value: new THREE.Color(0x050507) },
        uFogDensity: { value: 0.029 },
      },
      vertexShader: /* glsl */ `
        attribute float aCrestDist;
        attribute float aCenterNorm;
        varying float vCrestDist;
        varying float vCenterNorm;
        varying float vHeight;
        varying float vFogDepth;

        void main() {
          vCrestDist = aCrestDist;
          vCenterNorm = aCenterNorm;
          vHeight = position.y;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vFogDepth = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uBeat;
        uniform float uWarmth;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        varying float vCrestDist;
        varying float vCenterNorm;
        varying float vHeight;
        varying float vFogDepth;

        void main() {
          // Uniform crisp anti-aliased white ink stroke across needle peaks & flat edges
          float fw = max(fwidth(vCrestDist), 0.0022);
          float lineCore = 1.0 - smoothstep(fw * 0.5, fw * 2.05, vCrestDist);

          // Crisp vertical peak luminance right below sharp needle tips
          float centerWeight = exp(-vCenterNorm * vCenterNorm * 3.0);
          float tipGlow = exp(-vCrestDist * 7.5) * smoothstep(0.35, 2.5, vHeight) * (0.14 + centerWeight * (0.16 + uBeat * 0.28));

          // Pitch-obsidian opaque skirt for unmistakable Unknown Pleasures occlusion
          vec3 obsidian = vec3(0.019, 0.02, 0.028);
          float slopeShade = smoothstep(0.0, 2.8, vHeight) * exp(-vCrestDist * 1.65) * 0.05;

          // Pure white silver ink, gently warming on towering peaks during tender moments
          vec3 pureInk = vec3(0.96, 0.97, 0.99);
          vec3 warmInk = vec3(1.0, 0.85, 0.89);
          float crestWarm = uWarmth * centerWeight * smoothstep(0.55, 2.4, vHeight) * 0.65;
          vec3 inkColor = mix(pureInk, warmInk, crestWarm);

          float inkBrightness = mix(0.84, 1.06 + uBeat * 0.14, centerWeight);
          vec3 surfaceColor = obsidian + vec3(slopeShade) + inkColor * tipGlow;
          vec3 finalColor = mix(surfaceColor, inkColor * inkBrightness, lineCore);

          // Horizon-matched FogExp2
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          finalColor = mix(finalColor, uFogColor, clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.disposables.push(this.ridgeMaterial);

    // 4. Build 68 high-resolution vertical curtain strips
    for (let r = 0; r < RIDGE_COUNT; r++) {
      const rowNorm = r / (RIDGE_COUNT - 1);
      const z = (rowNorm - 0.5) * FIELD_DEPTH;

      const vertexCount = SAMPLES_PER_RIDGE * 2;
      const positions = new Float32Array(vertexCount * 3);
      const crestDist = new Float32Array(vertexCount);
      const centerNormAttr = new Float32Array(vertexCount);
      const indices: number[] = [];

      for (let s = 0; s < SAMPLES_PER_RIDGE; s++) {
        const u = s / (SAMPLES_PER_RIDGE - 1);
        const x = (u - 0.5) * FIELD_WIDTH;
        const c = u * 2 - 1;
        const baseH = 0.032 + this.sampleEnvelope[s] * 0.12;

        const botIdx = s * 2;
        const topIdx = s * 2 + 1;

        positions[botIdx * 3] = x;
        positions[botIdx * 3 + 1] = 0;
        positions[botIdx * 3 + 2] = z;
        crestDist[botIdx] = baseH;
        centerNormAttr[botIdx] = Math.abs(c);

        positions[topIdx * 3] = x;
        positions[topIdx * 3 + 1] = baseH;
        positions[topIdx * 3 + 2] = z;
        crestDist[topIdx] = 0;
        centerNormAttr[topIdx] = Math.abs(c);

        if (s < SAMPLES_PER_RIDGE - 1) {
          const b0 = botIdx;
          const t0 = topIdx;
          const b1 = (s + 1) * 2;
          const t1 = (s + 1) * 2 + 1;
          indices.push(b0, b1, t0, t0, b1, t1);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aCrestDist', new THREE.BufferAttribute(crestDist, 1));
      geo.setAttribute(
        'aCenterNorm',
        new THREE.BufferAttribute(centerNormAttr, 1),
      );
      geo.setIndex(indices);

      const mesh = new THREE.Mesh(geo, this.ridgeMaterial);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.ridgeGeometries.push(geo);
      this.disposables.push(geo);
    }

    // 5. Multi-part architectural studio plinth & grounding shadow
    this.buildArchitecturalPlinth(maxAnisotropy);

    // 6. Minimal central resonance beacon
    this.beacon = this.buildCentralBeacon();
    this.root.add(this.beacon.group);

    // 7. Atmospheric starlight dust
    const { points, baseY } = this.buildStarfield();
    this.starPoints = points;
    this.starBaseY = baseY;
    this.root.add(points);
  }

  private buildArchitecturalPlinth(maxAnisotropy: number): void {
    const plinthGroup = new THREE.Group();

    const deckTex = createBrushedDeckTexture(maxAnisotropy);
    this.disposables.push(deckTex);

    const deckGeo = new THREE.BoxGeometry(
      FIELD_WIDTH + 1.2,
      0.16,
      FIELD_DEPTH + 1.2,
    );
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x111218,
      map: deckTex,
      roughness: 0.78,
      metalness: 0.22,
    });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = -0.11;
    deck.receiveShadow = true;
    plinthGroup.add(deck);
    this.disposables.push(deckGeo, deckMat);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x525666,
      roughness: 0.24,
      metalness: 0.88,
    });
    this.disposables.push(railMat);

    const railHeight = 0.045;
    const railThick = 0.06;
    const w = FIELD_WIDTH + 1.22;
    const d = FIELD_DEPTH + 1.22;

    const sideRailGeo = new THREE.BoxGeometry(railThick, railHeight, d);
    const frontRailGeo = new THREE.BoxGeometry(w, railHeight, railThick);
    this.disposables.push(sideRailGeo, frontRailGeo);

    const leftRail = new THREE.Mesh(sideRailGeo, railMat);
    leftRail.position.set(-w / 2, -0.02, 0);
    const rightRail = new THREE.Mesh(sideRailGeo, railMat);
    rightRail.position.set(w / 2, -0.02, 0);
    const frontRail = new THREE.Mesh(frontRailGeo, railMat);
    frontRail.position.set(0, -0.02, d / 2);
    const backRail = new THREE.Mesh(frontRailGeo, railMat);
    backRail.position.set(0, -0.02, -d / 2);

    plinthGroup.add(leftRail, rightRail, frontRail, backRail);

    const cornerGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.2, 8);
    const cornerMat = new THREE.MeshStandardMaterial({
      color: 0x8c92a4,
      roughness: 0.3,
      metalness: 0.92,
    });
    this.disposables.push(cornerGeo, cornerMat);

    const corners: [number, number][] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
    ];
    for (const [cx, cz] of corners) {
      const cap = new THREE.Mesh(cornerGeo, cornerMat);
      cap.position.set(cx, -0.1, cz);
      plinthGroup.add(cap);
    }

    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(FIELD_WIDTH + 9, FIELD_DEPTH + 9);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.22;
    plinthGroup.add(shadowPlane);
    this.disposables.push(shadowTex, shadowGeo, shadowMat);

    this.root.add(plinthGroup);
  }

  private buildCentralBeacon(): CentralBeacon {
    const group = new THREE.Group();

    const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 1.0, 8);
    stemGeo.translate(0, 0.5, 0);
    const innerRingGeo = new THREE.RingGeometry(0.16, 0.21, 36);
    innerRingGeo.rotateX(-Math.PI / 2);
    const outerRingGeo = new THREE.RingGeometry(0.32, 0.35, 48);
    outerRingGeo.rotateX(-Math.PI / 2);
    const tipGeo = new THREE.OctahedronGeometry(0.06, 0);
    this.disposables.push(stemGeo, innerRingGeo, outerRingGeo, tipGeo);

    const stemMat = new THREE.MeshStandardMaterial({
      color: 0xf4f5f8,
      emissive: 0xf4f5f8,
      emissiveIntensity: 0.45,
      roughness: 0.22,
      metalness: 0.85,
      transparent: true,
      opacity: 0,
    });
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf4f5f8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0xfb7185,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tipMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    });
    this.disposables.push(stemMat, innerRingMat, outerRingMat, tipMat);

    const stem = new THREE.Mesh(stemGeo, stemMat);
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    const tip = new THREE.Mesh(tipGeo, tipMat);

    group.add(stem, innerRing, outerRing, tip);

    return {
      group,
      stem,
      innerRing,
      outerRing,
      tip,
      stemMat,
      innerRingMat,
      outerRingMat,
      tipMat,
      flare: 0,
    };
  }

  private buildStarfield(): { points: THREE.Points; baseY: Float32Array } {
    const count = 240;
    const positions = new Float32Array(count * 3);
    const baseY = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = (i * 2.399963) % (Math.PI * 2);
      const radius = 5.5 + ((i * 73.13) % 19.5);
      positions[i * 3] = Math.cos(angle) * radius;
      const y = 1.6 + ((i * 19.71) % 12.5);
      positions[i * 3 + 1] = y;
      baseY[i] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const tex = createStarTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: tex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xe6e8f0,
    });
    this.disposables.push(geo, tex, mat);

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, baseY };
  }

  public triggerRipple(_x = 0, _z = 0, strength = 1.25): void {
    this.boostPulse = Math.min(1.4, this.boostPulse + strength * 0.55);
    this.beacon.flare = Math.min(1.0, this.beacon.flare + 0.85);
  }

  public resetWaves(): void {
    this.boostPulse = 0.55;
    this.beacon.flare = 0.6;
    for (let r = 0; r < RIDGE_COUNT; r++) {
      this.prevHeights[r].fill(0.032);
    }
  }

  public update(
    audio: AudioFrameData,
    elapsed: number,
    dt: number,
    hasActiveWish: boolean,
    isWarmMood: boolean,
  ): void {
    const safeDt = Math.min(dt, 0.08);
    this.boostPulse *= Math.exp(-5.2 * safeDt);

    const spec = audio.spectrum;
    const isPlaying = audio.isPlaying;

    // Live overall punch multiplier driving simultaneous equalizer spikes
    const beatBoost = isPlaying
      ? 1.0 + audio.beatKick * 0.72 + audio.snarePunch * 0.42 + this.boostPulse * 0.55
      : 1.0 + this.boostPulse * 0.65;

    // 1. Compute shared live sharp-needle base curve across X once per frame
    const needleAnim = isPlaying ? elapsed * 5.2 : elapsed * 0.9;
    for (let s = 0; s < SAMPLES_PER_RIDGE; s++) {
      const c = this.sampleCentered[s];
      const bFloat = this.sampleBaseBin[s];
      const b0 = Math.floor(bFloat);
      const b1 = Math.min(SPECTRUM_BINS - 1, b0 + 1);
      const frac = bFloat - b0;
      const specVal = spec[b0] * (1 - frac) + spec[b1] * frac;

      // True pointed-cusp needle spikes: (1 - |sin|)^p produces razor-sharp Λ tips instead of rounded domes
      const needleA = Math.pow(1 - Math.abs(Math.sin(c * 24.0 + needleAnim * 0.35)), 2.4);
      const needleB = Math.pow(1 - Math.abs(Math.sin(c * 43.0 - needleAnim * 0.6)), 2.8);
      const needleC = Math.pow(1 - Math.abs(Math.cos(c * 14.5 + needleAnim * 0.22)), 2.0);
      const spikeMask = 0.16 + needleA * 0.72 + needleB * 0.52 + needleC * 0.34;

      // Extra razor spike right through the exact center on bass/kick hits
      const coreNeedle =
        Math.exp(-(c * c) / 0.025) *
        (audio.bass * 1.15 + audio.beatKick * 1.35) *
        (0.4 + needleB * 0.85);

      const rawAmp =
        (specVal * 3.35 + audio.bass * 0.8) * spikeMask * beatBoost + coreNeedle;

      this.baseSpikeCurve[s] = rawAmp;
    }

    // Fast upward snap, clean downward release so spikes feel crisp and tactile
    const riseAlpha = 1 - Math.exp(-36 * safeDt);
    const fallAlpha = 1 - Math.exp(-15 * safeDt);
    const centerRow = Math.floor(RIDGE_COUNT / 2);
    const centerSample = Math.floor(SAMPLES_PER_RIDGE / 2);

    // 2. Apply synchronously to ALL 68 lines simultaneously with subtle per-line organic variation
    for (let r = 0; r < RIDGE_COUNT; r++) {
      const profile = this.rowProfiles[r];
      const geo = this.ridgeGeometries[r];
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const crestAttr = geo.attributes.aCrestDist as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const crestArr = crestAttr.array as Float32Array;
      const rowPrev = this.prevHeights[r];

      for (let s = 0; s < SAMPLES_PER_RIDGE; s++) {
        const env = this.sampleEnvelope[s];

        if (env < 0.002) {
          // Razor-flat calm outer margins
          const flatH = 0.032;
          rowPrev[s] = flatH;
          posArr[(s * 2 + 1) * 3 + 1] = flatH;
          crestArr[s * 2] = flatH;
          continue;
        }

        const c = this.sampleCentered[s] + profile.centerShift;

        // Subtle adjacent-bin shimmer per row so lines stay nearly identical yet individually alive
        const shiftedBin = Math.max(
          0,
          Math.min(SPECTRUM_BINS - 1, Math.round(this.sampleBaseBin[s] + profile.binShift)),
        );
        const rowBinVal = spec[shiftedBin];

        // Fine per-line pointed needle tooth so the 3D side-view has crisp depth texture
        const rowTooth =
          0.7 +
          0.48 *
            Math.pow(
              1 - Math.abs(Math.sin(c * 31.0 + profile.combPhase + needleAnim * 0.2)),
              2.2,
            );

        const combined =
          (this.baseSpikeCurve[s] * 0.74 +
            rowBinVal * 3.1 * beatBoost * 0.32) *
          rowTooth *
          profile.gain;

        const targetH = Math.min(4.35, 0.032 + env * (0.04 + combined));

        const prevH = rowPrev[s];
        const alpha = targetH > prevH ? riseAlpha : fallAlpha;
        const h = prevH + (targetH - prevH) * alpha;
        rowPrev[s] = h;

        if (r === centerRow && s === centerSample) {
          this.centerHeight = h;
        }

        const botIdx = s * 2;
        const topIdx = s * 2 + 1;
        posArr[topIdx * 3 + 1] = h;
        crestArr[botIdx] = h;
      }

      posAttr.needsUpdate = true;
      crestAttr.needsUpdate = true;
    }

    // 3. Update shader uniforms
    this.ridgeMaterial.uniforms.uBeat.value = Math.min(
      1.35,
      audio.beatKick * 0.9 + audio.bass * 0.4 + this.boostPulse * 0.45,
    );
    const targetWarmth = isWarmMood ? 1.0 : hasActiveWish ? 0.22 : 0.0;
    this.ridgeMaterial.uniforms.uWarmth.value = THREE.MathUtils.damp(
      this.ridgeMaterial.uniforms.uWarmth.value,
      targetWarmth,
      2.8,
      safeDt,
    );

    // 4. Minimal central resonance beacon
    this.beacon.flare *= Math.exp(-2.1 * safeDt);
    const visibility = Math.min(
      1,
      (hasActiveWish ? 0.52 : 0.0) + this.beacon.flare * 0.65,
    );
    this.beacon.group.position.set(0, this.centerHeight, 0);

    const stemH =
      (0.75 + audio.bass * 0.55 + this.beacon.flare * 0.6) * visibility;
    this.beacon.stem.scale.set(1, Math.max(0.001, stemH), 1);
    this.beacon.tip.position.y = stemH + 0.08;
    this.beacon.tip.rotation.y = elapsed * 1.5;
    this.beacon.tip.scale.setScalar(
      0.001 + visibility * (0.85 + audio.beatKick * 0.4),
    );

    const innerScale = 0.001 + visibility * (1 + audio.beatKick * 0.45);
    const outerScale =
      0.001 +
      (1.0 + (1.0 - this.beacon.flare) * 1.8) * Math.max(0.001, this.beacon.flare);
    this.beacon.innerRing.scale.setScalar(innerScale);
    this.beacon.innerRing.position.y = 0.04;
    this.beacon.outerRing.scale.setScalar(outerScale);
    this.beacon.outerRing.position.y = 0.04;

    const beaconColorHex = isWarmMood ? 0xfb7185 : 0xf4f5f8;
    this.beacon.stemMat.color.setHex(beaconColorHex);
    this.beacon.stemMat.emissive.setHex(beaconColorHex);
    this.beacon.innerRingMat.color.setHex(beaconColorHex);
    this.beacon.tipMat.color.setHex(beaconColorHex);

    this.beacon.stemMat.opacity = visibility * 0.54;
    this.beacon.innerRingMat.opacity = visibility * 0.48;
    this.beacon.outerRingMat.opacity = this.beacon.flare * 0.52;
    this.beacon.tipMat.opacity = visibility * 0.88;

    // 5. Drifting starlight dust
    const starPos = this.starPoints.geometry.attributes
      .position as THREE.BufferAttribute;
    const sArr = starPos.array as Float32Array;
    for (let i = 0; i < this.starBaseY.length; i++) {
      sArr[i * 3 + 1] =
        this.starBaseY[i] +
        Math.sin(elapsed * 0.55 + i * 0.7) * 0.25 +
        audio.high * 0.3;
    }
    starPos.needsUpdate = true;
    this.starPoints.rotation.y = elapsed * 0.018;
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
  }
}
