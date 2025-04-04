import { useHealthCheck } from "../lib/hooks/useHealthCheck";
import { useEffect, useState } from "react";
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
        sensorReady,
        secondsLeft,
        handleComplete,
    } = useHealthCheck();

    const state = STATES[currentState];

    const displayValue =
        currentState === "TEMPERATURE"
            ? `${temperatureData.temperature.toFixed(1)}°C`
            : currentState === "PULSE"
            ? `${pulseData.pulse.toFixed(1)} Уд/мин`
            : currentState === "ALCOHOL"
            ? alcoholData.alcoholLevel
            : "Нет данных";

    // Таймер обратного отсчета (для ALCOHOL)
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

    // Логирование (опционально)
    useEffect(() => {
        console.log("🌡️ Температура:", temperatureData.temperature);
        console.log("🫀 Пульс:", pulseData.pulse);
        console.log("🍷 Alcohol:", alcoholData.alcoholLevel);
        console.log("📍 Состояние:", currentState);
    }, [temperatureData, pulseData, alcoholData, currentState]);

    // Прогресс круга
    const progress =
        currentState === "TEMPERATURE"
            ? (stabilityTime / MAX_STABILITY_TIME) * 100
            : currentState === "PULSE"
            ? (stabilityTime / MAX_STABILITY_TIME) * 100
            : currentState === "ALCOHOL" && alcoholData.alcoholLevel !== "Не определено"
            ? 100
            : 0;

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

                                {currentState === "ALCOHOL" && sensorReady && countdown > 0 ? (
                                    <motion.p className="text-lg text-yellow-400 mb-4">
                                        Осталось {countdown} секунд
                                    </motion.p>
                                ) : (
                                    <motion.p className="text-gray-400 mb-4">
                                        {currentState === "ALCOHOL"
                                            ? "Подуйте 3-4 секунды"
                                            : state.subtitle}
                                    </motion.p>
                                )}
                            </>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* 🌀 Один LoadingCircle в зависимости от состояния */}
                <div className="relative flex items-center justify-center mt-6">
                {currentState === "TEMPERATURE" && (
  <LoadingCircle
    icon={state.icon}
    value={temperatureData.temperature}
    unit="°C"
    progress={progress}
    onComplete={handleComplete}
  />
)}
{currentState === "PULSE" && (
  <LoadingCircle
    icon={state.icon}
    value={pulseData.pulse}
    unit="Уд/мин"
    progress={progress}
    onComplete={handleComplete}
  />
)}
{currentState === "ALCOHOL" && (
  <LoadingCircle
    icon={state.icon}
    value={alcoholData.alcoholLevel}
    unit=""
    progress={progress}
    onComplete={handleComplete}
  />
)}

                </div>
            </motion.div>
        </div>
    );
}
