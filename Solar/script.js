import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import TWEEN from 'three/addons/libs/tween.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION ---
const SCENE_CONFIG = {
    fov: 45,
    near: 0.1,
    far: 20000,
    ambientLightIntensity: 0.2, // Darker space
    sunLightIntensity: 2.0
};

// Global variables
let scene, camera, renderer, labelRenderer, controls, composer;
let sun;
let solarSystemData;
const celestialObjects = {}; // Map id -> { mesh, data, orbitMesh, parentId, childrenIds }
let animationId;
const clock = new THREE.Clock();
let sunLight; // Store reference to sun light for shadow updates
let sunPointLight; // Point light at sun for glow

// Expose to window for theme functions
window.scene = null;
window.celestialObjects = celestialObjects;
window.sunLight = null;
window.starfield = null;
window.lightMode = false;
window.graphicsQuality = 'low';

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// State
let currentFocus = null; // null = overview, or object ID
let isTransitioning = false;
let graphicsQuality = 'low'; // low, medium, high
let orbitSpeed = 1.0; // Speed multiplier
let labelsVisible = true;
let orbitsVisible = true;
let lightMode = false; // Light mode toggle

// DOM Elements
const container = document.getElementById('canvas-container');
const planetListEl = document.getElementById('planet-list');
const infoNameEl = document.getElementById('info-name');
const infoContentEl = document.getElementById('info-content');
const rightPanelEl = document.getElementById('right-panel');
const btnOverview = document.getElementById('btn-overview');
const loadingEl = document.getElementById('loading');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const btnToggleLabels = document.getElementById('btn-toggle-labels');
const btnToggleOrbits = document.getElementById('btn-toggle-orbits');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const fpsCounter = document.getElementById('fps-counter');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileInfoToggle = document.getElementById('mobile-info-toggle');
const mobileOverlay = document.getElementById('mobile-overlay');

// FPS tracking
let lastTime = performance.now();
let frames = 0;
let fps = 0;

// Store starfield for theme switching
let starfield = null;

init();


async function init() {
    // Wait for theme functions to be ready
    await new Promise(resolve => {
        if (window.createStarfield && window.applyTheme) {
            resolve();
        } else {
            setTimeout(resolve, 100);
        }
    });

    // 1. Setup Scene
    scene = new THREE.Scene();
    window.scene = scene;

    // Camera
    camera = new THREE.PerspectiveCamera(SCENE_CONFIG.fov, window.innerWidth / window.innerHeight, SCENE_CONFIG.near, SCENE_CONFIG.far);
    camera.position.set(0, 400, 600);

    // Renderer (WebGL)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;

    // Enable Shadows - Start disabled, enable in high quality
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // POST-PROCESSING (BLOOM)
    const renderScene = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.5;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    
    // Expose for theme switching
    window.composer = composer;
    window.bloomPass = bloomPass;
    window.renderer = renderer;

    // Renderer (CSS2D - Labels)
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    container.appendChild(labelRenderer.domElement);

    // Controls
    controls = new OrbitControls(camera, labelRenderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 20000;
    
    // Touch controls for mobile
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };

    // Starfield
    if (window.createStarfield) {
        window.createStarfield();
    }

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404060, 0.25); // Slightly brighter ambient
    scene.add(ambientLight);

    // Main Sun Light - Directional for better shadows
    sunLight = new THREE.DirectionalLight(0xfff5e6, 1.5); // Warmer, softer light
    sunLight.position.set(-100, 50, 100); // From sun direction
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -500;
    sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500;
    sunLight.shadow.camera.bottom = -500;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 2000;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);
    window.sunLight = sunLight;

    // Additional Point Light at Sun for glow effect
    sunPointLight = new THREE.PointLight(0xffaa00, 1.2, 800); // Reduced intensity
    sunPointLight.position.set(0, 0, 0);
    scene.add(sunPointLight);

    // 2. Load Data
    try {
        const response = await fetch('data.json');
        solarSystemData = await response.json();
        buildSolarSystem(solarSystemData);
        loadingEl.style.opacity = 0;
        setTimeout(() => loadingEl.remove(), 500);
    } catch (err) {
        loadingEl.innerText = "Error loading data.";
        console.error(err);
    }

    // 3. Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    
    // Touch support for mobile
    window.addEventListener('touchstart', onPointerDown, { passive: false });
    
    btnOverview.addEventListener('click', () => zoomToOverview());
    
    // Initial resize check
    onWindowResize();

    // Quality Toggles
    document.querySelectorAll('input[name="graphics-quality"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) setGraphicsQuality(e.target.value);
        });
    });

    // Speed Control
    speedSlider.addEventListener('input', (e) => {
        orbitSpeed = parseFloat(e.target.value);
        speedValue.textContent = orbitSpeed === 0 ? 'Paused' : `${orbitSpeed.toFixed(1)}x`;
    });

    // Toggle Labels
    btnToggleLabels.addEventListener('click', () => {
        labelsVisible = !labelsVisible;
        btnToggleLabels.textContent = labelsVisible ? '🏷️ Hide Labels' : '🏷️ Show Labels';
        btnToggleLabels.classList.toggle('active');
        
        // Toggle all labels by changing visibility
        scene.traverse((obj) => {
            if (obj.isCSS2DObject) {
                obj.visible = labelsVisible;
            }
        });
    });

    // Toggle Orbits
    btnToggleOrbits.addEventListener('click', () => {
        orbitsVisible = !orbitsVisible;
        btnToggleOrbits.textContent = orbitsVisible ? '⭕ Hide Orbits' : '⭕ Show Orbits';
        btnToggleOrbits.classList.toggle('active');
        
        // Toggle all orbit paths
        Object.values(celestialObjects).forEach(obj => {
            if (obj.orbitPath) {
                obj.orbitPath.visible = orbitsVisible;
            }
        });
    });

    // Toggle Theme (Light/Dark Mode)
    btnToggleTheme.addEventListener('click', () => {
        lightMode = !lightMode;
        window.lightMode = lightMode;
        btnToggleTheme.textContent = lightMode ? '🌙 Dark Mode' : '☀️ Light Mode';
        btnToggleTheme.classList.toggle('active');
        
        if (window.applyTheme) {
            window.applyTheme();
        }
    });

    // Mobile Menu Toggle
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const leftPanel = document.getElementById('left-panel');
            leftPanel.classList.toggle('mobile-open');
            
            // Only use overlay in portrait mode
            if (window.matchMedia('(orientation: portrait)').matches) {
                mobileOverlay.classList.toggle('active');
            }
        });

        // Close on overlay click (portrait only)
        mobileOverlay.addEventListener('click', () => {
            if (window.matchMedia('(orientation: portrait)').matches) {
                const leftPanel = document.getElementById('left-panel');
                leftPanel.classList.remove('mobile-open');
                mobileOverlay.classList.remove('active');
            }
        });

        // Close left panel on X button click (works for both portrait and landscape)
        const leftPanel = document.getElementById('left-panel');
        leftPanel.addEventListener('click', (e) => {
            const rect = leftPanel.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            
            if (clickX > rect.width - 50 && clickY < 50) {
                leftPanel.classList.remove('mobile-open');
                if (window.matchMedia('(orientation: portrait)').matches) {
                    mobileOverlay.classList.remove('active');
                }
            }
        });

        // Mobile Info Toggle Button (bottom right)
        if (mobileInfoToggle) {
            mobileInfoToggle.addEventListener('click', () => {
                const rightPanel = document.getElementById('right-panel');
                
                if (rightPanel.classList.contains('minimized')) {
                    // Expand
                    rightPanel.classList.remove('minimized');
                } else {
                    // Minimize
                    rightPanel.classList.add('minimized');
                }
            });
        }

        // Minimize button in panel header
        const btnMinimizeInfo = document.getElementById('btn-minimize-info');
        if (btnMinimizeInfo) {
            btnMinimizeInfo.addEventListener('click', () => {
                const rightPanel = document.getElementById('right-panel');
                rightPanel.classList.add('minimized');
            });
        }
    }

    // 4. Start Loop
    animate();
}

