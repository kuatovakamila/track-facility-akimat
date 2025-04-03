import { useHealthCheck } from "../lib/hooks/useHealthCheck";
import { Header } from "../components/Header";
import { LoadingCircle } from "../components/LoadingCircle";
import { STATES } from "../lib/constants";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const MAX_STABILITY_TIME = 7;

export default function HealthCheck() {
	const {
		currentState,
		stabilityTime,
		temperatureData,
		pulseData,
		alcoholData,
		sensorReady,
		secondsLeft,
		handleComplete,
	} = useHealthCheck();

	const state = STATES[currentState];

	const displayValue =
		currentState === "TEMPERATURE"
			? temperatureData.temperature.toFixed(1) + "°C"
			: currentState === "PULSE"
			? pulseData.pulse.toFixed(0) + " уд/мин"
			: currentState === "ALCOHOL" && alcoholData.alcoholLevel
			? alcoholData.alcoholLevel
			: "Нет данных";

	const [countdown, setCountdown] = useState(secondsLeft);
	const [countdownStarted, setCountdownStarted] = useState(false);

	useEffect(() => {
		if (currentState === "ALCOHOL" && sensorReady && !countdownStarted) {
			setCountdownStarted(true);
			setCountdown(secondsLeft);

			const timer = setInterval(() => {
				setCountdown((prev) => {
					if (prev > 0) return prev - 1;
					clearInterval(timer);
					return 0;
				});
			}, 1000);

			return () => clearInterval(timer);
		}
	}, [sensorReady, countdownStarted, currentState, secondsLeft]);

	return (
		<div className="min-h-screen bg-black text-white flex flex-col">
			<Header />
			<motion.div className="flex-1 flex flex-col items-center justify-center p-6">
				<AnimatePresence mode="wait">
					<motion.div key={currentState} className="text-center">
						{currentState === "ALCOHOL" && !sensorReady ? (
							<>
								<motion.h1 className="text-xl md:text-2xl font-medium mb-2">
									Ожидание сенсора...
								</motion.h1>
								<motion.p className="text-gray-400 mb-12">
									Пожалуйста, подождите...
								</motion.p>
							</>
						) : (
							<>
								<motion.h1 className="text-xl md:text-2xl font-medium mb-2">
									{state.title}
								</motion.h1>
								{currentState === "ALCOHOL" && countdown > 0 ? (
									<motion.p className="text-lg text-yellow-400 mb-4">
										Осталось {countdown} сек
									</motion.p>
								) : (
									<motion.p className="text-gray-400 mb-4">
										{state.subtitle}
									</motion.p>
								)}
							</>
						)}
					</motion.div>
				</AnimatePresence>

				<div className="relative flex items-center justify-center">
					<LoadingCircle
						key={currentState}
						icon={state.icon}
						value={displayValue}
						unit={state.unit}
						progress={
							currentState === "TEMPERATURE"
								? (stabilityTime / MAX_STABILITY_TIME) * 100
								: currentState === "PULSE"
								? (stabilityTime / MAX_STABILITY_TIME) * 100
								: currentState === "ALCOHOL" &&
								  alcoholData.alcoholLevel !== "Не определено"
								? 100
								: 0
						}
						onComplete={handleComplete}
					/>
					<motion.p
						className="absolute top-[50%] md:top-[53%] text-xs md:text-sm font-medium text-white"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
					>
						{displayValue}
					</motion.p>
				</div>
			</motion.div>
		</div>
	);
}

