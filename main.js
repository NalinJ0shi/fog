import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/loaders/GLTFLoader.js';
// SkeletonUtils is no longer needed if trees are part of the terrain model
// import { SkeletonUtils } from 'https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/utils/SkeletonUtils.js';


const _NOISE_GLSL = `
// ... (your existing _NOISE_GLSL code, unchanged) ...
vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
      return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
    return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v)
{
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

// First corner
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;

// Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
    vec3 x3 = x0 - D.yyy;       // -1.0+3.0*C.x = -0.5 = D.y

// Permutations
    i = mod289(i);
    vec4 p = permute( permute( permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// Gradients
    float n_ = 0.142857142857; // 1.0/7.0
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);   //  mod(p,7*7)
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

// Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

// Mix final noise value
    vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                 dot(p2,x2), dot(p3,x3) ) );
}

float FBM(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 0.0;
    for (int i = 0; i < 6; ++i) {
        value += amplitude * snoise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}
`;

class FogDemo {
    constructor() {
        this.initialFogDensity = 0.00005;
        this.initialFogHeightFactor = 0.05;

        this.threejs_ = new THREE.WebGLRenderer({
            antialias: true,
        });
        this.threejs_.shadowMap.enabled = true;
        this.threejs_.shadowMap.type = THREE.PCFSoftShadowMap;
        this.threejs_.setPixelRatio(window.devicePixelRatio);
        this.threejs_.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.threejs_.domElement);

        const fov = 60;
        const aspect = window.innerWidth / window.innerHeight; // Use current aspect
        const near = 1.0;
        const far = 30000.0; // Increased far plane for potentially larger scene
        this.camera_ = new THREE.PerspectiveCamera(fov, aspect, near, far);
        this.camera_.position.set(75, 50, 100); // Adjust camera based on your combined model scale

        this.scene_ = new THREE.Scene();
        this.totalTime_ = 0.0;
        this.previousRAF_ = null;
        this.shaders_ = [];
        this.gltfLoader_ = new GLTFLoader();

        // Removed separate loadedTerrain_ and loadedTree_
        this.loadedCombinedModel_ = null;


        this.SetupShaderChunks_();