function setGraphicsQuality(quality) {
    console.log("Switching Quality to:", quality);
    graphicsQuality = quality;
    window.graphicsQuality = quality;

    // Update shadow settings based on quality (but not in light mode)
    if (!lightMode) {
        if (quality === 'high') {
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            if (sunLight) {
                sunLight.castShadow = true;
                sunLight.intensity = 1.5;
            }
            if (sunPointLight) {
                sunPointLight.intensity = 1.2;
            }
        } else {
            renderer.shadowMap.enabled = false;
            if (sunLight) {
                sunLight.castShadow = false;
                sunLight.intensity = 1.0;
            }
            if (sunPointLight) {
                sunPointLight.intensity = 0.8;
            }
        }
    }

    // Save current state
    const savedAngles = {};
    Object.keys(celestialObjects).forEach(key => {
        if (celestialObjects[key].angle !== undefined) {
            savedAngles[key] = celestialObjects[key].angle;
        }
    });
    const savedFocus = currentFocus;
    const savedCameraPos = camera.position.clone();
    const savedControlsTarget = controls.target.clone();

    // Rebuild Scene
    clearSolarSystem();
    buildSolarSystem(solarSystemData);

    // Restore angles
    Object.keys(savedAngles).forEach(key => {
        if (celestialObjects[key]) {
            celestialObjects[key].angle = savedAngles[key];
            if (celestialObjects[key].orbitContainer) {
                celestialObjects[key].orbitContainer.rotation.y = savedAngles[key];
            }
        }
    });

    // Restore focus and camera
    currentFocus = savedFocus;
    camera.position.copy(savedCameraPos);
    controls.target.copy(savedControlsTarget);

    // Restore UI state
    if (savedFocus) {
        document.querySelectorAll('#planet-list li').forEach(li => {
            if (li.dataset.id === savedFocus) li.classList.add('active');
            else li.classList.remove('active');
        });
        
        const targetObj = celestialObjects[savedFocus];
        if (targetObj) {
            updateInfoPanel(targetObj.data);
            updateFocusVisibility(savedFocus);
        }
    }
    
    // Re-apply theme if in light mode
    if (lightMode && window.applyTheme) {
        setTimeout(() => {
            window.applyTheme();
        }, 100);
    }
}

