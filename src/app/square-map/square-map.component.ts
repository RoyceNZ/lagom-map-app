import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { createNoise2D } from 'simplex-noise';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-square-map',
  imports: [FormsModule],
  templateUrl: './square-map.component.html',
})
export class SquareMapComponent implements AfterViewInit {
  @ViewChild('rendererContainer', { static: false }) rendererContainer!: ElementRef;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;

  maxHeight = 10;
  stoneHeight = 0.8;
  dirtHeight = 0.7;
  grassHeight = 0.5;
  sandHeight = 0.3;

  houseSize = 5;
  sectionSize = 10;

  light!: THREE.DirectionalLight;

  ngAfterViewInit(): void {
    this.initScene();
    this.updateMap();
  }

  initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#ADD8E6"); // Set the background color of the scene to light blue
    
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(-217, 231, 233); // Set the camera position to see the squares

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize((window.innerWidth / 3) * 2, (window.innerHeight / 3) * 2);
    // center the window
    this.renderer.domElement.style.margin = 'auto';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    document.body.appendChild(this.renderer.domElement);

    this.light = new THREE.DirectionalLight(new THREE.Color("#FFFFE0").convertSRGBToLinear(), 2);
    this.light.position.set(20, 50, 30);

    this.light.castShadow = true;
    this.light.shadow.mapSize.width = 512;
    this.light.shadow.mapSize.height = 512;
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = 500;
    this.scene.add(this.light);

    // Create controls to move the camera
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.dampingFactor = 0.1;
    controls.enableDamping = true;
    controls.minDistance = 30;
    controls.maxDistance = 500;

    this.renderer.setAnimationLoop(() => {
      controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  async updateMap(): Promise<void> {
    this.scene.clear();

    // Add the light back to the scene after clearing it
    this.scene.add(this.light);

    let pmrem = new THREE.PMREMGenerator(this.renderer);
    let envMapTexture = await new RGBELoader().setDataType(THREE.FloatType).loadAsync('assets/envmap.hdr');
    let envmap = pmrem.fromEquirectangular(envMapTexture).texture;

    let textures = {
      grass: new THREE.TextureLoader().load('assets/grass.jpg'),
      stone: new THREE.TextureLoader().load('assets/stone.png'),
      sand: new THREE.TextureLoader().load('assets/sand.jpg'),
      dirt: new THREE.TextureLoader().load('assets/dirt.png'),
      dirt2: new THREE.TextureLoader().load('assets/dirt2.jpg'),
      water: new THREE.TextureLoader().load('assets/water.jpg'),
    }
    
    const noise2D = createNoise2D();
    const squareCount = 141 * 141;
    const squareGeometry = new THREE.BoxGeometry(1.77, 1, 1.535);
    const stoneMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.stone }), squareCount);
    const dirtMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.dirt }), squareCount);
    const dirt2Mesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.dirt2 }), squareCount);
    const sandMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.sand }), squareCount);
    const grassMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.grass }), squareCount);

    let stoneIndex = 0;
    let dirtIndex = 0;
    let dirt2Index = 0;
    let sandIndex = 0;
    let grassIndex = 0;

    // Create the squares
    for(let i = -70; i <= 70; i++) {
      for(let j = -70; j <= 70; j++) {
        let position = this.tileToPosition(i, j);

        let noise = (noise2D(i * 0.025, j * 0.025) + 1) * 0.5;
        noise = Math.pow(noise, 1.5);

        let height = noise * this.maxHeight;
        let matrix = new THREE.Matrix4().makeTranslation(position.x, height * 0.5, position.y);
        matrix.scale(new THREE.Vector3(1, height, 1));

        if (height > this.stoneHeight * this.maxHeight) {
          stoneMesh.setMatrixAt(stoneIndex++, matrix);
        } else if (height > this.dirtHeight * this.maxHeight) {
          dirtMesh.setMatrixAt(dirtIndex++, matrix);
        } else if (height > this.grassHeight * this.maxHeight) {
          grassMesh.setMatrixAt(grassIndex++, matrix);
        } else if (height > this.sandHeight * this.maxHeight) {
          sandMesh.setMatrixAt(sandIndex++, matrix);
        } else {
          dirt2Mesh.setMatrixAt(dirt2Index++, matrix);
        }
      }
    }

    // Add houseSize squares
    this.addSpecialSquares(this.houseSize, 12, textures.stone, stoneMesh, stoneIndex);

    // Add sectionSize squares
    this.addSpecialSquares(this.sectionSize, 10, textures.grass, grassMesh, grassIndex);

    stoneMesh.instanceMatrix.needsUpdate = true;
    dirtMesh.instanceMatrix.needsUpdate = true;
    dirt2Mesh.instanceMatrix.needsUpdate = true;
    sandMesh.instanceMatrix.needsUpdate = true;
    grassMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(stoneMesh, dirtMesh, dirt2Mesh, sandMesh, grassMesh);
  }

  addSpecialSquares(size: number, height: number, texture: THREE.Texture, mesh: THREE.InstancedMesh, index: number): void {
    const halfSize = Math.floor(size / 2);
    for (let i = -halfSize; i <= halfSize; i++) {
      for (let j = -halfSize; j <= halfSize; j++) {
        let position = this.tileToPosition(i, j);
        let matrix = new THREE.Matrix4().makeTranslation(position.x, height * 0.5, position.y);
        matrix.scale(new THREE.Vector3(1, height, 1));
        mesh.setMatrixAt(index++, matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  tileToPosition(tileX: number, tileY: number): THREE.Vector2 {
    return new THREE.Vector2(tileX * 1.77, tileY * 1.535);
  }
}