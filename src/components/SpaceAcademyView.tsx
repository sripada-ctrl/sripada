import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Compass,
  Globe2,
  Rocket,
  Sparkles,
  Telescope,
} from 'lucide-react';
import {
  SPACE_ACADEMY_PLANETS,
  SPACE_ACADEMY_PUZZLES,
} from '../data/gameData';
import { GameProgressState, MissionDefinition } from '../types/game';
import { soundEngine } from '../utils/audio';

interface SpaceAcademyViewProps {
  progress: GameProgressState;
  orbitalMission: MissionDefinition;
  finalMission: MissionDefinition;
  finalMissionUnlocked: boolean;
  finalMissionLockReason?: string;
  onUpdateProgress: (updater: (prev: GameProgressState) => GameProgressState) => void;
  onLaunchMission: (mission: MissionDefinition) => void;
  onBackToEarth: () => void;
}

export const SpaceAcademyView: React.FC<SpaceAcademyViewProps> = ({
  progress,
  orbitalMission,
  finalMission,
  finalMissionUnlocked,
  finalMissionLockReason,
  onUpdateProgress,
  onLaunchMission,
  onBackToEarth,
}) => {
  const [selectedPlanetId, setSelectedPlanetId] = useState(SPACE_ACADEMY_PLANETS[0].id);
  const [selectedPuzzleId, setSelectedPuzzleId] = useState(SPACE_ACADEMY_PUZZLES[0].id);
  const [chosenOption, setChosenOption] = useState<number | null>(null);
  const [puzzleFeedback, setPuzzleFeedback] = useState<string | null>(null);
  const [thrusterAlign, setThrusterAlign] = useState(42);

  const activePlanet =
    SPACE_ACADEMY_PLANETS.find((p) => p.id === selectedPlanetId) ?? SPACE_ACADEMY_PLANETS[0];
  const activePuzzle =
    SPACE_ACADEMY_PUZZLES.find((p) => p.id === selectedPuzzleId) ?? SPACE_ACADEMY_PUZZLES[0];
  const isPuzzleSolved = progress.spacePuzzlesSolved.includes(activePuzzle.id);

  const handleSolvePuzzle = (idx: number) => {
    setChosenOption(idx);
    if (idx === activePuzzle.correctIndex) {
      soundEngine.upgrade();
      setPuzzleFeedback(activePuzzle.explanation);
      if (!isPuzzleSolved) {
        onUpdateProgress((prev) => ({
          ...prev,
          spacePuzzlesSolved: [...prev.spacePuzzlesSolved, activePuzzle.id],
          ecoPoints: prev.ecoPoints + activePuzzle.rewardEcoPoints,
          totalEcoPointsEarned: prev.totalEcoPointsEarned + activePuzzle.rewardEcoPoints,
        }));
      }
    } else {
      soundEngine.warning();
      setPuzzleFeedback('Telemetry mismatch — review the planetary climate mechanics and try again.');
    }
  };

  const handleCompleteTraining = () => {
    if (Math.abs(thrusterAlign - 75) <= 5) {
      soundEngine.missionComplete();
      onUpdateProgress((prev) => ({
        ...prev,
        spaceTrainingCompleted: true,
        ecoPoints: prev.spaceTrainingCompleted ? prev.ecoPoints : prev.ecoPoints + 80,
        totalEcoPointsEarned: prev.spaceTrainingCompleted
          ? prev.totalEcoPointsEarned
          : prev.totalEcoPointsEarned + 80,
      }));
    } else {
      soundEngine.warning();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="fixed inset-0 z-30 flex flex-col bg-[#040812] text-slate-100 overflow-y-auto"
    >
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#091120] border-b border-cyan-500/20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              soundEngine.click();
              onBackToEarth();
            }}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Earth Map
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-wide text-white">
              Space Academy & Orbital Research Centre
            </h1>
            <p className="text-xs text-cyan-300/80">
              World 3 · Astronaut Training, Planetary Science & Exo-Terra Launchpad
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400">Eco Points:</span>
            <span className="font-mono-num font-bold text-amber-300">{progress.ecoPoints}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto p-6 space-y-8">
        {/* Top Row: Astronaut Training + Orbital / Final Mission Launch */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Astronaut Training Calibration */}
          <div className="p-6 bg-[#091120] border border-cyan-500/25 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Compass className="w-5 h-5 text-cyan-400" />
                01. Astronaut Orbital Calibration
              </h2>
              <span className="text-xs font-mono-num text-emerald-400">
                {progress.spaceTrainingCompleted ? 'CERTIFIED' : 'TRAINING'}
              </span>
            </div>
            <p className="text-sm text-slate-300">
              Align the zero-gravity atmospheric probe thrusters to the optimal orbital resonance band (<span className="font-mono-num text-cyan-300">70% – 80%</span>) to earn astronaut certification.
            </p>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-xs font-mono-num text-slate-400">
                <span>Thruster Vector Alignment</span>
                <span className="text-cyan-300 font-bold">{thrusterAlign}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={thrusterAlign}
                onChange={(e) => setThrusterAlign(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
              />
              <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden relative border border-slate-800">
                <div
                  className="absolute top-0 bottom-0 bg-emerald-500/30 border-x border-emerald-400"
                  style={{ left: '70%', width: '10%' }}
                />
                <div
                  className="h-full bg-cyan-400 transition-all duration-100"
                  style={{ width: `${thrusterAlign}%` }}
                />
              </div>
            </div>

            <button
              onClick={handleCompleteTraining}
              className="px-4 py-2 text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors"
            >
              {progress.spaceTrainingCompleted ? 'Recalibrate Probe' : 'Verify Astronaut Calibration'}
            </button>
          </div>

          {/* Space Research Centre Launch Bay */}
          <div className="p-6 bg-[#091120] border border-emerald-500/25 rounded-2xl flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Rocket className="w-5 h-5 text-emerald-400" />
                02. Deep-Space Launch Bay
              </h2>
              <p className="text-sm text-slate-300">
                Deploy into Low-Earth Orbit to clear satellite debris, or launch the Final Mission to Exo-Terra once Gaia Convergence is restored.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => {
                  soundEngine.click();
                  onLaunchMission(orbitalMission);
                }}
                className="p-4 text-left bg-slate-900/90 hover:bg-slate-800 border border-cyan-500/40 rounded-xl transition-colors space-y-1"
              >
                <div className="text-xs font-mono-num text-cyan-300">ORBITAL STATION ZENITH</div>
                <div className="font-bold text-white">Enter Orbital Mission</div>
                <div className="text-xs text-slate-400">Clear debris & calibrate satellites</div>
              </button>

              <button
                onClick={() => {
                  if (!finalMissionUnlocked) return;
                  soundEngine.click();
                  onLaunchMission(finalMission);
                }}
                disabled={!finalMissionUnlocked}
                className={`p-4 text-left border rounded-xl transition-colors space-y-1 ${
                  finalMissionUnlocked
                    ? 'bg-emerald-950/50 hover:bg-emerald-900/60 border-emerald-400/60 cursor-pointer'
                    : 'bg-slate-900/50 border-slate-800 opacity-70 cursor-not-allowed'
                }`}
              >
                <div className="text-xs font-mono-num text-emerald-300">FINAL SPACE EXPLORATION</div>
                <div className="font-bold text-white">Exo-Terra Finale</div>
                <div className="text-xs text-slate-400">
                  {finalMissionUnlocked ? 'Ready for deep-space launch' : finalMissionLockReason}
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* Middle Row: Planetary Research Explorer */}
        <section className="p-6 bg-[#091120] border border-cyan-500/20 rounded-2xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Globe2 className="w-5 h-5 text-cyan-400" />
              03. Comparative Planetary Research
            </h2>
            <div className="flex flex-wrap gap-2">
              {SPACE_ACADEMY_PLANETS.map((planet) => (
                <button
                  key={planet.id}
                  onClick={() => {
                    soundEngine.click();
                    setSelectedPlanetId(planet.id);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    selectedPlanetId === planet.id
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {planet.name}
                </button>
              ))}
            </div>
          </div>

          <motion.div
            key={activePlanet.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-center"
          >
            {/* Procedural Planet Visual */}
            <div className="flex items-center justify-center p-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 38, repeat: Infinity, ease: 'linear' }}
                className="w-36 h-36 rounded-full shadow-2xl relative overflow-hidden border border-white/20"
                style={{
                  background: `radial-gradient(circle at 32% 32%, ${activePlanet.accent}, ${activePlanet.color} 68%, #020617 100%)`,
                }}
              >
                <div
                  className="absolute inset-0 opacity-35"
                  style={{
                    background:
                      'repeating-linear-gradient(25deg, transparent, transparent 14px, rgba(255,255,255,0.12) 14px, rgba(255,255,255,0.12) 22px)',
                  }}
                />
              </motion.div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-2xl font-bold text-white">{activePlanet.name}</h3>
                <span className="text-xs font-mono-num text-cyan-300">
                  {activePlanet.classification}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg">
                  <div className="text-slate-400">Atmosphere Composition</div>
                  <div className="text-slate-100 font-semibold mt-0.5">{activePlanet.atmosphere}</div>
                </div>
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg">
                  <div className="text-slate-400">Surface Temperature</div>
                  <div className="text-slate-100 font-semibold mt-0.5">{activePlanet.temperature}</div>
                </div>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{activePlanet.ecoLesson}</p>
            </div>
          </motion.div>
        </section>

        {/* Bottom Row: Space & Environmental Puzzles */}
        <section className="p-6 bg-[#091120] border border-cyan-500/20 rounded-2xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Telescope className="w-5 h-5 text-emerald-400" />
              04. Scientific Space Puzzles ({progress.spacePuzzlesSolved.length}/{SPACE_ACADEMY_PUZZLES.length} Solved)
            </h2>
            <div className="flex flex-wrap gap-2">
              {SPACE_ACADEMY_PUZZLES.map((pz) => {
                const solved = progress.spacePuzzlesSolved.includes(pz.id);
                return (
                  <button
                    key={pz.id}
                    onClick={() => {
                      soundEngine.click();
                      setSelectedPuzzleId(pz.id);
                      setChosenOption(null);
                      setPuzzleFeedback(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                      selectedPuzzleId === pz.id
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {solved && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {pz.title}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-xs font-mono-num text-cyan-300">
              {activePuzzle.category} · Reward +{activePuzzle.rewardEcoPoints} Eco Points
            </div>
            <p className="text-base font-medium text-white">{activePuzzle.prompt}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activePuzzle.options.map((opt, idx) => {
                const isSelected = chosenOption === idx;
                const isRight = idx === activePuzzle.correctIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSolvePuzzle(idx)}
                    className={`p-3.5 text-left text-sm rounded-xl border transition-colors ${
                      isSelected
                        ? isRight
                          ? 'bg-emerald-950/60 border-emerald-400 text-emerald-100'
                          : 'bg-rose-950/60 border-rose-400 text-rose-100'
                        : 'bg-slate-900/80 hover:bg-slate-800 border-slate-800 text-slate-200'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {(puzzleFeedback || isPuzzleSolved) && (
              <div className="p-3.5 bg-slate-900 border border-emerald-500/30 rounded-xl text-sm text-emerald-200">
                {puzzleFeedback ?? activePuzzle.explanation}
              </div>
            )}
          </div>
        </section>
      </main>
    </motion.div>
  );
};
