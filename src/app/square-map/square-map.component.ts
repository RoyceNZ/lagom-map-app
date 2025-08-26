import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Define comprehensive terrain types based on Earth's biomes
export type TerrainType = 
  | 'saltwater'
  | 'freshwater'
  | 'borealForest'
  | 'temperateForest'
  | 'tropicalRainforest'
  | 'temperateGrassland'
  | 'savanna'
  | 'tundra'
  | 'deserts'
  | 'mountains'
  | 'pastureland'
  | 'cropland'
  | 'scrub'
  | 'urban';

// Visual representation mapping (Three.js material types)
export type VisualTerrainType = 'stone' | 'dirt' | 'dirt2' | 'sand' | 'grass' | 'water';

// Map terrain types to visual representation (Three.js materials)
export const TERRAIN_VISUAL_MAPPING: Record<TerrainType, VisualTerrainType> = {
  saltwater: 'dirt2',           // Blue water texture (ocean)
  freshwater: 'water',          // Alternative water texture (lakes/rivers)  
  borealForest: 'grass',        // Green forest texture
  temperateForest: 'grass',     // Green forest texture
  tropicalRainforest: 'grass',  // Green forest texture
  temperateGrassland: 'grass',  // Green grass texture
  savanna: 'sand',              // Sandy/tan texture for dry grassland
  tundra: 'stone',              // Grey/rocky texture for cold climate
  deserts: 'sand',              // Sandy texture
  mountains: 'stone',           // Rocky/grey texture
  pastureland: 'grass',         // Green grass texture
  cropland: 'dirt',             // Brown dirt texture for farmland
  scrub: 'sand',                // Sandy texture for dry vegetation  
  urban: 'stone'                // Grey/stone texture for built areas
} as const;