function clearSolarSystem() {
    // Remove all registered celestial objects from scene
    Object.values(celestialObjects).forEach(obj => {
        // Remove mesh
        if (obj.mesh) {
            // Remove labels
            obj.mesh.children.forEach(c => {
                if (c.isCSS2DObject) obj.mesh.remove(c);
            });

            // Remove from parent
            if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);

            // Dispose geometry/material
            if (obj.mesh.geometry) obj.mesh.geometry.dispose();
            if (obj.mesh.material) obj.mesh.material.dispose();
        }

        // Remove orbit containers/paths
        if (obj.orbitContainer) scene.remove(obj.orbitContainer);
        if (obj.orbitPath) scene.remove(obj.orbitPath);
        
        // Remove asteroid belt labels
        if (obj.labels) {
            obj.labels.forEach(label => {
                if (label.parent) label.parent.remove(label);
            });
        }
    });

    // Clear dictionary
    // Note: We can't just re-assign celestialObjects = {} because it's a const.
    // But we can clear keys.
    Object.keys(celestialObjects).forEach(key => delete celestialObjects[key]);

    // Clear List
    planetListEl.innerHTML = '';

    // Re-add Sun (as it was cleared) - actually buildSolarSystem handles Sun too.
    // Wait, buildSolarSystem handles everything.
    // We just need to make sure we don't duplicate ambient lights/stars (createStarfield is outside buildSolarSystem).
}


// --- SCENE BUILDER ---

function createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const count = 5000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
        positions[i] = (Math.random() - 0.5) * 4000; // Spread out stars
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0.8 });
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
}

function buildSolarSystem(data) {
    // 1. Sun
    const sunGeo = new THREE.SphereGeometry(data.sun.radius, 64, 64);
    // Sun uses StandardMaterial with Emissive to glow
    const sunMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xFFDD00,
        emissiveIntensity: 2
    });

    if (graphicsQuality === 'high') {
        const tex = new THREE.TextureLoader().load('assets/sun.jpg');
        sunMat.map = tex;
        sunMat.emissiveMap = tex;
        sunMat.emissive = new THREE.Color(0xffffff); // Use texture color
        sunMat.color = new THREE.Color(0xffffff);
    }

    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    
    // Sun should not cast shadows (it's the light source)
    sunMesh.castShadow = false;
    sunMesh.receiveShadow = false;

    // Add a helper Glow Mesh (slightly larger, transparent) for extra corona effect
    const glowGeo = new THREE.SphereGeometry(data.sun.radius * 1.2, 64, 64);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0xFFaa00,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    sunMesh.add(glowMesh); // Attach to sun

    scene.add(sunMesh);
    createLabel(sunMesh, data.sun.name, "sun");
    celestialObjects['sun'] = { mesh: sunMesh, data: data.sun, type: 'star' };

    // Add Sun to UI List with proper ID
    const sunDataWithId = { ...data.sun, id: 'sun' };
    addToList(sunDataWithId);

    // 2. Asteroid Belt (between Mars and Jupiter)
    if (data.asteroidBelt) {
        createAsteroidBelt(data.asteroidBelt);
    }

    // 3. Planets
    data.planets.forEach(planet => {
        createPlanet(planet, sunMesh);
    });
}

function createAsteroidBelt(beltData) {
    // Determine asteroid count based on quality
    const asteroidCount = graphicsQuality === 'high' ? beltData.count.high : beltData.count.low;
    
    // Create instanced mesh for performance
    const geometry = new THREE.SphereGeometry(1, 6, 6); // Low-poly sphere, will be scaled
    const material = new THREE.MeshStandardMaterial({
        color: beltData.color,
        roughness: 0.9,
        metalness: 0.1
    });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, asteroidCount);
    instancedMesh.castShadow = false; // Performance optimization
    instancedMesh.receiveShadow = false;
    
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    
    // Generate random asteroids in a belt
    for (let i = 0; i < asteroidCount; i++) {
        // Random distance within belt range
        const distance = beltData.innerRadius + Math.random() * (beltData.outerRadius - beltData.innerRadius);
        
        // Random angle around the sun
        const angle = Math.random() * Math.PI * 2;
        
        // Slight vertical variation (flattened disc)
        const height = (Math.random() - 0.5) * 5;
        
        // Position
        dummy.position.set(
            Math.cos(angle) * distance,
            height,
            Math.sin(angle) * distance
        );
        
        // Random rotation
        dummy.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );
        
        // Random size
        const size = beltData.asteroidSize.min + Math.random() * (beltData.asteroidSize.max - beltData.asteroidSize.min);
        dummy.scale.set(size, size, size);
        
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        
        // Random color variation (brownish-gray)
        color.setHex(beltData.color);
        color.r += (Math.random() - 0.5) * 0.2;
        color.g += (Math.random() - 0.5) * 0.2;
        color.b += (Math.random() - 0.5) * 0.2;
        instancedMesh.setColorAt(i, color);
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.needsUpdate = true;
    }
    
    scene.add(instancedMesh);
    
    // Store reference for visibility control and rotation
    celestialObjects['asteroidBelt'] = {
        mesh: instancedMesh,
        data: beltData,
        type: 'asteroidBelt',
        angle: 0
    };
    
    // Add label at average position
    const labelDistance = (beltData.innerRadius + beltData.outerRadius) / 2;
    const labelDiv = document.createElement('div');
    labelDiv.className = 'asteroid-belt-label';
    labelDiv.textContent = beltData.name;
    labelDiv.style.pointerEvents = 'none';
    
    const label = new CSS2DObject(labelDiv);
    label.position.set(labelDistance, 0, 0);
    scene.add(label);
    
    // Store label reference
    if (!celestialObjects['asteroidBelt'].labels) {
        celestialObjects['asteroidBelt'].labels = [];
    }
    celestialObjects['asteroidBelt'].labels.push(label);
}

