// import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';

// import * as THREE from 'three';
// import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
// import { createNoise2D } from 'simplex-noise';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// @Component({
//   selector: 'app-hex-map',
//   imports: [],
//   templateUrl: './hex-map.component.html',
//   styleUrl: './hex-map.component.css'
// })
// export class HexMapComponent implements AfterViewInit {
//   @ViewChild('rendererContainer', { static: false }) rendererContainer!: ElementRef;
//   scene!: THREE.Scene;
//   camera!: THREE.PerspectiveCamera;
//   renderer!: THREE.WebGLRenderer;

//   ngAfterViewInit(): void {
//     this.scene = new THREE.Scene();
//     this.scene.background = new THREE.Color("#FFEECC"); // Set the background color of the scene
    
//     this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
//     this.camera.position.set(-17, 31, 33); // Set the camera position to see the hexagons

//     this.renderer = new THREE.WebGLRenderer({ antialias: true });
//     this.renderer.setSize(window.innerWidth, window.innerHeight);
//     this.renderer.toneMapping = THREE.ACESFilmicToneMapping
//     this.renderer.shadowMap.enabled = true;
//     this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    

//     document.body.appendChild(this.renderer.domElement);

//     const light = new THREE.DirectionalLight(new THREE.Color("#ADD8E6").convertSRGBToLinear(), 2);
//     light.position.set(20, 50, 30);

//     light.castShadow = true;
//     light.shadow.mapSize.width = 512;
//     light.shadow.mapSize.height = 512;
//     light.shadow.camera.near = 0.5;
//     light.shadow.camera.far = 500;
//     this.scene.add(light);

//     // Create controls to move the camera
//     const controls = new OrbitControls(this.camera, this.renderer.domElement);
//     controls.target.set(0, 0, 0);
//     controls.dampingFactor = 0.1;
//     controls.enableDamping = true;
    

//     let envmap: THREE.Texture;
//     // Create a hexagon
//     // let hexagonGeometries: THREE.BufferGeometry | null = null;
//     let stoneGeo: THREE.BufferGeometry = new THREE.BoxGeometry(0, 0, 0);
//     let dirtGeo: THREE.BufferGeometry = new THREE.BoxGeometry(0, 0, 0);
//     let dirt2Geo: THREE.BufferGeometry = new THREE.BoxGeometry(0, 0, 0);
//     let sandGeo: THREE.BufferGeometry = new THREE.BoxGeometry(0, 0, 0);
//     let grassGeo: THREE.BufferGeometry = new THREE.BoxGeometry(0, 0, 0);

//     const MAX_HEIGHT = 10;
//     const STONE_HEIGHT = MAX_HEIGHT * 0.8;
//     const DIRT_HEIGHT = MAX_HEIGHT * 0.7;
//     const GRASS_HEIGHT = MAX_HEIGHT * 0.5;
//     const SAND_HEIGHT = MAX_HEIGHT * 0.3;
//     const DIRT2_HEIGHT = MAX_HEIGHT * 0;

//     (async () => {
//       // Load the environment map
//       let pmrem = new THREE.PMREMGenerator(this.renderer);
//       let envMapTexture = await new RGBELoader().setDataType(THREE.FloatType).loadAsync('assets/envmap.hdr');
//       envmap = pmrem.fromEquirectangular(envMapTexture).texture;

//       let textures = {
//         grass: new THREE.TextureLoader().load('assets/grass.jpg'),
//         stone: new THREE.TextureLoader().load('assets/stone.png'),
//         sand: new THREE.TextureLoader().load('assets/sand.jpg'),
//         dirt: new THREE.TextureLoader().load('assets/dirt.png'),
//         dirt2: new THREE.TextureLoader().load('assets/dirt2.jpg'),
//         water: new THREE.TextureLoader().load('assets/water.jpg'),
//       }
      
//       const noise2D = createNoise2D();
//       // Create the hexagon
//       for(let i = -15; i <= 15; i++) {
//         for(let j = -15; j <= 15; j++) {
//           let position = tileToPosition(i, j);

//           if(position.length() > 16) continue;

//           let noise = (noise2D(i * 0.1, j * 0.1) + 1) * 0.5;
//           noise = Math.pow(noise, 1.5);

//           makeHex(noise * MAX_HEIGHT , position);
//         }
//       }

//       let stoneMesh = hexMesh(stoneGeo, textures.stone);
//       let dirtMesh = hexMesh(dirtGeo, textures.dirt);
//       let dirt2Mesh = hexMesh(dirt2Geo, textures.dirt2);
//       let sandMesh = hexMesh(sandGeo, textures.sand);
//       let grassMesh = hexMesh(grassGeo, textures.grass);
//       this.scene.add(stoneMesh, dirtMesh, dirt2Mesh, sandMesh, grassMesh);


//       this.renderer.setAnimationLoop(() => {
//         controls.update();
//         this.renderer.render(this.scene, this.camera);
//       });
//     })();

//     function tileToPosition(tileX: number, tileY: number) {
//       return new THREE.Vector2((tileX + (tileY % 2) * 0.5) * 1.77, tileY * 1.535);
//     }

//     function hexGeometry(height: any, position: any) {
//       let geo = new THREE.CylinderGeometry(1, 1, height, 6, 1, false);
//       geo.translate(position.x, height * 0.5, position.y);

//       return geo;
//     }

//     function makeHex(height: any, position: any) {
//       let geo = hexGeometry(height, position);

//       if (height > STONE_HEIGHT) {
//         stoneGeo = BufferGeometryUtils.mergeGeometries([ geo, stoneGeo ]);
//       } else if (height > DIRT_HEIGHT) {
//         dirtGeo = BufferGeometryUtils.mergeGeometries([ geo , dirtGeo ]);
//       }
//       else if (height > GRASS_HEIGHT) {
//         grassGeo = BufferGeometryUtils.mergeGeometries([ geo , grassGeo ]);
//       }
//       else if (height > SAND_HEIGHT) {
//         sandGeo = BufferGeometryUtils.mergeGeometries([geo , sandGeo]);
//       }
//       else if (height > DIRT2_HEIGHT) {
//         dirt2Geo = BufferGeometryUtils.mergeGeometries([ geo , dirt2Geo ]);
//       }
//     }

//     function hexMesh(geo: any, map: any) {
//       let mat = new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, map });

//       let mesh = new THREE.Mesh(geo, mat);
//       mesh.castShadow = true;
//       mesh.receiveShadow = true;

//       return mesh;
//     }
//   }
// }
