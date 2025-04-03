import { useHealthCheck } from "../lib/hooks/useHealthCheck";
import { Header } from "../components/Header";
import { LoadingCircle } from "../components/LoadingCircle";
import { STATES } from "../lib/constants";
import { motion, AnimatePresence } from "framer-motion";

const MAX_STABILITY_TIME = 7;

export default function HealthCheck() {
	const {
		currentState,
		stabilityTime,
		temperatureData,
		pulseData,
		alcoholData,
		secondsLeft,
		handleComplete,
	} = useHealthCheck();

	const state = STATES[currentState];

	let displayValue: string | number | null = "loading";
	if (currentState === "TEMPERATURE" && temperatureData?.temperature !== undefined) {
		displayValue = Number(temperatureData.temperature).toFixed(1);
	} 
	else if (currentState === "PULSE" && pulseData?.pulse !== undefined) {
		displayValue = Number(pulseData.pulse).toFixed(1);
	} 
	else if (currentState === "ALCOHOL" && alcoholData?.alcoholLevel) {
		displayValue = alcoholData.alcoholLevel;
		console.log("📡 Alcohol Level Displayed:", displayValue);
	}

	return (
		<div className="min-h-screen bg-black text-white flex flex-col">
			<Header />
			<motion.div className="flex-1 flex flex-col items-center justify-center p-6">
				<AnimatePresence mode="wait">
					<motion.div key={currentState} className="text-center">
						<motion.h1 className="text-xl md:text-2xl font-medium mb-2">
							{state.title}
						</motion.h1>
						<motion.p className="text-gray-400 mb-12">{state.subtitle}</motion.p>
					</motion.div>
				</AnimatePresence>

				<div className="flex flex-col items-center gap-4">
				<LoadingCircle
    key={currentState}
    icon={state.icon}
    value={displayValue}
    unit={state.unit}
    progress={
        currentState === "TEMPERATURE"
            ? (stabilityTime / MAX_STABILITY_TIME) * 100  // ✅ Temperature progresses normally
            : alcoholData.alcoholLevel !== "Не определено"
            ? 100  // ✅ Alcohol jumps to 100% once detected
            : 0  // ✅ Prevents alcohol from showing an incomplete progress bar
    }
    onComplete={handleComplete} // ✅ Triggers navigation only for alcohol
/>


					{displayValue === "loading" && (
						<span className="text-sm text-gray-400">
							{`Осталось ${secondsLeft} секунд`}
						</span>
					)}
				</div>
			</motion.div>
		</div>
	);
}