function createPlanet(planetData, sunMesh) {
    // 1. Orbit Container (Pivots at Sun 0,0,0)
    const orbitContainer = new THREE.Object3D();
    scene.add(orbitContainer);

    // 2. Orbit Path (Visual Ring)
    // High Quality: More segments
    const segments = graphicsQuality === 'high' ? 256 : 128;
    const pathGeo = new THREE.RingGeometry(planetData.distance - 0.5, planetData.distance + 0.5, segments);
    const pathMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.15 // Faint orbit lines
    });
    const pathMesh = new THREE.Mesh(pathGeo, pathMat);
    pathMesh.rotation.x = -Math.PI / 2;
    scene.add(pathMesh); // Add separate so it doesn't rotate with orbitContainer
    const orbitPath = pathMesh; // Store for visibility toggling

    // 3. System Group (Holds Planet + Moons)
    const systemGroup = new THREE.Object3D();
    systemGroup.position.set(planetData.distance, 0, 0);
    orbitContainer.add(systemGroup);

    // 4. Planet Mesh
    // High Quality: More geometry segments + Textures
    const sphereSegs = graphicsQuality === 'high' ? 64 : 32;
    const geometry = new THREE.SphereGeometry(planetData.radius, sphereSegs, sphereSegs);

    let material;
    if (graphicsQuality === 'high') {
        const textureLoader = new THREE.TextureLoader();

        // Load texture (assumes assets exist for all main planets now)
        // Default to .jpg as downloaded
        const texturePath = `assets/${planetData.id}.jpg`;
        const map = textureLoader.load(texturePath);

        material = new THREE.MeshPhongMaterial({
            map: map,
            shininess: 5,
            specular: 0x333333
        });

    } else {
        material = new THREE.MeshLambertMaterial({
            color: planetData.color
        });
    }

    const mesh = new THREE.Mesh(geometry, material);

    // Shadow Props - Enable for all qualities but enhance in high
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    systemGroup.add(mesh);

    createLabel(mesh, planetData.name, planetData.id);

    // 5. Moons
    const moonIds = [];
    if (planetData.moons) {
        planetData.moons.forEach(moonData => {
            const moonId = createMoon(moonData, systemGroup); // Pass systemGroup as parent
            moonIds.push(moonId);
        });
    }

    // 6. Procedural Moons (Medium / High)
    if (graphicsQuality !== 'low') {
        // Gas Giants usually have rings/many moons.
        // Let's add them for planets far away or large radius (Jupiter+)
        if (planetData.radius > 8) { // Arbitrary check for "Gas Giant" size
            generateProceduralMoons(systemGroup, planetData.radius, 100);
        }
    }

    // Register
    celestialObjects[planetData.id] = {
        mesh: mesh,
        orbitContainer: orbitContainer, // Rotates around 0,0,0
        orbitPath: orbitPath,
        data: planetData,
        type: 'planet',
        angle: Math.random() * Math.PI * 2,
        childrenIds: moonIds
    };

    // Add to UI List
    addToList(planetData);
}

function generateProceduralMoons(parentGroup, planetRadius, count) {
    const geo = new THREE.SphereGeometry(0.2, 4, 4); // Tiny low-poly
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const instancedMesh = new THREE.InstancedMesh(geo, mat, count);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
        // Random orbit around planet
        const dist = planetRadius * (1.5 + Math.random() * 3); // 1.5x to 4.5x radius
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.5) * planetRadius * 0.2; // Flattened disc

        dummy.position.set(
            Math.cos(angle) * dist,
            height,
            Math.sin(angle) * dist
        );

        const scale = 0.5 + Math.random() * 0.5;
        dummy.scale.set(scale, scale, scale);

        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    parentGroup.add(instancedMesh);
    // Note: These procedural moons are purely visual, no interaction/labels to keep perf high
}

