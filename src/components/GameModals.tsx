import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  CheckCircle2,
  Compass,
  FlaskConical,
  Globe2,
  Lock,
  Nut,
  Package,
  Radio,
  Recycle,
  Rocket,
  Settings,
  ShieldAlert,
  Sparkles,
  Sun,
  Trees,
  User,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import {
  BACKPACK_LEVELS,
  MISSIONS,
  TECH_UPGRADES,
  isMissionUnlocked,
} from '../data/gameData';
import {
  GameProgressState,
  MissionDefinition,
  ModalTab,
  TechCategory,
} from '../types/game';
import { soundEngine } from '../utils/audio';

interface GameModalsProps {
  activeModal: ModalTab;
  progress: GameProgressState;
  globalProgressPct: number;
  onClose: () => void;
  onSwitchModal: (tab: ModalTab) => void;
  onStartWorldMap: () => void;
  onOpenSpaceAcademy: () => void;
  onSelectMission: (mission: MissionDefinition) => void;
  onEnterMission?: (mission: MissionDefinition) => void;
  onPurchaseUpgrade: (upgradeId: string) => void;
  onUpdateProgress: (updater: (prev: GameProgressState) => GameProgressState) => void;
  onResetProgress: () => void;
}

const CATEGORY_META: Record<TechCategory, { label: string; icon: React.ReactNode }> = {
  backpack: { label: 'Backpack Technology', icon: <Package className="w-4 h-4 text-emerald-400" /> },
  robot: { label: 'Robot Technology', icon: <Bot className="w-4 h-4 text-cyan-400" /> },
  environmental: { label: 'Environmental Technology', icon: <Trees className="w-4 h-4 text-green-400" /> },
  rescue: { label: 'Rescue Technology', icon: <ShieldAlert className="w-4 h-4 text-amber-400" /> },
};

