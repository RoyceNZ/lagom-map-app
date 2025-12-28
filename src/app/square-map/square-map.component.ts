import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// SDF (Signed Distance Field) Shader for seamless rounded biome tiles
const sdfVertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  void main() {
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sdfFragmentShader = `
  uniform sampler2D map;
  uniform vec3 color;
  uniform float roughness;
  uniform float metalness;
  uniform sampler2D envMap;
  uniform float envMapIntensity;
  uniform float cornerRadius;
  
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  // SDF for rounded box
  float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  
  void main() {
    // Box dimensions (half-extents)
    vec3 boxSize = vec3(0.5, 0.5, 0.5);
    
    // Calculate SDF distance
    float dist = sdRoundBox(vPosition, boxSize, cornerRadius);
    
    // Discard fragments outside the rounded box
    if (dist > 0.01) {
      discard;
    }
    
    // Smooth alpha based on distance for anti-aliasing
    float alpha = 1.0 - smoothstep(-0.01, 0.01, dist);
    
    // Sample texture
    vec4 texColor = texture2D(map, vUv);
    
    // Apply color tint
    vec3 finalColor = texColor.rgb * color;
    
    // Simple Phong-like lighting
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    float diff = max(dot(vNormal, lightDir), 0.0);
    
    finalColor = finalColor * (0.3 + 0.7 * diff);
    
    gl_FragColor = vec4(finalColor, alpha * texColor.a);
  }
`;

// Alternative: Instanced SDF shader with per-instance biome data
const sdfInstancedVertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  
  void main() {
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const sdfInstancedFragmentShader = `
  uniform sampler2D map;
  uniform vec3 baseColor;
  uniform float cornerRadius;
  uniform float envMapIntensity;
  
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  
  // SDF for rounded box - returns distance to surface
  float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  
  // Calculate smooth normal from SDF
  vec3 calcNormal(vec3 p, vec3 boxSize, float r) {
    const vec2 e = vec2(0.005, 0.0);
    return normalize(vec3(
      sdRoundBox(p + e.xyy, boxSize, r) - sdRoundBox(p - e.xyy, boxSize, r),
      sdRoundBox(p + e.yxy, boxSize, r) - sdRoundBox(p - e.yxy, boxSize, r),
      sdRoundBox(p + e.yyx, boxSize, r) - sdRoundBox(p - e.yyx, boxSize, r)
    ));
  }
  
  void main() {
    // Box dimensions (half-extents) - slightly smaller to create rounded effect
    vec3 boxSize = vec3(0.5, 0.5, 0.5);
    
    // Calculate SDF distance at this fragment
    float dist = sdRoundBox(vPosition, boxSize, cornerRadius);
    
    // More lenient discard threshold - only discard far outside
    if (dist > 0.1) {
      discard;
    }
    
    // Sample texture first
    vec4 texColor = texture2D(map, vUv);
    
    // Apply base color tint
    vec3 finalColor = texColor.rgb * baseColor;
    
    // Calculate smooth normal based on SDF only near edges
    vec3 smoothNormal = vNormal;
    if (dist > -0.05 && cornerRadius > 0.01) {
      smoothNormal = mix(vNormal, calcNormal(vPosition, boxSize, cornerRadius), 0.8);
    }
    
    // Enhanced lighting with smooth normals
    vec3 lightDir = normalize(vec3(1.0, 2.0, 1.0));
    float diff = max(dot(smoothNormal, lightDir), 0.0);
    
    // Ambient + diffuse lighting
    vec3 ambient = finalColor * 0.4;
    vec3 diffuse = finalColor * diff * 0.6;
    finalColor = ambient + diffuse;
    
    // Smooth alpha for anti-aliasing at edges only
    float alpha = 1.0;
    if (dist > 0.0) {
      alpha = 1.0 - smoothstep(0.0, 0.05, dist);
    }
    
    gl_FragColor = vec4(finalColor, alpha * texColor.a);
  }
`;

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

  // Hover functionality
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  hoveredTileInfo: { biome: string; x: number; z: number } | null = null;
  highlightMesh!: THREE.Mesh;

  // Instanced meshes (one per visual terrain type) - interior tiles
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
  
  // Perimeter meshes (rounded edges) - one per visual terrain type
  mountainsPerimeterMesh!: THREE.InstancedMesh;
  tundraPerimeterMesh!: THREE.InstancedMesh;
  urbanPerimeterMesh!: THREE.InstancedMesh;
  borealForestPerimeterMesh!: THREE.InstancedMesh;
  temperateForestPerimeterMesh!: THREE.InstancedMesh;
  tropicalRainforestPerimeterMesh!: THREE.InstancedMesh;
  croplandPerimeterMesh!: THREE.InstancedMesh;
  scrubPerimeterMesh!: THREE.InstancedMesh;
  temperateGrasslandPerimeterMesh!: THREE.InstancedMesh;
  pasturelandPerimeterMesh!: THREE.InstancedMesh;
  savannaPerimeterMesh!: THREE.InstancedMesh;
  desertsPerimeterMesh!: THREE.InstancedMesh;

  // State and configuration
  isUpdating = false;
  updateTimeout: any = null;
  enforceEarthQuotas = true;
  usePopulationSizing = true;
  selectedYear = new Date().getFullYear();
  terrainSeed = Math.random() * 10000;
  
  // SDF configuration for rounded edges
  cornerRadius = 0.08; // 0.0 = sharp corners, 0.15 = very rounded

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
    
    // Consolidated group seeds: group similar biomes into single contiguous blocks.
    // Each seed represents a group; when a group is chosen we deterministically pick
    // one member of the group based on latitude (islandZ) and elevation so similar
    // biomes appear together as one block but still keep some geographic realism.
    const groupSeeds: Array<{ x: number, z: number, radius: number, group: string, members: TerrainType[] }> = [
      // Forest block (north-to-south within block will vary between boreal -> temperate -> tropical)
      { x: 0, z: -0.25, radius: 0.5, group: 'forests', members: ['borealForest', 'temperateForest', 'tropicalRainforest'] },
      // Grasslands/agricultural block (mix of grass, savanna and pasture)
      { x: 0.35, z: 0.1, radius: 0.45, group: 'grasslands', members: ['temperateGrassland', 'savanna', 'pastureland'] },
      // Desert block (kept as single, large desert area)
      { x: -0.4, z: 0, radius: 0.45, group: 'deserts', members: ['deserts'] },
      // Rainforest block (southern wet block, but kept inside forest group fallback if needed)
      { x: 0, z: 0.4, radius: 0.45, group: 'rainforest', members: ['tropicalRainforest'] },
      // Mountains (central spine)
      { x: 0, z: 0, radius: 0.25, group: 'mountains', members: ['mountains'] },
      // Tundra (cold northern fringe)
      { x: -0.25, z: -0.35, radius: 0.3, group: 'tundra', members: ['tundra'] },
      // Scrub/transition areas
      { x: 0.25, z: 0, radius: 0.25, group: 'scrub', members: ['scrub'] },
      // Freshwater (lake cluster near center)
      { x: -0.1, z: -0.1, radius: 0.2, group: 'freshwater', members: ['freshwater'] },
      // Human use clusters (agriculture and urban consolidated)
      { x: -0.15, z: 0.2, radius: 0.28, group: 'agriculture', members: ['cropland', 'pastureland', 'urban'] },
    ];

    // Find closest group seed
    let chosenGroup = groupSeeds[0];
    let minDistanceToSeed = Infinity;
    for (const seed of groupSeeds) {
      const seedDistance = Math.sqrt((islandX - seed.x) ** 2 + (islandZ - seed.z) ** 2);
      if (seedDistance < seed.radius && seedDistance < minDistanceToSeed) {
        minDistanceToSeed = seedDistance;
        chosenGroup = seed;
      }
    }

    // Deterministic selection within a chosen group to keep similar biomes contiguous
    const group = chosenGroup.group;

    // Helper: seeded selector to choose among members when needed
    const pickBySeed = (members: TerrainType[]) => {
      const r = Math.floor(this.seededRandom(x, z, 500 + Math.floor(elevation * 1000)) * members.length);
      return members[Math.max(0, Math.min(members.length - 1, r))];
    };

    if (group === 'forests') {
      // latitude-driven inside the forest block: north -> boreal, center -> temperate, south -> tropical
      if (islandZ < -0.15) return 'borealForest';
      if (islandZ > 0.15) return 'tropicalRainforest';
      return 'temperateForest';
    }

    if (group === 'rainforest') {
      return 'tropicalRainforest';
    }

    if (group === 'grasslands') {
      // Elevation and latitude influence: higher elevation -> pasture, southern -> savanna, otherwise temperate grassland
      if (elevation > 0.55) return 'pastureland';
      if (islandZ > 0.15) return 'savanna';
      return 'temperateGrassland';
    }

    if (group === 'deserts') {
      return 'deserts';
    }

    if (group === 'mountains') {
      return 'mountains';
    }

    if (group === 'tundra') {
      return 'tundra';
    }

    if (group === 'scrub') {
      return 'scrub';
    }

    if (group === 'freshwater') {
      return 'freshwater';
    }

    if (group === 'agriculture') {
      // Prefer cropland in low elevation and near center, pasture on rolling terrain, urban as small pockets
      if (elevation < 0.25 && Math.abs(islandX) < 0.3) return 'cropland';
      if (elevation > 0.45) return 'pastureland';
      // Use seeded choice to place occasional urban tiles
      const roll = this.seededRandom(x, z, 900);
      if (roll < 0.12) return 'urban';
      return pickBySeed(['cropland', 'pastureland']);
    }

    // Fallback: pick one of the group's members deterministically
    return pickBySeed(chosenGroup.members);
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
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

    // Create highlight mesh for hover effect with rounded corners
    const highlightGeometry = new RoundedBoxGeometry(1.1, 2, 1.1, 4, 0);
    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });
    this.highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
    this.highlightMesh.visible = false;
    this.scene.add(this.highlightMesh);

    this.renderer.setAnimationLoop(() => {
      controls.update();
      this.renderer.render(this.scene, this.camera);
    });

    // Add window resize handler
    window.addEventListener('resize', () => this.onWindowResize());

    // Add mouse move handler for hover detection
    this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
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

  // Create a shader material with vertex-based beveling for selective edge rounding
  createBeveledMaterial(
    textureMap: THREE.Texture, 
    materialColor: number, 
    envMap: THREE.Texture,
    bevelRadius: number
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: textureMap },
        envMap: { value: envMap },
        envMapIntensity: { value: 0.135 },
        color: { value: new THREE.Color(materialColor) },
        bevelRadius: { value: bevelRadius }
      },
      vertexShader: `
        attribute vec4 edgeRounding; // (roundNorth, roundSouth, roundEast, roundWest)
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec4 vEdgeRounding;
        
        uniform float bevelRadius;
        
        void main() {
          vUv = uv;
          vEdgeRounding = edgeRounding;
          
          // Get position - DON'T modify it to avoid gaps
          vec3 pos = position;
          
          // Modify normal for beveled edges to create smooth visual transition
          vec3 modifiedNormal = normal;
          
          // Calculate if vertex is on an edge
          float threshold = 0.49;
          bool onNorthEdge = pos.z < -threshold;
          bool onSouthEdge = pos.z > threshold;
          bool onEastEdge = pos.x > threshold;
          bool onWestEdge = pos.x < -threshold;
          bool onTopFace = abs(normal.y) > 0.9; // Top face
          
          // Strong normal blending for visible rounded appearance
          float normalBlend = 0.85; // Much stronger blending
          
          // Apply normal smoothing to create rounded appearance through lighting
          if (onTopFace) {
            // Top face edge smoothing
            if (edgeRounding.x > 0.5 && onNorthEdge) { // roundNorth
              modifiedNormal = mix(modifiedNormal, normalize(vec3(0.0, 0.7, -0.7)), normalBlend);
            }
            if (edgeRounding.y > 0.5 && onSouthEdge) { // roundSouth
              modifiedNormal = mix(modifiedNormal, normalize(vec3(0.0, 0.7, 0.7)), normalBlend);
            }
            if (edgeRounding.z > 0.5 && onEastEdge) { // roundEast
              modifiedNormal = mix(modifiedNormal, normalize(vec3(0.7, 0.7, 0.0)), normalBlend);
            }
            if (edgeRounding.w > 0.5 && onWestEdge) { // roundWest
              modifiedNormal = mix(modifiedNormal, normalize(vec3(-0.7, 0.7, 0.0)), normalBlend);
            }
            
            // Smooth corners even more for rounded appearance
            if (edgeRounding.x > 0.5 && edgeRounding.w > 0.5 && onNorthEdge && onWestEdge) {
              modifiedNormal = normalize(vec3(-0.5, 0.7, -0.5));
            }
            if (edgeRounding.x > 0.5 && edgeRounding.z > 0.5 && onNorthEdge && onEastEdge) {
              modifiedNormal = normalize(vec3(0.5, 0.7, -0.5));
            }
            if (edgeRounding.y > 0.5 && edgeRounding.w > 0.5 && onSouthEdge && onWestEdge) {
              modifiedNormal = normalize(vec3(-0.5, 0.7, 0.5));
            }
            if (edgeRounding.y > 0.5 && edgeRounding.z > 0.5 && onSouthEdge && onEastEdge) {
              modifiedNormal = normalize(vec3(0.5, 0.7, 0.5));
            }
          } else {
            // Side faces - blend towards outward direction for smooth transition
            float sideBlend = 0.7;
            if (edgeRounding.x > 0.5 && onNorthEdge) {
              modifiedNormal = mix(modifiedNormal, normalize(vec3(0.0, 0.3, -1.0)), sideBlend);
            }
            if (edgeRounding.y > 0.5 && onSouthEdge) {
              modifiedNormal = mix(modifiedNormal, normalize(vec3(0.0, 0.3, 1.0)), sideBlend);
            }
            if (edgeRounding.z > 0.5 && onEastEdge) {
              modifiedNormal = mix(modifiedNormal, normalize(vec3(1.0, 0.3, 0.0)), sideBlend);
            }
            if (edgeRounding.w > 0.5 && onWestEdge) {
              modifiedNormal = mix(modifiedNormal, normalize(vec3(-1.0, 0.3, 0.0)), sideBlend);
            }
          }
          
          vNormal = normalize(normalMatrix * modifiedNormal);
          
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform samplerCube envMap;
        uniform vec3 color;
        uniform float envMapIntensity;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec4 vEdgeRounding;
        
        void main() {
          vec4 texColor = texture2D(map, vUv);
          
          // Enhanced lighting with multiple light sources
          vec3 normal = normalize(vNormal);
          
          // Main directional light (sun-like)
          vec3 mainLightDir = normalize(vec3(0.5, 1.5, 0.8));
          float mainDiffuse = max(dot(normal, mainLightDir), 0.0);
          
          // Fill light (softer, from opposite side)
          vec3 fillLightDir = normalize(vec3(-0.3, 0.5, -0.4));
          float fillDiffuse = max(dot(normal, fillLightDir), 0.0) * 0.3;
          
          // Rim light (from above-behind for edge definition)
          vec3 rimLightDir = normalize(vec3(0.0, 1.0, -0.5));
          float rimDiffuse = max(dot(normal, rimLightDir), 0.0) * 0.2;
          
          // Combine lighting
          float totalDiffuse = mainDiffuse + fillDiffuse + rimDiffuse;
          float ambient = 0.4; // Base ambient light
          float lighting = ambient + totalDiffuse * 0.8;
          lighting = clamp(lighting, 0.0, 1.2); // Allow slight overbright
          
          // Sample environment map for reflections
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 reflectDir = reflect(-viewDir, normal);
          vec4 envColor = textureCube(envMap, reflectDir);
          
          // Combine texture, color, lighting, and environment reflection
          vec3 finalColor = texColor.rgb * color * lighting;
          finalColor = mix(finalColor, envColor.rgb, envMapIntensity * 0.2);
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      lights: false,
      side: THREE.FrontSide
    });
  }

  // Create a shader material for water with transparency
  createWaterMaterial(
    textureMap: THREE.Texture, 
    materialColor: number, 
    envMap: THREE.Texture,
    opacity: number
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: textureMap },
        envMap: { value: envMap },
        envMapIntensity: { value: 0.3 },
        color: { value: new THREE.Color(materialColor) },
        opacity: { value: opacity }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform samplerCube envMap;
        uniform vec3 color;
        uniform float envMapIntensity;
        uniform float opacity;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        
        void main() {
          vec4 texColor = texture2D(map, vUv);
          
          // Enhanced lighting with multiple light sources (same as land)
          vec3 normal = normalize(vNormal);
          
          // Main directional light (sun-like)
          vec3 mainLightDir = normalize(vec3(0.5, 1.5, 0.8));
          float mainDiffuse = max(dot(normal, mainLightDir), 0.0);
          
          // Fill light (softer, from opposite side)
          vec3 fillLightDir = normalize(vec3(-0.3, 0.5, -0.4));
          float fillDiffuse = max(dot(normal, fillLightDir), 0.0) * 0.3;
          
          // Rim light (from above-behind for edge definition)
          vec3 rimLightDir = normalize(vec3(0.0, 1.0, -0.5));
          float rimDiffuse = max(dot(normal, rimLightDir), 0.0) * 0.2;
          
          // Combine lighting
          float totalDiffuse = mainDiffuse + fillDiffuse + rimDiffuse;
          float ambient = 0.5; // Slightly higher ambient for water
          float lighting = ambient + totalDiffuse * 0.7;
          lighting = clamp(lighting, 0.0, 1.2);
          
          // Sample environment map for reflections (stronger for water)
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 reflectDir = reflect(-viewDir, normal);
          vec4 envColor = textureCube(envMap, reflectDir);
          
          // Combine texture, color, lighting, and environment reflection
          vec3 finalColor = texColor.rgb * color * lighting;
          finalColor = mix(finalColor, envColor.rgb, envMapIntensity * 0.5); // Stronger reflection for water
          
          gl_FragColor = vec4(finalColor, opacity);
        }
      `,
      transparent: true,
      lights: false,
      side: THREE.FrontSide,
      depthWrite: true
    });
  }

  onMouseMove(event: MouseEvent): void {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update the raycaster with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Calculate objects intersecting the ray (use scene children since we're using merged meshes now)
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      const mesh = intersect.object as THREE.Mesh;
      
      // Get the position from the intersection point
      const x = Math.round(intersect.point.x);
      const z = Math.round(intersect.point.z);

      // Get biome type from the mesh's stored terrainType property
      const terrainType = (mesh as any).terrainType as VisualTerrainType;
      
      let biomeType = '';
      if (terrainType) {
        // Convert terrain type to display name
        switch (terrainType) {
          case 'mountains': biomeType = 'Mountains'; break;
          case 'tundra': biomeType = 'Tundra'; break;
          case 'urban': biomeType = 'Urban'; break;
          case 'borealForest': biomeType = 'Boreal Forest'; break;
          case 'temperateForest': biomeType = 'Temperate Forest'; break;
          case 'tropicalRainforest': biomeType = 'Tropical Rainforest'; break;
          case 'cropland': biomeType = 'Cropland'; break;
          case 'scrub': biomeType = 'Scrub'; break;
          case 'temperateGrassland': biomeType = 'Temperate Grassland'; break;
          case 'pastureland': biomeType = 'Pastureland'; break;
          case 'savanna': biomeType = 'Savanna'; break;
          case 'deserts': biomeType = 'Deserts'; break;
          case 'saltwater': biomeType = 'Saltwater (Ocean)'; break;
          case 'freshwater': biomeType = 'Freshwater (Lake/River)'; break;
        }
      }

      this.hoveredTileInfo = { biome: biomeType, x, z };

      // Position and show highlight mesh
      if (this.highlightMesh) {
        // Use the intersection point's Y coordinate as height
        const height = Math.max(0.1, intersect.point.y);
        
        // Position at center of the tile's height
        this.highlightMesh.position.set(x, height * 0.5, z);
        this.highlightMesh.scale.set(1, height, 1);
        this.highlightMesh.visible = true;
      }
    } else {
      this.hoveredTileInfo = null;
      if (this.highlightMesh) {
        this.highlightMesh.visible = false;
      }
    }
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
      
      // Apply texture settings to all land textures to reduce seams
      const landTextures = [
        textures.tundra, textures.urban, textures.borealForest, 
        textures.temperateForest, textures.tropicalRainforest, textures.cropland,
        textures.scrub, textures.temperateGrassland, textures.pastureland,
        textures.savanna, textures.deserts
      ];
      
      landTextures.forEach(texture => {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; // Prevent edge bleeding
        texture.minFilter = THREE.LinearFilter; // Smooth filtering
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 16; // Maximum anisotropic filtering for better quality
      });
    } catch (e) {
      // If textures not fully loaded yet, ignore - loader will update filters when ready
      console.warn('Failed to set texture filters/repeat; continuing', e);
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
  // Create two types of geometry:
  // 1. Regular box for interior tiles (seamless joining)
  // 2. Rounded box for perimeter tiles (smooth edges)
  const interiorGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  const perimeterGeometry = new RoundedBoxGeometry(1.0, 1.0, 1.0, 4, this.cornerRadius * 5);
  
  // Use a flat plane for water (lies on XZ plane). We'll rotate the plane once and reuse it.
  const unitWaterPlane = new THREE.PlaneGeometry(1.01, 1.01);
  unitWaterPlane.rotateX(-Math.PI / 2);
    
    // Helper function to check if a tile is on the perimeter of its biome
    const isPerimeterTile = (x: number, z: number, biome: TerrainType, mapAssignments: Map<string, TerrainType>): boolean => {
      // Check all 8 neighbors (including diagonals for smoother edges)
      const neighbors = [
        [-1, 0], [1, 0], [0, -1], [0, 1],  // Cardinal directions
        [-1, -1], [-1, 1], [1, -1], [1, 1]  // Diagonals
      ];
      
      for (const [dx, dz] of neighbors) {
        const neighborKey = `${x + dx},${z + dz}`;
        const neighborBiome = mapAssignments.get(neighborKey);
        
        // If neighbor doesn't exist or is a different biome, this is a perimeter tile
        if (!neighborBiome || neighborBiome !== biome) {
          return true;
        }
      }
      
      return false;
    };
    
    // Create individual meshes for each terrain type with standard materials
    // We'll create both interior and perimeter versions for seamless joining with rounded edges
    this.mountainsMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        color: 0x8b7355
      }),
      squareCount
    );
    
    this.tundraMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.tundra
      }),
      squareCount
    );
    
    this.urbanMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.urban
      }),
      squareCount
    );
    
    this.borealForestMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.borealForest
      }),
      squareCount
    );
    
    this.temperateForestMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.temperateForest
      }),
      squareCount
    );
    
    this.tropicalRainforestMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.tropicalRainforest
      }),
      squareCount
    );
    
    this.croplandMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.cropland
      }),
      squareCount
    );
    
    this.scrubMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.scrub
      }),
      squareCount
    );
    
    this.temperateGrasslandMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.temperateGrassland
      }),
      squareCount
    );
    
    this.pasturelandMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.pastureland
      }),
      squareCount
    );
    
    this.savannaMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.savanna
      }),
      squareCount
    );
    
    this.desertsMesh = new THREE.InstancedMesh(
      interiorGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, 
        envMapIntensity: 0.135, 
        flatShading: false,
        roughness: 1, 
        metalness: 0, 
        map: textures.deserts
      }),
      squareCount
    );
    
    this.saltwaterMesh = new THREE.InstancedMesh(unitWaterPlane, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: true, roughness: 0.0, metalness: 0.0, 
      map: textures.saltwater, transparent: true, opacity: 0.92, color: 0x20a0ff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 1,
      alphaTest: 0.01
    }), squareCount);
    
    this.freshwaterMesh = new THREE.InstancedMesh(unitWaterPlane, new THREE.MeshPhysicalMaterial({ 
      envMap: envmap, envMapIntensity: 0.3, flatShading: true, roughness: 0.1, metalness: 0.1, 
      map: textures.freshwater, transparent: true, opacity: 0.95, color: 0x4080ff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 1,
      alphaTest: 0.01
    }), squareCount);
    
    // Create perimeter meshes with rounded geometry
    this.mountainsPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, color: 0x8b7355
      }),
      squareCount
    );
    
    this.tundraPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.tundra
      }),
      squareCount
    );
    
    this.urbanPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.urban
      }),
      squareCount
    );
    
    this.borealForestPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.borealForest
      }),
      squareCount
    );
    
    this.temperateForestPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.temperateForest
      }),
      squareCount
    );
    
    this.tropicalRainforestPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.tropicalRainforest
      }),
      squareCount
    );
    
    this.croplandPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.cropland
      }),
      squareCount
    );
    
    this.scrubPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.scrub
      }),
      squareCount
    );
    
    this.temperateGrasslandPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.temperateGrassland
      }),
      squareCount
    );
    
    this.pasturelandPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.pastureland
      }),
      squareCount
    );
    
    this.savannaPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.savanna
      }),
      squareCount
    );
    
    this.desertsPerimeterMesh = new THREE.InstancedMesh(
      perimeterGeometry, 
      new THREE.MeshPhysicalMaterial({ 
        envMap: envmap, envMapIntensity: 0.135, flatShading: false,
        roughness: 1, metalness: 0, map: textures.deserts
      }),
      squareCount
    );

    // Initialize index counters for each terrain type (interior and perimeter)
    const interiorIndices = {
      mountains: 0, tundra: 0, urban: 0, borealForest: 0, temperateForest: 0,
      tropicalRainforest: 0, cropland: 0, scrub: 0, temperateGrassland: 0,
      pastureland: 0, savanna: 0, deserts: 0, saltwater: 0, freshwater: 0
    };
    
    const perimeterIndices = {
      mountains: 0, tundra: 0, urban: 0, borealForest: 0, temperateForest: 0,
      tropicalRainforest: 0, cropland: 0, scrub: 0, temperateGrassland: 0,
      pastureland: 0, savanna: 0, deserts: 0
    };

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

    // Map terrain types to their meshes (interior and perimeter)
    const terrainMeshes: Record<VisualTerrainType, THREE.InstancedMesh | null> = {
      mountains: this.mountainsMesh,
      tundra: this.tundraMesh,
      urban: this.urbanMesh,
      borealForest: this.borealForestMesh,
      temperateForest: this.temperateForestMesh,
      tropicalRainforest: this.tropicalRainforestMesh,
      cropland: this.croplandMesh,
      scrub: this.scrubMesh,
      temperateGrassland: this.temperateGrasslandMesh,
      pastureland: this.pasturelandMesh,
      savanna: this.savannaMesh,
      deserts: this.desertsMesh,
      saltwater: this.saltwaterMesh,
      freshwater: this.freshwaterMesh
    };
    
    const perimeterMeshes: Record<string, THREE.InstancedMesh | null> = {
      mountains: this.mountainsPerimeterMesh,
      tundra: this.tundraPerimeterMesh,
      urban: this.urbanPerimeterMesh,
      borealForest: this.borealForestPerimeterMesh,
      temperateForest: this.temperateForestPerimeterMesh,
      tropicalRainforest: this.tropicalRainforestPerimeterMesh,
      cropland: this.croplandPerimeterMesh,
      scrub: this.scrubPerimeterMesh,
      temperateGrassland: this.temperateGrasslandPerimeterMesh,
      pastureland: this.pasturelandPerimeterMesh,
      savanna: this.savannaPerimeterMesh,
      deserts: this.desertsPerimeterMesh
    };

    // Create arrays to store interior and perimeter tiles separately
    const interiorTiles: Record<VisualTerrainType, Array<{x: number, z: number}>> = {
      mountains: [], tundra: [], urban: [], borealForest: [], temperateForest: [],
      tropicalRainforest: [], cropland: [], scrub: [], temperateGrassland: [],
      pastureland: [], savanna: [], deserts: [], saltwater: [], freshwater: []
    };
    
    const perimeterTiles: Record<string, Array<{x: number, z: number}>> = {
      mountains: [], tundra: [], urban: [], borealForest: [], temperateForest: [],
      tropicalRainforest: [], cropland: [], scrub: [], temperateGrassland: [],
      pastureland: [], savanna: [], deserts: []
    };

    // Instead of using instanced meshes, create merged geometries for each biome
    // This allows us to create one cohesive mesh per biome with rounded outer edges
    
    // Helper function to get edge rounding flags for a tile
    const getEdgeRounding = (x: number, z: number, biome: TerrainType, mapAssignments: Map<string, TerrainType>) => {
      const neighbors = {
        north: mapAssignments.get(`${x},${z-1}`),
        south: mapAssignments.get(`${x},${z+1}`),
        east: mapAssignments.get(`${x+1},${z}`),
        west: mapAssignments.get(`${x-1},${z}`)
      };
      
      return {
        roundNorth: neighbors.north !== biome,
        roundSouth: neighbors.south !== biome,
        roundEast: neighbors.east !== biome,
        roundWest: neighbors.west !== biome
      };
    };
    
    // Helper to create a box with selective edge rounding using custom attributes
    // This adds custom attributes to mark which edges should be beveled
    const createSelectivelyRoundedBox = (
      width: number, 
      height: number, 
      depth: number, 
      roundEdges: {roundNorth: boolean, roundSouth: boolean, roundEast: boolean, roundWest: boolean},
      radius: number
    ): THREE.BufferGeometry => {
      // Create a regular box geometry
      const geometry = new THREE.BoxGeometry(width, height, depth);
      
      // Add custom attributes for edge rounding
      // We'll store which edges should be rounded for each vertex
      const positionAttr = geometry.attributes['position'];
      const vertexCount = positionAttr.count;
      
      // Create arrays to store edge rounding data for each vertex
      const edgeRoundingData = new Float32Array(vertexCount * 4); // 4 values per vertex (N, S, E, W)
      
      // Half dimensions for comparison
      const hw = width / 2;
      const hd = depth / 2;
      const threshold = 0.001; // Small threshold for floating point comparison
      
      // For each vertex, determine which edges it's on and mark accordingly
      for (let i = 0; i < vertexCount; i++) {
        const x = positionAttr.getX(i);
        const z = positionAttr.getZ(i);
        
        // Check which edges this vertex is on
        const onNorth = Math.abs(z + hd) < threshold; // -z edge
        const onSouth = Math.abs(z - hd) < threshold; // +z edge
        const onEast = Math.abs(x - hw) < threshold;  // +x edge
        const onWest = Math.abs(x + hw) < threshold;  // -x edge
        
        // Store rounding flags (1.0 = round, 0.0 = don't round)
        edgeRoundingData[i * 4 + 0] = (onNorth && roundEdges.roundNorth) ? 1.0 : 0.0;
        edgeRoundingData[i * 4 + 1] = (onSouth && roundEdges.roundSouth) ? 1.0 : 0.0;
        edgeRoundingData[i * 4 + 2] = (onEast && roundEdges.roundEast) ? 1.0 : 0.0;
        edgeRoundingData[i * 4 + 3] = (onWest && roundEdges.roundWest) ? 1.0 : 0.0;
      }
      
      // Add the custom attribute to the geometry
      geometry.setAttribute('edgeRounding', new THREE.BufferAttribute(edgeRoundingData, 4));
      
      // Store the bevel radius as a uniform value (we'll access it in the shader)
      (geometry as any).bevelRadius = radius;
      
      return geometry;
    };
    
    // Create merged geometry for each biome
    const biomeGeometries: Record<VisualTerrainType, THREE.BufferGeometry[]> = {
      mountains: [], tundra: [], urban: [], borealForest: [], temperateForest: [],
      tropicalRainforest: [], cropland: [], scrub: [], temperateGrassland: [],
      pastureland: [], savanna: [], deserts: [], saltwater: [], freshwater: []
    };
    
    // Process each tile and create appropriate geometry
    for (let x = -halfSize; x < halfSize; x++) {
      for (let z = -halfSize; z < halfSize; z++) {
        const key = `${x},${z}`;
        const logical = (mapAssignments.get(key) || 'saltwater') as TerrainType;
        const terrainType = TERRAIN_VISUAL_MAPPING[logical];
        
        // Update counts
        terrainCounts[terrainType] = (terrainCounts[terrainType] || 0) + 1;
        logicalTerrainCounts[logical] = (logicalTerrainCounts[logical] || 0) + 1;
        
        // Position at tile center
        const posX = x + 0.5;
        const posZ = z + 0.5;
        
        // Determine height based on terrain type
        let height = 0.1;
        if (terrainType === 'freshwater') {
          height = 4.8;
        } else if (terrainType === 'saltwater') {
          height = 0.1;
        } else {
          switch (terrainType) {
            case 'mountains': height = 8.0; break;
            case 'tundra': height = 6.5; break;
            case 'urban': height = 5.5; break;
            case 'borealForest': height = 4.5; break;
            case 'temperateForest': height = 3.5; break;
            case 'tropicalRainforest': height = 3.0; break;
            case 'temperateGrassland': height = 2.5; break;
            case 'pastureland': height = 2.0; break;
            case 'cropland': height = 1.8; break;
            case 'savanna': height = 1.5; break;
            case 'scrub': height = 1.0; break;
            case 'deserts': height = 0.8; break;
            default: height = 2.5; break;
          }
        }
        
        // Create geometry for this tile
        let tileGeometry: THREE.BufferGeometry;
        
        if (terrainType === 'saltwater' || terrainType === 'freshwater') {
          // Water uses flat plane
          // Saltwater at ground level (y=0), Freshwater uses its height variable
          const waterHeight = terrainType === 'saltwater' ? 0 : (height * 0.5);
          tileGeometry = new THREE.PlaneGeometry(1.0, 1.0);
          tileGeometry.rotateX(-Math.PI / 2);
          tileGeometry.translate(posX, waterHeight, posZ);
        } else {
          // Land tiles - check if perimeter and get edge rounding
          const edgeRounding = getEdgeRounding(x, z, logical, mapAssignments);
          
          // Always use createSelectivelyRoundedBox which adds the edgeRounding attribute
          // For non-perimeter tiles, all flags will be 0.0 (no rounding)
          tileGeometry = createSelectivelyRoundedBox(1.0, height, 1.0, edgeRounding, this.cornerRadius * 5);
          
          // Position the land geometry
          tileGeometry.translate(posX, height * 0.5, posZ);
        }
        
        // Ensure geometry has proper attributes for merging
        if (!tileGeometry.attributes['normal']) {
          tileGeometry.computeVertexNormals();
        }
        
        // Add to biome geometry array
        biomeGeometries[terrainType].push(tileGeometry);
      }
    }
    
    // Merge geometries for each biome and create meshes
    for (const [terrainType, geometries] of Object.entries(biomeGeometries)) {
      if (geometries.length > 0) {
        const terrain = terrainType as VisualTerrainType;
        
        try {
          // Filter out any null geometries and ensure all have compatible attributes
          const validGeometries = geometries.filter(g => g && g.attributes['position']);
          
          if (validGeometries.length === 0) {
            console.warn(`No valid geometries for terrain type: ${terrain}`);
            continue;
          }
          
          // Ensure all geometries are non-indexed for consistent merging
          // This is crucial because BoxGeometry is indexed but PlaneGeometry might not be
          const nonIndexedGeometries = validGeometries.map(geom => {
            // Clone to avoid modifying original
            const cloned = geom.clone();
            
            // Convert indexed to non-indexed if needed
            if (cloned.index) {
              return cloned.toNonIndexed();
            }
            
            // Ensure normals are computed
            if (!cloned.attributes['normal']) {
              cloned.computeVertexNormals();
            }
            
            return cloned;
          });
          
          // Merge all geometries for this biome
          // Use useGroups=false since we're using one material per biome
          const mergedGeometry = BufferGeometryUtils.mergeGeometries(nonIndexedGeometries, false);
          
          if (!mergedGeometry) {
            console.error(`Failed to merge geometries for terrain type: ${terrain}`);
            continue;
          }
          
          // Create appropriate material
          let material: THREE.Material;
          if (terrain === 'saltwater') {
            // Use custom shader for water too, for consistency with land rendering
            material = this.createWaterMaterial(textures.saltwater, 0x20a0ff, envmap, 0.92);
          } else if (terrain === 'freshwater') {
            // Use custom shader for water too, for consistency with land rendering
            material = this.createWaterMaterial(textures.freshwater, 0x4080ff, envmap, 0.95);
          } else {
            const textureMap = textures[terrain as keyof typeof textures];
            // Use white for all terrains - let the texture and lighting define the color
            const materialColor = 0xffffff;
            
            // Create custom shader material with vertex-based beveling
            material = this.createBeveledMaterial(textureMap, materialColor, envmap, this.cornerRadius * 5);
          }
          
          // Create mesh and add to scene
          const biomeMesh = new THREE.Mesh(mergedGeometry, material);
          biomeMesh.castShadow = true;
          biomeMesh.receiveShadow = true;
          
          // Set render order: land should render after water (higher order = renders later)
          if (terrain === 'saltwater' || terrain === 'freshwater') {
            biomeMesh.renderOrder = -1; // Render water first
          } else {
            biomeMesh.renderOrder = 0; // Render land after
          }
          
          this.scene.add(biomeMesh);
          
          // Store reference for hover detection
          (biomeMesh as any).terrainType = terrain;
          
        } catch (error) {
          console.error(`Error creating mesh for terrain type ${terrain}:`, error);
        }
      }
    }

    // Reconcile ocean/land counters with the tile-derived terrainCounts to avoid drift
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

    // Meshes are now added to scene during geometry merging (see above)
    // No need to add instanced meshes anymore
    
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
  // CREATES ISLAND: Places all land/freshwater in center, saltwater at edges
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

    const assignment = new Map<string, TerrainType>();

    // ISLAND GENERATION: Separate land/freshwater from ocean
    const landBiomes: { biome: TerrainType; count: number }[] = [];
    let saltwaterCount = 0;
    
    Object.keys(tileCounts).forEach(k => {
      if (k === 'saltwater') {
        saltwaterCount = tileCounts[k] || 0;
      } else {
        landBiomes.push({ biome: k as TerrainType, count: tileCounts[k] || 0 });
      }
    });
    
    // Sort land biomes by count (largest first for better distribution)
    landBiomes.sort((a, b) => b.count - a.count);
    
    console.log('🏝️ ISLAND GENERATION:');
    console.log(`  Land/Freshwater tiles: ${landBiomes.reduce((sum, b) => sum + b.count, 0)}`);
    console.log(`  Saltwater tiles: ${saltwaterCount}`);
    
    // Place land and freshwater tiles in the center (closest tiles first)
    let coordIndex = 0;
    for (const landBiome of landBiomes) {
      let remaining = landBiome.count;
      while (remaining > 0 && coordIndex < coords.length) {
        const c = coords[coordIndex];
        const key = `${c.x},${c.z}`;
        assignment.set(key, landBiome.biome);
        remaining--;
        coordIndex++;
      }
      if (remaining > 0) {
        console.warn(`⚠️ Could not place all ${landBiome.biome} tiles, ${remaining} remaining`);
      }
    }
    
    console.log(`  Island radius: ${coordIndex > 0 ? coords[coordIndex - 1].dist.toFixed(1) : 0} tiles from center`);
    
    // Fill remaining tiles (outer edges) with saltwater
    while (coordIndex < coords.length) {
      const c = coords[coordIndex];
      const key = `${c.x},${c.z}`;
      assignment.set(key, 'saltwater' as TerrainType);
      coordIndex++;
    }

    console.log(`✅ Island created: Land clustered at center, ocean surrounds edges`);
    return assignment;
  }

  // Cluster a target tile-count map into center-biased square blocks while preserving exact counts.
  // CREATES AN ISLAND: All land and freshwater tiles clustered in center, saltwater forms ocean around edges
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

    // STEP 1: Create a list of all tiles sorted by distance from center (closest first)
    const allTiles: { gx: number; gz: number; worldX: number; worldZ: number; dist: number }[] = [];
    for (let gz = 0; gz < mapSize; gz++) {
      for (let gx = 0; gx < mapSize; gx++) {
        const worldX = gx - halfSize;
        const worldZ = gz - halfSize;
        const dist = Math.sqrt(worldX * worldX + worldZ * worldZ);
        allTiles.push({ gx, gz, worldX, worldZ, dist });
      }
    }
    // Sort by distance from center (closest tiles first)
    allTiles.sort((a, b) => a.dist - b.dist || a.gx - b.gx || a.gz - b.gz);

    // STEP 2: Separate land/freshwater from saltwater counts
    const landAndFreshwaterCounts: { [key: string]: number } = {};
    let totalLandAndFreshwater = 0;
    
    Object.keys(counts).forEach(k => {
      if (k !== 'saltwater') {
        landAndFreshwaterCounts[k] = counts[k] || 0;
        totalLandAndFreshwater += counts[k] || 0;
      }
    });
    
    const saltwaterCount = counts['saltwater'] || 0;
    
    console.log(`Island formation: ${totalLandAndFreshwater} land/freshwater tiles at center, ${saltwaterCount} saltwater tiles at edges`);

    // STEP 3: Assign tiles based on distance from center
    // Mountains in center, deserts at island edge, other biomes in between
    
    // Define biome priority by distance from center (innermost to outermost)
    const biomeDistancePriority: TerrainType[] = [
      'mountains',           // Innermost - center of island
      'tundra',
      'borealForest',
      'temperateForest',
      'tropicalRainforest',
      'freshwater',          // Lakes and rivers
      'temperateGrassland',
      'savanna',
      'pastureland',
      'cropland',
      'scrub',
      'urban',
      'deserts'              // Outermost - edge of island (like beaches/sand)
    ];
    
    let tileIndex = 0;
    
    // Place biomes from center outward according to priority
    for (const biomeKey of biomeDistancePriority) {
      if (!landAndFreshwaterCounts[biomeKey]) continue; // Skip if this biome has 0 tiles
      
      let remaining = landAndFreshwaterCounts[biomeKey] || 0;
      const biome = biomeKey as TerrainType;
      
      while (remaining > 0 && tileIndex < allTiles.length) {
        const tile = allTiles[tileIndex];
        const key = `${tile.worldX},${tile.worldZ}`;
        result.set(key, biome);
        occupied[tile.gz][tile.gx] = true;
        remaining--;
        tileIndex++;
      }
      
      if (remaining > 0) {
        console.warn(`Could not place all ${biomeKey} tiles, ${remaining} remaining`);
      }
    }
    
    // STEP 4: Fill remaining tiles (the outer ring) with saltwater
    while (tileIndex < allTiles.length) {
      const tile = allTiles[tileIndex];
      const key = `${tile.worldX},${tile.worldZ}`;
      result.set(key, 'saltwater' as TerrainType);
      occupied[tile.gz][tile.gx] = true;
      tileIndex++;
    }

    // Fill any remaining unassigned tiles with saltwater (safety net)
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
      console.log('Island clustering: All land and freshwater tiles placed toward center');
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