function createMoon(moonData, parentGroup) {
    // Moon Orbit Container (Pivots at Planet center)
    const moonOrbitContainer = new THREE.Object3D();
    parentGroup.add(moonOrbitContainer);

    // Moon Mesh
    const geometry = new THREE.SphereGeometry(moonData.radius, 16, 16);
    // Material
    let material;
    if (graphicsQuality === 'high') {
        const textureLoader = new THREE.TextureLoader();
        // Try specific moon texture, fallback to generic moon.jpg if not found (handled by logic or just map everything to what we have)
        // Since we copied moon.jpg to others, we can try loading by ID.
        // For safety, let's just use moon.jpg for everyone if specific file fails? 
        // No, we copied files so they exist.

        // However, there might be moons we missed.
        // Let's check if the ID is one of the main ones we have.
        const knownMoons = ['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'phobos', 'deimos'];
        let texPath = 'assets/moon.jpg'; // Default fallback
        if (knownMoons.includes(moonData.id)) {
            texPath = `assets/${moonData.id}.jpg`;
        }

        const tex = textureLoader.load(texPath);
        material = new THREE.MeshPhongMaterial({
            map: tex,
            shininess: 3,
            specular: 0x222222
        });
    } else {
        material = new THREE.MeshLambertMaterial({
            color: moonData.color
        });
    }

    // Create Mesh
    const mesh = new THREE.Mesh(geometry, material);

    // Enable shadows for moons
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position moon relative to planet
    // We add it to a container that rotates
    const distanceVector = new THREE.Vector3(moonData.distance, 0, 0);
    mesh.position.copy(distanceVector);

    moonOrbitContainer.add(mesh); // Add mesh to orbit container

    // Visual Path for Moon (Optional - kept simple)
    const pathGeo = new THREE.RingGeometry(moonData.distance - 0.1, moonData.distance + 0.1, 64);
    const pathMat = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
    const pathMesh = new THREE.Mesh(pathGeo, pathMat);
    pathMesh.rotation.x = -Math.PI / 2;
    parentGroup.add(pathMesh); // Add path to system group (static relative to planet)

    // Register
    celestialObjects[moonData.id] = {
        mesh: mesh,
        orbitContainer: moonOrbitContainer,
        data: moonData,
        type: 'moon',
        angle: Math.random() * Math.PI * 2
    };
    return moonData.id;
}

// Note: createOrbitPath is no longer used (inline in createPlanet/Moon)

function createLabel(mesh, text, id) {
    const div = document.createElement('div');
    div.className = id === 'sun' ? 'sun-label' : (mesh.geometry.parameters.radius > 5 ? 'planet-label' : 'moon-label');
    div.textContent = text;
    // Add specific class for styling if needed, defaulting to generic labels defined in CSS
    if (!div.className) div.className = 'planet-label';

    const label = new CSS2DObject(div);
    label.position.set(0, mesh.geometry.parameters.radius * 1.5, 0);
    mesh.add(label);

    // Click handling on label to select planet
    div.style.pointerEvents = 'auto'; // Re-enable for the div itself
    div.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // FOCUS LOCK: Only allow label clicks in overview mode
        // When focused, user must use UI list or Overview button
        if (currentFocus !== null) {
            return; // Ignore label clicks when in focus mode
        }
        
        focusOnObject(id);
    });
}

// --- UI HELPERS ---

function addToList(planetData) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${planetData.name}</span> <span style="font-size:10px; opacity:0.7">Planet</span>`;
    li.dataset.id = planetData.id;
    li.addEventListener('click', () => focusOnObject(planetData.id));
    planetListEl.appendChild(li);
}

function updateInfoPanel(data) {
    infoNameEl.textContent = data.name;
    
    // Check if this is a moon - find its parent planet
    let parentPlanet = null;
    const currentObj = celestialObjects[data.id];
    if (currentObj && currentObj.type === 'moon') {
        // Find parent planet
        const parentEntry = Object.values(celestialObjects).find(p => 
            p.childrenIds && p.childrenIds.includes(data.id)
        );
        if (parentEntry) {
            const parentId = Object.keys(celestialObjects).find(k => celestialObjects[k] === parentEntry);
            if (parentId) {
                parentPlanet = { id: parentId, name: parentEntry.data.name };
            }
        }
    }
    
    let html = '';
    
    // Back to parent button for moons
    if (parentPlanet) {
        html += `
        <div class="info-row">
            <button onclick="window.dispatchEvent(new CustomEvent('focus-moon', {detail: '${parentPlanet.id}'}))" 
                    style="padding:8px 12px; border:1px solid #4dbfec; background:rgba(77, 191, 236, 0.2); color:#4dbfec; border-radius:6px; cursor:pointer; width:100%; font-weight:bold; transition: all 0.2s;">
                ← Back to ${parentPlanet.name}
            </button>
        </div>`;
    } else {
        // Close button for planets/sun (not moons) - goes to overview
        html += `
        <div class="info-row">
            <button id="btn-close-info" 
                    style="padding:8px 12px; border:1px solid #ff6b6b; background:rgba(255, 107, 107, 0.2); color:#ff6b6b; border-radius:6px; cursor:pointer; width:100%; font-weight:bold; transition: all 0.2s;">
                ✕ Close & Overview
            </button>
        </div>`;
    }
    
    // Determine type from celestialObjects registry
    let objectType = 'Unknown';
    if (currentObj) {
        if (currentObj.type === 'star') objectType = 'Star';
        else if (currentObj.type === 'planet') objectType = 'Planet';
        else if (currentObj.type === 'moon') objectType = 'Moon';
        else if (currentObj.type === 'asteroidBelt') objectType = 'Asteroid Belt';
    } else {
        // Fallback for objects not in registry
        objectType = data.id === 'sun' ? 'Star' : (data.moons ? 'Planet' : 'Moon');
    }
    
    html += `
        <div class="info-row">
            <span class="info-label">Type</span>
            <span class="info-value">${objectType}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Radius</span>
            <span class="info-value">${data.radius} units</span>
        </div>
    `;

    if (data.distance) {
        html += `
        <div class="info-row">
            <span class="info-label">Distance from Parent</span>
            <span class="info-value">${data.distance} units</span>
        </div>`;
    }

    if (data.description) {
        html += `
        <div class="info-row">
            <span class="info-label">Description</span>
            <div style="font-size:0.95em; line-height:1.4; color:#ddd;">${data.description}</div>
        </div>`;
    }

    // Link to moons if any
    if (data.moons && data.moons.length > 0) {
        html += `<div class="info-row"><span class="info-label">Moons</span>`;
        html += `<div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">`;
        data.moons.forEach(m => {
            html += `<button onclick="window.dispatchEvent(new CustomEvent('focus-moon', {detail: '${m.id}'}))" style="padding:4px 8px; border:1px solid #555; background:transparent; color:white; border-radius:4px; cursor:pointer; transition: all 0.2s;">${m.name}</button>`;
        });
        html += `</div></div>`;
    }

    infoContentEl.innerHTML = html;
    rightPanelEl.classList.add('active');
    
    // Add event listener for close button (for non-moons)
    const closeBtn = document.getElementById('btn-close-info');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            zoomToOverview();
        });
    }
}

