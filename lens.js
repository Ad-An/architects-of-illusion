
// =============================================================================
// ARCHITECTS OF ILLUSION — SHARED EXPANDING LENS & PIXEL SAMPLING ENGINE
// =============================================================================

// 1. PERFORMANCE & OPTIMIZATION CONTROL
const WARP_UPDATE_INTERVAL_FRAMES = 5;  // Update SVG displacement filter every N frames (1 = smooth/heavy, 5 = optimized)
const WARP_SCALE_STEP = 5.0;            // Minimum scale change required to trigger SVG DOM redraw
const SNAPSHOT_DEBOUNCE_MS = 300;       // Debounce delay for html2canvas re-captures during window resize
const MIN_PIXEL_SIZE = 8;               // Smallest pixel block at lens border (8px gives 4x fewer draw calls than 4px)
const MAX_PIXEL_SIZE = 64;              // Largest pixel block far from lens border (px)
const PIXEL_GRADIENT_ZONE = 500;        // Distance from lens border over which pixels scale up (px)

// 2. DISTORTION CONTROL
const FALLOFF_POWER = 0;                // Exponent for sin curve falloff
const WARP_STRENGTH = -50;             // Refraction displacement power when active

// 3. FPS CROSSHAIR STYLE CONTROL
const CROSSHAIR_SIZE = 36;              // Width/Height of crosshair cursor (px)
const CROSSHAIR_COLOR = '#81f9ff';      // Bright tactical green
const CROSSHAIR_OUTLINE = '#000000';    // High-contrast black border

// 4. SPEED-DEPENDENT DYNAMIC LENS SIZE VARIABLES
const MIN_SIZE = 500;                   // Lens diameter when moving FAST (px)
const MAX_SIZE = 1000;                  // Lens diameter when moving SLOW (px)
const SIZE_MIN_SPEED = 2.0;             // Speed threshold (px/frame) where lens is MAX_SIZE
const SIZE_MAX_SPEED = 20.0;            // Speed threshold (px/frame) where lens hits MIN_SIZE

// 5. SPEED THRESHOLDS FOR STATE DEACTIVATION & REACTIVATION
const DEACTIVATE_SPEED_THRESHOLD = 3.2; // Speed below which mouse is considered idle (px/frame)
const REACTIVATE_SPEED_THRESHOLD = 1.0; // Speed above which mouse is considered "moving fast" (px/frame)

// 6. EXPANSION, CONTRACTION & REACTIVATION TIMERS
const DEACTIVATE_DELAY = 1.0;           // Seconds of slow/idle mouse before expansion begins
const EXPAND_DURATION = 1.0;            // Seconds taken to zoom out & drop warp to 0
const CONTRACT_DURATION = 0.5;          // Seconds taken to zoom back in & restore warp
const REACTIVATE_FAST_DURATION = 1;   // Seconds of fast movement required to turn back ON

// 7. VELOCITY DAMPING & LERP (JITTER REDUCTION)
const SPEED_SMOOTHING = 0.12;           // EMA Velocity Damping
const SIZE_LERP = 0.08;                 // Lerp factor for lens size transitions
const MIN_LERP = 0.03;                  // Position lerp speed when moving slowly
const MAX_LERP = 0.25;                  // Position lerp speed when moving fast
const SPEED_SENSITIVITY = 12.0;         // Velocity threshold for max lerp

// =============================================================================
// ENGINE IMPLEMENTATION
// =============================================================================

