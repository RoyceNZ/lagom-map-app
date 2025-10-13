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

// Visual representation mapping (Three.js material types) - expanded for 1:1 mapping
export type VisualTerrainType = 
  | 'mountains'          // Grey stone for rocky peaks
  | 'tundra'             // Light grey stone for cold barren areas  
  | 'urban'              // Dark grey stone for built areas
  | 'borealForest'       // Dark green trees for northern forests
  | 'temperateForest'    // Medium green trees for temperate forests
  | 'tropicalRainforest' // Bright green trees for tropical forests
  | 'cropland'           // Yellow grass for farmland
  | 'scrub'              // Green grass for shrubland
  | 'temperateGrassland' // Greener grass for grasslands
  | 'pastureland'        // Dark grass for grazing land
  | 'savanna'            // Clay color for warm grasslands
  | 'deserts'            // Sand color for hot dry areas
  | 'saltwater'          // Dark blue for ocean
  | 'freshwater';        // Light blue for lakes/rivers

// Map terrain types to visual representation (1:1 mapping)
export const TERRAIN_VISUAL_MAPPING: Record<TerrainType, VisualTerrainType> = {
  saltwater: 'saltwater',                    // Dark blue water (ocean)
  freshwater: 'freshwater',                  // Light blue water (lakes/rivers)  
  borealForest: 'borealForest',              // Dark green trees - northern forests
  temperateForest: 'temperateForest',        // Medium green trees - temperate forests
  tropicalRainforest: 'tropicalRainforest',  // Bright green trees - tropical forests
  temperateGrassland: 'temperateGrassland',  // Greener grass - grasslands and meadows
  savanna: 'savanna',                        // Clay color - warm dry grasslands
  tundra: 'tundra',                          // Light grey stone - cold barren areas
  deserts: 'deserts',                        // Sand color - hot dry areas
  mountains: 'mountains',                    // Grey stone - rocky peaks
  pastureland: 'pastureland',                // Dark grass - grazing land
  cropland: 'cropland',                      // Yellow grass - farmland
  scrub: 'scrub',                            // Green grass - dry shrubland and coastal areas
  urban: 'urban'                             // Dark grey stone - built areas (house/section)
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

 



  // Diet properties for food production area
  selectedDiet = 'vegan'; // Default diet
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

 
  isUpdating = false;
  transitionDuration = 300; // milliseconds
  private updateTimeout: any;
  
  // Store mesh references for each terrain type
  private mountainsMesh!: THREE.InstancedMesh;
  private tundraMesh!: THREE.InstancedMesh;
  private urbanMesh!: THREE.InstancedMesh;
  private borealForestMesh!: THREE.InstancedMesh;
  private temperateForestMesh!: THREE.InstancedMesh;
  private tropicalRainforestMesh!: THREE.InstancedMesh;
  private croplandMesh!: THREE.InstancedMesh;
  private scrubMesh!: THREE.InstancedMesh;
  private temperateGrasslandMesh!: THREE.InstancedMesh;
  private pasturelandMesh!: THREE.InstancedMesh;
  private savannaMesh!: THREE.InstancedMesh;
  private desertsMesh!: THREE.InstancedMesh;
  private saltwaterMesh!: THREE.InstancedMesh;
  private freshwaterMesh!: THREE.InstancedMesh;
  private tileToInstanceMap: Map<string, {mesh: THREE.InstancedMesh, index: number}> = new Map();
  private originalHeights: Map<string, number> = new Map(); // Cache original terrain heights

  light!: THREE.DirectionalLight;

  // Terrain distribution tracking
  actualTerrainPercentages: { stone: number; dirt: number; dirt2: number; sand: number; grass: number; water: number } = 
    { stone: 0, dirt: 0, dirt2: 0, sand: 0, grass: 0, water: 0 };
  expectedTerrainPercentages: { stone: number; dirt: number; dirt2: number; sand: number; grass: number; water: number } = 
    { stone: 0, dirt: 0, dirt2: 0, sand: 0, grass: 0, water: 0 };

  // Terrain generation seed for natural variation
  terrainSeed = Math.random() * 10000;
  showTerrainControls = true;

  // Earth-based biome quotas (enforces original distribution)
  enforceEarthQuotas = true;
  biomeQuotas: Record<TerrainType, number> = {
    saltwater: 0, freshwater: 0, borealForest: 0, temperateForest: 0, tropicalRainforest: 0,
    temperateGrassland: 0, savanna: 0, tundra: 0, deserts: 0, mountains: 0,
    pastureland: 0, cropland: 0, scrub: 0, urban: 0
  };

  // Track remaining quotas during generation
  remainingQuotas: Record<TerrainType, number> = { ...this.biomeQuotas };

  // Actual terrain counts from generation
  actualBiomeCounts: Record<TerrainType, number> = {
    saltwater: 0, freshwater: 0, borealForest: 0, temperateForest: 0, tropicalRainforest: 0,
    temperateGrassland: 0, savanna: 0, tundra: 0, deserts: 0, mountains: 0,
    pastureland: 0, cropland: 0, scrub: 0, urban: 0
  };

  // Get actual biome percentage
  getActualBiomePercentage(biome: TerrainType): number {
    const totalTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    return (this.actualBiomeCounts[biome] / totalTiles) * 100;
  }

  // Get actual biome count  
  getActualBiomeCount(biome: TerrainType): number {
    return this.actualBiomeCounts[biome];
  }

  // Get target (Earth-based) biome percentage
  getTargetBiomePercentage(biome: TerrainType): number {
    if (!this.enforceEarthQuotas) return 0;
    const totalTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    return (this.biomeQuotas[biome] / totalTiles) * 100;
  }

  // Get quota status for a biome
  getQuotaStatus(biome: TerrainType): string {
    if (!this.enforceEarthQuotas) return '';
    const actual = this.getActualBiomePercentage(biome);
    const target = this.getTargetBiomePercentage(biome);
    const diff = Math.abs(actual - target);
    
    if (diff < 0.1) return '✅'; // Very close
    if (diff < 0.5) return '🟡'; // Close
    return '🔴'; // Far from target
  }

  // Calculate Earth-based biome quotas for current map size
  private calculateBiomeQuotas(): void {
    const totalTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    const breakdown = this.landBreakdownPerPerson;
    const totalArea = this.totalAreaPerPerson;
    
    // Calculate exact tile quotas based on Earth percentages
    Object.keys(breakdown).forEach(biome => {
      const areaPercentage = breakdown[biome] / totalArea;
      this.biomeQuotas[biome as TerrainType] = Math.round(totalTiles * areaPercentage);
    });
    
    // Reset remaining quotas
    this.remainingQuotas = { ...this.biomeQuotas };
    
    console.log('=== EARTH-BASED BIOME QUOTAS ===');
    Object.entries(this.biomeQuotas).forEach(([biome, quota]) => {
      const percentage = (quota / totalTiles * 100);
      console.log(`${biome}: ${quota} tiles (${percentage.toFixed(1)}%)`);
    });
    console.log('================================');
  }

  // Check if a biome can be placed (quota available)
  private canPlaceBiome(biome: TerrainType): boolean {
    if (!this.enforceEarthQuotas) return true;
    return this.remainingQuotas[biome] > 0;
  }

  // Reserve a tile for a specific biome (decrements quota)
  private reserveBiomeTile(biome: TerrainType): boolean {
    if (!this.enforceEarthQuotas) return true;
    
    if (this.remainingQuotas[biome] > 0) {
      this.remainingQuotas[biome]--;
      return true;
    }
    return false;
  }

  // Get fallback biome when preferred biome quota is exceeded
  private getFallbackBiome(preferredBiome: TerrainType, x: number, z: number, distance: number): TerrainType {
    // Priority order for fallbacks based on similarity
    const fallbackMap: Record<TerrainType, TerrainType[]> = {
      borealForest: ['temperateForest', 'tundra', 'scrub'],
      temperateForest: ['borealForest', 'temperateGrassland', 'tropicalRainforest'],
      tropicalRainforest: ['temperateForest', 'savanna', 'borealForest'],
      temperateGrassland: ['savanna', 'scrub', 'temperateForest'],
      savanna: ['temperateGrassland', 'tropicalRainforest', 'deserts'],
      deserts: ['scrub', 'savanna', 'tundra'],
      tundra: ['mountains', 'borealForest', 'temperateForest'],
      mountains: ['tundra', 'scrub', 'borealForest'],
      scrub: ['temperateGrassland', 'savanna', 'temperateForest'],
      saltwater: ['freshwater', 'scrub'],
      freshwater: ['scrub', 'temperateGrassland', 'temperateForest'],
      urban: ['scrub', 'temperateGrassland', 'cropland'],
      cropland: ['pastureland', 'temperateGrassland', 'savanna'],
      pastureland: ['cropland', 'temperateGrassland', 'savanna']
    };
    
    // FIRST: Aggressively force missing biomes to appear (enhanced visibility)
    const islandRadius = this.mapHalfSize * 0.65;
    const islandX = x / islandRadius;
    const islandZ = z / islandRadius;
    
    // Get all biomes that still have quota remaining
    const availableBiomes = Object.keys(this.remainingQuotas).filter(biome => 
      this.canPlaceBiome(biome as TerrainType)
    ) as TerrainType[];
    
    // Prioritize missing biomes (those that haven't appeared yet)
    const missingBiomes = availableBiomes.filter(biome => {
      const remaining = this.remainingQuotas[biome as TerrainType];
      const original = this.biomeQuotas[biome as TerrainType];
      return remaining === original; // This biome hasn't been placed at all yet
    });
    
    // ENHANCED: If there are missing biomes, aggressively try to place them (increased from 25% to 40%)
    if (missingBiomes.length > 0) {
      const diversityRoll = this.seededRandom(x, z, 800);
      if (diversityRoll < 0.4) { // 40% chance to force a missing biome (increased visibility)
        // Choose missing biome based on geographic appropriateness
        let chosenBiome: TerrainType | null = null;
        
        if (islandZ < -0.1 && missingBiomes.includes('temperateForest')) {
          chosenBiome = 'temperateForest';
        } else if (islandZ > 0.1 && missingBiomes.includes('tropicalRainforest')) {
          chosenBiome = 'tropicalRainforest';
        } else if (islandZ > 0.1 && missingBiomes.includes('savanna')) {
          chosenBiome = 'savanna';
        } else if (islandX < -0.1 && missingBiomes.includes('deserts')) {
          chosenBiome = 'deserts';
        } else if (islandX > 0.1 && missingBiomes.includes('temperateGrassland')) {
          chosenBiome = 'temperateGrassland';
        } else if (Math.abs(islandX) < 0.3 && Math.abs(islandZ) < 0.3 && missingBiomes.includes('freshwater')) {
          chosenBiome = 'freshwater';
        } else {
          // Random missing biome
          const randomIndex = Math.floor(this.seededRandom(x, z, 810) * missingBiomes.length);
          chosenBiome = missingBiomes[randomIndex];
        }
        
        if (chosenBiome && this.canPlaceBiome(chosenBiome)) {
          return chosenBiome;
        }
      }
    }
    
    // SECOND: Also boost rare biomes that have very low counts (< 50 tiles placed)
    const rareBiomes = availableBiomes.filter(biome => {
      const placed = this.biomeQuotas[biome as TerrainType] - this.remainingQuotas[biome as TerrainType];
      return placed < 50; // Biomes with less than 50 tiles placed
    });
    
    if (rareBiomes.length > 0) {
      const rareBiomeRoll = this.seededRandom(x, z, 820);
      if (rareBiomeRoll < 0.3) { // 30% chance to boost rare biomes
        const randomRareIndex = Math.floor(this.seededRandom(x, z, 830) * rareBiomes.length);
        const rareBiome = rareBiomes[randomRareIndex];
        if (this.canPlaceBiome(rareBiome)) {
          return rareBiome;
        }
      }
    }
    
    // THIRD: Try standard fallback options in order
    const fallbacks = fallbackMap[preferredBiome] || ['scrub'];
    for (const fallback of fallbacks) {
      if (this.canPlaceBiome(fallback)) {
        return fallback;
      }
    }
    
    // FOURTH: Find any available biome with quota remaining
    for (const biome of availableBiomes) {
      if (this.canPlaceBiome(biome)) {
        return biome;
      }
    }
    
    // Absolute fallback
    return 'scrub';
  }

  // Convert visual terrain type back to logical terrain type for counting
  private getLogicalTerrainFromVisual(visualType: VisualTerrainType, x: number, z: number): TerrainType {
    // Since we have 1:1 mapping, we can reverse lookup from the mapping
    for (const [logical, visual] of Object.entries(TERRAIN_VISUAL_MAPPING)) {
      if (visual === visualType) {
        return logical as TerrainType;
      }
    }
    
    // Fallback - this shouldn't happen with 1:1 mapping
    return 'scrub';
  }

  // Precise tile counting for ocean percentage enforcement
  private oceanTileCount = 0;
  private totalTileCount = 0;
  private maxOceanTiles = 0;
  private landTileCount = 0;
  private maxLandTiles = 0;
  
  // Pre-calculated natural island shape for performance
  private naturalIslandMap?: Map<string, boolean>;


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

  // Calculate number of tiles for each biome based on area and map size
  get biomeTileCounts(): { [key: string]: number } {
    const totalTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    const breakdown = this.landBreakdownPerPerson;
    const totalArea = this.totalAreaPerPerson;
    
    const tileCounts: { [key: string]: number } = {};
    
    // Calculate tiles for each biome based on their area percentage
    Object.keys(breakdown).forEach(biome => {
      const areaPercentage = breakdown[biome] / totalArea;
      tileCounts[biome] = Math.round(totalTiles * areaPercentage);
    });
    
    return tileCounts;
  }

  // Helper function to get tile count for a specific biome
  getBiomeTileCount(biomeName: string): number {
    return this.biomeTileCounts[biomeName] || 0;
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
    
    // Target: 70.9% saltwater (ocean) + 1.77% freshwater (land-based lakes/rivers) = 72.67% total water
    // But since freshwater is now on land tiles, we need 70.9% ocean + 29.1% land (which includes freshwater)
    const targetOceanTiles = Math.floor(totalTiles * 0.709); // Just ocean tiles
    const targetLandTiles = Math.floor(totalTiles * 0.291);  // Land tiles (some will become freshwater)
    
    // Simulate freshwater placement on land tiles to estimate count
    let estimatedFreshwaterOnLand = 0;
    const sampleSize = Math.min(1000, targetLandTiles); // Sample to estimate
    
    for (let sample = 0; sample < sampleSize; sample++) {
      // Generate a random land tile position (simplified)
      const angle = Math.random() * 2 * Math.PI;
      const radius = Math.random() * halfSize * 0.4; // Inland positions
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const adjustedDistance = Math.sqrt(x * x + z * z) / halfSize;
      
      if (this.shouldBeFreshwaterOnLand(x, z, adjustedDistance)) {
        estimatedFreshwaterOnLand++;
      }
    }
    
    // Scale the estimate to full land area
    const freshwaterRatio = estimatedFreshwaterOnLand / sampleSize;
    const estimatedTotalFreshwater = Math.floor(targetLandTiles * freshwaterRatio);
    
    console.log('=== CALCULATING OPTIMAL OCEAN THRESHOLD ===');
    console.log(`Target ocean tiles: ${targetOceanTiles} / ${totalTiles} (${(targetOceanTiles/totalTiles*100).toFixed(1)}%)`);
    console.log(`Target land tiles: ${targetLandTiles} / ${totalTiles} (${(targetLandTiles/totalTiles*100).toFixed(1)}%)`);
    console.log(`Estimated freshwater on land: ${estimatedTotalFreshwater} (${(estimatedTotalFreshwater/totalTiles*100).toFixed(2)}%)`);
    console.log(`Remaining solid land: ${targetLandTiles - estimatedTotalFreshwater} (${((targetLandTiles - estimatedTotalFreshwater)/totalTiles*100).toFixed(1)}%)`);
    
    // Use binary search to find the distance threshold that gives us target ocean tiles
    
    // Test different thresholds to find the one that gives us closest to target ocean tiles
    let bestThreshold = 0.4;
    let bestDifference = Number.MAX_SAFE_INTEGER;
    
    for (let threshold = 0.2; threshold <= 0.6; threshold += 0.01) {
      let oceanCount = 0;
      
      for (let i = -halfSize; i <= halfSize; i++) {
        for (let j = -halfSize; j <= halfSize; j++) {
          const distanceFromCenter = Math.sqrt(i * i + j * j) / halfSize;
    
          
          if (distanceFromCenter > threshold) {
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

  // Pre-calculate natural island shape for performance optimization
  private calculateNaturalIslandShape(halfSize: number): void {
    console.log('Pre-calculating natural island shape for performance...');
    this.naturalIslandMap = new Map<string, boolean>();
    
    const startTime = performance.now();
    let landTileCount = 0;
    
    // Generate all possible tile positions and determine which are land
    for (let i = -halfSize; i <= halfSize; i++) {
      for (let j = -halfSize; j <= halfSize; j++) {
        const x = i;
        const z = j;
        const isLand = this.calculateIslandLandAtPosition(x, z, halfSize);
        
        if (isLand) {
          this.naturalIslandMap.set(`${x},${z}`, true);
          landTileCount++;
        }
      }
    }
    
    const endTime = performance.now();
    const landPercentage = (landTileCount / this.totalTileCount * 100).toFixed(1);
    
    console.log(`Natural island pre-calculation complete:`);
    console.log(`- Land tiles: ${landTileCount} (${landPercentage}%)`);
    console.log(`- Calculation time: ${(endTime - startTime).toFixed(1)}ms`);
  }

  // Calculate if a specific position should be land (used only during pre-calculation)
  private calculateIslandLandAtPosition(x: number, z: number, halfSize: number): boolean {
    const centerX = 0;
    const centerZ = 0;
    
    // Calculate distance and angle from center
    const distanceFromCenter = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
    const normalizedDistance = distanceFromCenter / halfSize;
    const angle = Math.atan2(z - centerZ, x - centerX);
    
    // Create more natural, irregular island shape using multiple techniques
    
    // 1. Base organic shape (not perfectly circular)
    let baseRadius = 0.6; // Slightly smaller base
    
    // 2. Large-scale geographic features using domain warping
    const warpScale = 0.008;
    const warpStrength = 25;
    
    const warpX1 = this.seededNoise2D(x * warpScale, z * warpScale) * warpStrength;
    const warpZ1 = this.seededNoise2D((x + 100) * warpScale, (z + 100) * warpScale) * warpStrength;
    
    const warpedX = x + warpX1;
    const warpedZ = z + warpZ1;
    const warpedDistance = Math.sqrt(warpedX ** 2 + warpedZ ** 2) / halfSize;
    const warpedAngle = Math.atan2(warpedZ, warpedX);
    
    // 3. Fractal noise for organic complexity (multiple octaves)
    let coastalNoise = 0;
    let amplitude = 1;
    let frequency = 0.01;
    const octaves = 6;
    
    for (let i = 0; i < octaves; i++) {
      coastalNoise += this.seededNoise2D(x * frequency + i * 1000, z * frequency + i * 1000) * amplitude;
      amplitude *= 0.5; // Each octave has half the amplitude
      frequency *= 2;   // Each octave has double the frequency
    }
    coastalNoise *= 0.15; // Scale the overall effect
    
    // 4. Large peninsulas and deep bays using low-frequency variations
    const majorFeatures = 
      Math.sin(warpedAngle * 2.3 + this.terrainSeed * 0.001) * 0.18 +
      Math.sin(warpedAngle * 3.7 + this.terrainSeed * 0.002) * 0.12 +
      Math.sin(warpedAngle * 5.1 + this.terrainSeed * 0.003) * 0.08;
    
    // 5. Medium-scale coastal indentations
    const mediumFeatures = 
      Math.sin(warpedAngle * 8.2 + coastalNoise * 10) * 0.06 +
      Math.sin(warpedAngle * 12.7 + coastalNoise * 15) * 0.04;
    
    // 6. Small-scale coastal detail
    const smallFeatures = this.seededNoise2D(x * 0.05, z * 0.05) * 0.03 +
                          this.seededNoise2D(x * 0.12, z * 0.12) * 0.02;
    
    // 7. Create some natural elongation (not perfectly round)
    const elongationFactor = 1 + Math.sin(warpedAngle + this.terrainSeed * 0.001) * 0.15;
    
    // Combine all features
    const effectiveRadius = (baseRadius + majorFeatures + mediumFeatures + coastalNoise + smallFeatures) * elongationFactor;
    
    // 8. Distance-based falloff for natural island edges
    const distanceFalloff = Math.pow(Math.max(0, 1 - warpedDistance * 1.2), 0.8);
    const adjustedRadius = effectiveRadius * distanceFalloff;
    
    // 9. Natural coastline determination with erosion simulation
    const coastlineThreshold = adjustedRadius;
    const coastlineNoise = this.seededNoise2D(x * 0.3 + this.terrainSeed, z * 0.3 + this.terrainSeed) * 0.05;
    
    // Create natural transition zone
    const transitionWidth = 0.08;
    const distanceToCoast = normalizedDistance - (coastlineThreshold + coastlineNoise);
    
    if (distanceToCoast < -transitionWidth) {
      return true; // Definitely land
    } else if (distanceToCoast > transitionWidth) {
      return false; // Definitely ocean
    } else {
      // Natural coastline transition with erosion patterns
      const erosionNoise = this.seededNoise2D(x * 0.4, z * 0.4) + 
                           this.seededNoise2D(x * 0.8, z * 0.8) * 0.5;
      const transitionFactor = (distanceToCoast + transitionWidth) / (2 * transitionWidth);
      
      // Add some randomness for natural coastline variation
      const randomFactor = this.seededNoise2D(x * 0.25 + this.terrainSeed * 2, z * 0.25 + this.terrainSeed * 3);
      
      return (erosionNoise + randomFactor * 0.3) > transitionFactor;
    }
  }

  // Generate seeded random number for consistent terrain patterns
  private seededRandom(x: number, z: number, offset: number = 0): number {
    const seed = this.terrainSeed + offset;
    const value = Math.sin((x + seed) * 12.9898 + (z + seed) * 78.233) * 43758.5453;
    return Math.abs(value) % 1;
  }

  // Regenerate terrain with new patterns
  regenerateTerrain(): void {
    this.terrainSeed = Math.random() * 10000;
    console.log('Regenerating terrain with new seed:', this.terrainSeed);
    this.updateMap();
  }

  // Enhanced method to determine logical terrain type with natural clustering and quota enforcement
  private getLogicalTerrainType(noiseValue: number, x: number, z: number, adjustedDistance: number): TerrainType {
    // FIRST: Check if this tile is even part of the natural island
    const tileKey = `${x},${z}`;
    const isPartOfIsland = this.naturalIslandMap?.get(tileKey) || false;
    
    if (!isPartOfIsland) {
      // This tile is outside the natural island boundaries - it should be ocean
      return 'saltwater';
    }

    // Natural island terrain generation with quota enforcement
    const elevation = this.calculateNaturalElevation(x, z, adjustedDistance);
    
    // Get natural biome preference (what would naturally occur here)
    const preferredBiome = this.getNaturalBiomePreference(x, z, adjustedDistance, elevation);
    
    // Try to place preferred biome, use fallback if quota exceeded
    if (this.canPlaceBiome(preferredBiome)) {
      return preferredBiome;
    } else {
      return this.getFallbackBiome(preferredBiome, x, z, adjustedDistance);
    }
  }

  // Get the natural biome preference - SIMPLIFIED for clear distinct groups with NO MIXING
  private getNaturalBiomePreference(x: number, z: number, adjustedDistance: number, elevation: number): TerrainType {
    // Get primary biome cluster ONLY - no secondary influences or mixing
    const primaryBiome = this.getNaturalBiomeCluster(x, z, adjustedDistance, elevation);
    
    // Return primary biome directly with no transitions, constraints, or geographic modifications
    return primaryBiome;
  }

  // Calculate natural elevation based on distance and terrain features
  private calculateNaturalElevation(x: number, z: number, distance: number): number {
    // Create a natural mountain range through the center with foothills
    const mountainSpine = Math.abs(x * 0.3 + z * 0.1) < 20 ? 1.0 : 0.0;
    const foothills = Math.exp(-Math.pow(x * 0.05 + z * 0.03, 2)) * 0.8;
    
    // Add natural terrain variation using seeded random
    const terrainNoise1 = (this.seededRandom(x, z, 100) - 0.5) * 0.6;
    const terrainNoise2 = (this.seededRandom(x, z, 200) - 0.5) * 0.4;
    const terrainNoise3 = (this.seededRandom(x, z, 300) - 0.5) * 0.2;
    
    const baseElevation = 1.0 - distance; // Higher at center, lower at edges
    const mountainInfluence = mountainSpine + foothills;
    const noiseInfluence = terrainNoise1 + terrainNoise2 + terrainNoise3;
    
    return Math.max(0, baseElevation + mountainInfluence * 0.4 + noiseInfluence * 0.3);
  }

  // Get primary biome based on natural clustering patterns within the island
  private getNaturalBiomeCluster(x: number, z: number, distance: number, elevation: number): TerrainType {
    // Only cluster biomes within the island - use distance-based positioning
    // Distance 0 = center, distance 1 = edge of map (but island edge is ~0.65)
    
    // Convert absolute coordinates to island-relative coordinates
    // Scale coordinates based on actual island size rather than full map
    const islandRadius = this.mapHalfSize * 0.65; // Match island generation radius
    const islandX = x / islandRadius;  // Normalize to island scale
    const islandZ = z / islandRadius;  // Normalize to island scale
    const islandDistance = Math.sqrt(islandX * islandX + islandZ * islandZ);
    
    // Single consolidated cluster per biome type for maximum visibility
    // Each biome gets ONE primary location with large radius for clear identification
    const biomeSeeds = [
      // Major biomes positioned strategically around the island with large consolidated areas
      { x: 0, z: -0.35, biome: 'borealForest', radius: 0.45 },       // North - large boreal forest region
      { x: 0.4, z: -0.2, biome: 'temperateForest', radius: 0.4 },    // Northeast - consolidated temperate forest
      { x: -0.4, z: 0, biome: 'deserts', radius: 0.4 },              // West - large desert region
      { x: 0, z: 0.4, biome: 'tropicalRainforest', radius: 0.45 },   // South - major rainforest area
      { x: 0.4, z: 0.15, biome: 'temperateGrassland', radius: 0.35 }, // East - grassland plains
      { x: -0.2, z: 0.35, biome: 'savanna', radius: 0.3 },           // Southwest - savanna region
      { x: 0, z: 0, biome: 'mountains', radius: 0.25 },              // Center - mountain range
      { x: -0.3, z: -0.3, biome: 'tundra', radius: 0.3 },           // Northwest - tundra region
      { x: 0.25, z: 0, biome: 'scrub', radius: 0.25 },              // Central-east - scrubland
      { x: -0.1, z: -0.1, biome: 'freshwater', radius: 0.2 },       // Near center - lake region
      // Human use biomes consolidated into distinct zones
      { x: 0.15, z: -0.15, biome: 'urban', radius: 0.2 },           // Northeast urban center
      { x: -0.15, z: 0.2, biome: 'cropland', radius: 0.25 },        // West-central agricultural zone
      { x: 0.2, z: 0.3, biome: 'pastureland', radius: 0.22 },       // Southeast grazing lands
    ];
    
    // Find the closest biome seed within island coordinates - CLEAN distinct clusters only
    let closestBiome: TerrainType = 'scrub';
    let minDistance = Infinity;
    
    // Pure clustering - find closest biome seed with NO noise or variation
    for (const seed of biomeSeeds) {
      const seedDistance = Math.sqrt((islandX - seed.x) ** 2 + (islandZ - seed.z) ** 2);
      const influenceRadius = seed.radius; // Clean radius with no modifications
      
      if (seedDistance < influenceRadius && seedDistance < minDistance) {
        minDistance = seedDistance;
        closestBiome = seed.biome as TerrainType;
      }
    }
    
    return closestBiome;
  }

  // Enhanced fallback system with intelligent biome placement and rare biome visibility boosting
  private getSecondaryBiomeInfluence(x: number, z: number, distance: number, elevation: number): TerrainType {
    // Convert to island-relative coordinates
    const islandRadius = this.mapHalfSize * 0.65;
    const islandX = x / islandRadius;
    const islandZ = z / islandRadius;
    const islandDistance = Math.sqrt(islandX * islandX + islandZ * islandZ);
    
    // Create transition influences based on neighboring biomes using seeded random
    const influenceNoise = (this.seededRandom(x, z, 500) - 0.5) * 0.2; // Reduced noise for stronger clustering
    
    // Coastal influence - scrub near island coastlines (maintained)
    if (islandDistance > 0.7) {
      return 'scrub';
    }
    
    // MINIMAL secondary biome influences - only for essential transitions
    // Greatly reduced to promote single consolidated clusters per biome
    const secondarySeeds = [
      // Only essential boundary transitions to prevent hard edges
      { x: 0.2, z: -0.25, biome: 'scrub', radius: 0.08 },    // Small transition zone
      { x: -0.2, z: 0.2, biome: 'scrub', radius: 0.08 },     // Small transition zone
      { x: 0.0, z: 0.15, biome: 'scrub', radius: 0.06 },     // Minimal transition
    ];
    
    // Find closest secondary influence with much smaller radius for minimal mixing
    for (const seed of secondarySeeds) {
      const seedDistance = Math.sqrt((islandX - seed.x) ** 2 + (islandZ - seed.z) ** 2);
      const effectiveRadius = seed.radius + influenceNoise * 0.05; // Much smaller influence
      if (seedDistance < effectiveRadius) {
        return seed.biome as TerrainType;
      }
    }
    
    // Greatly reduced diversity enforcement to maintain consolidated clusters (reduced from 25% to 5%)
    const diversityRoll = this.seededRandom(x, z, 650);
    
    // Minimal forced diversity to preserve primary biome clustering (reduced from 25% to 5%)
    if (diversityRoll < 0.05) { // Only 5% chance for forced diversity to maintain consolidated appearance
      const allBiomes: TerrainType[] = [
        'temperateForest', 'tropicalRainforest', 'temperateGrassland', 
        'savanna', 'deserts', 'freshwater', 'urban', 'cropland', 'pastureland'
      ];
      const biomeIndex = Math.floor(this.seededRandom(x, z, 670) * allBiomes.length);
      return allBiomes[biomeIndex];
    }
    
    // Fallback to scrub to maintain clean boundaries between primary biome clusters
    return 'scrub';
    return 'deserts';
  }

  // Generate transition noise for biome boundaries
  private getTransitionNoise(x: number, z: number): number {
    const noise1 = (this.seededRandom(x, z, 700) - 0.5) * 1.0;
    const noise2 = (this.seededRandom(x, z, 800) - 0.5) * 0.6;
    const noise3 = (this.seededRandom(x, z, 900) - 0.5) * 0.4;
    
    return (noise1 + noise2 + noise3) / 3;
  }

  // Apply elevation constraints to biome selection (reduced constraints for more diversity)
  private applyElevationConstraints(primary: TerrainType, secondary: TerrainType, elevation: number, transitionNoise: number, x: number, z: number): TerrainType {
    // Very high elevation biomes (more restrictive threshold)
    if (elevation > 0.85) {
      if (elevation > 0.95) return 'mountains';
      return this.seededRandom(x, z, 950) < 0.6 ? 'tundra' : 'mountains';
    }
    
    // High elevation - allow more biome variety
    if (elevation > 0.7) {
      if (primary === 'saltwater' || primary === 'freshwater') {
        return this.seededRandom(x, z, 960) < 0.5 ? 'tundra' : 'mountains';
      }
      // Allow temperate forests and grasslands at high elevation
      if (primary === 'deserts' || primary === 'savanna' || primary === 'tropicalRainforest') {
        return transitionNoise > 0 ? 'temperateForest' : 'temperateGrassland';
      }
      return primary;
    }
    
    // Medium elevation - most biomes allowed
    if (elevation > 0.4) {
      return primary; // Allow all biomes at medium elevation
    }
    
    // Low elevation - favor diverse biomes, avoid only the highest elevation ones
    if (elevation < 0.3) {
      if (primary === 'mountains') {
        return secondary === 'tundra' ? 'temperateGrassland' : secondary;
      }
      if (primary === 'tundra' && elevation < 0.15) {
        return secondary === 'mountains' ? 'scrub' : secondary;
      }
    }
    
    // Use transition noise to blend biomes naturally with more variety
    const blendThreshold = 0.2 + (elevation * 0.05); // Reduced threshold for more blending
    if (Math.abs(transitionNoise) < blendThreshold) {
      const choice = this.seededRandom(x, z, 1000);
      if (choice < 0.4) return primary;
      if (choice < 0.8) return secondary;
      // 20% chance for additional diversity
      const diversityBiomes: TerrainType[] = ['temperateForest', 'tropicalRainforest', 'savanna', 'deserts', 'temperateGrassland', 'freshwater'];
      return diversityBiomes[Math.floor(this.seededRandom(x, z, 1050) * diversityBiomes.length)];
    }
    
    return primary;
  }

  // Apply geographic logic for realistic biome placement within the island
  private applyGeographicLogic(biome: TerrainType, x: number, z: number, distance: number, elevation: number): TerrainType {
    // Convert to island-relative coordinates
    const islandRadius = this.mapHalfSize * 0.65;
    const islandX = x / islandRadius;
    const islandZ = z / islandRadius;
    const islandDistance = Math.sqrt(islandX * islandX + islandZ * islandZ);
    
    // Freshwater lakes in low-lying areas (natural collection points)
    if (elevation < 0.3 && islandDistance < 0.4) {
      const lakeChance = this.seededRandom(x, z, 1150);
      if (lakeChance < 0.08 && biome !== 'urban' && biome !== 'mountains') {
        return 'freshwater';
      }
    }
    
    // Rain shadow effect - deserts behind mountains (west side of island)
    if (islandX < -0.2 && elevation < 0.4) {
      const mountainDistance = Math.sqrt((islandX + 0.3) ** 2 + islandZ ** 2);
      if (mountainDistance < 0.3) {
        return this.seededRandom(x, z, 1100) < 0.7 ? 'deserts' : 'scrub';
      }
    }
    
    // Tropical areas in the south
    if (islandZ > 0.2 && elevation < 0.6) {
      if (biome === 'temperateForest' || biome === 'borealForest') {
        return this.seededRandom(x, z, 1160) < 0.4 ? 'tropicalRainforest' : biome;
      }
      if (biome === 'temperateGrassland') {
        return this.seededRandom(x, z, 1170) < 0.3 ? 'savanna' : biome;
      }
    }
    
    // Northern areas favor boreal and temperate biomes
    if (islandZ < -0.2) {
      if (biome === 'tropicalRainforest') {
        return elevation > 0.3 ? 'temperateForest' : 'borealForest';
      }
      if (biome === 'savanna') {
        return elevation > 0.4 ? 'temperateGrassland' : 'borealForest';
      }
    }
    
    // Coastal zones - scrub and grassland near island coastlines
    if (islandDistance > 0.6 && islandDistance < 0.9) {
      if (biome === 'tropicalRainforest' || biome === 'temperateForest') {
        return this.seededRandom(x, z, 1200) < 0.4 ? 'scrub' : biome;
      }
    }
    
    // River valleys and water proximity - more forests and grasslands
    const waterProximityBonus = this.calculateWaterProximity(islandX, islandZ);
    if (waterProximityBonus > 0.3 && elevation > 0.2 && elevation < 0.6) {
      if (biome === 'deserts' || biome === 'scrub') {
        return islandZ > 0 ? 'temperateForest' : 'borealForest';
      }
    }
    
    // Urban and agricultural areas can appear but have reduced priority for diversity
    if (biome === 'urban' || biome === 'cropland' || biome === 'pastureland') {
      // Sometimes replace with natural biomes for more diversity
      if (this.seededRandom(x, z, 1250) < 0.3) {
        const naturalAlternatives: TerrainType[] = ['temperateGrassland', 'scrub', 'temperateForest'];
        return naturalAlternatives[Math.floor(this.seededRandom(x, z, 1260) * naturalAlternatives.length)];
      }
      return biome;
    }
    
    return biome;
  }

  // Calculate proximity to water sources for biome influence within island
  private calculateWaterProximity(islandX: number, islandZ: number): number {
    // Simulate river valleys and water sources using island coordinates
    const riverValley1 = Math.exp(-Math.pow((islandX - 0.1) * 2, 2) - Math.pow((islandZ + 0.2) * 1.5, 2));
    const riverValley2 = Math.exp(-Math.pow((islandX + 0.15) * 1.8, 2) - Math.pow((islandZ - 0.25) * 1.6, 2));
    const lakeBed = Math.exp(-Math.pow((islandX + 0.05) * 3, 2) - Math.pow(islandZ * 2.5, 2));
    
    return Math.max(riverValley1, riverValley2, lakeBed);
  }

  // Simple 4-region system with smooth boundaries
  private getSimpleBiomeRegion(relativeX: number, relativeZ: number, distance: number): string {
    // Central area
    if (distance < 0.2) {
      return 'center';
    }
    
    // Simple quadrant system with smooth transitions
    if (Math.abs(relativeX) > Math.abs(relativeZ)) {
      return relativeX > 0 ? 'east' : 'west';
    } else {
      return relativeZ > 0 ? 'south' : 'north';
    }
  }

  // Method to determine terrain type with pre-calculated natural island shape
  getTerrainTypeFromNoise(noiseValue: number, x: number = 0, z: number = 0): VisualTerrainType {
    // Use pre-calculated natural island shape for performance
    const tileKey = `${x},${z}`;
    const isLandTile = this.naturalIslandMap?.get(tileKey) || false;
    
    if (isLandTile) {
      // This tile is part of the natural island
      this.landTileCount++;
      
      // Calculate distance for terrain type determination
      const adjustedDistance = Math.sqrt(x * x + z * z) / this.mapHalfSize;
      
      // Check if this land tile should be freshwater (lakes/rivers within the island)
      const shouldBeFreshwaterLake = this.shouldBeFreshwaterOnLand(x, z, adjustedDistance);
      
      if (shouldBeFreshwaterLake) {
        // This land tile becomes a freshwater lake/river
        return TERRAIN_VISUAL_MAPPING['freshwater'];
      }
      
      // Get logical terrain type, then map to visual representation
      const logicalTerrain = this.getLogicalTerrainType(noiseValue, x, z, adjustedDistance);
      
      return TERRAIN_VISUAL_MAPPING[logicalTerrain];
    } else {
      // This tile is ocean (outside the island boundaries)
      this.oceanTileCount++;
      
      // All water tiles outside the island are saltwater (ocean)
      return TERRAIN_VISUAL_MAPPING['saltwater'];
    }
  }

  // Enhanced seeded 2D noise function for natural terrain generation
  private seededNoise2D(x: number, z: number): number {
    // Use multiple hash functions for better distribution
    const seed = this.terrainSeed;
    
    // Hash the coordinates with the seed for deterministic randomness
    const hash1 = Math.sin((x + seed) * 12.9898 + (z + seed) * 78.233) * 43758.5453;
    const hash2 = Math.sin((x + seed) * 93.9898 + (z + seed) * 47.233) * 23421.6314;
    const hash3 = Math.sin((x + seed) * 67.2346 + (z + seed) * 89.145) * 39284.7293;
    
    // Combine multiple hashes for better noise characteristics
    const noise = (Math.abs(hash1) % 1) * 0.5 + 
                  (Math.abs(hash2) % 1) * 0.3 + 
                  (Math.abs(hash3) % 1) * 0.2;
    
    // Normalize to -1 to 1 range and smooth the distribution
    const normalized = (noise % 1) * 2 - 1;
    
    // Apply smoothing function for more natural curves
    return normalized * normalized * normalized * Math.sign(normalized);
  }

  private shouldBeFreshwaterOnLand(x: number, z: number, adjustedDistance: number): boolean {
    // Enhanced freshwater generation with natural river systems and lakes
    
    // Don't place water too close to the center or too far from land
    if (adjustedDistance < 0.1 || adjustedDistance > 0.75) {
      return false;
    }
    
    // Calculate elevation for this position
    const elevation = this.calculateNaturalElevation(x, z, adjustedDistance);
    
    // Create natural river systems flowing from mountains to coast
    const riverSystem1 = this.createRiverSystem(x, z, { sourceX: 0, sourceZ: -15, targetX: 25, targetZ: 45 }, elevation);
    const riverSystem2 = this.createRiverSystem(x, z, { sourceX: -10, sourceZ: -20, targetX: -40, targetZ: 30 }, elevation);
    const riverSystem3 = this.createRiverSystem(x, z, { sourceX: 15, sourceZ: -10, targetX: 50, targetZ: 20 }, elevation);
    
    // Create mountain lakes in high-elevation areas
    const mountainLake1 = this.createMountainLake(x, z, { centerX: -5, centerZ: -18, radius: 8 }, elevation);
    const mountainLake2 = this.createMountainLake(x, z, { centerX: 12, centerZ: -8, radius: 6 }, elevation);
    
    // Create valley lakes in natural depressions
    const valleyLake1 = this.createValleyLake(x, z, { centerX: -25, centerZ: 10, radius: 12 }, elevation);
    const valleyLake2 = this.createValleyLake(x, z, { centerX: 20, centerZ: 25, radius: 10 }, elevation);
    
    // Create coastal wetlands and estuaries
    const wetland1 = this.createCoastalWetland(x, z, { centerX: 35, centerZ: 35, radius: 8 }, adjustedDistance);
    const wetland2 = this.createCoastalWetland(x, z, { centerX: -35, centerZ: 25, radius: 6 }, adjustedDistance);
    
    // Combine all water features
    return riverSystem1 || riverSystem2 || riverSystem3 || 
           mountainLake1 || mountainLake2 || 
           valleyLake1 || valleyLake2 ||
           wetland1 || wetland2;
  }

  // Create natural river systems flowing from source to target
  private createRiverSystem(x: number, z: number, river: {sourceX: number, sourceZ: number, targetX: number, targetZ: number}, elevation: number): boolean {
    // Calculate the river path
    const riverLength = Math.sqrt((river.targetX - river.sourceX) ** 2 + (river.targetZ - river.sourceZ) ** 2);
    const directionX = (river.targetX - river.sourceX) / riverLength;
    const directionZ = (river.targetZ - river.sourceZ) / riverLength;
    
    // Find closest point on river path
    const toPointX = x - river.sourceX;
    const toPointZ = z - river.sourceZ;
    const projectionLength = Math.max(0, Math.min(riverLength, toPointX * directionX + toPointZ * directionZ));
    
    const closestX = river.sourceX + projectionLength * directionX;
    const closestZ = river.sourceZ + projectionLength * directionZ;
    
    const distanceToRiver = Math.sqrt((x - closestX) ** 2 + (z - closestZ) ** 2);
    
    // River width varies based on distance from source (gets wider downstream)
    const progressRatio = projectionLength / riverLength;
    const baseWidth = 1.5 + progressRatio * 3; // Starts narrow, gets wider
    
    // Add natural meandering
    const meander = Math.sin(projectionLength * 0.3) * Math.cos(projectionLength * 0.2) * 2;
    const effectiveWidth = baseWidth + Math.abs(meander);
    
    // Rivers only flow through appropriate elevations (following valleys)
    const minElevation = 0.15 + progressRatio * 0.1; // Rivers flow to lower elevations
    const maxElevation = 0.6 - progressRatio * 0.2;
    
    if (elevation < minElevation || elevation > maxElevation) {
      return false;
    }
    
    // Add noise for natural river banks
    const bankNoise = (this.seededRandom(x, z, 1300) - 0.5) * 1.0;
    const effectiveDistance = distanceToRiver + bankNoise;
    
    return effectiveDistance < effectiveWidth && this.seededRandom(x, z, 1400) < 0.6; // 60% chance for natural gaps
  }

  // Create mountain lakes in high-elevation areas
  private createMountainLake(x: number, z: number, lake: {centerX: number, centerZ: number, radius: number}, elevation: number): boolean {
    const distance = Math.sqrt((x - lake.centerX) ** 2 + (z - lake.centerZ) ** 2);
    
    // Only create mountain lakes at appropriate elevations
    if (elevation < 0.5 || elevation > 0.85) {
      return false;
    }
    
    // Add natural lake shape variation
    const shapeNoise = (this.seededRandom(x, z, 1500) - 0.5) + 
                      (this.seededRandom(x, z, 1600) - 0.5);
    const effectiveRadius = lake.radius * (1 + shapeNoise * 0.3);
    
    return distance < effectiveRadius && this.seededRandom(x, z, 1700) < 0.8; // 80% density for clear lake definition
  }

  // Create valley lakes in natural depressions
  private createValleyLake(x: number, z: number, lake: {centerX: number, centerZ: number, radius: number}, elevation: number): boolean {
    const distance = Math.sqrt((x - lake.centerX) ** 2 + (z - lake.centerZ) ** 2);
    
    // Valley lakes occur at medium elevations
    if (elevation < 0.2 || elevation > 0.5) {
      return false;
    }
    
    // Create irregular lake shapes
    const angle = Math.atan2(z - lake.centerZ, x - lake.centerX);
    const radialVariation = (this.seededRandom(x, z, 1800) - 0.5) * 0.8;
    const effectiveRadius = lake.radius * (1 + radialVariation);
    
    return distance < effectiveRadius && this.seededRandom(x, z, 1900) < 0.7; // 70% density for natural edges
  }

  // Create coastal wetlands near the shore
  private createCoastalWetland(x: number, z: number, wetland: {centerX: number, centerZ: number, radius: number}, distanceFromCenter: number): boolean {
    const distance = Math.sqrt((x - wetland.centerX) ** 2 + (z - wetland.centerZ) ** 2);
    
    // Wetlands only near the coast
    if (distanceFromCenter < 0.6 || distanceFromCenter > 0.8) {
      return false;
    }
    
    // Create irregular wetland patches
    const patchNoise = (this.seededRandom(x, z, 2000) - 0.5) + 
                      (this.seededRandom(x, z, 2100) - 0.5);
    const effectiveRadius = wetland.radius * (0.8 + patchNoise * 0.4);
    
    return distance < effectiveRadius && this.seededRandom(x, z, 2200) < 0.5; // 50% density for scattered wetland patches
  }

  generateVisualMap(): void {
    console.log('=== ACTUAL MAP VISUAL REPRESENTATION ===');
    const halfSize = this.mapHalfSize;
    const step = 8; // Sample every 8th tile to make it manageable
    
    // Create character mapping for each terrain type
    const terrainChars: Record<VisualTerrainType, string> = {
      saltwater: '~',           // Dark blue water (ocean)
      freshwater: 'w',          // Light blue water (lakes/rivers)
      mountains: 'M',           // Grey stone (rocky peaks)
      tundra: 'T',              // Light grey stone (cold barren)
      urban: 'U',               // Dark grey stone (built areas)
      borealForest: 'B',        // Dark green trees (northern forests)
      temperateForest: 'F',     // Medium green trees (temperate forests)
      tropicalRainforest: 'R',  // Bright green trees (tropical forests)
      cropland: 'C',            // Yellow grass (farmland)
      scrub: 's',               // Green grass (shrubland)
      temperateGrassland: 'G',  // Greener grass (grasslands)
      pastureland: 'P',         // Dark grass (grazing land)
      savanna: 'S',             // Clay color (warm grasslands)
      deserts: 'D'              // Sand color (hot dry areas)
    };
    
    console.log('Legend: ~ = Saltwater, w = Freshwater, M = Mountains, T = Tundra, U = Urban');
    console.log('        B = Boreal Forest, F = Temperate Forest, R = Tropical Rainforest');
    console.log('        C = Cropland, s = Scrub, G = Grassland, P = Pasture, S = Savanna, D = Desert');
    console.log('');
    
    // Sample the map in a grid pattern
    for (let z = halfSize; z >= -halfSize; z -= step) {
      let row = '';
      for (let x = -halfSize; x <= halfSize; x += step) {
        // Get the terrain type for this position
        const noise = Math.random(); // Use random since we don't have the exact noise
        const terrainType = this.getTerrainTypeFromNoise(noise, x, z);
        row += terrainChars[terrainType] + ' ';
      }
      console.log(row);
    }
    
    console.log('');
    console.log('Map shows from top (North) to bottom (South), left (West) to right (East)');
    console.log('Center of map is roughly in the middle of the grid');
    console.log('=========================================');
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
    
    // Prevent viewing the bottom of the map
    controls.maxPolarAngle = Math.PI / 2; // Limit to horizontal view (90 degrees max)

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
  
    // Load individual textures for each terrain type
    let textures = {
      mountains: new THREE.TextureLoader().load('assets/mountains.png'),
      tundra: new THREE.TextureLoader().load('assets/tundra.png'),
      urban: new THREE.TextureLoader().load('assets/urban.png'),
      borealForest: new THREE.TextureLoader().load('assets/borealForest.png'),
      temperateForest: new THREE.TextureLoader().load('assets/temperateForest.png'),
      tropicalRainforest: new THREE.TextureLoader().load('assets/tropicalRainforest.png'),
      cropland: new THREE.TextureLoader().load('assets/cropland.png'),
      scrub: new THREE.TextureLoader().load('assets/scrub.png'),
      temperateGrassland: new THREE.TextureLoader().load('assets/temperateGrassland.png'),
      pastureland: new THREE.TextureLoader().load('assets/pastureland.png'),
      savanna: new THREE.TextureLoader().load('assets/savanna.png'),
      deserts: new THREE.TextureLoader().load('assets/deserts.png'),
      saltwater: new THREE.TextureLoader().load('assets/saltwater.png'),
      freshwater: new THREE.TextureLoader().load('assets/freshwater.png')
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
      
      console.log('=== INITIALIZING PRECISE TILE COUNTING ===');
      console.log(`Total tiles: ${this.totalTileCount}`);
      console.log(`Max land tiles: ${this.maxLandTiles} (${(this.maxLandTiles/this.totalTileCount*100).toFixed(1)}%)`);
      console.log(`Max ocean tiles: ${this.maxOceanTiles} (${(this.maxOceanTiles/this.totalTileCount*100).toFixed(1)}%)`);
      console.log('===============================================');
      
      // PRE-CALCULATE NATURAL ISLAND SHAPE for performance optimization
      this.naturalIslandMap = new Map<string, boolean>();
      this.calculateNaturalIslandShape(halfSize);
    }
    const squareGeometry = new THREE.BoxGeometry(1, 1, 1);
    
    // Create individual meshes for each terrain type with their specific textures
    this.mountainsMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.mountains 
    }), squareCount);
    
    this.tundraMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.tundra 
    }), squareCount);
    
    this.urbanMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.urban 
    }), squareCount);
    
    this.borealForestMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.borealForest 
    }), squareCount);
    
    this.temperateForestMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.temperateForest 
    }), squareCount);
    
    this.tropicalRainforestMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.tropicalRainforest 
    }), squareCount);
    
    this.croplandMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.cropland 
    }), squareCount);
    
    this.scrubMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.scrub 
    }), squareCount);
    
    this.temperateGrasslandMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.temperateGrassland 
    }), squareCount);
    
    this.pasturelandMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.pastureland 
    }), squareCount);
    
    this.savannaMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.savanna 
    }), squareCount);
    
    this.desertsMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.135, flatShading: true, roughness: 1, metalness: 0, map: textures.deserts 
    }), squareCount);
    
    this.saltwaterMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: false, roughness: 0.0, metalness: 0.0, 
      map: textures.saltwater, transparent: true, opacity: 0.8, color: 0x20a0ff
    }), squareCount);
    
    this.freshwaterMesh = new THREE.InstancedMesh(squareGeometry, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: false, roughness: 0.1, metalness: 0.1, 
      map: textures.freshwater, transparent: true, opacity: 0.8, color: 0x4080ff
    }), squareCount);

    // Initialize index counters for each terrain type
    let mountainsIndex = 0;
    let tundraIndex = 0;
    let urbanIndex = 0;
    let borealForestIndex = 0;
    let temperateForestIndex = 0;
    let tropicalRainforestIndex = 0;
    let croplandIndex = 0;
    let scrubIndex = 0;
    let temperateGrasslandIndex = 0;
    let pasturelandIndex = 0;
    let savannaIndex = 0;
    let desertsIndex = 0;
    let saltwaterIndex = 0;
    let freshwaterIndex = 0;
    let waterIndex = 0;

    // Clear the tile mapping and height cache
    this.tileToInstanceMap.clear();
    this.originalHeights.clear();

    // Clear previous counts
    this.actualBiomeCounts = {
      saltwater: 0, freshwater: 0, borealForest: 0, temperateForest: 0, tropicalRainforest: 0,
      temperateGrassland: 0, savanna: 0, tundra: 0, deserts: 0, mountains: 0,
      pastureland: 0, cropland: 0, scrub: 0, urban: 0
    };

    // Initialize Earth-based biome quotas
    if (this.enforceEarthQuotas) {
      this.calculateBiomeQuotas();
    }

    // Track terrain type counts for debugging
    const terrainCounts: Record<VisualTerrainType, number> = {
      saltwater: 0, freshwater: 0, mountains: 0, tundra: 0, urban: 0,
      borealForest: 0, temperateForest: 0, tropicalRainforest: 0,
      cropland: 0, scrub: 0, temperateGrassland: 0, pastureland: 0,
      savanna: 0, deserts: 0
    };
    
    // Track logical terrain types being generated
    const logicalTerrainCounts: Record<TerrainType, number> = {
      saltwater: 0, freshwater: 0, borealForest: 0, temperateForest: 0, tropicalRainforest: 0,
      temperateGrassland: 0, savanna: 0, tundra: 0, deserts: 0, mountains: 0,
      pastureland: 0, cropland: 0, scrub: 0, urban: 0
    };

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
        
  
        if (this.usePopulationSizing) {
          // Use quota-enforced terrain assignment with natural clustering
          const logicalTerrain = this.getLogicalTerrainType(noise, i, j, Math.sqrt(i * i + j * j) / halfSize);
          
          // Reserve the biome tile (decrements quota)
          if (this.enforceEarthQuotas) {
            this.reserveBiomeTile(logicalTerrain);
          }
          
          // Convert logical terrain to visual terrain type
          terrainType = TERRAIN_VISUAL_MAPPING[logicalTerrain];
          
          // Debug logging for natural island generation
          if (Math.random() < 0.0005 && i >= 0 && j >= 0) { // Log 0.05% of tiles, only positive quadrant
            const distanceFromCenter = Math.sqrt(i * i + j * j) / halfSize;
            console.log(`QUOTA TERRAIN Debug [${i},${j}]: logical="${logicalTerrain}", visual="${terrainType}", dist=${distanceFromCenter.toFixed(3)}, remaining=${this.remainingQuotas[logicalTerrain]}`);
          }
        } else {
          // Fallback - should not be used with population sizing enabled
          terrainType = 'temperateGrassland';
        }

        // Track actual biome counts
        const logicalTerrainType = this.getLogicalTerrainFromVisual(terrainType, i, j);
        this.actualBiomeCounts[logicalTerrainType]++;
        terrainCounts[terrainType]++;
        logicalTerrainCounts[logicalTerrainType]++;
        
        // Set height based on terrain type - with 1:1 mapping we can use terrain type directly
        let baseHeight: number;
        if (terrainType === 'saltwater' || terrainType === 'freshwater') {
          // Water tiles stay at water level
          baseHeight = 0.1;
        } else {
          // For natural island terrain, get the logical type to determine proper elevation
          if (this.usePopulationSizing ) {
            // With 1:1 mapping, we can use the visual terrain type directly for height
            switch(terrainType) {
              case 'mountains': baseHeight = 8.0; break;           // True mountains - highest peaks
              case 'tundra': baseHeight = 6.5; break;              // High alpine areas
              case 'urban': baseHeight = 5.5; break;               // Elevated house area
              case 'borealForest': baseHeight = 4.5; break;        // Mountain forest slopes
              case 'temperateForest': baseHeight = 3.5; break;     // Mid-elevation forests
              case 'tropicalRainforest': baseHeight = 3.0; break;  // Lush valleys
              case 'temperateGrassland': baseHeight = 2.5; break;  // Rolling hills
              case 'pastureland': baseHeight = 2.0; break;         // Grazing areas
              case 'cropland': baseHeight = 1.8; break;            // Farmland
              case 'savanna': baseHeight = 1.5; break;             // Dry grasslands
              case 'scrub': baseHeight = 1.0; break;               // Coastal shrubland
              case 'deserts': baseHeight = 0.8; break;             // Dry desert areas
              default: baseHeight = 2.5; break;
            }
          } else {
            // Use simplified height for special areas
            switch(terrainType) {
              case 'mountains': case 'tundra': case 'urban': baseHeight = 2.0; break;
              case 'borealForest': case 'temperateForest': case 'tropicalRainforest': baseHeight = 1.0; break;
              case 'cropland': case 'scrub': baseHeight = 0.8; break;
              case 'temperateGrassland': case 'pastureland': baseHeight = 0.6; break;
              case 'savanna': case 'deserts': baseHeight = 0.4; break;
              default: baseHeight = 1.0; break;
            }
          }
        }
        
        this.originalHeights.set(tileKey, baseHeight);

        let height: number;
        let matrix: THREE.Matrix4;
        
        // Special handling for water tiles - place at sea level
        if (terrainType === 'freshwater') {
          height = 0; // Water at sea level
          matrix = new THREE.Matrix4().makeTranslation(position.x, height, position.y);
          matrix.scale(new THREE.Vector3(1, 0.2, 1)); // Thin water layer
        } else {
          height = baseHeight;

          matrix = new THREE.Matrix4().makeTranslation(position.x, height * 0.5, position.y);
          matrix.scale(new THREE.Vector3(1, height, 1));
        }

        // Debug logging for center tile
        if (i === 0 && j === 0) {
          console.log('Center tile terrain type:', terrainType, 'noise:', noise, 'height:', height.toFixed(2));
        }
        
        // Enhanced height debugging - log more tiles to see height variety
        if (Math.random() < 0.002) { // Log 0.2% of tiles to see height variety across terrain types
          const distanceFromCenter = Math.sqrt(i * i + j * j) / halfSize;
          
          // Also get logical terrain type for comparison
          let logicalType = 'unknown';
          if (this.usePopulationSizing) {
            const adjustedDistance = Math.sqrt(i * i + j * j) / halfSize;
            logicalType = this.getLogicalTerrainType(noise, i, j, adjustedDistance);
          }
          
          console.log(`HEIGHT ANALYSIS [${i},${j}]: visual="${terrainType}", logical="${logicalType}", dist=${distanceFromCenter.toFixed(2)}, height=${height.toFixed(2)}m, baseHeight=${baseHeight.toFixed(2)}m`);
        }

        // Assign to appropriate mesh based on terrain type
        terrainCounts[terrainType]++;
        switch (terrainType) {
          case 'mountains':
            this.mountainsMesh.setMatrixAt(mountainsIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.mountainsMesh, index: mountainsIndex});
            mountainsIndex++;
            break;
          case 'tundra':
            this.tundraMesh.setMatrixAt(tundraIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.tundraMesh, index: tundraIndex});
            tundraIndex++;
            break;
          case 'urban':
            this.urbanMesh.setMatrixAt(urbanIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.urbanMesh, index: urbanIndex});
            urbanIndex++;
            break;
          case 'cropland':
            this.croplandMesh.setMatrixAt(croplandIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.croplandMesh, index: croplandIndex});
            croplandIndex++;
            break;
          case 'scrub':
            this.scrubMesh.setMatrixAt(scrubIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.scrubMesh, index: scrubIndex});
            scrubIndex++;
            break;
          case 'temperateGrassland':
            this.temperateGrasslandMesh.setMatrixAt(temperateGrasslandIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.temperateGrasslandMesh, index: temperateGrasslandIndex});
            temperateGrasslandIndex++;
            break;
          case 'pastureland':
            this.pasturelandMesh.setMatrixAt(pasturelandIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.pasturelandMesh, index: pasturelandIndex});
            pasturelandIndex++;
            break;
          case 'savanna':
            this.savannaMesh.setMatrixAt(savannaIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.savannaMesh, index: savannaIndex});
            savannaIndex++;
            break;
          case 'deserts':
            this.desertsMesh.setMatrixAt(desertsIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.desertsMesh, index: desertsIndex});
            desertsIndex++;
            break;
          case 'borealForest':
            this.borealForestMesh.setMatrixAt(borealForestIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.borealForestMesh, index: borealForestIndex});
            borealForestIndex++;
            break;
          case 'temperateForest':
            this.temperateForestMesh.setMatrixAt(temperateForestIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.temperateForestMesh, index: temperateForestIndex});
            temperateForestIndex++;
            break;
          case 'tropicalRainforest':
            this.tropicalRainforestMesh.setMatrixAt(tropicalRainforestIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.tropicalRainforestMesh, index: tropicalRainforestIndex});
            tropicalRainforestIndex++;
            break;
          case 'saltwater':
            this.saltwaterMesh.setMatrixAt(saltwaterIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.saltwaterMesh, index: saltwaterIndex});
            saltwaterIndex++;
            break;
          case 'freshwater':
            this.freshwaterMesh.setMatrixAt(freshwaterIndex, matrix);
            this.tileToInstanceMap.set(tileKey, {mesh: this.freshwaterMesh, index: freshwaterIndex});
            freshwaterIndex++;
            break;
        }
      }
    }

    // Update all terrain mesh matrices
    this.mountainsMesh.instanceMatrix.needsUpdate = true;
    this.tundraMesh.instanceMatrix.needsUpdate = true;
    this.urbanMesh.instanceMatrix.needsUpdate = true;
    this.borealForestMesh.instanceMatrix.needsUpdate = true;
    this.temperateForestMesh.instanceMatrix.needsUpdate = true;
    this.tropicalRainforestMesh.instanceMatrix.needsUpdate = true;
    this.croplandMesh.instanceMatrix.needsUpdate = true;
    this.scrubMesh.instanceMatrix.needsUpdate = true;
    this.temperateGrasslandMesh.instanceMatrix.needsUpdate = true;
    this.pasturelandMesh.instanceMatrix.needsUpdate = true;
    this.savannaMesh.instanceMatrix.needsUpdate = true;
    this.desertsMesh.instanceMatrix.needsUpdate = true;
    this.saltwaterMesh.instanceMatrix.needsUpdate = true;
    this.freshwaterMesh.instanceMatrix.needsUpdate = true;

    console.log('Terrain distribution:', terrainCounts);
    
    // Log actual biome percentages
    console.log('=== ACTUAL BIOME DISTRIBUTION ===');
    const totalMapTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    Object.entries(this.actualBiomeCounts).forEach(([biome, count]) => {
      const percentage = (count / totalMapTiles * 100);
      const targetPercentage = this.enforceEarthQuotas ? (this.biomeQuotas[biome as TerrainType] / totalMapTiles * 100) : null;
      const targetText = targetPercentage ? `[Target: ${targetPercentage.toFixed(1)}%]` : '';
      console.log(`${biome}: ${count} tiles (${percentage.toFixed(1)}%) ${targetText}`);
    });
    
    if (this.enforceEarthQuotas) {
      const quotasRemaining = Object.entries(this.remainingQuotas).filter(([_, remaining]) => remaining > 0);
      if (quotasRemaining.length > 0) {
        console.log('⚠️ UNFULFILLED QUOTAS:');
        quotasRemaining.forEach(([biome, remaining]) => {
          console.log(`  ${biome}: ${remaining} tiles remaining`);
        });
      } else {
        console.log('✅ All Earth-based quotas fulfilled perfectly!');
      }
    }
    console.log('==================================');
    
    // Debug: Log key map parameters
    console.log(`=== MAP SIZE DEBUG ===`);
    console.log(`Map size: ${this.populationBasedMapSize}x${this.populationBasedMapSize}`);
    console.log(`Map half size: ${this.mapHalfSize}`);
    console.log(`Center coordinates: (${this.populationBasedMapSize/2}, ${this.populationBasedMapSize/2})`);
    console.log(`======================`);
    
    // Display which terrain types are actually present
    this.logPresentTerrainTypes(terrainCounts);
    
    console.log('=== NATURAL ISLAND TERRAIN BREAKDOWN ===');
    
    // Group by visual mesh type for better understanding
    const mountainCount = terrainCounts.mountains;
    const tundraCount = terrainCounts.tundra;
    const urbanCount = terrainCounts.urban;
    const stoneTotal = mountainCount + tundraCount + urbanCount;
    
    const croplandCount = terrainCounts.cropland;
    const scrubCount = terrainCounts.scrub;
    const dirtTotal = croplandCount + scrubCount;
    
    const grasslandCount = terrainCounts.temperateGrassland;
    const pasturelandCount = terrainCounts.pastureland;
    const dirt2Total = grasslandCount + pasturelandCount;
    
    const savannaCount = terrainCounts.savanna;
    const desertsCount = terrainCounts.deserts;
    const sandTotal = savannaCount + desertsCount;
    
    const borealForestCount = terrainCounts.borealForest;
    const temperateForestCount = terrainCounts.temperateForest;
    const tropicalRainforestCount = terrainCounts.tropicalRainforest;
    const grassTotal = borealForestCount + temperateForestCount + tropicalRainforestCount;
    
    const saltwaterCount = terrainCounts.saltwater;
    const freshwaterCount = terrainCounts.freshwater;
    const waterTotal = saltwaterCount + freshwaterCount;
    
    console.log(`Stone mesh (mountains/tundra/urban): ${stoneTotal} tiles (${mountainCount} mountains, ${tundraCount} tundra, ${urbanCount} urban)`);
    console.log(`Dirt mesh (cropland/scrub): ${dirtTotal} tiles (${croplandCount} cropland, ${scrubCount} scrub)`);
    console.log(`Dirt2 mesh (grasslands/pasture): ${dirt2Total} tiles (${grasslandCount} grassland, ${pasturelandCount} pasture)`);
    console.log(`Sand mesh (savanna/deserts): ${sandTotal} tiles (${savannaCount} savanna, ${desertsCount} deserts)`);
    console.log(`Grass mesh (all forests): ${grassTotal} tiles (${borealForestCount} boreal, ${temperateForestCount} temperate, ${tropicalRainforestCount} tropical)`);
    console.log(`Water mesh (saltwater/freshwater): ${waterTotal} tiles (${saltwaterCount} saltwater, ${freshwaterCount} freshwater)`);
    console.log('==========================================');
    
    // Generate visual map representation
    this.generateVisualMap();
    const totalTiles = Object.values(terrainCounts).reduce((sum, count) => sum + count, 0);
    console.log('Total tiles:', totalTiles);
    
    // Log precise tile counting results
    if (this.usePopulationSizing) {
      const actualWaterPercent = (waterTotal / totalTiles * 100).toFixed(2);
      const actualLandPercent = ((totalTiles - waterTotal) / totalTiles * 100).toFixed(2);
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
      console.log(`Water tiles from terrain count: ${waterTotal}`);
      console.log(`Counter vs terrain count match: ${this.oceanTileCount === waterTotal}`);
      console.log('======================================');
    }
    
    // Calculate actual percentages
    this.actualTerrainPercentages = {
      stone: parseFloat((stoneTotal / totalTiles * 100).toFixed(1)),
      dirt: parseFloat((dirtTotal / totalTiles * 100).toFixed(1)),
      dirt2: parseFloat((dirt2Total / totalTiles * 100).toFixed(1)), // Grasslands/Cropland
      sand: parseFloat((sandTotal / totalTiles * 100).toFixed(1)),
      grass: parseFloat((grassTotal / totalTiles * 100).toFixed(1)),
      water: parseFloat((waterTotal / totalTiles * 100).toFixed(1)) // Water (saltwater + freshwater)
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

    this.scene.add(
      this.mountainsMesh, this.tundraMesh, this.urbanMesh,
      this.borealForestMesh, this.temperateForestMesh, this.tropicalRainforestMesh,
      this.croplandMesh, this.scrubMesh, this.temperateGrasslandMesh, this.pasturelandMesh,
      this.savannaMesh, this.desertsMesh, this.saltwaterMesh, this.freshwaterMesh
    );
    console.log('Terrain meshes added to scene');
    console.log('Scene children count:', this.scene.children.length);
    
    console.log('Map update completed successfully');
    this.isUpdating = false;
  }

  reassignTileToMesh(tileX: number, tileZ: number, targetTerrainType: VisualTerrainType): void {
    const tileKey = `${tileX},${tileZ}`;
    const tileInfo = this.tileToInstanceMap.get(tileKey);
    
    if (!tileInfo) return;
    
    const currentMesh = tileInfo.mesh;
    const currentIndex = tileInfo.index;
    
    // Get target mesh for specific terrain type
    let targetMesh: THREE.InstancedMesh;
    switch (targetTerrainType) {
      case 'mountains': targetMesh = this.mountainsMesh; break;
      case 'tundra': targetMesh = this.tundraMesh; break;
      case 'urban': targetMesh = this.urbanMesh; break;
      case 'cropland': targetMesh = this.croplandMesh; break;
      case 'scrub': targetMesh = this.scrubMesh; break;
      case 'temperateGrassland': targetMesh = this.temperateGrasslandMesh; break;
      case 'pastureland': targetMesh = this.pasturelandMesh; break;
      case 'savanna': targetMesh = this.savannaMesh; break;
      case 'deserts': targetMesh = this.desertsMesh; break;
      case 'borealForest': targetMesh = this.borealForestMesh; break;
      case 'temperateForest': targetMesh = this.temperateForestMesh; break;
      case 'tropicalRainforest': targetMesh = this.tropicalRainforestMesh; break;
      case 'saltwater': targetMesh = this.saltwaterMesh; break;
      case 'freshwater': targetMesh = this.freshwaterMesh; break;
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
    
    if (this.usePopulationSizing) {
      // Use land distribution-based terrain assignment with island layout
      terrainType = this.getTerrainTypeFromNoise(noise, tileX, tileZ);
    } else {
      // Use original position-based terrain assignment
      const quarterSize = halfSize / 2;
      const halfQuarterSize = quarterSize / 2;
      
      if (tileX < -quarterSize && tileZ < -quarterSize) {
        terrainType = 'mountains';
      } else if (tileX < 0 && tileZ < 0) {
        terrainType = 'cropland';
      } else if (tileX < quarterSize && tileZ < quarterSize) {
        terrainType = 'temperateForest';
      } else if (tileX < halfSize - halfQuarterSize && tileZ < halfSize - halfQuarterSize) {
        terrainType = 'savanna';
      } else {
        terrainType = 'temperateGrassland';
      }
    }
    
    this.reassignTileToMesh(tileX, tileZ, terrainType);
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

  private tileToPosition(tileX: number, tileY: number): THREE.Vector2 {
    return new THREE.Vector2(tileX * 1, tileY * 1);
  }


  private logPresentTerrainTypes(terrainCounts: Record<VisualTerrainType, number>): void {
    console.log('=== TERRAIN TYPES PRESENT ON CURRENT ISLAND ===');
    
    const presentTerrains = Object.entries(terrainCounts)
      .filter(([_, count]) => count > 0)
      .sort(([_, countA], [__, countB]) => countB - countA);
    
    console.log(`Total terrain types present: ${presentTerrains.length} out of 14 possible`);
    console.log('Present terrain types (sorted by frequency):');
    
    presentTerrains.forEach(([terrainType, count]) => {
      const percentage = ((count / Object.values(terrainCounts).reduce((a, b) => a + b, 0)) * 100).toFixed(1);
      console.log(`  • ${terrainType}: ${count} tiles (${percentage}%)`);
    });

    const missingTerrains = Object.keys(terrainCounts)
      .filter(terrainType => terrainCounts[terrainType as VisualTerrainType] === 0);
    
    if (missingTerrains.length > 0) {
      console.log('\nMissing terrain types:');
      missingTerrains.forEach(terrainType => {
        console.log(`  ✗ ${terrainType}: 0 tiles`);
      });
    } else {
      console.log('\n✅ All 14 terrain types are present on this island!');
    }
    console.log('==========================================');
  }
}