// Listen for custom event from inline HTML
window.addEventListener('focus-moon', (e) => {
    focusOnObject(e.detail);
});

// --- INTERACTION ---

function onPointerDown(event) {
    // Only handle clicks on canvas, not UI
    if (event.target.closest('.panel')) return;

    // FOCUS LOCK: Disable 3D mesh clicking when already focused on an object
    // User must use Overview button or UI list to change focus
    if (currentFocus !== null) {
        return; // Ignore all 3D clicks when in focus mode
    }

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true); // Recursive

    // Filter for planetary bodies (meshes)
    for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;

        // Helper to find ID from mesh or parent
        const findIdFromMesh = (m) => Object.keys(celestialObjects).find(key => celestialObjects[key].mesh === m);

        let foundId = findIdFromMesh(obj);
        if (!foundId && obj.parent) foundId = findIdFromMesh(obj.parent);

        if (foundId) {
            focusOnObject(foundId);
            return;
        }
    }
}

function focusOnObject(id) {
    if (isTransitioning) return;
    if (currentFocus === id) return; // Already there

    const targetObj = celestialObjects[id];
    if (!targetObj) return;

    currentFocus = id;
    
    // Add focus-locked class to canvas container
    container.classList.add('focus-locked');
    
    // Show focus hint (only once per session or first time)
    const focusHint = document.getElementById('focus-hint');
    if (focusHint && !window.focusHintShown) {
        focusHint.style.display = 'block';
        setTimeout(() => {
            focusHint.style.display = 'none';
        }, 2000);
        window.focusHintShown = true; // Show only once
    }

    // Highlight in list
    document.querySelectorAll('#planet-list li').forEach(li => {
        if (li.dataset.id === id) li.classList.add('active');
        else li.classList.remove('active');
    });

    updateInfoPanel(targetObj.data);

    // On mobile: hide left panel, show right panel and toggle button
    if (window.innerWidth <= 768) {
        const leftPanel = document.getElementById('left-panel');
        const rightPanel = document.getElementById('right-panel');
        leftPanel.classList.remove('mobile-open');
        
        if (window.matchMedia('(orientation: portrait)').matches) {
            mobileOverlay.classList.remove('active');
        }
        
        // Show info toggle button and minimize button
        if (mobileInfoToggle) {
            mobileInfoToggle.style.display = 'flex';
        }
        const btnMinimizeInfo = document.getElementById('btn-minimize-info');
        if (btnMinimizeInfo) {
            btnMinimizeInfo.style.display = 'flex';
        }
        // Right panel will show via its .active class
    }

    // Prepare for transition
    isTransitioning = true;

    updateFocusVisibility(id);

    // Calculate view positions
    const targetRadius = targetObj.data.radius;
    let offsetDist = targetRadius * 4; // Default
    if (id === 'sun') offsetDist = targetRadius * 4.0;
    
    // On mobile, zoom out 2x more to see the whole object
    if (window.innerWidth <= 768) {
        offsetDist *= 2;
    }

    // Get current world pos
    const targetWorldPos = new THREE.Vector3();
    targetObj.mesh.getWorldPosition(targetWorldPos);

    let viewDir;
    if (id === 'sun') {
        // For Sun, just back up along Z/Y
        viewDir = new THREE.Vector3(0, 0.5, 1).normalize();
    } else {
        // Calculate a nice "Front-Side" viewing angle relative to Sun
        // Vector from Sun to Planet
        const sunToPlanet = new THREE.Vector3().copy(targetWorldPos).normalize();

        // Vector pointing Back towards Sun (Inside-Out view)
        const planetToSun = new THREE.Vector3().copy(sunToPlanet).negate();

        // Sideways vector (Tangent to orbit)
        const tangent = new THREE.Vector3(0, 1, 0).cross(sunToPlanet).normalize();

        // Desired View Vector: Combination of looking from "Sun side" and "Orbit Side" (45 degrees)
        viewDir = new THREE.Vector3().addVectors(planetToSun, tangent).normalize();
    }

    // Apply Offset
    // End Camera Pos = PlanetPos + ViewDir * Distance
    const endCameraPos = new THREE.Vector3().copy(targetWorldPos).add(viewDir.multiplyScalar(offsetDist));
    if (id !== 'sun') endCameraPos.y += offsetDist * 0.3; // Slight elevation for planets

    new TWEEN.Tween(camera.position)
        .to(endCameraPos, 1500)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onUpdate(() => {
            // Manually turn controls to look at target during tween
            controls.target.lerp(targetWorldPos, 0.1);
            controls.update();
        })
        .onComplete(() => {
            controls.target.copy(targetWorldPos);
            isTransitioning = false; // Allow tracking
        })
        .start();

    // Also tween the controls target smoothly
    new TWEEN.Tween(controls.target)
        .to(targetWorldPos, 1500)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();

    new TWEEN.Tween(controls.target)
        .to(targetWorldPos, 1500)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onComplete(() => {
            isTransitioning = false;
            // No need to init previousTargetPosition anymore for rotation logic, just state
        })
        .start();

}