        window.addEventListener('resize', () => {
            this.OnWindowResize_();
        }, false);
    }

    SetupShaderChunks_() {
        THREE.ShaderChunk.fog_fragment = `
        #ifdef USE_FOG
            vec3 fogOrigin = cameraPosition;
            vec3 fogDirection = normalize(vWorldPosition - fogOrigin);
            float fogDepth = distance(vWorldPosition, fogOrigin);

            vec3 noiseSampleCoord = vWorldPosition * 0.00025 + vec3(
                0.0, 0.0, fogTime * 0.025);
            float noiseSample = FBM(noiseSampleCoord + FBM(noiseSampleCoord)) * 0.5 + 0.5;
            // Adjust the threshold (5000.0) if your new scene scale is very different
            fogDepth *= mix(noiseSample, 1.0, saturate((fogDepth - 5000.0) / 5000.0));
            fogDepth *= fogDepth;

            float heightFactor = fogHeightFactor;
            float fogFactor = heightFactor * exp(-fogOrigin.y * fogDensity) * (
                1.0 - exp(-fogDepth * fogDirection.y * fogDensity)) / fogDirection.y;
            fogFactor = saturate(fogFactor);

            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif`;

        THREE.ShaderChunk.fog_pars_fragment = _NOISE_GLSL + `
        #ifdef USE_FOG
            uniform float fogTime;
            uniform vec3 fogColor;
            varying vec3 vWorldPosition;
            uniform float fogHeightFactor;
            #ifdef FOG_EXP2
                uniform float fogDensity;
            #else
                uniform float fogNear;
                uniform float fogFar;
            #endif
        #endif`;

        THREE.ShaderChunk.fog_vertex = `
        #ifdef USE_FOG
            vWorldPosition = worldPosition.xyz;
        #endif`;

        THREE.ShaderChunk.fog_pars_vertex = `
        #ifdef USE_FOG
            varying vec3 vWorldPosition;
        #endif`;
    }

    // Removed LoadModels_ as loading is now done in Initialize_

    ModifyShaderCallback_ = (shader) => {
        this.shaders_.push(shader);
        shader.uniforms.fogTime = { value: 0.0 };
        // Initialize with scene fog if available, otherwise use initial values
        const density = (this.scene_ && this.scene_.fog) ? this.scene_.fog.density : this.initialFogDensity;
        shader.uniforms.fogDensity = { value: density };
        shader.uniforms.fogHeightFactor = { value: this.initialFogHeightFactor };
    };

    ApplyShaderToModelMaterials_(model, castsShadow = false, receivesShadow = false) {
        if (!model) return;
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = castsShadow;
                child.receiveShadow = receivesShadow;

                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    if (material) {
                        material.onBeforeCompile = this.ModifyShaderCallback_;
                        // If fog is already set, ensure the uniform is updated
                        if (this.scene_ && this.scene_.fog) {
                            if (material.uniforms && material.uniforms.fogDensity) {
                                material.uniforms.fogDensity.value = this.scene_.fog.density;
                            }
                        }
                        material.needsUpdate = true;
                    }
                });
            }
        });
    }


    async Initialize_() {
        // Load the combined terrain and trees model directly here
        try {
            const combinedData = await this.gltfLoader_.loadAsync('terrain2.glb'); // Load the new combined file
            this.loadedCombinedModel_ = combinedData.scene; // Store the combined model

            console.log('Combined model loaded successfully', this.loadedCombinedModel_);

        } catch (error) {
            console.error('Error loading combined model:', error);
            // You might still want a fallback here if loading fails
        }

        // Lights
        let light = new THREE.DirectionalLight(0xFFFFFF, 1.5); // Slightly stronger light
        light.position.set(100, 200, 100); // Adjust light position based on the scale of your combined model
        light.target.position.set(0, 0, 0); // Adjust target if combined model center is different
        light.castShadow = true;
        light.shadow.bias = -0.001;
        light.shadow.mapSize.width = 4096; // Increased shadow map size
        light.shadow.mapSize.height = 4096;
        // Adjust shadow camera frustum based on your combined model's scale
        light.shadow.camera.near = 10;
        light.shadow.camera.far = 1000;
        light.shadow.camera.left = -200; // Example, adjust to fit the combined model
        light.shadow.camera.right = 200;
        light.shadow.camera.top = 200;
        light.shadow.camera.bottom = -200;
        this.scene_.add(light);
        // this.scene_.add(new THREE.CameraHelper(light.shadow.camera)); // Optional: to debug shadow camera

        const ambientLight = new THREE.AmbientLight(0x404040, 1.0); // Adjusted ambient light
        this.scene_.add(ambientLight);

        // Controls
        const controls = new OrbitControls(this.camera_, this.threejs_.domElement);
        controls.target.set(0, 0, 0); // Adjust target if combined model center is different
        controls.update();

        // Sky
        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(this.camera_.far * 0.9, 32, 32), // Skybox slightly within far plane
            new THREE.MeshBasicMaterial({
                color: 0x8080FF, // Sky color
                side: THREE.BackSide,
                fog: false // Skybox itself should not be affected by scene fog usually
            })
        );
        this.scene_.add(sky);

        // Add the combined model (terrain + trees)
        if (this.loadedCombinedModel_) {
            // --- MANUAL SCALING ADJUSTMENT HERE for the ENTIRE combined model ---
            // Uncomment the line below and change the values (e.g., 0.1, 0.1, 0.1)
            // to adjust the size of the entire combined model.
            // This is where you fix the overall size mismatch.
            // Example: this.loadedCombinedModel_.scale.set(0.5, 0.5, 0.5); // Make the whole thing half size
            // Example: this.loadedCombinedModel_.scale.set(2, 2, 2); // Make the whole thing double size
             this.loadedCombinedModel_.scale.set(10, 10, 10); // <-- Change these values for X, Y, Z scaling

            // --- MANUAL POSITION ADJUSTMENT HERE for the ENTIRE combined model ---
            // You might also need to adjust the position if the model's origin isn't at the base or center
            // Example: this.loadedCombinedModel_.position.set(0, -10, 0); // Adjust as needed if model is too high/low
             this.loadedCombinedModel_.position.set(0, 0, 0); // <-- Change these values for X, Y, Z position


            this.scene_.add(this.loadedCombinedModel_);
            // Apply shader to all meshes within the combined model
            this.ApplyShaderToModelMaterials_(this.loadedCombinedModel_, true, true); // Assuming terrain/trees cast/receive shadows
        } else {
            console.warn("Combined model not loaded, falling back to plane.");
            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(2000, 2000, 100, 100), // Fallback plane
                new THREE.MeshStandardMaterial({ color: 0x808080 })
            );
            ground.rotation.x = -Math.PI / 2.0;
            ground.receiveShadow = true;
            ground.material.onBeforeCompile = this.ModifyShaderCallback_;
            this.scene_.add(ground);
        }

        // --- REMOVED the old separate terrain and tree loading/scattering logic ---
        // Previously this section loaded terrain.glb and scattered tree.glb instances.
        // This is now handled by loading the single terrain2.glb model.


        // Monolith (adjust position/scale if needed relative to the combined model)
        const monolith = new THREE.Mesh(
            new THREE.BoxGeometry(50, 200, 10), // Scaled down monolith for example
            new THREE.MeshStandardMaterial({color: 0x111111, metalness: 0.9, roughness: 0.2}));
        monolith.position.set(0, 100, -150); // Adjust position
        monolith.castShadow = true;
        monolith.material.onBeforeCompile = this.ModifyShaderCallback_;
        this.scene_.add(monolith);

        // Scene Fog - set this up after materials that might reference its initial value
        this.scene_.fog = new THREE.FogExp2(0xDFE9F3, this.initialFogDensity);

        // Update existing shaders with the final fog settings
        for (let s of this.shaders_) {
            if (s.uniforms.fogDensity) s.uniforms.fogDensity.value = this.scene_.fog.density;
            // fogHeightFactor is already set from initialFogHeightFactor
        }

        // Adjust camera position/target if the scale/position of the combined model changes significantly
        // Example: this.camera_.position.set(adjustX, adjustY, adjustZ);
        // Example: controls.target.set(adjustX, adjustY, adjustZ);
        controls.update(); // Important to update controls after changing target
    }

    CreateUI_() {
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.top = '10px';
        container.style.left = '10px';
        container.style.padding = '10px';
        container.style.backgroundColor = 'rgba(0,0,0,0.7)';
        container.style.color = 'white';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.borderRadius = '5px';
        container.style.zIndex = '100'; // Ensure UI is on top
        document.body.appendChild(container);

        // --- Fog Density Control ---
        const densityControlDiv = document.createElement('div');
        densityControlDiv.style.marginBottom = '10px';
        container.appendChild(densityControlDiv);

        const densityLabel = document.createElement('label');
        densityLabel.htmlFor = 'fogDensitySlider';
        densityLabel.textContent = 'Fog Density: ';
        densityLabel.style.display = 'block';
        densityControlDiv.appendChild(densityLabel);

        const densitySlider = document.createElement('input');
        densitySlider.type = 'range';
        densitySlider.id = 'fogDensitySlider';
        densitySlider.min = '0.00000';
        densitySlider.max = '0.002'; // Increased max slightly
        densitySlider.step = '0.000001';
        densitySlider.value = (this.scene_.fog ? this.scene_.fog.density : this.initialFogDensity).toString();
        densitySlider.style.width = '150px';
        densityControlDiv.appendChild(densitySlider);

        const densityValueDisplay = document.createElement('span');
        densityValueDisplay.id = 'fogDensityValue';
        densityValueDisplay.textContent = ` ${parseFloat(densitySlider.value).toFixed(6)}`;
        densityValueDisplay.style.marginLeft = '5px';
        densityControlDiv.appendChild(densityValueDisplay);

        densitySlider.addEventListener('input', (event) => {
            const newDensity = parseFloat(event.target.value);
            if (this.scene_.fog) {
                this.scene_.fog.density = newDensity;
            }
            for (let s of this.shaders_) {
                if (s.uniforms.fogDensity) {
                    s.uniforms.fogDensity.value = newDensity;
                }
            }
            densityValueDisplay.textContent = ` ${newDensity.toFixed(6)}`;
        });

        // --- Fog Height Factor Control ---
        const heightControlDiv = document.createElement('div');
        container.appendChild(heightControlDiv);

        const heightLabel = document.createElement('label');
        heightLabel.htmlFor = 'fogHeightSlider';
        heightLabel.textContent = 'Fog Height Factor: ';
        heightLabel.style.display = 'block';
        heightControlDiv.appendChild(heightLabel);

        const heightSlider = document.createElement('input');
        heightSlider.type = 'range';
        heightSlider.id = 'fogHeightSlider';
        heightSlider.min = '0.0';
        heightSlider.max = '0.5'; // Adjusted max
        heightSlider.step = '0.001';
        heightSlider.value = this.initialFogHeightFactor.toString();
        heightSlider.style.width = '150px';
        heightControlDiv.appendChild(heightSlider);

        const heightValueDisplay = document.createElement('span');
        heightValueDisplay.id = 'fogHeightValue';
        heightValueDisplay.textContent = ` ${parseFloat(heightSlider.value).toFixed(3)}`;
        heightValueDisplay.style.marginLeft = '5px';
        heightControlDiv.appendChild(heightValueDisplay);

        heightSlider.addEventListener('input', (event) => {
            const newHeightFactor = parseFloat(event.target.value);
            this.initialFogHeightFactor = newHeightFactor; // Update the stored factor
            for (let s of this.shaders_) {
                if (s.uniforms.fogHeightFactor) {
                    s.uniforms.fogHeightFactor.value = newHeightFactor;
                }
            }
            heightValueDisplay.textContent = ` ${newHeightFactor.toFixed(3)}`;
        });
    }

    OnWindowResize_() {
        this.camera_.aspect = window.innerWidth / window.innerHeight;
        this.camera_.updateProjectionMatrix();
        this.threejs_.setSize(window.innerWidth, window.innerHeight);
    }

    RAF_() {
        requestAnimationFrame((t) => {
            if (!this.previousRAF_) {
                this.previousRAF_ = t;
            }

            this.Step_((t - this.previousRAF_) * 0.001);
            this.previousRAF_ = t;

            this.threejs_.render(this.scene_, this.camera_);
            this.RAF_();
        });
    }

    Step_(timeElapsed) {
        if (isNaN(timeElapsed) || timeElapsed <=0 ) return; // Guard against invalid timeElapsed
        this.totalTime_ += timeElapsed;
        for (let s of this.shaders_) {
            if (s.uniforms.fogTime) { // Check if fogTime uniform exists
                s.uniforms.fogTime.value = this.totalTime_;
            }
        }
    }
}

let _APP = null;

window.addEventListener('DOMContentLoaded', async () => {
    _APP = new FogDemo();
    await _APP.Initialize_(); // Initialize scene, load model
    _APP.CreateUI_();       // Create UI after scene and fog are ready
    _APP.RAF_();             // Start render loop
});