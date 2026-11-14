export type WorldId = 'earth-restoration' | 'disaster-survival' | 'space-academy';

export type MissionCategory =
  | 'polluted-city'
  | 'damaged-forest'
  | 'polluted-ocean'
  | 'contaminated-water'
  | 'secret-lab'
  | 'toxic-bunker'
  | 'natural-disaster'
  | 'secret-global'
  | 'space-academy'
  | 'final-space';

export type Difficulty = 'Standard' | 'Moderate' | 'High' | 'Critical';

export type ScreenMode =
  | 'opening'
  | 'world-map'
  | 'mission-active'
  | 'space-academy'
  | 'ending-cinematic';

export type ModalTab =
  | null
  | 'main-menu'
  | 'missions'
  | 'tech-tree'
  | 'inventory'
  | 'profile'
  | 'settings';

export type TechCategory =
  | 'backpack'
  | 'robot'
  | 'environmental'
  | 'rescue';

export interface TechUpgrade {
  id: string;
  name: string;
  category: TechCategory;
  cost: number;
  prerequisiteId?: string;
  description: string;
  effectSummary: string;
  tier: 1 | 2 | 3;
}

export interface MissionDefinition {
  id: string;
  title: string;
  locationName: string;
  region: string;
  world: WorldId;
  category: MissionCategory;
  /** Latitude in degrees (-90 to 90) */
  lat: number;
  /** Longitude in degrees (-180 to 180) */
  lng: number;
  difficulty: Difficulty;
  problemSummary: string;
  objectives: string[];
  rewardEcoPoints: number;
  rewardBonusNote: string;
  unlockRequirement: {
    minEcoPoints?: number;
    minCompletedCount?: number;
    requiredMissionIds?: string[];
    requiresGlobalProgress?: number;
    requiresLabClues?: number;
  };
  /** Visual/gameplay config for the interactive mission arena */
  arenaConfig: {
    rubbishCount: number;
    treesToPlant: number;
    coralsToRestore: number;
    equipmentToRepair: number;
    hiddenItemsCount: number;
    hasRecyclingMachine: boolean;
    hasSecretLab?: boolean;
    isDisaster?: boolean;
    disasterType?: 'Floods & Cyclone' | 'Wildfires, Quakes & Drought';
    isToxicBunker?: boolean;
    isSpaceMission?: boolean;
    isFinalMission?: boolean;
    biomePrimary: string;
    biomeRestored: string;
    biomeTheme?: 'tokyo-cyber' | 'coral-reef' | 'forest' | 'town' | 'space';
    smogStacksToStop?: number;
    runoffPipesToSeal?: number;
  };
}

export interface SquadMember {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'needs-rescue' | 'safe';
  x: number;
  y: number;
}

export interface PlayerSettings {
  soundEnabled: boolean;
  soundVolume: number;
  autoRotateGlobe: boolean;
  highDetailParticles: boolean;
  graphicsQuality?: 'high' | 'ultra';
}

export interface GameProgressState {
  playerName: string;
  ecoPoints: number;
  scrap: number;
  totalEcoPointsEarned: number;
  totalWasteRecycled: number;
  totalTreesPlanted: number;
  totalCoralsRestored: number;
  teammatesRescued: number;
  backpackLevel: 1 | 2 | 3 | 4;
  backpackMaxCapacity: number;
  currentBackpackItems: number;
  robotUnlocked: boolean;
  completedMissionIds: string[];
  discoveredLabIds: string[];
  labCluesFound: number;
  unlockedTechIds: string[];
  unlockedVehicles: string[];
  activeVehicleId: string | null;
  spaceTrainingCompleted: boolean;
  spacePuzzlesSolved: string[];
  endingAchieved: boolean;
  settings: PlayerSettings;
}

export interface RemotePlayerState {
  id: string;
  name: string;
  color: string;
  screenMode: ScreenMode;
  lat: number;
  lng: number;
  activeMissionId: string | null;
  arenaX: number;
  arenaZ: number;
  vehicleId: string | null;
  ecoPoints: number;
}

export interface SquadChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface SectorPingEvent {
  id: string;
  missionId: string;
  lat: number;
  lng: number;
  title: string;
  byPlayerName: string;
  color: string;
  createdAt: number;
}

export interface MissionCoopState {
  missionId: string;
  completedNodeIds: string[];
  bunkerFound: boolean;
  labDiscovered: boolean;
}