function zoomToOverview() {
    isTransitioning = true;
    currentFocus = null;
    updateFocusVisibility(null); // Reset visibility
    
    // Remove focus-locked class to allow clicking again
    container.classList.remove('focus-locked');

    rightPanelEl.classList.remove('active');
    document.querySelectorAll('#planet-list li').forEach(li => li.classList.remove('active'));

    // On mobile: close right panel and hide toggle buttons
    if (window.innerWidth <= 768) {
        rightPanelEl.classList.remove('mobile-open');
        rightPanelEl.classList.remove('minimized');
        if (mobileInfoToggle) {
            mobileInfoToggle.style.display = 'none';
        }
        const btnMinimizeInfo = document.getElementById('btn-minimize-info');
        if (btnMinimizeInfo) {
            btnMinimizeInfo.style.display = 'none';
        }
    }

    new TWEEN.Tween(camera.position)
        .to({ x: 0, y: 400, z: 600 }, 1500)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onComplete(() => { isTransitioning = false; })
        .start();

    new TWEEN.Tween(controls.target)
        .to({ x: 0, y: 0, z: 0 }, 1500)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();
}

// --- VISIBILITY HELPER ---
function updateFocusVisibility(targetId) {
    if (!targetId) {
        // Show Everything
        if (celestialObjects['sun']) celestialObjects['sun'].mesh.visible = true;
        Object.values(celestialObjects).forEach(obj => {
            if (obj.orbitContainer) obj.orbitContainer.visible = true;
            if (obj.orbitPath) obj.orbitPath.visible = true;
        });
        return;
    }

    // Determine the "Active System" (Planet + Moons)
    const targetObj = celestialObjects[targetId];
    let systemRootId = targetId;

    // If focusing on Sun, show everything
    if (targetId === 'sun') {
        if (celestialObjects['sun']) celestialObjects['sun'].mesh.visible = true;
        Object.values(celestialObjects).forEach(obj => {
            if (obj.orbitContainer) obj.orbitContainer.visible = true;
            if (obj.orbitPath) obj.orbitPath.visible = true;
        });
        return;
    }

    // If moon, escalate to parent planet
    if (targetObj.type === 'moon') {
        // We didn't store parentId in celestialObjects explicitly in my fix above, 
        // but we can find it or use the mesh hierarchy
        // Actually earlier 'createMoon' I did: parentId: planetMesh.uuid logic was in comments
        // Let's rely on finding the planet entry that contains this moon
        const parentEntry = Object.values(celestialObjects).find(p => p.childrenIds && p.childrenIds.includes(targetId));
        if (parentEntry) systemRootId = Object.keys(celestialObjects).find(k => celestialObjects[k] === parentEntry);
    }

    // Hide Sun when focusing on planets/moons
    if (celestialObjects['sun']) celestialObjects['sun'].mesh.visible = false;

    // Filter Loop
    Object.keys(celestialObjects).forEach(key => {
        const obj = celestialObjects[key];

        if (key === 'sun') return; // Handled

        // If it's the active system root (Planet)
        if (key === systemRootId) {
            obj.orbitContainer.visible = true;
            if (obj.orbitPath) obj.orbitPath.visible = false; // Hide the ring around sun, looks cleaner
        } else {
            // Check if it is a moon of the active system
            // In my structure, Moons are inside the Planet's "systemGroup"
            // So if Planet's orbitContainer is visible, Moons are visible?
            // Yes, because orbitContainer -> systemGroup -> moonOrbitContainer -> moonMesh

            // So we just need to hide OTHER planets.
            if (obj.type === 'planet' && key !== systemRootId) {
                obj.orbitContainer.visible = false;
                if (obj.orbitPath) obj.orbitPath.visible = false;
            }
            // Moons don't have separate 'orbitContainer' at root level, so we don't need to hide them individually
            // Their visibility is controlled by their parent planet's container
        }
    });
}


