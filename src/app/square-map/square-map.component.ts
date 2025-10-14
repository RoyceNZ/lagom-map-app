import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  | 'saltwater'
  | 'freshwater'
  | 'mountains'
  | 'tundra'
  | 'urban'
  | 'borealForest'
  | 'temperateForest'
  | 'tropicalRainforest'
  | 'cropland'
  | 'scrub'
  | 'temperateGrassland'
  | 'pastureland'
  | 'savanna'
  | 'deserts';

// Map logical terrain types to visual terrain types (1:1 mapping)
const TERRAIN_VISUAL_MAPPING: Record<TerrainType, VisualTerrainType> = {
  saltwater: 'saltwater',
  freshwater: 'freshwater',
  borealForest: 'borealForest',
  temperateForest: 'temperateForest',
  tropicalRainforest: 'tropicalRainforest',
  temperateGrassland: 'temperateGrassland',
  savanna: 'savanna',
  tundra: 'tundra',
  deserts: 'deserts',
  mountains: 'mountains',
  pastureland: 'pastureland',
  cropland: 'cropland',
  scrub: 'scrub',
  urban: 'urban'
};

@Component({
  selector: 'app-square-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './square-map.component.html',
  styleUrls: ['./square-map.component.css']
})
export class SquareMapComponent implements AfterViewInit {
  @ViewChild('rendererContainer', { static: true }) rendererContainer!: ElementRef;

  // Core rendering objects
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  light!: THREE.DirectionalLight;

  // Instanced meshes (one per visual terrain type)
  mountainsMesh!: THREE.InstancedMesh;
  tundraMesh!: THREE.InstancedMesh;
  urbanMesh!: THREE.InstancedMesh;
  borealForestMesh!: THREE.InstancedMesh;
  temperateForestMesh!: THREE.InstancedMesh;
  tropicalRainforestMesh!: THREE.InstancedMesh;
  croplandMesh!: THREE.InstancedMesh;
  scrubMesh!: THREE.InstancedMesh;
  temperateGrasslandMesh!: THREE.InstancedMesh;
  pasturelandMesh!: THREE.InstancedMesh;
  savannaMesh!: THREE.InstancedMesh;
  desertsMesh!: THREE.InstancedMesh;
  saltwaterMesh!: THREE.InstancedMesh;
  freshwaterMesh!: THREE.InstancedMesh;

  // State and configuration
  isUpdating = false;
  updateTimeout: any = null;
  enforceEarthQuotas = true;
  usePopulationSizing = true;
  selectedYear = new Date().getFullYear();
  terrainSeed = Math.random() * 10000;

  // Quotas and counts
  remainingQuotas: Record<TerrainType, number> = {} as any;
  biomeQuotas: Record<TerrainType, number> = {} as any;
  actualBiomeCounts: Record<TerrainType, number> = {} as any;

  // Tile bookkeeping
  tileToInstanceMap = new Map<string, {mesh: THREE.InstancedMesh, index: number}>();
  originalHeights = new Map<string, number>();
  // Last generated deterministic map assignments (keyed `x,z`) used for read-only sampling
  lastMapAssignments: Map<string, TerrainType> | null = null;

  actualTerrainPercentages: any = {};
  expectedTerrainPercentages: any = {};

  // Check if a biome can be placed given Earth quota enforcement
  private canPlaceBiome(biome: TerrainType): boolean {
    return (this.remainingQuotas[biome] || 0) > 0;
  }

  // Get actual biome percentage on current map (used by template)
  getActualBiomePercentage(biome: TerrainType): number {
    const total = this.populationBasedMapSize * this.populationBasedMapSize;
    if (!total || !this.actualBiomeCounts) return 0;
    return ((this.actualBiomeCounts[biome] || 0) / total) * 100;
  }

  getActualBiomeCount(biome: TerrainType): number {
    return this.actualBiomeCounts[biome] || 0;
  }

  getTargetBiomePercentage(biome: TerrainType): number {
    const total = this.populationBasedMapSize * this.populationBasedMapSize;
    return ((this.biomeQuotas[biome] || 0) / total) * 100;
  }

  getQuotaStatus(biome: TerrainType): string {
    const actual = this.getActualBiomePercentage(biome);
    const target = this.getTargetBiomePercentage(biome);
    const diff = Math.abs(actual - target);
    if (diff < 0.1) return '✅';
    if (diff < 0.5) return '🟡';
    return '🔴';
  }

