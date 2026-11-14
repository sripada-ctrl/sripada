import { MissionDefinition } from '../types/game';

export type WeatherKind =
  | 'clear'
  | 'mist'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'blizzard'
  | 'neon-rain'
  | 'bio-drift'
  | 'thermal-surge';

export interface WeatherState {
  kind: WeatherKind;
  label: string;
  temperatureC: number;
  precipitation: 'none' | 'rain' | 'snow' | 'bio';
  intensity: number;
  wetness: number;
  snowCover: number;
  fogBoost: number;
  sunDim: number;
  windX: number;
  windZ: number;
  hasLightning: boolean;
  tintHex: number;
}

export interface MissionClimateProfile {
  climateName: string;
  cycle: WeatherState[];
}

const WEATHER_PRESETS: Record<string, WeatherState> = {
  tropicalRain: {
    kind: 'rain',
    label: 'Tropical Rain',
    temperatureC: 24,
    precipitation: 'rain',
    intensity: 0.78,
    wetness: 0.85,
    snowCover: 0,
    fogBoost: 0.0045,
    sunDim: 0.62,
    windX: 2.2,
    windZ: 1.4,
    hasLightning: false,
    tintHex: 0x3b586d,
  },
  monsoonStorm: {
    kind: 'storm',
    label: 'Monsoon Thunderstorm',
    temperatureC: 22,
    precipitation: 'rain',
    intensity: 1.0,
    wetness: 1.0,
    snowCover: 0,
    fogBoost: 0.0072,
    sunDim: 0.44,
    windX: 5.5,
    windZ: 3.1,
    hasLightning: true,
    tintHex: 0x1e2d3d,
  },
  humidMist: {
    kind: 'mist',
    label: 'Canopy Sunbreak Mist',
    temperatureC: 27,
    precipitation: 'none',
    intensity: 0.2,
    wetness: 0.35,
    snowCover: 0,
    fogBoost: 0.0038,
    sunDim: 0.92,
    windX: 0.6,
    windZ: 0.4,
    hasLightning: false,
    tintHex: 0x76a4b8,
  },
  mountainSnow: {
    kind: 'snow',
    label: 'Alpine Snowfall',
    temperatureC: -4,
    precipitation: 'snow',
    intensity: 0.75,
    wetness: 0.15,
    snowCover: 0.72,
    fogBoost: 0.0052,
    sunDim: 0.76,
    windX: 1.8,
    windZ: -1.1,
    hasLightning: false,
    tintHex: 0xcbe2f6,
  },
  alpineBlizzard: {
    kind: 'blizzard',
    label: 'Mountain Blizzard',
    temperatureC: -11,
    precipitation: 'snow',
    intensity: 1.0,
    wetness: 0.1,
    snowCover: 1.0,
    fogBoost: 0.009,
    sunDim: 0.52,
    windX: 6.4,
    windZ: -3.2,
    hasLightning: false,
    tintHex: 0xdbeafe,
  },
  crispMountainClear: {
    kind: 'clear',
    label: 'Crisp Peak Sunlight',
    temperatureC: -1,
    precipitation: 'snow',
    intensity: 0.18,
    wetness: 0.08,
    snowCover: 0.48,
    fogBoost: 0.0008,
    sunDim: 1.0,
    windX: 0.8,
    windZ: -0.4,
    hasLightning: false,
    tintHex: 0x93c5fd,
  },
  neonRain: {
    kind: 'neon-rain',
    label: 'Neon City Rain',
    temperatureC: 16,
    precipitation: 'rain',
    intensity: 0.82,
    wetness: 0.92,
    snowCover: 0,
    fogBoost: 0.0036,
    sunDim: 0.72,
    windX: -2.4,
    windZ: 1.6,
    hasLightning: false,
    tintHex: 0x162447,
  },
  cyberStorm: {
    kind: 'storm',
    label: 'Electric Squall',
    temperatureC: 14,
    precipitation: 'rain',
    intensity: 1.0,
    wetness: 1.0,
    snowCover: 0,
    fogBoost: 0.006,
    sunDim: 0.55,
    windX: -4.8,
    windZ: 2.9,
    hasLightning: true,
    tintHex: 0x1e1b4b,
  },
  cyberClear: {
    kind: 'mist',
    label: 'Humid Bay Haze',
    temperatureC: 19,
    precipitation: 'none',
    intensity: 0.12,
    wetness: 0.45,
    snowCover: 0,
    fogBoost: 0.002,
    sunDim: 0.94,
    windX: -0.8,
    windZ: 0.5,
    hasLightning: false,
    tintHex: 0x22253a,
  },
  meadowBreeze: {
    kind: 'clear',
    label: 'Sunny Meadow Breeze',
    temperatureC: 21,
    precipitation: 'none',
    intensity: 0,
    wetness: 0.05,
    snowCover: 0,
    fogBoost: 0,
    sunDim: 1.0,
    windX: 1.1,
    windZ: 0.5,
    hasLightning: false,
    tintHex: 0x7ab0d8,
  },
  townDrizzle: {
    kind: 'rain',
    label: 'Passing Shower',
    temperatureC: 15,
    precipitation: 'rain',
    intensity: 0.62,
    wetness: 0.72,
    snowCover: 0,
    fogBoost: 0.0034,
    sunDim: 0.74,
    windX: 2.4,
    windZ: 1.2,
    hasLightning: false,
    tintHex: 0x4c6275,
  },
  cycloneSquall: {
    kind: 'storm',
    label: 'Cyclone Storm Surge',
    temperatureC: 25,
    precipitation: 'rain',
    intensity: 1.0,
    wetness: 1.0,
    snowCover: 0,
    fogBoost: 0.0082,
    sunDim: 0.42,
    windX: 6.8,
    windZ: 3.4,
    hasLightning: true,
    tintHex: 0x1b2b3d,
  },
  bioDrift: {
    kind: 'bio-drift',
    label: 'Bioluminescent Plankton Drift',
    temperatureC: 20,
    precipitation: 'bio',
    intensity: 0.75,
    wetness: 0,
    snowCover: 0,
    fogBoost: 0.001,
    sunDim: 0.96,
    windX: 1.2,
    windZ: 0.6,
    hasLightning: false,
    tintHex: 0x06374f,
  },
  thermalSurge: {
    kind: 'thermal-surge',
    label: 'Deep-Current Thermal Plume',
    temperatureC: 29,
    precipitation: 'bio',
    intensity: 1.0,
    wetness: 0,
    snowCover: 0,
    fogBoost: 0.0035,
    sunDim: 0.84,
    windX: 3.2,
    windZ: -1.8,
    hasLightning: false,
    tintHex: 0x04283b,
  },
  orbitalSolarWind: {
    kind: 'clear',
    label: 'Solar Wind Aurora',
    temperatureC: -120,
    precipitation: 'bio',
    intensity: 0.45,
    wetness: 0,
    snowCover: 0,
    fogBoost: 0,
    sunDim: 1.0,
    windX: 2.5,
    windZ: 1.0,
    hasLightning: false,
    tintHex: 0x030712,
  },
};