// --- ANIMATION LOOP ---

function animate(time) {
    requestAnimationFrame(animate);

    TWEEN.update(time);

    // FPS Counter
    frames++;
    const currentTime = performance.now();
    if (currentTime >= lastTime + 1000) {
        fps = Math.round((frames * 1000) / (currentTime - lastTime));
        fpsCounter.textContent = `${fps}`;
        frames = 0;
        lastTime = currentTime;
    }

    // 1. Update Orbits & Rotations
    // Use clock for delta if needed, but constants are fine for now
    const SPEED_SCALE = 0.1 * orbitSpeed; // Apply speed multiplier

    Object.values(celestialObjects).forEach(obj => {
        // Rotation (Self)
        if (obj.data.rotationSpeed && obj.mesh) {
            obj.mesh.rotation.y += obj.data.rotationSpeed * SPEED_SCALE;
        }

        // Orbit (Around Parent)
        if (obj.orbitContainer && obj.data.orbitalSpeed) {
            obj.angle += obj.data.orbitalSpeed * SPEED_SCALE;
            obj.orbitContainer.rotation.y = obj.angle;
        }
        
        // Asteroid Belt rotation (slow rotation around sun)
        if (obj.type === 'asteroidBelt' && obj.mesh) {
            obj.angle += obj.data.rotationSpeed * SPEED_SCALE;
            obj.mesh.rotation.y = obj.angle;
            
            // Rotate labels too
            if (obj.labels) {
                obj.labels.forEach(label => {
                    const currentPos = label.position.clone();
                    const distance = Math.sqrt(currentPos.x * currentPos.x + currentPos.z * currentPos.z);
                    const currentAngle = Math.atan2(currentPos.z, currentPos.x);
                    const newAngle = currentAngle + obj.data.rotationSpeed * SPEED_SCALE;
                    label.position.set(
                        Math.cos(newAngle) * distance,
                        currentPos.y,
                        Math.sin(newAngle) * distance
                    );
                });
            }
        }
    });

    // 2. Camera Tracking (Orbital Locking)
    if (currentFocus && !isTransitioning) {
        const obj = celestialObjects[currentFocus];
        if (obj && obj.mesh) {
            const currentWorldPos = new THREE.Vector3();
            obj.mesh.getWorldPosition(currentWorldPos);

            // 1. Move controls target to follow object explicitly
            controls.target.copy(currentWorldPos);

            // 2. Rotate Camera with the Orbit to maintain relative angle
            // This prevents "Strafing" where the planet rotates but camera stays still world-wise

            if (obj.data.orbitalSpeed) {
                // Stable Orbit Logic: Rotate camera around the central pivot to match the object's orbit.
                // This preserves the distance/angle perfectly without drift.

                if (obj.type === 'planet') {
                    // Planet orbits Sun (0,0,0)
                    rotateCameraAroundPoint(camera, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), obj.data.orbitalSpeed * SPEED_SCALE);
                }
                else if (obj.type === 'moon') {
                    // Moon orbits Planet. 
                    // 1. We must apply the Parent Planet's orbit (around Sun) to the camera first
                    //    so the camera keeps up with the Planet System.
                    // We need to find the parent planet's speed. 
                    // Navigate up: MoonMesh -> MoonOrbit -> SystemGroup. SystemGroup holds PlanetMesh.
                    const planetSystem = obj.mesh.parent.parent;
                    // We can't easily access planet data here blindly, but we can infer or find it.
                    // Safer: find the planet object in our registry that corresponds to this system.
                    const planetEntry = Object.values(celestialObjects).find(o => o.type === 'planet' && o.orbitContainer === planetSystem.parent);

                    if (planetEntry) {
                        // Apply Planet's Orbit (around Sun)
                        rotateCameraAroundPoint(camera, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), planetEntry.data.orbitalSpeed * SPEED_SCALE);

                        // Apply Moon's Orbit (around Planet)
                        const planetPos = new THREE.Vector3();
                        planetEntry.mesh.getWorldPosition(planetPos);
                        rotateCameraAroundPoint(camera, planetPos, new THREE.Vector3(0, 1, 0), obj.data.orbitalSpeed * SPEED_SCALE);
                    }
                }
            }
        }
    }

    controls.update();
    
    // Update label renderer BEFORE rendering to reduce lag
    labelRenderer.render(scene, camera);
    
    // renderer.render(scene, camera); // Replaced by composer
    composer.render();
}

function rotateCameraAroundPoint(camera, point, axis, theta) {
    camera.position.sub(point); // translate to local
    camera.position.applyAxisAngle(axis, theta); // rotate
    camera.position.add(point); // translate back
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // Update composer
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    
    // Adjust camera FOV for mobile
    if (window.innerWidth < 768) {
        camera.fov = 60; // Wider FOV for mobile
    } else {
        camera.fov = SCENE_CONFIG.fov;
    }
    camera.updateProjectionMatrix();
}