export const GameModals: React.FC<GameModalsProps> = ({
  activeModal,
  progress,
  globalProgressPct,
  onClose,
  onSwitchModal,
  onStartWorldMap,
  onOpenSpaceAcademy,
  onSelectMission,
  onEnterMission,
  onPurchaseUpgrade,
  onUpdateProgress,
  onResetProgress,
}) => {
  const [techFilter, setTechFilter] = useState<TechCategory>('backpack');
  const [worldFilter, setWorldFilter] = useState<'all' | 'earth-restoration' | 'disaster-survival' | 'space-academy'>('all');
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <AnimatePresence>
      {activeModal && (
        <motion.div
          key="game-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/65 p-4"
        >
          <motion.div
            key={activeModal}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#091120]/95 border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden"
          >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#070e1c]">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-wide text-white">
              {activeModal === 'main-menu' && 'Project Eclipse — Command Menu'}
              {activeModal === 'missions' && 'Global Missions Directory'}
              {activeModal === 'tech-tree' && 'Technology Tree & Upgrades'}
              {activeModal === 'inventory' && 'Inventory, Backpack & Vehicles'}
              {activeModal === 'profile' && 'Commander Profile & Global Impact'}
              {activeModal === 'settings' && 'System & Audio Settings'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-900 border border-orange-500/30 rounded-lg text-xs">
              <Nut className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-mono-num font-bold text-orange-300">{progress.scrap} Scrap</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono-num font-bold text-amber-300">{progress.ecoPoints} EP</span>
            </div>
            <button
              onClick={() => {
                soundEngine.click();
                onClose();
              }}
              aria-label="Close panel"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. MAIN MENU */}
          {activeModal === 'main-menu' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-cyan-500/10 border border-amber-400/30">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-orange-600 shadow-[0_0_24px_rgba(251,191,36,0.55)] flex items-center justify-center shrink-0">
                    <Sun className="w-5 h-5 text-amber-950" />
                  </div>
                  <div>
                    <div className="text-xs font-mono-num uppercase tracking-wider text-amber-300">
                      Sol System · Orbit Telemetry Active
                    </div>
                    <div className="text-sm font-semibold text-slate-100">
                      Planetary Restoration: {globalProgressPct}% · Commander {progress.playerName}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                onClick={() => {
                  soundEngine.click();
                  onStartWorldMap();
                  onClose();
                }}
                className="flex items-center justify-between p-4 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/50 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">START GAME</div>
                  <div className="text-xs text-emerald-200/80">Enter the interactive 3D Earth mission hub</div>
                </div>
                <Globe2 className="w-6 h-6 text-emerald-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onStartWorldMap();
                  onClose();
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">WORLD MAP</div>
                  <div className="text-xs text-slate-400">Rotate, zoom & inspect global markers</div>
                </div>
                <Compass className="w-6 h-6 text-cyan-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onSwitchModal('missions');
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">MISSIONS</div>
                  <div className="text-xs text-slate-400">Browse all 14 missions across 3 worlds</div>
                </div>
                <Radio className="w-6 h-6 text-cyan-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onSwitchModal('tech-tree');
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">TECHNOLOGY TREE</div>
                  <div className="text-xs text-slate-400">Unlock Robot Companion, Backpack & Vehicles</div>
                </div>
                <Wrench className="w-6 h-6 text-amber-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onSwitchModal('inventory');
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">INVENTORY</div>
                  <div className="text-xs text-slate-400">Backpack storage, Recycler & Rescue Vehicles</div>
                </div>
                <Package className="w-6 h-6 text-emerald-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onSwitchModal('profile');
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">PLAYER PROFILE</div>
                  <div className="text-xs text-slate-400">Career restoration stats & callsign</div>
                </div>
                <User className="w-6 h-6 text-cyan-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onOpenSpaceAcademy();
                  onClose();
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">SPACE ACADEMY</div>
                  <div className="text-xs text-slate-400">Astronaut training, planets & puzzles</div>
                </div>
                <Rocket className="w-6 h-6 text-cyan-400" />
              </button>

              <button
                onClick={() => {
                  soundEngine.click();
                  onSwitchModal('settings');
                }}
                className="flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition-colors"
              >
                <div>
                  <div className="font-bold text-white text-base">SETTINGS</div>
                  <div className="text-xs text-slate-400">Audio, globe rotation & save management</div>
                </div>
                <Settings className="w-6 h-6 text-slate-300" />
              </button>
              </div>
            </div>
          )}

          {/* 2. MISSIONS DIRECTORY */}
          {activeModal === 'missions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'all', label: 'All Worlds (14)' },
                    { id: 'earth-restoration', label: 'Earth Restoration' },
                    { id: 'disaster-survival', label: 'Disaster Survival (15%)' },
                    { id: 'space-academy', label: 'Space Academy' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setWorldFilter(tab.id as typeof worldFilter)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                        worldFilter === tab.id
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="text-xs font-mono-num text-emerald-300">
                  Global Restoration: {globalProgressPct}%
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {MISSIONS.filter((m) => worldFilter === 'all' || m.world === worldFilter).map((m) => {
                  const completed = progress.completedMissionIds.includes(m.id);
                  const { unlocked, reason } = isMissionUnlocked(m, progress, globalProgressPct);
                  return (
                    <div
                      key={m.id}
                      className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">{m.locationName}</span>
                          <span
                            className={`font-mono-num font-bold ${
                              completed
                                ? 'text-emerald-400'
                                : unlocked
                                ? 'text-rose-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {completed ? 'RESTORED' : unlocked ? 'ACTIVE' : 'LOCKED'}
                          </span>
                        </div>
                        <h3 className="font-bold text-white text-base">{m.title}</h3>
                        <p className="text-xs text-slate-300 leading-relaxed">{m.problemSummary}</p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                        <span className="text-xs font-mono-num text-amber-300">
                          +{m.rewardEcoPoints} Eco Points
                        </span>
                        {unlocked ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                soundEngine.click();
                                onSelectMission(m);
                                onClose();
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-cyan-500/35 text-cyan-200 rounded-lg transition-colors cursor-pointer"
                            >
                              Locate
                            </button>
                            {onEnterMission && (
                              <button
                                onClick={() => {
                                  soundEngine.upgrade();
                                  onEnterMission(m);
                                  onClose();
                                }}
                                className="px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                              >
                                {completed ? 'Replay' : 'Enter'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-amber-300/90 max-w-[190px] truncate" title={reason}>
                            <Lock className="w-3 h-3 shrink-0" />
                            {reason}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. TECHNOLOGY TREE */}
          {activeModal === 'tech-tree' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CATEGORY_META) as TechCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      soundEngine.click();
                      setTechFilter(cat);
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                      techFilter === cat
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-900 text-slate-200 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {CATEGORY_META[cat].icon}
                    {CATEGORY_META[cat].label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TECH_UPGRADES.filter((u) => u.category === techFilter).map((u) => {
                  const unlocked = progress.unlockedTechIds.includes(u.id);
                  const prereqMet =
                    !u.prerequisiteId || progress.unlockedTechIds.includes(u.prerequisiteId);
                  const canAfford = progress.ecoPoints >= u.cost;
                  const prereqName = u.prerequisiteId
                    ? TECH_UPGRADES.find((x) => x.id === u.prerequisiteId)?.name
                    : null;

                  return (
                    <div
                      key={u.id}
                      className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                        unlocked
                          ? 'bg-emerald-950/30 border-emerald-500/40'
                          : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono-num text-cyan-300">Tier {u.tier}</span>
                          <span className="font-mono-num font-bold text-amber-300">
                            {unlocked ? 'UNLOCKED' : `${u.cost} Eco Points`}
                          </span>
                        </div>
                        <h3 className="font-bold text-white text-base">{u.name}</h3>
                        <p className="text-xs text-slate-300">{u.description}</p>
                        <div className="text-xs font-semibold text-emerald-300 pt-1">
                          Effect: {u.effectSummary}
                        </div>
                        {!prereqMet && prereqName && (
                          <div className="text-[11px] text-amber-400">
                            Requires: {prereqName}
                          </div>
                        )}
                      </div>

                      <div className="pt-2">
                        {unlocked ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" />
                            Installed & Active
                          </div>
                        ) : (
                          <button
                            onClick={() => onPurchaseUpgrade(u.id)}
                            disabled={!prereqMet || !canAfford}
                            className={`w-full py-2 px-4 text-xs font-semibold rounded-lg transition-colors ${
                              prereqMet && canAfford
                                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {!prereqMet
                              ? 'Prerequisite Locked'
                              : !canAfford
                              ? `Need ${u.cost - progress.ecoPoints} more EP`
                              : `Unlock for ${u.cost} EP`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. INVENTORY & BACKPACK */}
          {activeModal === 'inventory' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                    <Package className="w-4 h-4" />
                    BACKPACK STORAGE
                  </div>
                  <div className="text-2xl font-bold font-mono-num text-white">
                    {progress.currentBackpackItems} / {progress.backpackMaxCapacity}
                  </div>
                  <div className="text-xs text-slate-400">
                    {BACKPACK_LEVELS[progress.backpackLevel].label}
                  </div>
                  <button
                    onClick={() => onSwitchModal('tech-tree')}
                    className="text-xs text-cyan-400 hover:underline font-medium"
                  >
                    Upgrade capacity in Tech Tree
                  </button>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                    <Recycle className="w-4 h-4" />
                    AUTOMATIC RECYCLER
                  </div>
                  <div className="text-2xl font-bold font-mono-num text-white">
                    {progress.totalWasteRecycled} units
                  </div>
                  <div className="text-xs text-slate-400">
                    {progress.unlockedTechIds.includes('env-recycler')
                      ? 'Plasma Catalytic Core (+40% Eco Points)'
                      : 'Standard Sorting Drum'}
                  </div>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-400">
                    <FlaskConical className="w-4 h-4" />
                    SECRET LAB ARCHIVES
                  </div>
                  <div className="text-2xl font-bold font-mono-num text-white">
                    {progress.labCluesFound} Clues
                  </div>
                  <div className="text-xs text-slate-400">
                    {progress.discoveredLabIds.length} Hidden Laboratories Discovered
                  </div>
                </div>
              </div>

              {/* Equipment & Vehicles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">
                  Equipment, Companion & Emergency Rescue Vehicles
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 bg-slate-900/90 border border-orange-500/30 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-sm">Rusty Grabber</div>
                      <div className="text-xs text-slate-400">Starter salvage claw for collecting polluted trash & debris</div>
                    </div>
                    <span className="text-xs font-mono-num text-emerald-400">EQUIPPED</span>
                  </div>

                  <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-sm">Pollution Scanner</div>
                      <div className="text-xs text-slate-400">Reveals hidden waste, toxic zones & bunkers</div>
                    </div>
                    <span className="text-xs font-mono-num text-emerald-400">EQUIPPED</span>
                  </div>

                  <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-sm">Robot Companion (E.C.H.O.-7)</div>
                      <div className="text-xs text-slate-400">Detects waste, offers hints & collects items</div>
                    </div>
                    <span className={`text-xs font-mono-num ${progress.robotUnlocked ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {progress.robotUnlocked ? 'ONLINE' : 'LOCKED'}
                    </span>
                  </div>

                  {[
                    { id: 'vehicle-boat', name: 'Hydro-Jet Rescue Boat', desc: 'Rapid floodwater rescue & ocean navigation' },
                    { id: 'vehicle-transport', name: 'All-Terrain Eco-Rover', desc: 'High-speed overland hazard transport' },
                    { id: 'vehicle-heli', name: 'Stratosphere Rescue Helicopter', desc: 'Airlift evacuation over wildfires & quakes' },
                  ].map((v) => {
                    const owned = progress.unlockedVehicles.includes(v.id);
                    const active = progress.activeVehicleId === v.id;
                    return (
                      <div
                        key={v.id}
                        className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="font-semibold text-white text-sm">{v.name}</div>
                          <div className="text-xs text-slate-400">{v.desc}</div>
                        </div>
                        {owned ? (
                          <button
                            onClick={() => {
                              soundEngine.click();
                              onUpdateProgress((p) => ({
                                ...p,
                                activeVehicleId: active ? null : v.id,
                              }));
                            }}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap ${
                              active
                                ? 'bg-emerald-500 text-slate-950'
                                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                            }`}
                          >
                            {active ? 'Equipped' : 'Equip'}
                          </button>
                        ) : (
                          <span className="text-xs font-mono-num text-slate-500">Tech Tree</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 5. PLAYER PROFILE */}
          {activeModal === 'profile' && (
            <div className="space-y-5">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 block">Commander Callsign</label>
                  <input
                    type="text"
                    value={progress.playerName}
                    maxLength={28}
                    onChange={(e) =>
                      onUpdateProgress((p) => ({ ...p, playerName: e.target.value }))
                    }
                    className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-semibold text-sm focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">Planetary Rank</div>
                  <div className="text-lg font-bold text-cyan-300">
                    {progress.endingAchieved
                      ? 'Eclipse Guardian'
                      : globalProgressPct >= 60
                      ? 'Senior Biosphere Director'
                      : globalProgressPct >= 25
                      ? 'Eco-Field Specialist'
                      : 'Cadet Pathfinder'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-sm">
                {[
                  { label: 'Global Restoration', value: `${globalProgressPct}%` },
                  { label: 'Missions Restored', value: `${progress.completedMissionIds.length} / ${MISSIONS.length}` },
                  { label: 'Lifetime Eco Points', value: `${progress.totalEcoPointsEarned}` },
                  { label: 'Waste Recycled', value: `${progress.totalWasteRecycled} items` },
                  { label: 'Trees & Corals Restored', value: `${progress.totalTreesPlanted + progress.totalCoralsRestored}` },
                  { label: 'Teammates Rescued', value: `${progress.teammatesRescued}` },
                ].map((stat) => (
                  <div key={stat.label} className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
                    <div className="text-xs text-slate-400">{stat.label}</div>
                    <div className="text-xl font-bold font-mono-num text-white mt-1">{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. SETTINGS */}
          {activeModal === 'settings' && (
            <div className="space-y-5">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-white text-sm">Synthesized Game Audio</div>
                    <div className="text-xs text-slate-400">Web Audio chimes, scanner sonar, and mission alerts</div>
                  </div>
                  <button
                    onClick={() =>
                      onUpdateProgress((p) => ({
                        ...p,
                        settings: { ...p.settings, soundEnabled: !p.settings.soundEnabled },
                      }))
                    }
                    className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg ${
                      progress.settings.soundEnabled
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {progress.settings.soundEnabled ? (
                      <>
                        <Volume2 className="w-4 h-4" /> Enabled
                      </>
                    ) : (
                      <>
                        <VolumeX className="w-4 h-4" /> Muted
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Audio Volume</span>
                    <span className="font-mono-num">{Math.round(progress.settings.soundVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(progress.settings.soundVolume * 100)}
                    onChange={(e) =>
                      onUpdateProgress((p) => ({
                        ...p,
                        settings: { ...p.settings, soundVolume: Number(e.target.value) / 100 },
                      }))
                    }
                    className="w-full accent-cyan-400"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div>
                    <div className="font-semibold text-white text-sm">Auto-Rotate 3D Earth</div>
                    <div className="text-xs text-slate-400">Slowly spin the planet when no marker is selected</div>
                  </div>
                  <button
                    onClick={() =>
                      onUpdateProgress((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          autoRotateGlobe: !p.settings.autoRotateGlobe,
                        },
                      }))
                    }
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                      progress.settings.autoRotateGlobe
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {progress.settings.autoRotateGlobe ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div>
                    <div className="font-semibold text-white text-sm">3D Graphics Fidelity</div>
                    <div className="text-xs text-slate-400">Ultra enables 3K planetary maps & 4x MSAA post-processing</div>
                  </div>
                  <button
                    onClick={() => {
                      soundEngine.click();
                      onUpdateProgress((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          graphicsQuality: p.settings.graphicsQuality === 'high' ? 'ultra' : 'high',
                        },
                      }));
                    }}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                      progress.settings.graphicsQuality !== 'high'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-cyan-500 text-slate-950'
                    }`}
                  >
                    {progress.settings.graphicsQuality === 'high' ? 'High (2K)' : 'Ultra (3K · MSAA)'}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div>
                    <div className="font-semibold text-white text-sm">High-Detail Space & Biome Particles</div>
                    <div className="text-xs text-slate-400">Dense starfields, orbital ice dust, embers & fireflies</div>
                  </div>
                  <button
                    onClick={() => {
                      soundEngine.click();
                      onUpdateProgress((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          highDetailParticles: !p.settings.highDetailParticles,
                        },
                      }));
                    }}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                      progress.settings.highDetailParticles
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {progress.settings.highDetailParticles ? 'On' : 'Standard'}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-rose-500/30 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-white text-sm">Reset Local Campaign Progress</div>
                  <div className="text-xs text-slate-400">Clears saved missions, Eco Points, and upgrades</div>
                </div>
                {!confirmReset ? (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="px-3.5 py-2 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-lg"
                  >
                    Reset Progress
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onResetProgress();
                        setConfirmReset(false);
                        onClose();
                      }}
                      className="px-3.5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg"
                    >
                      Confirm Reset
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="px-3 py-2 text-xs font-semibold bg-slate-800 text-slate-300 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