@Component({
  selector: 'app-square-map',
  imports: [FormsModule, CommonModule],
  templateUrl: './square-map.component.html',
  styleUrl: './square-map.component.css'
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

  houseSize = 130;
  sectionSize = 750;

  // House generation properties
  houseAreaSqM = 100; // Square meters for house footprint
  numberOfFloors = 2;
  floorHeight = 3; // Height of each floor in meters
  showHouse = true;
  housePositionX = 0;
  housePositionZ = 0;

  // House material colors
  wallColor = '#d4af37'; // Gold color for walls
  roofColor = '#8b4513'; // Brown for roof
  windowColor = '#87ceeb'; // Sky blue for windows
  doorColor = '#654321'; // Dark brown for door

  // Section properties
  sectionAreaSqM = 400; // Square meters for section around house
  showSection = true;

  // Diet properties for food production area
  selectedDiet = 'vegan'; // Default diet
  showFoodArea = true;
  dietRequirements = {
    vegan: 150,
    vegetarian: 250,
    pescatarian: 350,
    flexitarian: 450,
    omnivore: 600
  };

  // Population-based sizing properties
  usePopulationSizing = true;
  selectedYear = 2025;

  // Garden and farm properties
  showGardenObjects = false;
  showFarmModels = true;
  showClothingModels = true;

  // Clothing area properties
  showClothingArea = true; // Show clothing area by default
  selectedClothingConsumption = 'medium';
  clothingRequirements = {
    low: 200,
    medium: 500,
    high: 1000
  };

  // Transition state management
  isUpdating = false;
  transitionDuration = 300; // milliseconds
  private updateTimeout: any;
  
  // Store mesh references for selective updates
  private stoneMesh!: THREE.InstancedMesh;
  private dirtMesh!: THREE.InstancedMesh;
  private dirt2Mesh!: THREE.InstancedMesh;
  private sandMesh!: THREE.InstancedMesh;
  private grassMesh!: THREE.InstancedMesh;
  private waterMesh!: THREE.InstancedMesh;
  private currentHouseFootprint: Set<string> = new Set();
  private currentSectionFootprint: Set<string> = new Set();
  private tileToInstanceMap: Map<string, {mesh: THREE.InstancedMesh, index: number}> = new Map();
  private originalHeights: Map<string, number> = new Map(); // Cache original terrain heights

  stoneArea = 20;
  dirtArea = 40;
  grassArea = 60;
  sandArea = 80;

  light!: THREE.DirectionalLight;

  // Terrain distribution tracking
  actualTerrainPercentages: { stone: number; dirt: number; dirt2: number; sand: number; grass: number; water: number } = 
    { stone: 0, dirt: 0, dirt2: 0, sand: 0, grass: 0, water: 0 };
  expectedTerrainPercentages: { stone: number; dirt: number; dirt2: number; sand: number; grass: number; water: number } = 
    { stone: 0, dirt: 0, dirt2: 0, sand: 0, grass: 0, water: 0 };

  // Precise tile counting for ocean percentage enforcement
  private oceanTileCount = 0;
  private totalTileCount = 0;
  private maxOceanTiles = 0;
  private landTileCount = 0;
  private maxLandTiles = 0;
  private landTileMap?: Map<string, boolean>;
  private optimalOceanThreshold?: number;

  // Getter to ensure section is never smaller than house
  get minSectionArea(): number {
    return Math.max(this.houseAreaSqM + 50, 100); // At least 50 sqm larger than house, minimum 100
  }

  // Ensure section area is valid
  get validSectionArea(): number {
    return Math.max(this.sectionAreaSqM, this.minSectionArea);
  }

  // Get the food production area requirement for selected diet
  get foodProductionArea(): number {
    return this.dietRequirements[this.selectedDiet as keyof typeof this.dietRequirements] || 150;
  }

  // Get clothing production area
  get clothingProductionArea(): number {
    return this.clothingRequirements[this.selectedClothingConsumption as keyof typeof this.clothingRequirements] || 5;
  }

  // Helper method for template Math operations
  getAbsDifference(actual: number, expected: number): number {
    return Math.abs(actual - expected);
  }

  // Population-based calculations
  getWorldPopulation(year: number): number {
    // More accurate population model based on UN World Population Prospects 2022
    const basePopulation = 8045311447; // World population as of January 1, 2023 (UN estimate)
    const baseYear = 2023;
    
    // Use varying growth rates based on actual projections
    let population = basePopulation;
    
    if (year < baseYear) {
      // Historical declining growth rate (approximate)
      const growthRate = 0.0084; // ~0.84% average for recent years
      const yearDiff = baseYear - year;
      population = basePopulation / Math.pow(1 + growthRate, yearDiff);
    } else if (year > baseYear) {
      // Future projections with declining growth rate
      const yearDiff = year - baseYear;
      
      // UN projects declining growth: ~0.67% for 2023-2030, then further decline
      if (year <= 2030) {
        const growthRate = 0.0067; // 0.67%
        population = basePopulation * Math.pow(1 + growthRate, yearDiff);
      } else if (year <= 2050) {
        // Population in 2030 (projected ~8.5 billion)
        const pop2030 = basePopulation * Math.pow(1.0067, 7);
        const growthRate = 0.0043; // 0.43% for 2030-2050
        const yearsSince2030 = year - 2030;
        population = pop2030 * Math.pow(1 + growthRate, yearsSince2030);
      } else {
        // Beyond 2050, very slow growth approaching peak around 2080s
        const pop2050 = basePopulation * Math.pow(1.0067, 7) * Math.pow(1.0043, 20);
        const growthRate = 0.001; // 0.1% very slow growth
        const yearsSince2050 = year - 2050;
        population = pop2050 * Math.pow(1 + growthRate, yearsSince2050);
      }
    }
    
    return Math.round(population);
  }

  get totalAreaPerPerson(): number {
    const earthSurfaceArea = 510072000000000; // m² (510.072 million km² - precise Earth surface area)
    return earthSurfaceArea / this.getWorldPopulation(this.selectedYear);
  }

  get oceanAreaPerPerson(): number {
    return this.totalAreaPerPerson * 0.7092; // 70.92% ocean (more precise)
  }

  get squareMetersPerPerson(): number {
    return this.totalAreaPerPerson * 0.2908; // 29.08% land (more precise)
  }

  get landBreakdownPerPerson(): { [key: string]: number } {
    const totalSurfacePerPerson = this.totalAreaPerPerson; // 63,759 m² based on your table
    
    return {
      // Water (70.8% of total surface)
      saltwater: totalSurfacePerPerson * 0.6903,     // 44,010 m² - Saltwater (69.03%)
      freshwater: totalSurfacePerPerson * 0.0177,    // 1,128 m² - Freshwater (1.77%)
      
      // Land Biomes (29.2% of total surface)
      deserts: totalSurfacePerPerson * 0.19 * 0.292,           // 3,538 m² - Deserts (19% of land)
      borealForest: totalSurfacePerPerson * 0.17 * 0.292,      // 3,165 m² - Boreal Forest (17% of land)
      temperateGrassland: totalSurfacePerPerson * 0.13 * 0.292, // 2,420 m² - Temperate Grassland (13% of land)
      temperateForest: totalSurfacePerPerson * 0.13 * 0.292,   // 2,420 m² - Temperate Forest (13% of land)
      tundra: totalSurfacePerPerson * 0.11 * 0.292,            // 2,048 m² - Tundra (11% of land)
      tropicalRainforest: totalSurfacePerPerson * 0.10 * 0.292, // 1,862 m² - Tropical Rainforest (10% of land)
      savanna: totalSurfacePerPerson * 0.08 * 0.292,           // 1,489 m² - Savanna (8% of land)
      mountains: totalSurfacePerPerson * 0.06 * 0.292,         // 1,117 m² - Mountains (6% of land)
      scrub: totalSurfacePerPerson * 0.03 * 0.292,             // 559 m² - Scrub (3% of land)
      
      // Human Use Areas
      urban: totalSurfacePerPerson * 0.0069 * 0.292,           // 128 m² - Urban (0.69% of land)
      cropland: totalSurfacePerPerson * 0.31 * 0.646 * 0.292,  // 2,000 m² - Cropland (64.6% of agricultural)
      pastureland: totalSurfacePerPerson * 0.31 * 0.354 * 0.292 // 3,750 m² - Pastureland (35.4% of agricultural)
    };
  }

  get usableAreaPerPerson(): number {
    const breakdown = this.landBreakdownPerPerson;
    // More realistic calculation: some forest + some grassland + urban areas + agricultural areas
    // Estimates suggest only about 10-12% of Earth's land is suitable for agriculture/habitation
    const usableForest = (breakdown['borealForest'] + breakdown['temperateForest'] + breakdown['tropicalRainforest']) * 0.15; // 15% of forests are accessible/usable
    const usableGrassland = (breakdown['temperateGrassland'] + breakdown['savanna']) * 0.35; // 35% of grasslands are usable
    const agriculturalArea = breakdown['pastureland'] + breakdown['cropland']; // All agricultural area is usable
    const urbanArea = breakdown['urban']; // All urban area is "usable" (already developed)
    
    return usableForest + usableGrassland + agriculturalArea + urbanArea;
  }

  get populationBasedMapSize(): number {
    if (!this.usePopulationSizing) return 141; // Default map size (141x141)
    
    // Use total Earth surface area per person for map size calculation
    // This represents the ACTUAL 1:1 scale of each person's fair share
    const totalAreaPerPerson = this.totalAreaPerPerson;
    
    // Calculate map size to represent the actual area per person at 1:1 scale
    // Each tile = 1m², so map shows the real square meters per person
    const mapSize = Math.sqrt(totalAreaPerPerson);
    
    // Clamp between reasonable bounds for performance and visibility
    const clampedSize = Math.max(50, Math.min(500, Math.floor(mapSize)));
    
    // Ensure odd number for symmetrical generation around center (0,0)
    return clampedSize % 2 === 0 ? clampedSize + 1 : clampedSize;
  }

  get mapHalfSize(): number {
    return Math.floor(this.populationBasedMapSize / 2);
  }

  getMapScaleRatio(): number {
    // At 1:1 scale, each map square meter represents 1 real square meter
    return 1;
  }

  // Calculate the optimal ocean distance threshold to achieve exactly 70.9% ocean
  private calculateOptimalOceanThreshold(): number {
    const mapSize = this.populationBasedMapSize;
    const halfSize = this.mapHalfSize;
    const totalTiles = mapSize * mapSize;
    const targetWaterTiles = Math.floor(totalTiles * 0.709);
    
    // Count freshwater tiles by simulating freshwater placement
    let freshwaterCount = 0;
    
    for (let i = -halfSize; i <= halfSize; i++) {
      for (let j = -halfSize; j <= halfSize; j++) {
        const x = i;
        const z = j;
        const adjustedDistance = Math.sqrt(x * x + z * z) / halfSize;
        
        // Check if this would be a freshwater tile (lakes, rivers, streams)
        // Main central lake
        const lakeCenterX = 3;
        const lakeCenterZ = 6;
        const lakeRadius = 4;
        const lakeDistance = Math.sqrt((x - lakeCenterX) ** 2 + (z - lakeCenterZ) ** 2);
        const lakeShape = Math.sin(Math.atan2(z - lakeCenterZ, x - lakeCenterX) * 4) * 1;
        if (lakeDistance <= lakeRadius + lakeShape && adjustedDistance <= 0.35) {
          freshwaterCount++;
          continue;
        }
        
        // Mountain lakes
        const mountainLake1X = 12;
        const mountainLake1Z = 12;
        const mountainLake1Distance = Math.sqrt((x - mountainLake1X) ** 2 + (z - mountainLake1Z) ** 2);
        if (mountainLake1Distance <= 2 && adjustedDistance <= 0.18) {
          freshwaterCount++;
          continue;
        }
        
        const mountainLake2X = -6;
        const mountainLake2Z = -10;
        const mountainLake2Distance = Math.sqrt((x - mountainLake2X) ** 2 + (z - mountainLake2Z) ** 2);
        if (mountainLake2Distance <= 1.5 && adjustedDistance <= 0.20) {
          freshwaterCount++;
          continue;
        }
        
        // Rivers and streams (simplified check)
        const riverWidth = 1.2;
        const river1StartX = mountainLake1X;
        const river1StartZ = mountainLake1Z;
        const river1EndX = lakeCenterX - lakeRadius;
        const river1EndZ = lakeCenterZ;
        const river1Progress = Math.max(0, Math.min(1, (x - river1StartX) / Math.max(1, river1EndX - river1StartX)));
        const river1CenterX = river1StartX + (river1EndX - river1StartX) * river1Progress + Math.sin(river1Progress * Math.PI * 3) * 2;
        const river1CenterZ = river1StartZ + (river1EndZ - river1StartZ) * river1Progress + Math.cos(river1Progress * Math.PI * 2) * 1.5;
        const river1Distance = Math.sqrt((x - river1CenterX) ** 2 + (z - river1CenterZ) ** 2);
        
        if (river1Distance <= riverWidth && adjustedDistance <= 0.35 &&
            ((x - river1StartX) * (river1EndX - river1StartX) + (z - river1StartZ) * (river1EndZ - river1StartZ)) >= 0 &&
            ((x - river1EndX) * (river1StartX - river1EndX) + (z - river1EndZ) * (river1StartZ - river1EndZ)) >= 0) {
          freshwaterCount++;
          continue;
        }
      }
    }
    
    const targetOceanTiles = targetWaterTiles - freshwaterCount;
    
    console.log('=== CALCULATING OPTIMAL OCEAN THRESHOLD ===');
    console.log(`Target total water tiles: ${targetWaterTiles} / ${totalTiles} (${(targetWaterTiles/totalTiles*100).toFixed(1)}%)`);
    console.log(`Calculated freshwater tiles: ${freshwaterCount}`);
    console.log(`Target ocean tiles from distance: ${targetOceanTiles}`);
    
    // Test different thresholds to find the one that gives us closest to target ocean tiles
    let bestThreshold = 0.4;
    let bestDifference = Number.MAX_SAFE_INTEGER;
    
    for (let threshold = 0.2; threshold <= 0.6; threshold += 0.01) {
      let oceanCount = 0;
      
      for (let i = -halfSize; i <= halfSize; i++) {
        for (let j = -halfSize; j <= halfSize; j++) {
          const distanceFromCenter = Math.sqrt(i * i + j * j) / halfSize;
          const inReservedArea = this.isWithinSectionFootprint(i, j) || 
                                 this.isWithinFoodProductionArea(i, j) || 
                                 this.isWithinClothingArea(i, j);
          
          if (distanceFromCenter > threshold && !inReservedArea) {
            oceanCount++;
          }
        }
      }
      
      const difference = Math.abs(oceanCount - targetOceanTiles);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestThreshold = threshold;
      }
    }
    
    console.log(`Best threshold: ${bestThreshold.toFixed(3)} (difference: ${bestDifference} tiles)`);
    console.log('===============================================');
    
    return bestThreshold;
  }

  // Pre-calculate which tiles should be land to ensure exactly 29.1% coverage
  private calculateLandDistribution(halfSize: number): void {
    const allTiles: {x: number, z: number, distance: number, priority: number}[] = [];
    
    // Generate all possible tile positions with their priorities
    for (let i = -halfSize; i <= halfSize; i++) {
      for (let j = -halfSize; j <= halfSize; j++) {
        const x = i;
        const z = j;
        const adjustedDistance = Math.sqrt(x * x + z * z) / halfSize;
        
        // Create natural island shape with priority based on distance from center
        const baseRadius = 0.55;
        const coastalVariation = Math.sin(Math.atan2(z, x) * 6) * 0.08 + 
                                Math.sin(Math.atan2(z, x) * 3) * 0.05;
        const naturalRadius = baseRadius + coastalVariation;
        
        // Calculate priority (higher number = more likely to be land)
        let priority = 0;
        
        // Reserved areas get highest priority
        const inReservedArea = this.isWithinSectionFootprint(x, z) || 
                              this.isWithinFoodProductionArea(x, z) || 
                              this.isWithinClothingArea(x, z);
        if (inReservedArea) {
          priority = 1000; // Highest priority
        } else if (adjustedDistance < naturalRadius) {
          // Natural island area - priority decreases with distance
          priority = 100 - (adjustedDistance * 100);
          
          // Add some randomness for natural coastline
          const noise = Math.abs(Math.sin((x + z) * 12.9898) * 43758.5453) % 1;
          priority += (noise - 0.5) * 20;
        } else {
          // Outside natural island - very low priority
          priority = 10 - adjustedDistance * 5;
        }
        
        allTiles.push({x, z, distance: adjustedDistance, priority});
      }
    }
    
    // Sort tiles by priority (highest first)
    allTiles.sort((a, b) => b.priority - a.priority);
    
    // Select top tiles for land up to the exact quota
    for (let i = 0; i < this.maxLandTiles && i < allTiles.length; i++) {
      const tile = allTiles[i];
      this.landTileMap!.set(`${tile.x},${tile.z}`, true);
    }
    
    console.log(`Pre-calculated ${this.landTileMap!.size} land tiles for natural island distribution`);
  }

  // Method to determine logical terrain type based on location and land distribution
  private getLogicalTerrainType(noiseValue: number, x: number, z: number, adjustedDistance: number): TerrainType {
    // Determine terrain type based on location and reserved areas
    const inReservedArea = this.isWithinSectionFootprint(x, z) || 
                          this.isWithinFoodProductionArea(x, z) || 
                          this.isWithinClothingArea(x, z);
    
    if (inReservedArea) {
      if (this.isWithinSectionFootprint(x, z)) {
        return 'urban'; // Urban development
      } else if (this.isWithinFoodProductionArea(x, z)) {
        return 'cropland'; // Agricultural land
      } else if (this.isWithinClothingArea(x, z)) {
        return 'pastureland'; // Grazing/textile production
      }
    }
    
    // Natural terrain distribution from center outward
    if (adjustedDistance < 0.15) {
      return noiseValue < 0.5 ? 'mountains' : 'cropland'; // Mountain core
    } else if (adjustedDistance < 0.3) {
      return noiseValue < 0.3 ? 'mountains' : (noiseValue < 0.6 ? 'cropland' : 'temperateForest'); // Mid island
    } else if (adjustedDistance < 0.45) {
      return noiseValue < 0.4 ? 'temperateGrassland' : (noiseValue < 0.7 ? 'deserts' : 'cropland'); // Outer areas
    } else {
      return noiseValue < 0.6 ? 'deserts' : 'temperateGrassland'; // Coastal areas
    }
  }

  // Method to determine terrain type with pre-calculated land distribution
  getTerrainTypeFromNoise(noiseValue: number, x: number = 0, z: number = 0): VisualTerrainType {
    // Use pre-calculated land distribution for exactly 29.1% land coverage
    const tileKey = `${x},${z}`;
    const isLandTile = this.landTileMap?.get(tileKey) || false;
    
    if (isLandTile) {
      // This tile was pre-selected to be land
      this.landTileCount++;
      
      // Calculate distance for terrain type determination
      const adjustedDistance = Math.sqrt(x * x + z * z) / this.mapHalfSize;
      
      // Get logical terrain type, then map to visual representation
      const logicalTerrain = this.getLogicalTerrainType(noiseValue, x, z, adjustedDistance);
      return TERRAIN_VISUAL_MAPPING[logicalTerrain];
    } else {
      // This tile is water (ocean + some inland lakes)
      this.oceanTileCount++;
      
      // Determine if it's saltwater or freshwater based on location
      const adjustedDistance = Math.sqrt(x * x + z * z) / this.mapHalfSize;
      const isInlandWater = adjustedDistance < 0.3 && Math.random() < 0.1; // 10% chance of inland water
      
      // Both saltwater and freshwater use the same visual representation
      return TERRAIN_VISUAL_MAPPING[isInlandWater ? 'freshwater' : 'saltwater'];
    }
  }

  ngAfterViewInit(): void {
    console.log('ngAfterViewInit called');
    this.initScene();
    console.log('Scene initialized');
    this.updateMap();
    console.log('Map update called');
  }

  initScene(): void {
    console.log('initScene called');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#ADD8E6"); // Set the background color of the scene to light blue
    
    // Calculate available space for the renderer
    const isMobile = window.innerWidth <= 768;
    const filterPanelWidth = isMobile ? 0 : 320;
    const bannerHeight = 95; /* Adjusted to match filter top position */
    const mobileFiltersHeight = isMobile ? 200 : 0;
    
    const availableWidth = window.innerWidth - filterPanelWidth;
    const availableHeight = window.innerHeight - bannerHeight - mobileFiltersHeight;
    
    console.log('Available dimensions:', availableWidth, 'x', availableHeight);
    
    this.camera = new THREE.PerspectiveCamera(45, availableWidth / availableHeight, 0.1, 1000);
    
    // Position camera to view the entire island (map is 251x251 units)
    // Higher and farther back to see the full island with ocean around it
    this.camera.position.set(180, 200, 180); // Elevated angle to see the island's topography
    console.log('Camera positioned at:', this.camera.position);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(availableWidth, availableHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    console.log('Renderer created, appending to container');
    // Append to the proper container instead of document.body
    this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);
    console.log('Canvas appended to container');

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

    // Add window resize handler
    window.addEventListener('resize', () => this.onWindowResize());
  }

  onWindowResize(): void {
    const isMobile = window.innerWidth <= 768;
    const filterPanelWidth = isMobile ? 0 : 320;
    const bannerHeight = 95; /* Adjusted to match filter top position */
    const mobileFiltersHeight = isMobile ? 200 : 0; // Approximate height of filters on mobile
    
    const availableWidth = window.innerWidth - filterPanelWidth;
    const availableHeight = window.innerHeight - bannerHeight - mobileFiltersHeight;
    
    this.camera.aspect = availableWidth / availableHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(availableWidth, availableHeight);
  }

  async updateMap(): Promise<void> {
    console.log('updateMap called');
    // Prevent multiple simultaneous updates
    if (this.isUpdating) return;
    
    this.isUpdating = true;
    console.log('Starting map update...');
    
    // Clear and regenerate the scene
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
    
    // Remove noise generation since we're using flat terrain
    const mapSize = this.populationBasedMapSize;
    const halfSize = this.mapHalfSize;
    const squareCount = mapSize * mapSize;
    console.log('Map dimensions:', mapSize, 'x', mapSize, '=', squareCount, 'squares');
    console.log('Half size:', halfSize);
    
    // Initialize precise ocean tile counting
    if (this.usePopulationSizing) {
      this.totalTileCount = squareCount;
      this.maxOceanTiles = Math.floor(this.totalTileCount * 0.709); // Exactly 70.9% rounded down
      this.maxLandTiles = Math.floor(this.totalTileCount * 0.291); // Exactly 29.1% land limit
      this.oceanTileCount = 0;
      this.landTileCount = 0;
      this.optimalOceanThreshold = undefined; // Reset threshold calculation
      
      console.log('=== INITIALIZING PRECISE TILE COUNTING ===');
      console.log(`Total tiles: ${this.totalTileCount}`);
      console.log(`Max land tiles: ${this.maxLandTiles} (${(this.maxLandTiles/this.totalTileCount*100).toFixed(1)}%)`);
      console.log(`Max ocean tiles: ${this.maxOceanTiles} (${(this.maxOceanTiles/this.totalTileCount*100).toFixed(1)}%)`);
      console.log('===============================================');
      
      // PRE-CALCULATE WHICH TILES SHOULD BE LAND to ensure even distribution
      this.landTileMap = new Map<string, boolean>();
      this.calculateLandDistribution(halfSize);
    }
    const squareGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.stoneMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.stone }), squareCount);
    this.dirtMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.dirt }), squareCount);
    this.dirt2Mesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, 
      envMapIntensity: 0.3, 
      flatShading: false, 
      roughness: 0.1, 
      metalness: 0.1, 
      map: textures.water,
      transparent: true,
      opacity: 0.8,
      color: 0x4080ff
    }), squareCount);
    this.sandMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.sand }), squareCount);
    this.grassMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.grass }), squareCount);
    this.waterMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, 
      envMapIntensity: 0.3, 
      flatShading: false, 
      roughness: 0.0, 
      metalness: 0.0, 
      map: textures.water,
      transparent: true,
      opacity: 0.8,
      color: 0x20a0ff
    }), squareCount);

    let stoneIndex = 0;
    let dirtIndex = 0;
    let dirt2Index = 0;
    let sandIndex = 0;
    let grassIndex = 0;
    let waterIndex = 0;

    // Clear the tile mapping and height cache
    this.tileToInstanceMap.clear();
    this.originalHeights.clear();

    // Track terrain type counts for debugging
    const terrainCounts = { stone: 0, dirt: 0, dirt2: 0, sand: 0, grass: 0, water: 0 };

    // Pre-calculate the house level height (flat terrain)
    const houseLevelHeight = 0.5; // Same as flat terrain height

    // Create the squares
    for(let i = -halfSize; i <= halfSize; i++) {
      for(let j = -halfSize; j <= halfSize; j++) {
        let position = this.tileToPosition(i, j);

        // Use flat terrain - no noise-based height variations
        const flatHeight = 0.5; // Fixed flat height for all terrain
        
        // Create a proper random value based on both coordinates for better terrain distribution
        const seed = i * 1000 + j;
        let noise = Math.abs(Math.sin(seed * 12.9898) * Math.cos(seed * 78.233) * 43758.5453) % 1;
        
        const tileKey = `${i},${j}`;
        
        // Determine terrain type first to decide height
        let terrainType: VisualTerrainType;
        
        // Special case: House section area should always be urban stone color  
        if (this.isWithinSectionFootprint(i, j)) {
          terrainType = 'stone'; // Urban development
        }
        // Special case: Food production area should always be dirt color
        else if (this.isWithinFoodProductionArea(i, j)) {
          terrainType = 'dirt';
        }
        // Special case: Clothing production area should always be grass color
        else if (this.isWithinClothingArea(i, j)) {
          terrainType = 'grass'; // Agricultural/textile production
        } else if (this.usePopulationSizing) {
          // Use land distribution-based terrain assignment with island layout
          terrainType = this.getTerrainTypeFromNoise(noise, i, j);
        } else {
          console.log('Using old position-based terrain assignment');
          // Use original position-based terrain assignment with proportional areas
          const quarterSize = halfSize / 2;
          const halfQuarterSize = quarterSize / 2;
          
          if (i < -quarterSize && j < -quarterSize) {
            terrainType = 'stone';
          } else if (i < 0 && j < 0) {
            terrainType = 'dirt';
          } else if (i < halfQuarterSize && j < halfQuarterSize) {
            terrainType = 'dirt2';
          } else if (i < quarterSize && j < quarterSize) {
            terrainType = 'sand';
          } else {
            terrainType = 'grass';
          }
        }
        
        // Set height based on terrain type
        let baseHeight: number;
        if (terrainType === 'dirt2') {
          // Ocean tiles stay at water level (0.5m)
          baseHeight = 0.5;
        } else {
          // All land terrain is raised 1m above water level
          baseHeight = 1.5;
        }
        
        this.originalHeights.set(tileKey, baseHeight);

        let height: number;
        
        // Check if this tile is within special areas and adjust height accordingly
        if (this.isWithinHouseFootprint(i, j)) {
          // Use slightly elevated height for house area
          height = baseHeight + 0.1;
        } else if (this.isWithinSectionFootprint(i, j)) {
          // Use slightly elevated height for section area (same as house)
          height = baseHeight + 0.1;
        } else if (this.isWithinFoodProductionArea(i, j)) {
          // Use slightly elevated height for food production area (same as house)
          height = baseHeight + 0.1;
        } else {
          // Use base height
          height = baseHeight;
        }

        let matrix = new THREE.Matrix4().makeTranslation(position.x, height * 0.5, position.y);
        matrix.scale(new THREE.Vector3(1, height, 1));

        // Debug logging for center tile
        if (i === 0 && j === 0) {
          console.log('Center tile terrain type:', terrainType, 'noise:', noise);
        }

        // Assign to appropriate mesh based on terrain type
        terrainCounts[terrainType]++;
        switch (terrainType) {
          case 'stone':
            this.stoneMesh.setMatrixAt(stoneIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.stoneMesh, index: stoneIndex});
            stoneIndex++;
            break;
          case 'dirt':
            this.dirtMesh.setMatrixAt(dirtIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.dirtMesh, index: dirtIndex});
            dirtIndex++;
            break;
          case 'grass':
            this.grassMesh.setMatrixAt(grassIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.grassMesh, index: grassIndex});
            grassIndex++;
            break;
          case 'sand':
            this.sandMesh.setMatrixAt(sandIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.sandMesh, index: sandIndex});
            sandIndex++;
            break;
          case 'dirt2':
            this.dirt2Mesh.setMatrixAt(dirt2Index, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.dirt2Mesh, index: dirt2Index});
            dirt2Index++;
            break;
          case 'water':
            this.waterMesh.setMatrixAt(waterIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.waterMesh, index: waterIndex});
            waterIndex++;
            break;
        }
      }
    }

    this.stoneMesh.instanceMatrix.needsUpdate = true;
    this.dirtMesh.instanceMatrix.needsUpdate = true;
    this.dirt2Mesh.instanceMatrix.needsUpdate = true;
    this.sandMesh.instanceMatrix.needsUpdate = true;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    this.waterMesh.instanceMatrix.needsUpdate = true;

    console.log('Terrain distribution:', terrainCounts);
    const totalTiles = Object.values(terrainCounts).reduce((sum, count) => sum + count, 0);
    console.log('Total tiles:', totalTiles);
    
    // Log precise tile counting results
    if (this.usePopulationSizing) {
      const actualWaterPercent = (terrainCounts.dirt2 / totalTiles * 100).toFixed(2);
      const actualLandPercent = ((totalTiles - terrainCounts.dirt2) / totalTiles * 100).toFixed(2);
      const targetWaterPercent = 70.9;
      const targetLandPercent = 29.1;
      
      console.log('=== PRECISE TILE COUNTING RESULTS ===');
      console.log(`Target water percentage: ${targetWaterPercent}%`);
      console.log(`Actual water percentage: ${actualWaterPercent}%`);
      console.log(`Difference from target: ${(parseFloat(actualWaterPercent) - targetWaterPercent).toFixed(2)}%`);
      console.log(`---`);
      console.log(`Target land percentage: ${targetLandPercent}%`);
      console.log(`Actual land percentage: ${actualLandPercent}%`);
      console.log(`Max land tiles allowed: ${this.maxLandTiles}`);
      console.log(`Land tiles from counter: ${this.landTileCount}`);
      console.log(`Water tiles from counter: ${this.oceanTileCount}`);
      console.log(`Water tiles from terrain count: ${terrainCounts.dirt2}`);
      console.log(`Counter vs terrain count match: ${this.oceanTileCount === terrainCounts.dirt2}`);
      console.log('======================================');
    }
    
    // Calculate actual percentages
    this.actualTerrainPercentages = {
      stone: parseFloat((terrainCounts.stone / totalTiles * 100).toFixed(1)),
      dirt: parseFloat((terrainCounts.dirt / totalTiles * 100).toFixed(1)),
      dirt2: parseFloat((terrainCounts.dirt2 / totalTiles * 100).toFixed(1)), // Water (saltwater + freshwater)
      sand: parseFloat((terrainCounts.sand / totalTiles * 100).toFixed(1)),
      grass: parseFloat((terrainCounts.grass / totalTiles * 100).toFixed(1)),
      water: parseFloat((terrainCounts.water / totalTiles * 100).toFixed(1))
    };
    
    // Calculate expected percentages from biome breakdown
    const breakdown = this.landBreakdownPerPerson;
    const totalArea = this.totalAreaPerPerson;
    this.expectedTerrainPercentages = {
      stone: parseFloat(((breakdown['mountains'] + breakdown['tundra'] + breakdown['urban']) / totalArea * 100).toFixed(1)),
      dirt: parseFloat(((breakdown['cropland'] + breakdown['scrub']) / totalArea * 100).toFixed(1)),
      dirt2: parseFloat((breakdown['saltwater'] / totalArea * 100).toFixed(1)), // Ocean water only
      sand: parseFloat((breakdown['deserts'] / totalArea * 100).toFixed(1)),
      grass: parseFloat(((breakdown['borealForest'] + breakdown['temperateForest'] + breakdown['tropicalRainforest'] + breakdown['temperateGrassland'] + breakdown['savanna'] + breakdown['pastureland']) / totalArea * 100).toFixed(1)),
      water: parseFloat((breakdown['freshwater'] / totalArea * 100).toFixed(1)) // Freshwater only
    };
    
    console.log('=== TERRAIN PERCENTAGE COMPARISON ===');
    console.log('Terrain Type | Actual % | Expected % | Difference');
    console.log('Stone (Mountains/Urban):', this.actualTerrainPercentages.stone + '%', '|', this.expectedTerrainPercentages.stone + '%', '|', (this.actualTerrainPercentages.stone - this.expectedTerrainPercentages.stone).toFixed(1) + '%');
    console.log('Dirt (Cropland/Scrub):', this.actualTerrainPercentages.dirt + '%', '|', this.expectedTerrainPercentages.dirt + '%', '|', (this.actualTerrainPercentages.dirt - this.expectedTerrainPercentages.dirt).toFixed(1) + '%');
    console.log('Ocean Water (Saltwater):', this.actualTerrainPercentages.dirt2 + '%', '|', this.expectedTerrainPercentages.dirt2 + '%', '|', (this.actualTerrainPercentages.dirt2 - this.expectedTerrainPercentages.dirt2).toFixed(1) + '%');
    console.log('Fresh Water (Lakes/Rivers):', this.actualTerrainPercentages.water + '%', '|', this.expectedTerrainPercentages.water + '%', '|', (this.actualTerrainPercentages.water - this.expectedTerrainPercentages.water).toFixed(1) + '%');
    console.log('Sand (Deserts/Savanna):', this.actualTerrainPercentages.sand + '%', '|', this.expectedTerrainPercentages.sand + '%', '|', (this.actualTerrainPercentages.sand - this.expectedTerrainPercentages.sand).toFixed(1) + '%');
    console.log('Grass (Forests/Grasslands):', this.actualTerrainPercentages.grass + '%', '|', this.expectedTerrainPercentages.grass + '%', '|', (this.actualTerrainPercentages.grass - this.expectedTerrainPercentages.grass).toFixed(1) + '%');
    console.log('========================================');

    this.scene.add(this.stoneMesh, this.dirtMesh, this.dirt2Mesh, this.sandMesh, this.grassMesh, this.waterMesh);
    console.log('Terrain meshes added to scene');
    console.log('Scene children count:', this.scene.children.length);

    // Track current house footprint
    this.updateHouseFootprint();

    // Generate and place house if enabled
    if (this.showHouse) {
      this.generateHouse();
      this.generateSectionBoundary(); // Add section boundary visualization
      this.generateFoodProductionBoundary(); // Add food production boundary visualization
      this.generateClothingBoundary(); // Add clothing area boundary visualization
      this.generateClothingItems(); // Generate cotton bushes and other clothing items
    }
    
    console.log('Map update completed successfully');
    this.isUpdating = false;
  }

  updateHouse(): void {
    // Enforce section size constraint
    if (this.sectionAreaSqM < this.minSectionArea) {
      this.sectionAreaSqM = this.minSectionArea;
    }
    
    // For house size/position changes, update only affected terrain tiles
    this.updateHouseTerrainSelectively();
    
    // Update food production area terrain colors when food area size changes
    this.updateFoodProductionAreaTerrain();
    
    // For diet changes, only update food models without full terrain regeneration
    this.clearFoodModels();
    this.generateFoodItems();
    
    // Also update clothing models
    this.clearClothingModels();
    this.generateClothingItems();
  }

  updateHouseAppearance(): void {
    // Only regenerate the house without redrawing terrain (for non-positional changes)
    if (this.showHouse) {
      this.generateHouse();
      this.generateSectionBoundary(); // Add section boundary visualization
      this.generateFoodProductionBoundary(); // Add food production boundary visualization
      this.generateClothingBoundary(); // Add clothing area boundary visualization
    } else {
      // Remove house if disabled
      const existingHouse = this.scene.getObjectByName('procedural-house');
      if (existingHouse) {
        this.scene.remove(existingHouse);
      }
      // Also remove section boundary
      const existingSection = this.scene.getObjectByName('section-boundary');
      if (existingSection) {
        this.scene.remove(existingSection);
      }
      // Also remove food production boundary
      const existingFoodArea = this.scene.getObjectByName('food-production-boundary');
      if (existingFoodArea) {
        this.scene.remove(existingFoodArea);
      }
      // Also remove clothing boundary
      const existingClothingArea = this.scene.getObjectByName('clothing-boundary');
      if (existingClothingArea) {
        this.scene.remove(existingClothingArea);
      }
      // Also remove food items
      const existingFoodItems = this.scene.getObjectByName('food-items-group');
      if (existingFoodItems) {
        this.scene.remove(existingFoodItems);
      }
      // Also remove clothing items
      const existingClothingItems = this.scene.getObjectByName('clothing-items-group');
      if (existingClothingItems) {
        this.scene.remove(existingClothingItems);
      }
    }
  }

  // Update house footprint tracking
  updateHouseFootprint(): void {
    this.currentHouseFootprint.clear();
    if (this.showHouse) {
      const halfSize = this.mapHalfSize;
      for(let i = -halfSize; i <= halfSize; i++) {
        for(let j = -halfSize; j <= halfSize; j++) {
          if (this.isWithinHouseFootprint(i, j)) {
            this.currentHouseFootprint.add(`${i},${j}`);
          }
        }
      }
    }
  }

  // Selectively update only terrain tiles affected by house changes

  clearFoodModels(): void {
    // Remove all existing food objects from the scene
    const objectsToRemove: THREE.Object3D[] = [];
    
    this.scene!.traverse((child) => {
      if (child.userData['type'] === 'food' || child.userData['type'] === 'vegetable' || child.userData['type'] === 'animal') {
        objectsToRemove.push(child);
      }
    });
    
    objectsToRemove.forEach(obj => {
      this.scene!.remove(obj);
      // Dispose of geometry and materials if they exist
      if ((obj as any).geometry) {
        (obj as any).geometry.dispose();
      }
      if ((obj as any).material) {
        if (Array.isArray((obj as any).material)) {
          (obj as any).material.forEach((mat: any) => mat.dispose());
        } else {
          (obj as any).material.dispose();
        }
      }
    });
  }

  clearClothingModels(): void {
    // Remove all existing clothing objects from the scene
    const objectsToRemove: THREE.Object3D[] = [];
    
    this.scene!.traverse((child) => {
      if (child.userData['type'] === 'clothing' || child.userData['type'] === 'cotton') {
        objectsToRemove.push(child);
      }
    });
    
    objectsToRemove.forEach(obj => {
      this.scene!.remove(obj);
      // Dispose of geometry and materials if they exist
      if ((obj as any).geometry) {
        (obj as any).geometry.dispose();
      }
      if ((obj as any).material) {
        if (Array.isArray((obj as any).material)) {
          (obj as any).material.forEach((mat: any) => mat.dispose());
        } else {
          (obj as any).material.dispose();
        }
      }
    });
  }

  updateFoodProductionAreaTerrain(): void {
    if (!this.tileToInstanceMap || this.tileToInstanceMap.size === 0) {
      return; // No terrain to update yet
    }

    const halfSize = this.mapHalfSize;
    
    // Update terrain for all tiles to ensure food production area has dirt color
    for(let i = -halfSize; i <= halfSize; i++) {
      for(let j = -halfSize; j <= halfSize; j++) {
        const tileKey = `${i},${j}`;
        const tileInfo = this.tileToInstanceMap.get(tileKey);
        
        if (tileInfo) {
          const shouldBeDirt = this.isWithinFoodProductionArea(i, j);
          const currentlyDirt = tileInfo.mesh === this.dirtMesh;
          
          // If it should be dirt but isn't, or shouldn't be dirt but is, update it
          if (shouldBeDirt && !currentlyDirt) {
            this.reassignTileToMesh(i, j, 'dirt');
          } else if (!shouldBeDirt && currentlyDirt && !this.isWithinHouseFootprint(i, j) && !this.isWithinSectionFootprint(i, j)) {
            // If it's currently dirt but shouldn't be (and not house/section), reassign based on normal terrain logic
            this.reassignTileToNormalTerrain(i, j);
          }
        }
      }
    }
  }

  reassignTileToMesh(tileX: number, tileZ: number, targetTerrainType: VisualTerrainType): void {
    const tileKey = `${tileX},${tileZ}`;
    const tileInfo = this.tileToInstanceMap.get(tileKey);
    
    if (!tileInfo) return;
    
    const currentMesh = tileInfo.mesh;
    const currentIndex = tileInfo.index;
    
    // Get target mesh
    let targetMesh: THREE.InstancedMesh;
    switch (targetTerrainType) {
      case 'stone': targetMesh = this.stoneMesh; break;
      case 'sand': targetMesh = this.sandMesh; break;
      case 'dirt': targetMesh = this.dirtMesh; break;
      case 'grass': targetMesh = this.grassMesh; break;
      case 'dirt2': targetMesh = this.dirt2Mesh; break;
      case 'water': targetMesh = this.waterMesh; break;
      default: 
        console.error('Unknown terrain type:', targetTerrainType);
        return;
    }
    
    if (currentMesh === targetMesh) return; // Already correct
    
    // Get the current matrix
    const matrix = new THREE.Matrix4();
    currentMesh.getMatrixAt(currentIndex, matrix);
    
    // Find next available index on target mesh
    let targetIndex = 0;
    const existingIndices = Array.from(this.tileToInstanceMap.values())
      .filter(info => info.mesh === targetMesh)
      .map(info => info.index);
    
    if (existingIndices.length > 0) {
      targetIndex = Math.max(...existingIndices) + 1;
    }
    
    // Set matrix on target mesh
    targetMesh.setMatrixAt(targetIndex, matrix);
    targetMesh.instanceMatrix.needsUpdate = true;
    
    // Update mapping
    this.tileToInstanceMap.set(tileKey, {mesh: targetMesh, index: targetIndex});
    
    // Hide the old instance by scaling to zero
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    currentMesh.setMatrixAt(currentIndex, hiddenMatrix);
    currentMesh.instanceMatrix.needsUpdate = true;
  }

  reassignTileToNormalTerrain(tileX: number, tileZ: number): void {
    const halfSize = this.mapHalfSize;
    
    // Create a proper random value based on both coordinates for better terrain distribution
    const seed = tileX * 1000 + tileZ;
    let noise = Math.abs(Math.sin(seed * 12.9898) * Math.cos(seed * 78.233) * 43758.5453) % 1;
    
    let terrainType: VisualTerrainType;
    
    // Special case: House section area should always be urban stone color
    if (this.isWithinSectionFootprint(tileX, tileZ)) {
      terrainType = 'stone'; // Urban development
    }
    // Special case: Clothing production area should always be grass color
    else if (this.isWithinClothingArea(tileX, tileZ)) {
      terrainType = 'grass'; // Agricultural/textile production
    } else if (this.usePopulationSizing) {
      // Use land distribution-based terrain assignment with island layout
      terrainType = this.getTerrainTypeFromNoise(noise, tileX, tileZ);
    } else {
      // Use original position-based terrain assignment
      const quarterSize = halfSize / 2;
      const halfQuarterSize = quarterSize / 2;
      
      if (tileX < -quarterSize && tileZ < -quarterSize) {
        terrainType = 'stone';
      } else if (tileX < 0 && tileZ < 0) {
        terrainType = 'dirt';
      } else if (tileX < quarterSize && tileZ < quarterSize) {
        terrainType = 'grass';
      } else if (tileX < halfSize - halfQuarterSize && tileZ < halfSize - halfQuarterSize) {
        terrainType = 'sand';
      } else {
        terrainType = 'dirt2';
      }
    }
    
    this.reassignTileToMesh(tileX, tileZ, terrainType);
  }

  updateHouseTerrainSelectively(): void {
    if (!this.stoneMesh || this.tileToInstanceMap.size === 0 || this.originalHeights.size === 0) {
      // If meshes don't exist yet, do full update
      this.updateMap();
      return;
    }

    const newHouseFootprint = new Set<string>();
    const newSectionFootprint = new Set<string>();
    const newFoodAreaFootprint = new Set<string>();
    const newClothingAreaFootprint = new Set<string>();
    const houseLevelHeight = 0.5; // Flat terrain height

    // Calculate new house footprint
    if (this.showHouse) {
      const halfSize = this.mapHalfSize;
      for(let i = -halfSize; i <= halfSize; i++) {
        for(let j = -halfSize; j <= halfSize; j++) {
          if (this.isWithinHouseFootprint(i, j)) {
            newHouseFootprint.add(`${i},${j}`);
          }
          if (this.isWithinSectionFootprint(i, j)) {
            newSectionFootprint.add(`${i},${j}`);
          }
          if (this.isWithinFoodProductionArea(i, j)) {
            newFoodAreaFootprint.add(`${i},${j}`);
          }
          if (this.isWithinClothingArea(i, j)) {
            newClothingAreaFootprint.add(`${i},${j}`);
          }
        }
      }
    }

    // Combine all level areas (house + section + food area + clothing area)
    const newLevelFootprint = new Set([...newHouseFootprint, ...newSectionFootprint, ...newFoodAreaFootprint, ...newClothingAreaFootprint]);
    const oldLevelFootprint = new Set([...this.currentHouseFootprint, ...this.currentSectionFootprint]);

    // Find tiles that need updating (old level areas + new level areas)
    const tilesToUpdate = new Set([...oldLevelFootprint, ...newLevelFootprint]);
    const updatedMeshes = new Set<THREE.InstancedMesh>();

    // Update affected tiles
    for (const tileKey of tilesToUpdate) {
      const instanceInfo = this.tileToInstanceMap.get(tileKey);
      const originalHeight = this.originalHeights.get(tileKey);
      
      if (!instanceInfo || originalHeight === undefined) continue;

      const [i, j] = tileKey.split(',').map(Number);
      const position = this.tileToPosition(i, j);
      
      let height: number;
      if (newLevelFootprint.has(tileKey)) {
        // Use level height for house, section, or food production area
        height = houseLevelHeight;
      } else {
        // Use cached original height for non-level areas
        height = originalHeight;
      }

      const matrix = new THREE.Matrix4().makeTranslation(position.x, height * 0.5, position.y);
      matrix.scale(new THREE.Vector3(1, height, 1));

      // Update the specific instance
      instanceInfo.mesh.setMatrixAt(instanceInfo.index, matrix);
      updatedMeshes.add(instanceInfo.mesh);
    }

    // Mark updated meshes as needing update
    for (const mesh of updatedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Update current footprints
    this.currentHouseFootprint = newHouseFootprint;
    this.currentSectionFootprint = newSectionFootprint;

    // Update house appearance
    this.updateHouseAppearance();
  }

  // Debounced update to prevent too many rapid updates
  debouncedUpdateMap(): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    
    this.updateTimeout = setTimeout(() => {
      this.updateMap();
    }, 100); // 100ms debounce
  }

  generateHouse(): void {
    // Remove existing house if any
    const existingHouse = this.scene.getObjectByName('procedural-house');
    if (existingHouse) {
      this.scene.remove(existingHouse);
    }

    // Calculate house dimensions from area
    const houseWidth = Math.sqrt(this.houseAreaSqM);
    const houseDepth = Math.sqrt(this.houseAreaSqM);
    const totalHeight = this.numberOfFloors * this.floorHeight;

    // Get terrain height at house position
    const terrainHeight = this.getTerrainHeightAt(this.housePositionX, this.housePositionZ);

    // Create house group
    const houseGroup = new THREE.Group();
    houseGroup.name = 'procedural-house';

    // Materials with selectable colors
    const wallMaterial = new THREE.MeshLambertMaterial({ color: this.wallColor });
    const roofMaterial = new THREE.MeshLambertMaterial({ color: this.roofColor });
    const windowMaterial = new THREE.MeshLambertMaterial({ color: this.windowColor });
    const doorMaterial = new THREE.MeshLambertMaterial({ color: this.doorColor });

    // Generate each floor
    for (let floor = 0; floor < this.numberOfFloors; floor++) {
      const floorY = terrainHeight + floor * this.floorHeight; // Position relative to terrain height
      
      // Main structure for this floor
      const wallGeometry = new THREE.BoxGeometry(houseWidth, this.floorHeight, houseDepth);
      const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
      wallMesh.position.set(this.housePositionX, floorY + this.floorHeight / 2, this.housePositionZ);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      houseGroup.add(wallMesh);

      // Add windows (procedurally placed based on floor)
      const windowsPerSide = Math.max(1, Math.floor(houseWidth / 3));
      for (let i = 0; i < windowsPerSide; i++) {
        // Front windows
        const windowGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.1);
        const frontWindow = new THREE.Mesh(windowGeometry, windowMaterial);
        const windowSpacing = houseWidth / (windowsPerSide + 1);
        frontWindow.position.set(
          this.housePositionX - houseWidth/2 + windowSpacing * (i + 1),
          floorY + this.floorHeight * 0.6,
          this.housePositionZ + houseDepth/2 + 0.05
        );
        houseGroup.add(frontWindow);

        // Back windows
        const backWindow = frontWindow.clone();
        backWindow.position.z = this.housePositionZ - houseDepth/2 - 0.05;
        houseGroup.add(backWindow);
      }

      // Add door only on ground floor
      if (floor === 0) {
        const doorGeometry = new THREE.BoxGeometry(1, 2, 0.1);
        const door = new THREE.Mesh(doorGeometry, doorMaterial);
        door.position.set(
          this.housePositionX,
          terrainHeight + 1, // Position door relative to terrain height
          this.housePositionZ + houseDepth/2 + 0.05
        );
        houseGroup.add(door);
      }
    }

    // Add roof
    const roofGeometry = new THREE.ConeGeometry(
      Math.max(houseWidth, houseDepth) * 0.8,
      this.floorHeight * 0.8,
      4
    );
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.set(
      this.housePositionX,
      terrainHeight + totalHeight + this.floorHeight * 0.4, // Position roof relative to terrain height
      this.housePositionZ
    );
    roof.rotation.y = Math.PI / 4; // Rotate 45 degrees for diamond shape
    roof.castShadow = true;
    houseGroup.add(roof);

    // Add chimney (if more than 1 floor)
    if (this.numberOfFloors > 1) {
      const chimneyGeometry = new THREE.BoxGeometry(0.5, this.floorHeight * 0.6, 0.5);
      const chimney = new THREE.Mesh(chimneyGeometry, wallMaterial);
      chimney.position.set(
        this.housePositionX + houseWidth * 0.3,
        terrainHeight + totalHeight + this.floorHeight * 0.7, // Position chimney relative to terrain height
        this.housePositionZ + houseDepth * 0.3
      );
      chimney.castShadow = true;
      houseGroup.add(chimney);
    }

    this.scene.add(houseGroup);
  }

  generateSectionBoundary(): void {
    // Remove existing section boundary if any
    const existingSection = this.scene.getObjectByName('section-boundary');
    if (existingSection) {
      this.scene.remove(existingSection);
    }

    if (!this.showSection || !this.showHouse) {
      return; // Don't show section if not enabled or no house
    }

    // Calculate section dimensions
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const sectionDepth = Math.sqrt(this.validSectionArea);
    const groundHeight = this.getHouseLevelHeight();

    // Create wireframe boundary for the section
    const sectionGeometry = new THREE.PlaneGeometry(sectionWidth, sectionDepth);
    const sectionEdges = new THREE.EdgesGeometry(sectionGeometry);
    const sectionMaterial = new THREE.LineBasicMaterial({ 
      color: 0x00ff00, // Green color for section boundary
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    const sectionBoundary = new THREE.LineSegments(sectionEdges, sectionMaterial);
    
    // Position the section boundary
    sectionBoundary.position.set(this.housePositionX, groundHeight + 0.1, this.housePositionZ);
    sectionBoundary.rotation.x = -Math.PI / 2; // Rotate to lie flat on ground
    sectionBoundary.name = 'section-boundary';

    this.scene.add(sectionBoundary);
  }

  generateFoodProductionBoundary(): void {
    // Remove existing food production boundary if any
    const existingFoodArea = this.scene.getObjectByName('food-production-boundary');
    if (existingFoodArea) {
      this.scene.remove(existingFoodArea);
    }

    if (!this.showFoodArea || !this.showHouse) {
      return; // Don't show food area if not enabled or no house
    }

    // Calculate food area dimensions
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const foodAreaDepth = Math.sqrt(this.foodProductionArea);
    const groundHeight = this.getHouseLevelHeight();

    // Position food area adjacent to section area
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth/2 + 5; // 5 meter gap

    // Create wireframe boundary for the food production area
    const foodAreaGeometry = new THREE.PlaneGeometry(foodAreaWidth, foodAreaDepth);
    const foodAreaEdges = new THREE.EdgesGeometry(foodAreaGeometry);
    const foodAreaMaterial = new THREE.LineBasicMaterial({ 
      color: 0xff6600, // Orange color for food production boundary
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    const foodProductionBoundary = new THREE.LineSegments(foodAreaEdges, foodAreaMaterial);
    
    // Position the food production boundary
    foodProductionBoundary.position.set(foodAreaOffsetX, groundHeight + 0.1, this.housePositionZ);
    foodProductionBoundary.rotation.x = -Math.PI / 2; // Rotate to lie flat on ground
    foodProductionBoundary.name = 'food-production-boundary';

    this.scene.add(foodProductionBoundary);
    
    // Generate food items within the food production area
    this.generateFoodItems();
  }

  generateClothingBoundary(): void {
    // Remove existing clothing boundary if any
    const existingClothingArea = this.scene.getObjectByName('clothing-boundary');
    if (existingClothingArea) {
      this.scene.remove(existingClothingArea);
    }

    if (!this.showClothingArea || !this.showHouse) {
      return; // Don't show clothing area if not enabled or no house
    }

    // Calculate clothing area dimensions
    const clothingAreaWidth = Math.sqrt(this.clothingProductionArea);
    const clothingAreaDepth = Math.sqrt(this.clothingProductionArea);
    const groundHeight = this.getHouseLevelHeight();

    // Position clothing area adjacent to food area
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const clothingAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth + clothingAreaWidth/2 + 10; // 5m gap from section + food area + 5m gap

    // Create wireframe boundary for the clothing area
    const clothingAreaGeometry = new THREE.PlaneGeometry(clothingAreaWidth, clothingAreaDepth);
    const clothingAreaEdges = new THREE.EdgesGeometry(clothingAreaGeometry);
    const clothingAreaMaterial = new THREE.LineBasicMaterial({ 
      color: 0x9932cc, // Purple color for clothing area boundary
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    const clothingBoundary = new THREE.LineSegments(clothingAreaEdges, clothingAreaMaterial);
    
    // Position the clothing boundary
    clothingBoundary.position.set(clothingAreaOffsetX, groundHeight + 0.1, this.housePositionZ);
    clothingBoundary.rotation.x = -Math.PI / 2; // Rotate to lie flat on ground
    clothingBoundary.name = 'clothing-boundary';

    this.scene.add(clothingBoundary);
    
    // Generate clothing items within the clothing area
    this.generateClothingItems();
  }

  generateFoodItems(): void {
    // Remove existing food items if any
    const existingFoodItems = this.scene.getObjectByName('food-items-group');
    if (existingFoodItems) {
      this.scene.remove(existingFoodItems);
    }

    if (!this.showFoodArea || !this.showHouse || !this.showFarmModels) {
      return; // Don't show food items if not enabled or no house or farm models disabled
    }

    const foodItemsGroup = new THREE.Group();
    foodItemsGroup.name = 'food-items-group';

    // Calculate food area dimensions and position
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const foodAreaDepth = Math.sqrt(this.foodProductionArea);
    const groundHeight = this.getHouseLevelHeight();
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth/2 + 5; // 5 meter gap

    // Generate vegetables (always present in all diets)
    this.generateVegetables(foodItemsGroup, foodAreaOffsetX, groundHeight, foodAreaWidth, foodAreaDepth);

    // Generate animals based on diet type
    if (this.selectedDiet !== 'vegan' && this.selectedDiet !== 'vegetarian') {
      this.generateAnimals(foodItemsGroup, foodAreaOffsetX, groundHeight, foodAreaWidth, foodAreaDepth);
    }

    this.scene.add(foodItemsGroup);
  }

  generateVegetables(group: THREE.Group, centerX: number, groundHeight: number, width: number, depth: number): void {
    // Use a fixed seed based on house position and food area to ensure consistent vegetable placement
    let seed = Math.floor(this.housePositionX * 1000 + this.housePositionZ * 1000 + this.foodProductionArea);
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    // Farm-style row configuration
    const rowSpacing = 3.0; // 3 meters between rows
    const plantSpacing = 1.5; // 1.5 meters between plants in a row
    const rowCount = Math.floor(depth / rowSpacing);
    const plantsPerRow = Math.floor(width / plantSpacing);
    
    // Create alternating crop types for different rows (crop rotation simulation)
    const cropTypes = [0, 1, 2, 3]; // carrot, cabbage, tomato, corn
    
    for (let row = 0; row < rowCount; row++) {
      const cropType = cropTypes[row % cropTypes.length]; // Rotate crop types by row
      const rowZ = this.housePositionZ - depth/2 + row * rowSpacing + rowSpacing/2;
      
      for (let plant = 0; plant < plantsPerRow; plant++) {
        const plantX = centerX - width/2 + plant * plantSpacing + plantSpacing/2;
        
        // Add slight random variation to avoid perfect grid look (±0.2m)
        const x = plantX + (seededRandom() - 0.5) * 0.4;
        const z = rowZ + (seededRandom() - 0.5) * 0.4;
        // Use row-specific crop type instead of random
        const vegetableType = cropType;
        let vegetable: THREE.Mesh;
        
        switch (vegetableType) {
          case 0: // Carrot - orange cone
            const carrotGeometry = new THREE.ConeGeometry(0.3, 1.2, 8);
            const carrotMaterial = new THREE.MeshPhongMaterial({ color: 0xff6600 });
            vegetable = new THREE.Mesh(carrotGeometry, carrotMaterial);
            vegetable.position.set(x, groundHeight + 0.6, z);
            
            // Add green leafy top
            const leavesGeometry = new THREE.ConeGeometry(0.4, 0.8, 6);
            const leavesMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 });
            const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
            leaves.position.set(0, 0.8, 0);
            vegetable.add(leaves);
            break;
            
          case 1: // Cabbage - green sphere
            const cabbageGeometry = new THREE.SphereGeometry(0.8, 8, 6);
            const cabbageMaterial = new THREE.MeshPhongMaterial({ color: 0x90ee90 });
            vegetable = new THREE.Mesh(cabbageGeometry, cabbageMaterial);
            vegetable.position.set(x, groundHeight + 0.8, z);
            break;
            
          case 2: // Tomato plant - red spheres on green stick
            const stickGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2);
            const stickMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 });
            vegetable = new THREE.Mesh(stickGeometry, stickMaterial);
            vegetable.position.set(x, groundHeight + 1, z);
            
            // Add tomatoes using seeded random for consistent placement
            for (let j = 0; j < 3; j++) {
              const tomatoGeometry = new THREE.SphereGeometry(0.3, 6, 4);
              const tomatoMaterial = new THREE.MeshPhongMaterial({ color: 0xff4500 });
              const tomato = new THREE.Mesh(tomatoGeometry, tomatoMaterial);
              tomato.position.set(
                (seededRandom() - 0.5) * 0.6,
                0.3 + j * 0.4,
                (seededRandom() - 0.5) * 0.6
              );
              vegetable.add(tomato);
            }
            break;
            
          case 3: // Corn - yellow cylinder with green leaves
            const cornGeometry = new THREE.CylinderGeometry(0.3, 0.2, 1.5, 8);
            const cornMaterial = new THREE.MeshPhongMaterial({ color: 0xffd700 });
            vegetable = new THREE.Mesh(cornGeometry, cornMaterial);
            vegetable.position.set(x, groundHeight + 0.75, z);
            
            // Add corn husk
            const huskGeometry = new THREE.CylinderGeometry(0.35, 0.25, 1.6, 6);
            const huskMaterial = new THREE.MeshPhongMaterial({ color: 0x9acd32 });
            const husk = new THREE.Mesh(huskGeometry, huskMaterial);
            husk.position.set(0, 0, 0);
            vegetable.add(husk);
            break;
            
          default:
            vegetable = new THREE.Mesh();
        }
        
        // Mark as vegetable type for cleanup
        vegetable.userData['type'] = 'vegetable';
        
        group.add(vegetable);
      }
    }
  }

  generateAnimals(group: THREE.Group, centerX: number, groundHeight: number, width: number, depth: number): void {
    const animalCount = Math.floor(this.foodProductionArea / 50); // One animal per 50 sq m (increased density)
    
    // Use a fixed seed based on house position and food area to ensure consistent animal placement
    let seed = Math.floor(this.housePositionX * 1000 + this.housePositionZ * 1000 + this.foodProductionArea + 12345); // Different offset from vegetables
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    for (let i = 0; i < animalCount; i++) {
      // Deterministic position within food area using seeded random
      const x = centerX + (seededRandom() - 0.5) * width * 0.8;
      const z = this.housePositionZ + (seededRandom() - 0.5) * depth * 0.8;
      
      // Create different types of animals deterministically
      const animalType = Math.floor(seededRandom() * 3);
      let animal: THREE.Group;
      
      switch (animalType) {
        case 0: // Chicken - small white body with red comb
          animal = new THREE.Group();
          
          // Body
          const chickenBodyGeometry = new THREE.SphereGeometry(0.5, 8, 6);
          const chickenBodyMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
          const chickenBody = new THREE.Mesh(chickenBodyGeometry, chickenBodyMaterial);
          chickenBody.position.set(0, 0.5, 0);
          animal.add(chickenBody);
          
          // Head
          const chickenHeadGeometry = new THREE.SphereGeometry(0.3, 6, 4);
          const chickenHead = new THREE.Mesh(chickenHeadGeometry, chickenBodyMaterial);
          chickenHead.position.set(0, 1, 0.4);
          animal.add(chickenHead);
          
          // Comb
          const combGeometry = new THREE.SphereGeometry(0.15, 4, 3);
          const combMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
          const comb = new THREE.Mesh(combGeometry, combMaterial);
          comb.position.set(0, 1.3, 0.4);
          animal.add(comb);
          
          break;
          
        case 1: // Pig - pink cylindrical body
          animal = new THREE.Group();
          
          // Body
          const pigBodyGeometry = new THREE.CylinderGeometry(0.8, 0.8, 1.5, 8);
          const pigBodyMaterial = new THREE.MeshPhongMaterial({ color: 0xffc0cb });
          const pigBody = new THREE.Mesh(pigBodyGeometry, pigBodyMaterial);
          pigBody.rotation.z = Math.PI / 2;
          pigBody.position.set(0, 0.8, 0);
          animal.add(pigBody);
          
          // Head
          const pigHeadGeometry = new THREE.SphereGeometry(0.6, 8, 6);
          const pigHead = new THREE.Mesh(pigHeadGeometry, pigBodyMaterial);
          pigHead.position.set(0.8, 0.8, 0);
          animal.add(pigHead);
          
          // Snout
          const snoutGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 6);
          const snout = new THREE.Mesh(snoutGeometry, pigBodyMaterial);
          snout.rotation.z = Math.PI / 2;
          snout.position.set(1.2, 0.8, 0);
          animal.add(snout);
          
          break;
          
        case 2: // Cow - black and white spotted body
          animal = new THREE.Group();
          
          // Body
          const cowBodyGeometry = new THREE.BoxGeometry(2, 1.2, 1);
          const cowBodyMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
          const cowBody = new THREE.Mesh(cowBodyGeometry, cowBodyMaterial);
          cowBody.position.set(0, 1.2, 0);
          animal.add(cowBody);
          
          // Add black spots
          for (let j = 0; j < 4; j++) {
            const spotGeometry = new THREE.SphereGeometry(0.3, 6, 4);
            const spotMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
            const spot = new THREE.Mesh(spotGeometry, spotMaterial);
            spot.position.set(
              (Math.random() - 0.5) * 1.8,
              1.2 + (Math.random() - 0.5) * 1,
              (Math.random() - 0.5) * 0.8
            );
            animal.add(spot);
          }
          
          // Head
          const cowHeadGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.6);
          const cowHead = new THREE.Mesh(cowHeadGeometry, cowBodyMaterial);
          cowHead.position.set(1.2, 1.5, 0);
          animal.add(cowHead);
          
          // Horns
          const hornGeometry = new THREE.ConeGeometry(0.1, 0.4, 4);
          const hornMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
          const horn1 = new THREE.Mesh(hornGeometry, hornMaterial);
          const horn2 = new THREE.Mesh(hornGeometry, hornMaterial);
          horn1.position.set(1.2, 1.9, -0.2);
          horn2.position.set(1.2, 1.9, 0.2);
          animal.add(horn1);
          animal.add(horn2);
          
          break;
          
        default:
          animal = new THREE.Group();
      }
      
      animal.position.set(x, groundHeight, z);
      group.add(animal);
    }
  }

  generateClothingItems(): void {
    // Remove existing clothing items if any
    const existingClothingItems = this.scene.getObjectByName('clothing-items-group');
    if (existingClothingItems) {
      this.scene.remove(existingClothingItems);
    }

    if (!this.showClothingArea || !this.showHouse || !this.showClothingModels) {
      return; // Don't show clothing items if not enabled or no house or clothing models disabled
    }

    const clothingItemsGroup = new THREE.Group();
    clothingItemsGroup.name = 'clothing-items-group';

    // Calculate clothing area dimensions and position
    const clothingAreaWidth = Math.sqrt(this.clothingProductionArea);
    const clothingAreaDepth = Math.sqrt(this.clothingProductionArea);
    const groundHeight = this.getHouseLevelHeight();
    
    // Position clothing area adjacent to food area
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const clothingAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth + clothingAreaWidth/2 + 10; // 5m gap from section + food area + 5m gap

    // Generate cotton bushes
    this.generateCottonBushes(clothingItemsGroup, clothingAreaOffsetX, groundHeight, clothingAreaWidth, clothingAreaDepth);

    this.scene.add(clothingItemsGroup);
  }

  generateCottonBushes(group: THREE.Group, centerX: number, groundHeight: number, width: number, depth: number): void {
    // Use a fixed seed based on house position and clothing area to ensure consistent cotton bush placement
    let seed = Math.floor(this.housePositionX * 1000 + this.housePositionZ * 1000 + this.clothingProductionArea + 54321); // Different offset from food items
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    // Cotton field row configuration - cotton needs wider spacing than vegetables
    const rowSpacing = 4.0; // 4 meters between rows (wider for cotton cultivation)
    const plantSpacing = 2.0; // 2 meters between cotton bushes in a row
    const rowCount = Math.floor(depth / rowSpacing);
    const plantsPerRow = Math.floor(width / plantSpacing);
    
    for (let row = 0; row < rowCount; row++) {
      const rowZ = this.housePositionZ - depth/2 + row * rowSpacing + rowSpacing/2;
      
      for (let plant = 0; plant < plantsPerRow; plant++) {
        const plantX = centerX - width/2 + plant * plantSpacing + plantSpacing/2;
        
        // Add slight random variation to avoid perfect grid look (±0.3m)
        const x = plantX + (seededRandom() - 0.5) * 0.6;
        const z = rowZ + (seededRandom() - 0.5) * 0.6;
        
        // Create cotton bush - procedurally generated
        const cottonBush = this.createCottonBush(seededRandom);
        cottonBush.position.set(x, groundHeight, z);
        
        // Add random rotation for variety
        cottonBush.rotation.y = seededRandom() * Math.PI * 2;
        
        // Mark as clothing type for cleanup
        cottonBush.userData['type'] = 'cotton';
        
        group.add(cottonBush);
      }
    }
  }

  createCottonBush(seededRandom: () => number): THREE.Group {
    const cottonBush = new THREE.Group();
    
    // Main stem - brown woody cylinder
    const stemGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
    const stemMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 }); // Brown
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.set(0, 0.75, 0);
    cottonBush.add(stem);
    
    // Create several branches
    const branchCount = 3 + Math.floor(seededRandom() * 3); // 3-5 branches
    for (let i = 0; i < branchCount; i++) {
      const branchHeight = 0.3 + seededRandom() * 0.6; // Height between 0.3 and 0.9
      const branchAngle = (seededRandom() * Math.PI * 2); // Random angle around stem
      const branchLength = 0.8 + seededRandom() * 0.4; // Length between 0.8 and 1.2
      
      // Branch geometry
      const branchGeometry = new THREE.CylinderGeometry(0.05, 0.08, branchLength, 6);
      const branchMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 }); // Green
      const branch = new THREE.Mesh(branchGeometry, branchMaterial);
      
      // Position and rotate branch
      branch.position.set(
        Math.cos(branchAngle) * 0.2,
        branchHeight,
        Math.sin(branchAngle) * 0.2
      );
      branch.rotation.z = Math.cos(branchAngle) * 0.3; // Slight outward tilt
      branch.rotation.x = Math.sin(branchAngle) * 0.3;
      
      cottonBush.add(branch);
      
      // Add cotton bolls to this branch
      const bollCount = 2 + Math.floor(seededRandom() * 3); // 2-4 bolls per branch
      for (let j = 0; j < bollCount; j++) {
        const boll = this.createCottonBoll(seededRandom);
        
        // Position bolls along the branch
        const bollPosition = 0.2 + (j / bollCount) * 0.6; // Along the branch length
        boll.position.set(
          Math.cos(branchAngle) * branchLength * bollPosition,
          branchHeight + (bollPosition - 0.5) * 0.3,
          Math.sin(branchAngle) * branchLength * bollPosition
        );
        
        cottonBush.add(boll);
      }
    }
    
    // Add some leaves scattered around
    const leafCount = 8 + Math.floor(seededRandom() * 6); // 8-13 leaves
    for (let i = 0; i < leafCount; i++) {
      const leaf = this.createCottonLeaf(seededRandom);
      
      // Position leaves around the plant
      const leafAngle = seededRandom() * Math.PI * 2;
      const leafRadius = 0.3 + seededRandom() * 0.5;
      const leafHeight = 0.2 + seededRandom() * 1.0;
      
      leaf.position.set(
        Math.cos(leafAngle) * leafRadius,
        leafHeight,
        Math.sin(leafAngle) * leafRadius
      );
      
      cottonBush.add(leaf);
    }
    
    return cottonBush;
  }

  createCottonBoll(seededRandom: () => number): THREE.Group {
    const boll = new THREE.Group();
    
    // Brown pod/capsule at the base
    const podGeometry = new THREE.SphereGeometry(0.2, 6, 4);
    const podMaterial = new THREE.MeshPhongMaterial({ color: 0x8b6914 }); // Dark brown
    const pod = new THREE.Mesh(podGeometry, podMaterial);
    boll.add(pod);
    
    // White fluffy cotton emerging from the pod
    const cottonPuffs = 3 + Math.floor(seededRandom() * 2); // 3-4 puffs
    for (let i = 0; i < cottonPuffs; i++) {
      const puffGeometry = new THREE.SphereGeometry(0.15 + seededRandom() * 0.1, 4, 3);
      const puffMaterial = new THREE.MeshPhongMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.9 
      });
      const puff = new THREE.Mesh(puffGeometry, puffMaterial);
      
      // Position puffs slightly outside and above the pod
      const puffAngle = (i / cottonPuffs) * Math.PI * 2 + seededRandom() * 0.5;
      puff.position.set(
        Math.cos(puffAngle) * 0.15,
        0.1 + seededRandom() * 0.1,
        Math.sin(puffAngle) * 0.15
      );
      
      boll.add(puff);
    }
    
    return boll;
  }

  createCottonLeaf(seededRandom: () => number): THREE.Mesh {
    // Create a simple leaf shape using a flattened sphere
    const leafGeometry = new THREE.SphereGeometry(0.2, 6, 3);
    leafGeometry.scale(1, 0.1, 1.5); // Flatten and elongate
    
    const leafMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x228b22, // Green
      side: THREE.DoubleSide 
    });
    
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    
    // Add some random rotation for natural look
    leaf.rotation.x = (seededRandom() - 0.5) * 0.5;
    leaf.rotation.y = seededRandom() * Math.PI * 2;
    leaf.rotation.z = (seededRandom() - 0.5) * 0.3;
    
    return leaf;
  }

  tileToPosition(tileX: number, tileY: number): THREE.Vector2 {
    return new THREE.Vector2(tileX * 1, tileY * 1);
  }

  // Method to calculate terrain height at any world position
  getTerrainHeightAt(worldX: number, worldZ: number): number {
    // Convert world position to tile coordinates
    // Since each tile is 1m x 1m and positioned from -halfSize to +halfSize
    const tileX = Math.round(worldX);
    const tileZ = Math.round(worldZ);
    
    // Get terrain type for this position
    const terrainType = this.getTerrainTypeFromNoise(tileX, tileZ);
    
    // Ocean tiles stay at 0.5m, land tiles are at 1.5m (raised by 1m)
    if (terrainType === 'dirt2') { // Ocean/water tiles
      return 0.5;
    } else { // All land tiles (dirt, grass, sand, stone)
      return 1.5;
    }
  }

  // Method to check if a tile position is within the house footprint
  isWithinHouseFootprint(tileX: number, tileZ: number): boolean {
    if (!this.showHouse) return false;
    
    const worldPos = this.tileToPosition(tileX, tileZ);
    const houseWidth = Math.sqrt(this.houseAreaSqM);
    const houseDepth = Math.sqrt(this.houseAreaSqM);
    
    // Add small buffer around house for smoother transition
    const buffer = 1;
    
    return (
      worldPos.x >= this.housePositionX - houseWidth/2 - buffer &&
      worldPos.x <= this.housePositionX + houseWidth/2 + buffer &&
      worldPos.y >= this.housePositionZ - houseDepth/2 - buffer &&
      worldPos.y <= this.housePositionZ + houseDepth/2 + buffer
    );
  }

  // Method to check if a tile position is within the section footprint
  isWithinSectionFootprint(tileX: number, tileZ: number): boolean {
    if (!this.showSection || !this.showHouse) return false;
    
    const worldPos = this.tileToPosition(tileX, tileZ);
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const sectionDepth = Math.sqrt(this.validSectionArea);
    
    // Add small buffer around section for smoother transition
    const buffer = 1;
    
    return (
      worldPos.x >= this.housePositionX - sectionWidth/2 - buffer &&
      worldPos.x <= this.housePositionX + sectionWidth/2 + buffer &&
      worldPos.y >= this.housePositionZ - sectionDepth/2 - buffer &&
      worldPos.y <= this.housePositionZ + sectionDepth/2 + buffer
    );
  }

  // Method to check if a tile position is within the food production area
  isWithinFoodProductionArea(tileX: number, tileZ: number): boolean {
    if (!this.showFoodArea || !this.showHouse) return false;
    
    const worldPos = this.tileToPosition(tileX, tileZ);
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const foodAreaDepth = Math.sqrt(this.foodProductionArea);
    
    // Position food area adjacent to section area
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth/2 + 5; // 5 meter gap
    
    // Add small buffer around food area for smoother transition
    const buffer = 1;
    
    return (
      worldPos.x >= foodAreaOffsetX - foodAreaWidth/2 - buffer &&
      worldPos.x <= foodAreaOffsetX + foodAreaWidth/2 + buffer &&
      worldPos.y >= this.housePositionZ - foodAreaDepth/2 - buffer &&
      worldPos.y <= this.housePositionZ + foodAreaDepth/2 + buffer
    );
  }

  // Method to check if a tile position is within the clothing production area
  isWithinClothingArea(tileX: number, tileZ: number): boolean {
    if (!this.showClothingArea || !this.showHouse) return false;
    
    const worldPos = this.tileToPosition(tileX, tileZ);
    const clothingAreaWidth = Math.sqrt(this.clothingProductionArea);
    const clothingAreaDepth = Math.sqrt(this.clothingProductionArea);
    
    // Position clothing area adjacent to food area
    const sectionWidth = Math.sqrt(this.validSectionArea);
    const foodAreaWidth = Math.sqrt(this.foodProductionArea);
    const clothingAreaOffsetX = this.housePositionX + sectionWidth/2 + foodAreaWidth + clothingAreaWidth/2 + 10; // 5m gap from section + food area + 5m gap
    
    // Add small buffer around clothing area for smoother transition
    const buffer = 1;
    
    return (
      worldPos.x >= clothingAreaOffsetX - clothingAreaWidth/2 - buffer &&
      worldPos.x <= clothingAreaOffsetX + clothingAreaWidth/2 + buffer &&
      worldPos.y >= this.housePositionZ - clothingAreaDepth/2 - buffer &&
      worldPos.y <= this.housePositionZ + clothingAreaDepth/2 + buffer
    );
  }

  // Get the level height for the house area
  getHouseLevelHeight(): number {
    // Return elevated terrain height for house area (land tiles are at 1.5m)
    return 1.5;
  }
}