(function initExpandingLensEngine() {
  if (!window.html2canvas) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => setupEngine();
    document.head.appendChild(script);
  } else {
    setupEngine();
  }

  function setupEngine() {
    document.body.insertAdjacentHTML('beforeend', `
      <style>
        html, body, a, button, select, input, textarea {
          cursor: none !important;
        }

        @media (pointer: coarse) {
          #lens-cursor, #pixel-sampling-canvas, #fps-crosshair {
            display: none !important;
          }
          html, body, a, button, select, input, textarea {
            cursor: auto !important;
          }
        }
      </style>

      <canvas id="pixel-sampling-canvas" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 9990;
      "></canvas>

      <div id="lens-cursor" style="
        position: fixed;
        top: 0;
        left: 0;
        width: ${MAX_SIZE}px;
        height: ${MAX_SIZE}px;
        pointer-events: none;
        z-index: 9999;
        border-radius: 50%;
        will-change: transform, width, height;
        transform: translateZ(0);
        backdrop-filter: url(#lens-warp) brightness(1.05);
        -webkit-backdrop-filter: url(#lens-warp) brightness(1.05);
        box-shadow: 0 0 35px rgba(245, 158, 11, 0.35), inset 0 0 20px rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
      "></div>

      <div id="fps-crosshair" style="
        position: fixed;
        top: 0;
        left: 0;
        width: ${CROSSHAIR_SIZE}px;
        height: ${CROSSHAIR_SIZE}px;
        pointer-events: none;
        z-index: 10001;
        will-change: transform;
        transform: translate3d(-100px, -100px, 0);
      ">
        <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; display: block; overflow: visible;">
          <circle cx="50" cy="50" r="4" fill="${CROSSHAIR_OUTLINE}"/>
          <line x1="50" y1="20" x2="50" y2="40" stroke="${CROSSHAIR_OUTLINE}" stroke-width="6" stroke-linecap="square"/>
          <line x1="50" y1="60" x2="50" y2="80" stroke="${CROSSHAIR_OUTLINE}" stroke-width="6" stroke-linecap="square"/>
          <line x1="20" y1="50" x2="40" y2="50" stroke="${CROSSHAIR_OUTLINE}" stroke-width="6" stroke-linecap="square"/>
          <line x1="60" y1="50" x2="80" y2="50" stroke="${CROSSHAIR_OUTLINE}" stroke-width="6" stroke-linecap="square"/>

          <circle cx="50" cy="50" r="2" fill="${CROSSHAIR_COLOR}"/>
          <line x1="50" y1="21" x2="50" y2="39" stroke="${CROSSHAIR_COLOR}" stroke-width="3" stroke-linecap="square"/>
          <line x1="50" y1="61" x2="50" y2="78" stroke="${CROSSHAIR_COLOR}" stroke-width="3" stroke-linecap="square"/>
          <line x1="21" y1="50" x2="39" y2="50" stroke="${CROSSHAIR_COLOR}" stroke-width="3" stroke-linecap="square"/>
          <line x1="61" y1="50" x2="79" y2="50" stroke="${CROSSHAIR_COLOR}" stroke-width="3" stroke-linecap="square"/>
        </svg>
      </div>

      <svg style="display:none;" aria-hidden="true">
        <filter id="lens-warp" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
          <feImage id="fe-map" result="map" href="" preserveAspectRatio="none" />
          <feDisplacementMap 
            id="fe-displacement"
            in="SourceGraphic" 
            in2="map" 
            scale="${WARP_STRENGTH}" 
            xChannelSelector="R" 
            yChannelSelector="G" />
        </filter>
      </svg>
    `);

    const lensEl = document.getElementById('lens-cursor');
    const crosshairEl = document.getElementById('fps-crosshair');
    const canvas = document.getElementById('pixel-sampling-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const feMap = document.getElementById('fe-map');
    const feDisplacement = document.getElementById('fe-displacement');

    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
    let snapshotData = null;

    // --- OPTIMIZATION: Debounce html2canvas snapshot captures on window resize ---
    let resizeTimeout = null;
    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      offCanvas.width = window.innerWidth;
      offCanvas.height = window.innerHeight;
      captureSnapshot();
    }

    function debouncedResize() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeCanvas, SNAPSHOT_DEBOUNCE_MS);
    }

    function captureSnapshot() {
      if (typeof html2canvas === 'undefined') return;
      html2canvas(document.body, {
        ignoreElements: (el) => el.id === 'pixel-sampling-canvas' || el.id === 'lens-cursor' || el.id === 'fps-crosshair',
        logging: false,
        useCORS: true,
        scale: 0.5
      }).then((snapCanvas) => {
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.drawImage(snapCanvas, 0, 0, offCanvas.width, offCanvas.height);
        snapshotData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
      });
    }

    window.addEventListener('resize', debouncedResize);
    setTimeout(resizeCanvas, 300);

    function generateRadialMap(size, falloffPower) {
      const mapCanvas = document.createElement('canvas');
      mapCanvas.width = size;
      mapCanvas.height = size;
      const mapCtx = mapCanvas.getContext('2d');
      const imgData = mapCtx.createImageData(size, size);
      const data = imgData.data;
      const center = size / 2;
      const radius = size / 2;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - center) / radius;
          const dy = (y - center) / radius;
          const dist = Math.sqrt(dx * dx + dy * dy);

          let r = 128, g = 128;
          if (dist < 1.0) {
            const baseSin = Math.sin(dist * Math.PI);
            const factor = Math.pow(baseSin, falloffPower) * (1.0 - dist);
            r = Math.min(255, Math.max(0, 128 + (dx * factor) * 127));
            g = Math.min(255, Math.max(0, 128 + (dy * factor) * 127));
          }

          const idx = (y * size + x) * 4;
          data[idx]     = r;
          data[idx + 1] = g;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
      mapCtx.putImageData(imgData, 0, 0);
      return mapCanvas.toDataURL();
    }

    feMap.setAttribute('href', generateRadialMap(512, FALLOFF_POWER));

    // State & Movement Tracking
    let mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let targetPos = { ...mousePos };
    let lastTargetPos = { ...mousePos };

    let state = 'ACTIVE';
    let transitionProgress = 0.0;
    let currentBaseSize = MAX_SIZE;
    let smoothedSpeed = 0.0;
    let idleTime = 0;
    let fastMoveTime = 0;
    let lastFrameTime = Date.now();

    // Performance Counters & Caches
    let frameCount = 0;
    let lastAppliedWarp = null;
    const maxLevels = Math.log2(MAX_PIXEL_SIZE / MIN_PIXEL_SIZE);

    window.addEventListener('mousemove', (e) => {
      targetPos.x = e.clientX;
      targetPos.y = e.clientY;
    });

    // Render Loop
    function render() {
      const now = Date.now();
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      frameCount++;

      // 1. Crosshair Direct Tracking (1:1)
      const crosshairX = targetPos.x - CROSSHAIR_SIZE / 2;
      const crosshairY = targetPos.y - CROSSHAIR_SIZE / 2;
      crosshairEl.style.transform = `translate3d(${crosshairX}px, ${crosshairY}px, 0)`;

      // 2. Instant Speed & EMA Damping
      const deltaX = targetPos.x - lastTargetPos.x;
      const deltaY = targetPos.y - lastTargetPos.y;
      const instantSpeed = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      lastTargetPos = { ...targetPos };

      smoothedSpeed += (instantSpeed - smoothedSpeed) * SPEED_SMOOTHING;

      // 3. Speed Evaluation
      if (smoothedSpeed < DEACTIVATE_SPEED_THRESHOLD) {
        idleTime += dt;
        fastMoveTime = 0;
      } else if (smoothedSpeed > REACTIVATE_SPEED_THRESHOLD) {
        fastMoveTime += dt;
        if (state === 'ACTIVE') idleTime = 0;
      } else {
        fastMoveTime = 0;
        if (state === 'ACTIVE') idleTime = 0;
      }

      // 4. Dynamic Base Lens Size
      const clampedSpeed = Math.min(SIZE_MAX_SPEED, Math.max(SIZE_MIN_SPEED, smoothedSpeed));
      const sizeSpeedRatio = (clampedSpeed - SIZE_MIN_SPEED) / (SIZE_MAX_SPEED - SIZE_MIN_SPEED);
      const targetBaseSize = MAX_SIZE - sizeSpeedRatio * (MAX_SIZE - MIN_SIZE);

      currentBaseSize += (targetBaseSize - currentBaseSize) * SIZE_LERP;

      // 5. State Machine Timers
      if (state === 'ACTIVE') {
        transitionProgress = 0.0;
        if (idleTime >= DEACTIVATE_DELAY) {
          state = 'DEACTIVATING';
        }
      } else if (state === 'DEACTIVATING') {
        transitionProgress = Math.min(1.0, transitionProgress + dt / EXPAND_DURATION);
        if (transitionProgress >= 1.0) {
          state = 'OFF';
        }
        if (fastMoveTime >= REACTIVATE_FAST_DURATION) {
          state = 'REACTIVATING';
          idleTime = 0;
        }
      } else if (state === 'OFF') {
        transitionProgress = 1.0;
        if (fastMoveTime >= REACTIVATE_FAST_DURATION) {
          state = 'REACTIVATING';
          idleTime = 0;
        }
      } else if (state === 'REACTIVATING') {
        transitionProgress = Math.max(0.0, transitionProgress - dt / CONTRACT_DURATION);
        if (transitionProgress <= 0.0) {
          state = 'ACTIVE';
          idleTime = 0;
          fastMoveTime = 0;
        }
      }

      // 6. Expansion & Distortion Scaling
      const maxScreenDimension = Math.hypot(window.innerWidth, window.innerHeight) * 2.2;
      const easedP = Math.pow(transitionProgress, 2.0);

      const currentSize = currentBaseSize + (maxScreenDimension - currentBaseSize) * easedP;
      const currentWarp = WARP_STRENGTH * (1.0 - easedP);
      const currentClearRadius = currentSize / 2;

      // --- OPTIMIZATION: Throttled & Step-Clamped SVG Filter Updates ---
      const roundedWarp = Math.round(currentWarp);
      const isFrameInterval = (frameCount % WARP_UPDATE_INTERVAL_FRAMES === 0);
      const exceedsStepThreshold = lastAppliedWarp === null || Math.abs(roundedWarp - lastAppliedWarp) >= WARP_SCALE_STEP;

      if (isFrameInterval || exceedsStepThreshold) {
        if (lastAppliedWarp !== roundedWarp) {
          feDisplacement.setAttribute('scale', roundedWarp);
          lastAppliedWarp = roundedWarp;
        }
      }

      // 7. Smooth Lens Position Tracking
      const lerpSpeedRatio = Math.min(1.0, smoothedSpeed / SPEED_SENSITIVITY);
      const dynamicLerp = MIN_LERP + (MAX_LERP - MIN_LERP) * lerpSpeedRatio;

      mousePos.x += (targetPos.x - mousePos.x) * dynamicLerp;
      mousePos.y += (targetPos.y - mousePos.y) * dynamicLerp;

      const posX = mousePos.x - currentSize / 2;
      const posY = mousePos.y - currentSize / 2;
      lensEl.style.width = `${currentSize}px`;
      lensEl.style.height = `${currentSize}px`;
      lensEl.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;

      // 8. Recursive Quadtree Pixel Sampling Grid
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (state !== 'OFF' && snapshotData) {
        const data = snapshotData.data;
        const sw = snapshotData.width;
        const sh = snapshotData.height;

        function renderQuadNode(x, y, size) {
          const cx = x + size / 2;
          const cy = y + size / 2;
          const dx = cx - mousePos.x;
          const dy = cy - mousePos.y;
          const distToCenter = Math.hypot(dx, dy);
          const cellRadius = size * 0.70710678;

          if (distToCenter + cellRadius < currentClearRadius) {
            return;
          }

          const distToEdge = distToCenter - currentClearRadius;
          const normDist = Math.max(0, Math.min(1, distToEdge / PIXEL_GRADIENT_ZONE));
          const targetLevel = Math.floor(normDist * maxLevels);
          const desiredSize = MIN_PIXEL_SIZE * Math.pow(2, targetLevel);

          if (size > MIN_PIXEL_SIZE && size > desiredSize) {
            const half = size / 2;
            renderQuadNode(x, y, half);
            renderQuadNode(x + half, y, half);
            renderQuadNode(x, y + half, half);
            renderQuadNode(x + half, y + half, half);
            return;
          }

          if (distToCenter + cellRadius * 0.3 >= currentClearRadius) {
            const sampleX = Math.min(sw - 1, Math.max(0, Math.floor(cx)));
            const sampleY = Math.min(sh - 1, Math.max(0, Math.floor(cy)));
            const pixelIdx = (sampleY * sw + sampleX) * 4;

            const r = data[pixelIdx];
            const g = data[pixelIdx + 1];
            const b = data[pixelIdx + 2];

            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x, y, size, size);
          }
        }

        for (let y = 0; y < canvas.height; y += MAX_PIXEL_SIZE) {
          for (let x = 0; x < canvas.width; x += MAX_PIXEL_SIZE) {
            renderQuadNode(x, y, MAX_PIXEL_SIZE);
          }
        }
      }

      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  }
})();