  // Calculate Earth-based biome quotas for current map size
  private calculateBiomeQuotas(): void {
    const totalTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    const breakdown = this.landBreakdownPerPerson;
    const totalArea = this.totalAreaPerPerson;

    // Calculate exact tile quotas based on Earth percentages
    Object.keys(breakdown).forEach(biome => {
      const areaPercentage = breakdown[biome];
      this.biomeQuotas[biome as TerrainType] = Math.round(totalTiles * (areaPercentage / totalArea));
    });

    // Ensure quotas sum equals totalTiles: let saltwater absorb residual rounding differences
    const sumQuotas = Object.values(this.biomeQuotas).reduce((s, v) => s + (v || 0), 0);
    const delta = totalTiles - sumQuotas;
    if (!this.biomeQuotas['saltwater']) this.biomeQuotas['saltwater'] = 0;
    this.biomeQuotas['saltwater'] += delta;

    // Initialize remaining quotas as a shallow copy (will be reconciled after placement)
    this.remainingQuotas = Object.assign({}, this.biomeQuotas) as Record<TerrainType, number>;

    console.log('=== EARTH-BASED BIOME QUOTAS ===');
    Object.entries(this.biomeQuotas).forEach(([k, v]) => {
      const pct = (v / totalTiles) * 100;
      console.log(`${k}: ${v} tiles (${pct.toFixed(1)}%)`);
    });
    console.log('================================');
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

  // Generate seeded random number for consistent terrain patterns
  private seededRandom(x: number, z: number, offset: number = 0): number {
    const seed = this.terrainSeed + offset;
    const value = Math.sin((x + seed) * 12.9898 + (z + seed) * 78.233) * 43758.5453;
    return Math.abs(value) % 1;
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
  console.log('Per-biome deltas (shown in update logs): target=<tiles>, actual=<tiles> -> delta=<signed tiles> (<signed percentage points> pp)');
    console.log('');
    
    // Sample the map in a grid pattern
    for (let z = halfSize; z >= -halfSize; z -= step) {
      let row = '';
      for (let x = -halfSize; x <= halfSize; x += step) {
        // Get the terrain type for this position using lastMapAssignments (read-only)
        const key = `${x},${z}`;
        let terrainType: VisualTerrainType;
        if (this.lastMapAssignments && this.lastMapAssignments.has(key)) {
          terrainType = TERRAIN_VISUAL_MAPPING[this.lastMapAssignments.get(key)!];
        } else {
          // Fallback: non-mutating sampling via a pure lookup function (use seeded logic but avoid counters)
          const noise = Math.random();
          terrainType = this.getTerrainTypeFromNoise(noise, x, z);
        }
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
    // Reduce texture edge bleeding for water textures and allow repeating
    try {
      textures.saltwater.wrapS = textures.saltwater.wrapT = THREE.RepeatWrapping;
      textures.saltwater.magFilter = THREE.NearestFilter;
      textures.saltwater.minFilter = THREE.LinearMipMapLinearFilter;

      textures.freshwater.wrapS = textures.freshwater.wrapT = THREE.RepeatWrapping;
      textures.freshwater.magFilter = THREE.NearestFilter;
      textures.freshwater.minFilter = THREE.LinearMipMapLinearFilter;
    } catch (e) {
      // If textures not fully loaded yet, ignore - loader will update filters when ready
      console.warn('Failed to set water texture filters/repeat; continuing', e);
    }
    
    // Remove noise generation since we're using flat terrain
    const mapSize = this.populationBasedMapSize;
    const halfSize = this.mapHalfSize;
    const squareCount = mapSize * mapSize;
    console.log('Map dimensions:', mapSize, 'x', mapSize, '=', squareCount, 'squares');
    console.log('Half size:', halfSize);
    
  // Initialize precise ocean tile counting
  // Prepare deterministic map assignments container (filled below)
  let mapAssignments: Map<string, TerrainType> = new Map();
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
        // Instead of a radius-based natural island generator, generate a deterministic
        // arrangement of square groups that exactly matches the requested tile counts
        // from `biomeTileCounts`. This places compact square blocks for each biome
        // (largest first) into the map grid.
        // The generated assignment map is stored in `mapAssignments` and used below
        // to assign terrain types per tile.
        // NOTE: this replaces the natural island pre-calculation approach.
        // Keep `naturalIslandMap` undefined to avoid mixing approaches.
        // this.naturalIslandMap = new Map<string, boolean>();
        // this.calculateNaturalIslandShape(halfSize);
      
        // Calculate quotas (convert area breakdown into tile quotas) before placement
        this.calculateBiomeQuotas();

        // Generate deterministic per-tile assignments (guarantees exact counts)
        mapAssignments = this.generateSquareGroupsMap();
        // Optionally cluster those assignments into square blocks for a cleaner visual
        try {
          const clustered = this.clusterMapFromCounts(this.biomeQuotas);
          if (clustered && clustered.size === mapSize * mapSize) {
            mapAssignments = clustered;
            console.log('Clustering into square blocks applied (post-pass)');
          }
        } catch (e) {
          console.warn('Clustering post-pass failed, using per-tile assignment', e);
        }
        // Store for read-only sampling in generateVisualMap to avoid mutating counters
        this.lastMapAssignments = mapAssignments;
    }
  const squareGeometry = new THREE.BoxGeometry(1, 1, 1);
  // Use a flat plane for water (lies on XZ plane). We'll rotate the plane once and reuse it.
  const unitWaterPlane = new THREE.PlaneGeometry(1, 1);
  unitWaterPlane.rotateX(-Math.PI / 2);
    
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
    
    this.saltwaterMesh = new THREE.InstancedMesh(unitWaterPlane, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: false, roughness: 0.0, metalness: 0.0, 
      map: textures.saltwater, transparent: true, opacity: 0.92, color: 0x20a0ff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 1,
      alphaTest: 0.01
    }), squareCount);
    
    this.freshwaterMesh = new THREE.InstancedMesh(unitWaterPlane, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: false, roughness: 0.1, metalness: 0.1, 
      map: textures.freshwater, transparent: true, opacity: 0.95, color: 0x4080ff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 1,
      alphaTest: 0.01
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

  // Earth-based biome quotas were calculated earlier prior to placement/clustering

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

  // Merge adjacent identical tiles into larger rectangles to avoid visible seams
  // Build a type grid and visited grid
    const gridTypes: VisualTerrainType[][] = [];
    const visited: boolean[][] = [];
    // Collect water geometries to merge later (reduces seams)
    const saltwaterGeometries: THREE.BufferGeometry[] = [];
    const freshwaterGeometries: THREE.BufferGeometry[] = [];
    const saltwaterTileGroups: string[][] = [];
    const freshwaterTileGroups: string[][] = [];
    for (let gz = 0; gz < mapSize; gz++) {
      gridTypes[gz] = new Array(mapSize);
      visited[gz] = new Array(mapSize).fill(false);
    }

    // Fill gridTypes from mapAssignments (mapAssignments keys are "x,z" with center coords)
    for (let gz = 0; gz < mapSize; gz++) {
      for (let gx = 0; gx < mapSize; gx++) {
        const x = gx - halfSize;
        const z = gz - halfSize;
        const key = `${x},${z}`;
        const logical = (mapAssignments.get(key) || 'saltwater') as TerrainType;
        gridTypes[gz][gx] = TERRAIN_VISUAL_MAPPING[logical];
      }
    }

    const gridToCoord = (gx: number, gz: number) => ({ x: gx - halfSize, z: gz - halfSize });

    for (let gz = 0; gz < mapSize; gz++) {
      for (let gx = 0; gx < mapSize; gx++) {
        if (visited[gz][gx]) continue;
        const terrainType = gridTypes[gz][gx];
        // Find maximal width
        let width = 1;
        while (gx + width < mapSize && !visited[gz][gx + width] && gridTypes[gz][gx + width] === terrainType) width++;
        // Find maximal height for this width
        let height = 1;
        outer: while (gz + height < mapSize) {
          for (let wx = 0; wx < width; wx++) {
            if (visited[gz + height][gx + wx] || gridTypes[gz + height][gx + wx] !== terrainType) break outer;
          }
          height++;
        }

        // Mark visited
        for (let yy = 0; yy < height; yy++) {
          for (let xx = 0; xx < width; xx++) {
            visited[gz + yy][gx + xx] = true;
          }
        }

        // Compute world position for the rectangle center
        const centerGX = gx + (width - 1) / 2;
        const centerGZ = gz + (height - 1) / 2;
        const coord = gridToCoord(centerGX, centerGZ);
        const position = new THREE.Vector2(coord.x, coord.z);

        // Determine base height
        let baseHeight = 0.1;
        if (terrainType !== 'saltwater' && terrainType !== 'freshwater') {
          switch (terrainType) {
            case 'mountains': baseHeight = 8.0; break;
            case 'tundra': baseHeight = 6.5; break;
            case 'urban': baseHeight = 5.5; break;
            case 'borealForest': baseHeight = 4.5; break;
            case 'temperateForest': baseHeight = 3.5; break;
            case 'tropicalRainforest': baseHeight = 3.0; break;
            case 'temperateGrassland': baseHeight = 2.5; break;
            case 'pastureland': baseHeight = 2.0; break;
            case 'cropland': baseHeight = 1.8; break;
            case 'savanna': baseHeight = 1.5; break;
            case 'scrub': baseHeight = 1.0; break;
            case 'deserts': baseHeight = 0.8; break;
            default: baseHeight = 2.5; break;
          }
        }

        // Create matrix for the rectangle using compose(position, quaternion, scale)
        // Compose ensures scale does not affect translation (no translated scaling)
        const posY = (terrainType === 'freshwater' || terrainType === 'saltwater') ? 0 : baseHeight * 0.5;
        const scaleY = (terrainType === 'freshwater' || terrainType === 'saltwater') ? 0.2 : baseHeight;
        const matrix = new THREE.Matrix4();
        const positionVec = new THREE.Vector3(position.x, posY, position.y);
        const scaleVec = new THREE.Vector3(width, scaleY, height);
        const quat = new THREE.Quaternion();
        matrix.compose(positionVec, quat, scaleVec);

        // Assign to appropriate mesh based on terrain type and set mapping for every tile in rect
        const tileKeys: string[] = [];
        for (let yy = 0; yy < height; yy++) {
          for (let xx = 0; xx < width; xx++) {
            const gxIdx = gx + xx;
            const gzIdx = gz + yy;
            const worldX = gxIdx - halfSize;
            const worldZ = gzIdx - halfSize;
            tileKeys.push(`${worldX},${worldZ}`);
          }
        }

        // Update counts for this rectangle (visual + logical)
        try {
          // visual counts
          terrainCounts[terrainType] = (terrainCounts[terrainType] || 0) + tileKeys.length;

          // logical counts (map visual back to logical)
          const logical = this.getLogicalTerrainFromVisual(terrainType, position.x, position.y);
          // Update local counters only (authoritative assignment happens after merging)
          logicalTerrainCounts[logical] = (logicalTerrainCounts[logical] || 0) + tileKeys.length;
        } catch (e) {
          // ignore counting errors
        }

        switch (terrainType) {
          case 'mountains':
            this.mountainsMesh.setMatrixAt(mountainsIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.mountainsMesh, index: mountainsIndex}));
            mountainsIndex++;
            break;
          case 'tundra':
            this.tundraMesh.setMatrixAt(tundraIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.tundraMesh, index: tundraIndex}));
            tundraIndex++;
            break;
          case 'urban':
            this.urbanMesh.setMatrixAt(urbanIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.urbanMesh, index: urbanIndex}));
            urbanIndex++;
            break;
          case 'cropland':
            this.croplandMesh.setMatrixAt(croplandIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.croplandMesh, index: croplandIndex}));
            croplandIndex++;
            break;
          case 'scrub':
            this.scrubMesh.setMatrixAt(scrubIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.scrubMesh, index: scrubIndex}));
            scrubIndex++;
            break;
          case 'temperateGrassland':
            this.temperateGrasslandMesh.setMatrixAt(temperateGrasslandIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.temperateGrasslandMesh, index: temperateGrasslandIndex}));
            temperateGrasslandIndex++;
            break;
          case 'pastureland':
            this.pasturelandMesh.setMatrixAt(pasturelandIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.pasturelandMesh, index: pasturelandIndex}));
            pasturelandIndex++;
            break;
          case 'savanna':
            this.savannaMesh.setMatrixAt(savannaIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.savannaMesh, index: savannaIndex}));
            savannaIndex++;
            break;
          case 'deserts':
            this.desertsMesh.setMatrixAt(desertsIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.desertsMesh, index: desertsIndex}));
            desertsIndex++;
            break;
          case 'borealForest':
            this.borealForestMesh.setMatrixAt(borealForestIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.borealForestMesh, index: borealForestIndex}));
            borealForestIndex++;
            break;
          case 'temperateForest':
            this.temperateForestMesh.setMatrixAt(temperateForestIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.temperateForestMesh, index: temperateForestIndex}));
            temperateForestIndex++;
            break;
          case 'tropicalRainforest':
            this.tropicalRainforestMesh.setMatrixAt(tropicalRainforestIndex, matrix);
            tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.tropicalRainforestMesh, index: tropicalRainforestIndex}));
            tropicalRainforestIndex++;
            break;
            case 'saltwater':
              // Create a flat plane geometry for water rectangles (no vertical faces to show seams)
              try {
                const plane = new THREE.PlaneGeometry(1, 1);
                plane.rotateX(-Math.PI / 2);
                // Apply the same composed matrix (position + scale) to the plane geometry
                // We need a separate matrix without Y-scale for the plane thickness
                const waterMatrix = new THREE.Matrix4();
                // plane scale should be width x 1 x height
                const planeScale = new THREE.Vector3(width, 1, height);
                waterMatrix.compose(positionVec, quat, planeScale);
                plane.applyMatrix4(waterMatrix);
                saltwaterGeometries.push(plane);
                saltwaterTileGroups.push(tileKeys.slice());
              } catch (e) {
                // Fallback: set an instance on the instanced plane mesh
                this.saltwaterMesh.setMatrixAt(saltwaterIndex, matrix);
                tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.saltwaterMesh, index: saltwaterIndex}));
                saltwaterIndex++;
              }
            break;
          case 'freshwater':
            try {
              const plane = new THREE.PlaneGeometry(1, 1);
              plane.rotateX(-Math.PI / 2);
              const waterMatrix = new THREE.Matrix4();
              const planeScale = new THREE.Vector3(width, 1, height);
              waterMatrix.compose(positionVec, quat, planeScale);
              plane.applyMatrix4(waterMatrix);
              freshwaterGeometries.push(plane);
              freshwaterTileGroups.push(tileKeys.slice());
            } catch (e) {
              this.freshwaterMesh.setMatrixAt(freshwaterIndex, matrix);
              tileKeys.forEach(k => this.tileToInstanceMap.set(k, {mesh: this.freshwaterMesh, index: freshwaterIndex}));
              freshwaterIndex++;
            }
            break;
        }
      }
    }

  // Only render the number of instances we actually set matrices for.
  // InstancedMesh was created with capacity = squareCount; if we don't set
  // .count then the renderer may draw all allocated instances (many of which
  // are still at identity and appear at the origin). Setting .count prevents
  // that and removes the single center artifact and related performance issues.
  this.mountainsMesh.count = mountainsIndex;
  this.tundraMesh.count = tundraIndex;
  this.urbanMesh.count = urbanIndex;
  this.borealForestMesh.count = borealForestIndex;
  this.temperateForestMesh.count = temperateForestIndex;
  this.tropicalRainforestMesh.count = tropicalRainforestIndex;
  this.croplandMesh.count = croplandIndex;
  this.scrubMesh.count = scrubIndex;
  this.temperateGrasslandMesh.count = temperateGrasslandIndex;
  this.pasturelandMesh.count = pasturelandIndex;
  this.savannaMesh.count = savannaIndex;
  this.desertsMesh.count = desertsIndex;
  this.saltwaterMesh.count = saltwaterIndex;
  this.freshwaterMesh.count = freshwaterIndex;

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

  // Merge collected water geometries into single meshes to eliminate seams
  // Saltwater merging (robust)
  if (saltwaterGeometries.length > 0) {
    console.log('Attempting to merge', saltwaterGeometries.length, 'saltwater rectangles');
    let mergedSalt: THREE.BufferGeometry | null = null;
    try {
      if (typeof (BufferGeometryUtils as any).mergeBufferGeometries === 'function') {
        mergedSalt = (BufferGeometryUtils as any).mergeBufferGeometries(saltwaterGeometries, false) as THREE.BufferGeometry;
      } else if (typeof (BufferGeometryUtils as any).mergeGeometries === 'function') {
        mergedSalt = (BufferGeometryUtils as any).mergeGeometries(saltwaterGeometries) as THREE.BufferGeometry;
      } else {
        throw new Error('No merge function available on BufferGeometryUtils');
      }
    } catch (e) {
      console.warn('Saltwater merge failed, will fall back to adding individual water meshes', e);
    }

    if (mergedSalt) {
  const saltMat = (this.saltwaterMesh.material as THREE.Material).clone() as THREE.MeshPhysicalMaterial;
  saltMat.transparent = true;
  saltMat.opacity = (saltMat as any).opacity ?? 0.85;
  // For merged, single geometry write depth to avoid sorting issues
  saltMat.depthWrite = true;
  saltMat.depthTest = true;
  saltMat.polygonOffset = true;
  saltMat.polygonOffsetFactor = -1;
  saltMat.polygonOffsetUnits = 1;
  saltMat.alphaTest = 0.01;
  saltMat.side = THREE.DoubleSide;
  const mergedSaltMesh = new THREE.Mesh(mergedSalt, saltMat);
      mergedSaltMesh.receiveShadow = true;
      mergedSaltMesh.castShadow = false;
      mergedSaltMesh.renderOrder = 100;
      mergedSaltMesh.name = 'mergedSaltwater';
      this.scene.add(mergedSaltMesh);
      try { this.saltwaterMesh.visible = false; } catch (e) {}
      saltwaterTileGroups.forEach(group => group.forEach(k => this.tileToInstanceMap.set(k, {mesh: mergedSaltMesh as any, index: 0})));
    } else {
      // Fallback: add each saltwater geometry as its own mesh so water remains visible
  const saltMat = (this.saltwaterMesh.material as THREE.Material).clone() as THREE.MeshPhysicalMaterial;
  saltMat.transparent = true; saltMat.opacity = (saltMat as any).opacity ?? 0.85; saltMat.depthWrite = true; saltMat.depthTest = true;
  saltMat.polygonOffset = true; saltMat.polygonOffsetFactor = -1; saltMat.polygonOffsetUnits = 1; saltMat.alphaTest = 0.01; saltMat.side = THREE.DoubleSide;
      for (let i = 0; i < saltwaterGeometries.length; i++) {
        const geom = saltwaterGeometries[i];
        const mesh = new THREE.Mesh(geom, saltMat);
        mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 100;
        this.scene.add(mesh);
        saltwaterTileGroups[i].forEach(k => this.tileToInstanceMap.set(k, {mesh: mesh as any, index: 0}));
      }
      try { this.saltwaterMesh.visible = false; } catch (e) {}
    }
  }

  // Freshwater merging (robust)
  if (freshwaterGeometries.length > 0) {
    console.log('Attempting to merge', freshwaterGeometries.length, 'freshwater rectangles');
    let mergedFresh: THREE.BufferGeometry | null = null;
    try {
      if (typeof (BufferGeometryUtils as any).mergeBufferGeometries === 'function') {
        mergedFresh = (BufferGeometryUtils as any).mergeBufferGeometries(freshwaterGeometries, false) as THREE.BufferGeometry;
      } else if (typeof (BufferGeometryUtils as any).mergeGeometries === 'function') {
        mergedFresh = (BufferGeometryUtils as any).mergeGeometries(freshwaterGeometries) as THREE.BufferGeometry;
      } else {
        throw new Error('No merge function available on BufferGeometryUtils');
      }
    } catch (e) {
      console.warn('Freshwater merge failed, will fall back to adding individual water meshes', e);
    }

    if (mergedFresh) {
  const freshMat = (this.freshwaterMesh.material as THREE.Material).clone() as THREE.MeshPhysicalMaterial;
  freshMat.transparent = true;
  freshMat.opacity = (freshMat as any).opacity ?? 0.9;
  freshMat.depthWrite = true;
  freshMat.depthTest = true;
  freshMat.polygonOffset = true;
  freshMat.polygonOffsetFactor = -1;
  freshMat.polygonOffsetUnits = 1;
  freshMat.alphaTest = 0.01;
  freshMat.side = THREE.DoubleSide;
  const mergedFreshMesh = new THREE.Mesh(mergedFresh, freshMat);
      mergedFreshMesh.receiveShadow = true;
      mergedFreshMesh.castShadow = false;
      mergedFreshMesh.renderOrder = 100;
      mergedFreshMesh.name = 'mergedFreshwater';
      this.scene.add(mergedFreshMesh);
      try { this.freshwaterMesh.visible = false; } catch (e) {}
      freshwaterTileGroups.forEach(group => group.forEach(k => this.tileToInstanceMap.set(k, {mesh: mergedFreshMesh as any, index: 0})));
    } else {
  const freshMat = (this.freshwaterMesh.material as THREE.Material).clone() as THREE.MeshPhysicalMaterial;
  freshMat.transparent = true; freshMat.opacity = (freshMat as any).opacity ?? 0.9; freshMat.depthWrite = true; freshMat.depthTest = true;
  freshMat.polygonOffset = true; freshMat.polygonOffsetFactor = -1; freshMat.polygonOffsetUnits = 1; freshMat.alphaTest = 0.01; freshMat.side = THREE.DoubleSide;
      for (let i = 0; i < freshwaterGeometries.length; i++) {
        const geom = freshwaterGeometries[i];
        const mesh = new THREE.Mesh(geom, freshMat);
        mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 100;
        this.scene.add(mesh);
        freshwaterTileGroups[i].forEach(k => this.tileToInstanceMap.set(k, {mesh: mesh as any, index: 0}));
      }
      try { this.freshwaterMesh.visible = false; } catch (e) {}
    }
  }

    // Reconcile ocean/land counters with the rectangle-derived terrainCounts to avoid drift
    const computedSaltwater = terrainCounts.saltwater || 0;
    const computedFreshwater = terrainCounts.freshwater || 0;
    const computedWaterTotal = computedSaltwater + computedFreshwater;
    const prevOcean = this.oceanTileCount;
    if (prevOcean !== 0 && prevOcean !== computedSaltwater) {
      console.warn('oceanTileCount mismatch detected. previous=', prevOcean, 'computed=', computedSaltwater, '-> correcting to computed value');
    }
    // Make authoritative counts come from the terrainCounts (rectangles)
    this.oceanTileCount = computedSaltwater;
    // squareCount is total tiles on map
    this.landTileCount = squareCount - computedWaterTotal;

    console.log('Terrain distribution:', terrainCounts);

    // Ensure actualBiomeCounts aligns with the logicalTerrainCounts produced earlier
    // logicalTerrainCounts keys are TerrainType, which matches actualBiomeCounts layout
    Object.keys(this.actualBiomeCounts).forEach(k => this.actualBiomeCounts[k as TerrainType] = logicalTerrainCounts[k as TerrainType] || 0);

    // Reconcile remaining quotas to reflect the authoritative placements we just created.
    // This prevents the UI/logs from showing all quotas as "unfulfilled" when the generator
    // used its own internal counters during placement.
    Object.keys(this.remainingQuotas).forEach(k => {
      const target = this.biomeQuotas[k as TerrainType] || 0;
      const placed = this.actualBiomeCounts[k as TerrainType] || 0;
      this.remainingQuotas[k as TerrainType] = Math.max(0, target - placed);
    });
    // Debug summary for quotas vs placements
    try {
      const totalQuotaSum = Object.values(this.biomeQuotas).reduce((s, v) => s + (v || 0), 0);
      const totalPlacedSum = Object.values(this.actualBiomeCounts).reduce((s, v) => s + (v || 0), 0);
      const totalRemainingSum = Object.values(this.remainingQuotas).reduce((s, v) => s + (v || 0), 0);
      console.log('=== QUOTAS SUMMARY ===');
      console.log('Total quota sum:', totalQuotaSum, 'Total placed:', totalPlacedSum, 'Total remaining:', totalRemainingSum);
      Object.entries(this.biomeQuotas).forEach(([b, q]) => {
        const placed = this.actualBiomeCounts[b as TerrainType] || 0;
        const rem = this.remainingQuotas[b as TerrainType] || 0;
        console.log(`  ${b}: target=${q}, placed=${placed}, remaining=${rem}`);
      });
      console.log('======================');
    } catch (e) {}
    
    // Log actual biome percentages
    console.log('=== ACTUAL BIOME DISTRIBUTION ===');
    const totalMapTiles = this.populationBasedMapSize * this.populationBasedMapSize;
    Object.entries(this.actualBiomeCounts).forEach(([biome, count]) => {
      const percentage = (count / totalMapTiles * 100);
      const targetPercentage = this.enforceEarthQuotas ? (this.biomeQuotas[biome as TerrainType] / totalMapTiles * 100) : null;
      const targetText = targetPercentage ? `[Target: ${targetPercentage.toFixed(1)}%]` : '';
      console.log(`${biome}: ${count} tiles (${percentage.toFixed(1)}%) ${targetText}`);
    });

    // Show per-biome delta between actual tiles created and the target quotas (always printed)
    console.log('=== PER-BIOME DELTA VS TARGET (tiles | percentage points) ===');
    Object.entries(this.actualBiomeCounts).forEach(([biome, count]) => {
      const targetCount = this.biomeQuotas[biome as TerrainType] || 0;
      const deltaTiles = (count || 0) - targetCount;
      // percentage point difference relative to entire map
      const deltaPctPoints = (deltaTiles / totalMapTiles) * 100;
      const sign = deltaTiles >= 0 ? '+' : '-';
      console.log(`${biome}: target=${targetCount}, actual=${count} -> delta=${sign}${Math.abs(deltaTiles)} tiles (${sign}${Math.abs(deltaPctPoints).toFixed(2)} pp)`);
    });
    console.log('========================================================');
    
    // Report any unfulfilled quotas (if any)
    const quotasRemaining = Object.entries(this.remainingQuotas).filter(([_, remaining]) => remaining > 0);
    if (quotasRemaining.length > 0) {
      console.log('⚠️ UNFULFILLED QUOTAS:');
      quotasRemaining.forEach(([biome, remaining]) => {
        console.log(`  ${biome}: ${remaining} tiles remaining`);
      });
    } else {
      console.log('✅ All Earth-based quotas fulfilled perfectly!');
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
  const saltCounter = this.oceanTileCount;
  const freshCounter = this.actualBiomeCounts['freshwater'] || 0;
  const counterWaterTotal = saltCounter + freshCounter;
  console.log(`Saltwater tiles from counter: ${saltCounter}`);
  console.log(`Freshwater tiles from counter: ${freshCounter}`);
  console.log(`Water tiles from terrain count: ${waterTotal}`);
  console.log(`Counter vs terrain count match: ${counterWaterTotal === waterTotal}`);
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
    
  // Calculate expected percentages from the authoritative biome quotas (final tile counts)
    // Ensure biomeQuotas exists and has numeric values
    const bz = this.biomeQuotas || {} as Record<string, number>;
    this.expectedTerrainPercentages = {
      stone: parseFloat((((bz['mountains'] || 0) + (bz['tundra'] || 0) + (bz['urban'] || 0)) / totalMapTiles * 100).toFixed(1)),
      dirt: parseFloat((((bz['cropland'] || 0) + (bz['scrub'] || 0)) / totalMapTiles * 100).toFixed(1)),
      dirt2: parseFloat(((bz['saltwater'] || 0) / totalMapTiles * 100).toFixed(1)), // Ocean water only
      sand: parseFloat((((bz['deserts'] || 0) + (bz['savanna'] || 0)) / totalMapTiles * 100).toFixed(1)),
      grass: parseFloat((((bz['borealForest'] || 0) + (bz['temperateForest'] || 0) + (bz['tropicalRainforest'] || 0) + (bz['temperateGrassland'] || 0) + (bz['savanna'] || 0) + (bz['pastureland'] || 0)) / totalMapTiles * 100).toFixed(1)),
      water: parseFloat(((bz['freshwater'] || 0) / totalMapTiles * 100).toFixed(1)) // Freshwater only
    };

    // Compute explicit actual/expected values for saltwater and freshwater to avoid mis-labeling
    const actualSaltwaterPercent = parseFloat(((saltwaterCount / totalTiles) * 100).toFixed(1));
    const actualFreshwaterPercent = parseFloat(((freshwaterCount / totalTiles) * 100).toFixed(1));
    const expectedSaltwaterPercent = parseFloat(((bz['saltwater'] || 0) / totalMapTiles * 100).toFixed(1));
    const expectedFreshwaterPercent = parseFloat(((bz['freshwater'] || 0) / totalMapTiles * 100).toFixed(1));

  console.log('=== TERRAIN PERCENTAGE COMPARISON ===');
  console.log('Terrain Type | Actual % | Expected % | Difference');
  console.log('Stone (Mountains/Urban):', this.actualTerrainPercentages.stone + '%', '|', this.expectedTerrainPercentages.stone + '%', '|', (this.actualTerrainPercentages.stone - this.expectedTerrainPercentages.stone).toFixed(1) + '%');
  console.log('Dirt (Cropland/Scrub):', this.actualTerrainPercentages.dirt + '%', '|', this.expectedTerrainPercentages.dirt + '%', '|', (this.actualTerrainPercentages.dirt - this.expectedTerrainPercentages.dirt).toFixed(1) + '%');
  console.log('Ocean Water (Saltwater):', actualSaltwaterPercent + '%', '|', expectedSaltwaterPercent + '%', '|', (actualSaltwaterPercent - expectedSaltwaterPercent).toFixed(1) + '%');
  console.log('Fresh Water (Lakes/Rivers):', actualFreshwaterPercent + '%', '|', expectedFreshwaterPercent + '%', '|', (actualFreshwaterPercent - expectedFreshwaterPercent).toFixed(1) + '%');
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
    
  const currentMesh: any = tileInfo.mesh;
  const currentIndex: number = tileInfo.index;
    
    // Get target mesh for specific terrain type
  let targetMesh: any;
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

    // If current mesh is an InstancedMesh, we can move its matrix to the target instanced mesh.
    const isCurrentInstanced = currentMesh && typeof currentMesh.getMatrixAt === 'function';
    const isTargetInstanced = targetMesh && typeof targetMesh.setMatrixAt === 'function';

    if (isCurrentInstanced && isTargetInstanced) {
      const matrix = new THREE.Matrix4();
      currentMesh.getMatrixAt(currentIndex, matrix);

      // Find next available index on target mesh
      let targetIndex = 0;
      const existingIndices = Array.from(this.tileToInstanceMap.values())
        .filter((info: any) => info.mesh === targetMesh)
        .map((info: any) => info.index);
      if (existingIndices.length > 0) targetIndex = Math.max(...existingIndices) + 1;

      targetMesh.setMatrixAt(targetIndex, matrix);
      targetMesh.instanceMatrix.needsUpdate = true;

      // Update mapping
      this.tileToInstanceMap.set(tileKey, {mesh: targetMesh, index: targetIndex});

      // Hide the old instance by scaling to zero
      const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
      currentMesh.setMatrixAt(currentIndex, hiddenMatrix);
      currentMesh.instanceMatrix.needsUpdate = true;
      return;
    }

    // If either current or target is a regular Mesh (merged water geometry),
    // we cannot reassign a single tile's matrix easily. Update the mapping so
    // UI and lookups reflect the change, but leave the geometry as-is.
    if (!isTargetInstanced) {
      // Map tile to target non-instanced mesh (index 0 placeholder)
      this.tileToInstanceMap.set(tileKey, {mesh: targetMesh, index: 0});
      console.warn('Reassigned tile to a merged (non-instanced) mesh; geometry remains unchanged for that tile.');
      return;
    }

    // Fallback: if current is non-instanced but target is instanced, copy world transform
    if (!isCurrentInstanced && isTargetInstanced) {
      const worldMatrix = currentMesh.matrixWorld || new THREE.Matrix4();
      let targetIndex = 0;
      const existingIndices = Array.from(this.tileToInstanceMap.values())
        .filter((info: any) => info.mesh === targetMesh)
        .map((info: any) => info.index);
      if (existingIndices.length > 0) targetIndex = Math.max(...existingIndices) + 1;
      targetMesh.setMatrixAt(targetIndex, worldMatrix);
      targetMesh.instanceMatrix.needsUpdate = true;
      this.tileToInstanceMap.set(tileKey, {mesh: targetMesh, index: targetIndex});
      console.warn('Moved tile from non-instanced mesh to instanced mesh by copying world matrix.');
      return;
    }
  }

  // Generate deterministic square-block groupings to exactly meet biome tile counts.
  // Returns a map from tileKey "x,z" to the TerrainType assigned.
  private generateSquareGroupsMap(): Map<string, TerrainType> {
    const mapSize = this.populationBasedMapSize;
    const halfSize = this.mapHalfSize;
    const totalTiles = mapSize * mapSize;

    // Start from the biome tile counts (targets)
    const tileCounts = Object.assign({}, this.biomeTileCounts) as { [key: string]: number };

    // Ensure sum of targets equals totalTiles by letting saltwater absorb rounding residuals
    const sumTargets = Object.values(tileCounts).reduce((s, v) => s + (v || 0), 0);
    const delta = totalTiles - sumTargets;
    if (!tileCounts['saltwater']) tileCounts['saltwater'] = 0;
    tileCounts['saltwater'] += delta; // can be negative or positive; usually small

    // Prepare a list of all tile coordinates, sorted by center proximity (center-first)
    const coords: { x: number; z: number; dist: number }[] = [];
    for (let gz = -halfSize; gz <= halfSize; gz++) {
      for (let gx = -halfSize; gx <= halfSize; gx++) {
        const dist = Math.sqrt(gx * gx + gz * gz);
        coords.push({ x: gx, z: gz, dist });
      }
    }
    coords.sort((a, b) => a.dist - b.dist || a.x - b.x || a.z - b.z);

    // Remaining counters (mutable)
    const remaining: { [key: string]: number } = {};
    Object.keys(tileCounts).forEach(k => remaining[k] = tileCounts[k] || 0);

    const assignment = new Map<string, TerrainType>();

    // Helper: list of biome keys
    const biomeKeys = Object.keys(tileCounts);

    // For each tile (closest to center first), choose the best available biome
    for (const c of coords) {
      const key = `${c.x},${c.z}`;

      // If only one biome left with tiles, assign it
      const available = biomeKeys.filter(b => remaining[b] > 0);
      if (available.length === 1) {
        assignment.set(key, available[0] as TerrainType);
        remaining[available[0]]--;
        continue;
      }

      // Compute preferred biome for this location using natural clustering heuristics
      const adjustedDistance = Math.sqrt(c.x * c.x + c.z * c.z) / this.mapHalfSize;
      const elevation = this.calculateNaturalElevation(c.x, c.z, adjustedDistance);
      const preferred = this.getNaturalBiomeCluster(c.x, c.z, adjustedDistance, elevation);

      // If preferred biome has remaining quota, use it
      if (remaining[preferred] > 0) {
        assignment.set(key, preferred);
        remaining[preferred]--;
        continue;
      }

      // Otherwise choose the biome with the largest remaining count (greedy), deterministic tie-break by key
      let best: string | null = null;
      let bestCount = -Infinity;
      for (const b of biomeKeys) {
        const r = remaining[b];
        if (r > bestCount) {
          best = b;
          bestCount = r;
        } else if (r === bestCount && best && b < best) {
          // stable deterministic tiebreak
          best = b;
        }
      }
      if (!best) best = 'saltwater';
      assignment.set(key, best as TerrainType);
      remaining[best]--;
    }

    return assignment;
  }

  // Cluster a target tile-count map into center-biased square blocks while preserving exact counts.
  // Input: tileCounts keyed by TerrainType name (number of tiles desired).
  // Output: Map of "x,z" -> TerrainType with exactly mapSize*mapSize entries (fills remaining with saltwater).
  private clusterMapFromCounts(tileCountsInput: { [key: string]: number }): Map<string, TerrainType> {
    const mapSize = this.populationBasedMapSize;
    const halfSize = this.mapHalfSize;
    const totalTiles = mapSize * mapSize;

    // Copy counts (floor to integers)
    const counts: { [key: string]: number } = {};
    Object.keys(tileCountsInput).forEach(k => counts[k] = Math.max(0, Math.floor(tileCountsInput[k] || 0)));

    // If population sizing is enabled, enforce the global ocean tile limit (this.maxOceanTiles)
    // by clamping saltwater and reducing land counts if necessary so the overall water/land split
    // matches the intended target (70.9% ocean when population sizing is used).
    if (this.usePopulationSizing && typeof this.maxOceanTiles === 'number' && this.maxOceanTiles > 0) {
      const desiredSalt = this.maxOceanTiles;
      const totalTilesNum = totalTiles;

      // Desired freshwater (from requested tile counts)
      const desiredFresh = Math.max(0, counts['freshwater'] || 0);

      // Clamp freshwater so it doesn't exceed remaining tiles after desired salt
      const maxFreshAllowed = Math.max(0, totalTilesNum - desiredSalt);
      const finalDesiredFresh = Math.min(desiredFresh, maxFreshAllowed);

      // Compute desired total water (salt + fresh)
      const desiredTotalWater = desiredSalt + finalDesiredFresh;
      const allowedLand = Math.max(0, totalTilesNum - desiredTotalWater);

      // Gather current land biomes (exclude saltwater and freshwater)
      const landKeys = Object.keys(counts).filter(k => k !== 'saltwater' && k !== 'freshwater');
      const currentLandSum = landKeys.reduce((s, k) => s + (counts[k] || 0), 0);

      // If current land allocation exceeds allowed land, reduce land biomes proportionally
      if (currentLandSum > allowedLand && currentLandSum > 0) {
        // Compute proportional factors and floor the results; then distribute any remainder
        const newLandCounts: { [key: string]: number } = {};
        let accumulated = 0;
        for (const k of landKeys) {
          const original = counts[k] || 0;
          const proportional = Math.floor(original * allowedLand / currentLandSum);
          newLandCounts[k] = proportional;
          accumulated += proportional;
        }
        // Distribute remaining tiles (due to flooring) deterministically to largest original biomes
        let remainder = allowedLand - accumulated;
        if (remainder > 0) {
          const sortedByOriginal = landKeys.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b));
          let idx = 0;
          while (remainder > 0 && idx < sortedByOriginal.length) {
            const key = sortedByOriginal[idx];
            newLandCounts[key] = (newLandCounts[key] || 0) + 1;
            remainder--;
            idx++;
            if (idx >= sortedByOriginal.length) idx = 0;
          }
        }
        // Apply new land counts
        for (const k of landKeys) counts[k] = newLandCounts[k] || 0;
      }

      // Now set freshwater and saltwater to final desired values
      counts['freshwater'] = finalDesiredFresh;
      counts['saltwater'] = Math.max(0, desiredSalt);

      // Ensure totals sum to totalTiles by letting saltwater absorb any residual
      const finalSum = Object.values(counts).reduce((s, v) => s + v, 0);
      const residual = totalTilesNum - finalSum;
      if (residual !== 0) {
        counts['saltwater'] = Math.max(0, (counts['saltwater'] || 0) + residual);
      }
    } else {
      // Ensure sum of targets equals totalTiles by letting saltwater absorb rounding residuals
      const sum = Object.values(counts).reduce((s, v) => s + v, 0);
      const delta = totalTiles - sum;
      if (!counts['saltwater']) counts['saltwater'] = 0;
      counts['saltwater'] += delta;
    }

    // Prepare occupancy grid
    const occupied: boolean[][] = [];
    for (let z = 0; z < mapSize; z++) {
      occupied[z] = new Array(mapSize).fill(false);
    }

    const result = new Map<string, TerrainType>();

    // Helper to mark a block occupied and write results
    const occupyBlock = (tx: number, tz: number, s: number, biome: TerrainType) => {
      for (let oz = 0; oz < s; oz++) {
        for (let ox = 0; ox < s; ox++) {
          const gx = tx + ox;
          const gz = tz + oz;
          occupied[gz][gx] = true;
          const worldX = gx - halfSize;
          const worldZ = gz - halfSize;
          result.set(`${worldX},${worldZ}`, biome);
        }
      }
    };

    // Candidate generator for a given block size s (returns top-left coordinates sorted by block-center distance to map center)
    const generateCandidates = (s: number) => {
      const candidates: { tx: number; tz: number; dist: number }[] = [];
      for (let tz = 0; tz <= mapSize - s; tz++) {
        for (let tx = 0; tx <= mapSize - s; tx++) {
          const centerGX = tx + (s - 1) / 2;
          const centerGZ = tz + (s - 1) / 2;
          const dx = centerGX - halfSize;
          const dz = centerGZ - halfSize;
          const dist = Math.sqrt(dx * dx + dz * dz);
          candidates.push({ tx, tz, dist });
        }
      }
      // deterministic sort: distance then tx then tz
      candidates.sort((a, b) => a.dist - b.dist || a.tx - b.tx || a.tz - b.tz);
      return candidates;
    };

    // Order biomes by descending target size so we place large biomes first (more visually blocky)
    const biomeOrder = Object.keys(counts).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

    for (const biomeKey of biomeOrder) {
      let remaining = counts[biomeKey];
      if (remaining <= 0) continue;
      const biome = biomeKey as TerrainType;

      // Place blocks until we've satisfied the remaining count for this biome
      while (remaining > 0) {
        // Start with the largest square block possible
        let maxS = Math.floor(Math.sqrt(remaining));
        if (maxS < 1) maxS = 1;

        let placed = false;
        for (let s = maxS; s >= 1; s--) {
          // Generate candidate positions for this s
          const candidates = generateCandidates(s);
          for (const cand of candidates) {
            // Check occupancy for this block
            let ok = true;
            for (let oz = 0; oz < s && ok; oz++) {
              for (let ox = 0; ox < s; ox++) {
                if (occupied[cand.tz + oz][cand.tx + ox]) { ok = false; break; }
              }
            }
            if (!ok) continue;

            // Place block
            occupyBlock(cand.tx, cand.tz, s, biome);
            remaining -= s * s;
            placed = true;
            break; // placed one block, recompute remaining and try again
          }
          if (placed) break; // restart with new maxS
        }

        // If we couldn't place any block of any size (very crowded), find any single empty tile and place it
        if (!placed) {
          let found = false;
          for (let gz = 0; gz < mapSize && !found; gz++) {
            for (let gx = 0; gx < mapSize && !found; gx++) {
              if (!occupied[gz][gx]) {
                occupyBlock(gx, gz, 1, biome);
                remaining -= 1;
                found = true;
              }
            }
          }
          if (!found) {
            // No space left; abort (shouldn't happen) and break
            console.warn('clusterMapFromCounts: no space to place remaining tiles for', biomeKey, 'remaining=', remaining);
            break;
          }
        }
      }
    }

    // Fill any unassigned tiles with saltwater
    const salt = 'saltwater' as TerrainType;
    for (let gz = 0; gz < mapSize; gz++) {
      for (let gx = 0; gx < mapSize; gx++) {
        const worldX = gx - halfSize;
        const worldZ = gz - halfSize;
        const key = `${worldX},${worldZ}`;
        if (!result.has(key)) {
          result.set(key, salt);
        }
      }
    }

    // Final sanity: ensure map is fully filled
    if (result.size !== totalTiles) {
      console.warn('clusterMapFromCounts produced unexpected size', result.size, 'expected', totalTiles);
    }

    // Debug: log final counts used by clustering for verification
    try {
      const debugCounts = Object.assign({}, counts);
      console.log('clusterMapFromCounts final counts:', debugCounts);
      // Commit the final counts used by clustering back to component state so
      // quota reporting matches the actual placements the clustering performed.
      this.biomeQuotas = Object.assign({}, counts) as Record<TerrainType, number>;
    } catch (e) {}

    return result;
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