export function getMissionClimateProfile(
  mission: MissionDefinition,
  theme: 'tokyo-cyber' | 'coral-reef' | 'forest' | 'town' | 'space'
): MissionClimateProfile {
  if (theme === 'space') {
    return {
      climateName: 'Low-Earth Orbit Vacuum',
      cycle: [WEATHER_PRESETS.orbitalSolarWind],
    };
  }

  if (theme === 'coral-reef') {
    return {
      climateName: `${mission.region} Subsea Current`,
      cycle: [WEATHER_PRESETS.bioDrift, WEATHER_PRESETS.thermalSurge, WEATHER_PRESETS.bioDrift],
    };
  }

  if (theme === 'tokyo-cyber') {
    return {
      climateName: 'Tokyo Bay Maritime Cyberfront',
      cycle: [WEATHER_PRESETS.neonRain, WEATHER_PRESETS.cyberStorm, WEATHER_PRESETS.cyberClear],
    };
  }

  // Mountain / High-Latitude / Alpine Sectors (Taiga, Sierra Ridge, Iceland Vault, Eurasian Steppe)
  const locLower = `${mission.locationName} ${mission.title} ${mission.region}`.toLowerCase();
  const isMountainOrArctic =
    Math.abs(mission.lat) >= 49 ||
    locLower.includes('ridge') ||
    locLower.includes('mountain') ||
    locLower.includes('taiga') ||
    locLower.includes('iceland') ||
    locLower.includes('steppe');

  if (isMountainOrArctic) {
    return {
      climateName: 'Alpine / Boreal Cold Front',
      cycle: [
        WEATHER_PRESETS.mountainSnow,
        WEATHER_PRESETS.alpineBlizzard,
        WEATHER_PRESETS.crispMountainClear,
      ],
    };
  }

  // Disaster Floods & Cyclone
  if (mission.arenaConfig.isDisaster && mission.id.includes('flood')) {
    return {
      climateName: 'Coastal Monsoon Cyclone',
      cycle: [WEATHER_PRESETS.cycloneSquall, WEATHER_PRESETS.monsoonStorm, WEATHER_PRESETS.tropicalRain],
    };
  }

  // Tropical & Temperate Forests (Amazon Basin, Equatorial Hub)
  if (theme === 'forest') {
    return {
      climateName: `${mission.region} Rainforest`,
      cycle: [WEATHER_PRESETS.tropicalRain, WEATHER_PRESETS.monsoonStorm, WEATHER_PRESETS.humidMist],
    };
  }

  // Temperate Towns & Deltas
  return {
    climateName: `${mission.region} Temperate Skies`,
    cycle: [WEATHER_PRESETS.townDrizzle, WEATHER_PRESETS.meadowBreeze, WEATHER_PRESETS.tropicalRain],
  };
}
