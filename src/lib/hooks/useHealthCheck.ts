import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const COUNTDOWN_TIME = 15;

const TIMEOUT_MESSAGE =
    "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number;
    progress: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];
export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft" | "progress">>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
    });
    const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_TIME);
    const [progress, setProgress] = useState(0);
    const [processCompleted, setProcessCompleted] = useState(false);

    const refs = useRef({
        socket: null as Socket | null,
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
        alcoholMeasured: false,
    }).current;

    const updateState = useCallback(
        <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
            setState((prev) => ({ ...prev, ...updates }));
        },
        []
    );

    const handleTimeout = useCallback(() => {
        if (refs.hasTimedOut) return;
        refs.hasTimedOut = true;

        toast.error(TIMEOUT_MESSAGE, {
            duration: 3000,
            style: { background: "#272727", color: "#fff", borderRadius: "8px" },
        });
        navigate("/");
    }, [navigate]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || processCompleted) return;
        refs.isSubmitting = true;
        setProcessCompleted(true);
    
        console.log("🟢 handleComplete() Executed! Current State:", state.currentState);
    
        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
        if (currentIndex < STATE_SEQUENCE.length - 1) {
            console.log("➡️ Moving to Next Step:", STATE_SEQUENCE[currentIndex + 1]);
    
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });
    
            setSecondsLeft(COUNTDOWN_TIME);
            setProgress(0);
            refs.isSubmitting = false;
            return;
        }
    
        console.log("✅ Process Completed! Navigating to /complete-authentication");
    
        if (refs.socket) {
            console.log("🔌 Disconnecting WebSocket...");
            refs.socket.disconnect();
            refs.socket = null;
        }
    
        clearTimeout(refs.timeout!);
        refs.timeout = null;
        refs.hasTimedOut = true;
    
        setTimeout(() => {
            console.log("🚀 Final Navigation: /complete-authentication");
            navigate("/complete-authentication", { state: { success: true } });
        }, 100);
    }, [state.currentState, navigate, updateState, processCompleted]);
    

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            if (!data) return;
            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            if (state.currentState === "TEMPERATURE" && data.temperature) {
                const newTemperature = Number(data.temperature);

                setState((prev) => {
                    const newStabilityTime = Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME);
                    setProgress((newStabilityTime / MAX_STABILITY_TIME) * 100);

                    if (newStabilityTime >= MAX_STABILITY_TIME) {
                        console.log("✅ Temperature stabilized! Moving to alcohol measurement...");
                        handleComplete();
                    }

                    return {
                        ...prev,
                        stabilityTime: newStabilityTime,
                        temperatureData: { temperature: newTemperature },
                    };
                });
            }
        },
        [state.currentState, handleTimeout, handleComplete]
    );

    const listenToAlcoholData = useCallback(() => {
        if (processCompleted) return;
        console.log("📡 Firebase Listener Activated for Alcohol Data");
    
        const alcoholRef = ref(db, "alcohol_value");
    
        refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    
        const unsubscribe = onValue(alcoholRef, async (snapshot) => {
            if (processCompleted) return;
    
            const data = snapshot.val();
            if (!data) {
                console.warn("⚠️ No alcohol data received.");
                return;
            }
    
            console.log("📡 Alcohol Data Received:", data);
            if (refs.alcoholMeasured) return;
    
            let alcoholStatus = "Не определено";
            if (data.sober === 0) alcoholStatus = "Трезвый";
            else if (data.drunk === 0) alcoholStatus = "Пьяный";
    
            console.log("✅ Alcohol Status Determined:", alcoholStatus);
    
            setState((prev) => ({
                ...prev,
                alcoholData: { alcoholLevel: alcoholStatus },
            }));
    
            clearTimeout(refs.timeout!);
            refs.alcoholMeasured = true;
            unsubscribe();
    
            console.log("🚀 Executing handleComplete() after Alcohol Measurement");
            handleComplete();
        });
    
        return () => {
            console.log("❌ Unsubscribing from Firebase Listener for Alcohol Data");
            unsubscribe();
            clearTimeout(refs.timeout!);
        };
    }, [handleComplete, handleTimeout, processCompleted]);
    
useEffect(() => {
    if (processCompleted) {
        console.log("🛑 Process Already Completed. Stopping Further Execution.");
        return;
    }

    console.log("🔄 useEffect Triggered. Current State:", state.currentState);

    refs.hasTimedOut = false;
    const socket = io("http://localhost:3001", { transports: ["websocket"], reconnection: false });

    refs.socket = socket;
    refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
    socket.on("temperature", handleDataEvent);

    let cleanupAlcohol: (() => void) | undefined;
    if (state.currentState === "ALCOHOL") cleanupAlcohol = listenToAlcoholData();

    return () => {
        console.log("🔌 Cleaning Up WebSocket and Firebase Listener...");
        socket.disconnect();
        clearTimeout(refs.timeout!);
        if (cleanupAlcohol) cleanupAlcohol();
    };
}, [processCompleted, state.currentState, handleTimeout, listenToAlcoholData]);

    

useEffect(() => {
    if (processCompleted) return; // ✅ Stop updates if process is completed

    console.log("🔄 Stability Update Interval Started");
    
    const stabilityInterval = setInterval(() => {
        const timeSinceLastData = Date.now() - refs.lastDataTime;
        
        if (timeSinceLastData > STABILITY_UPDATE_INTERVAL) {
            setState((prev) => {
                const decreasedStabilityTime = Math.max(prev.stabilityTime - 1, 0);
                setProgress((decreasedStabilityTime / MAX_STABILITY_TIME) * 100);

                console.log("⏳ Decreasing Stability Time:", decreasedStabilityTime);
                
                return { ...prev, stabilityTime: decreasedStabilityTime };
            });
        }
    }, STABILITY_UPDATE_INTERVAL);

    return () => {
        console.log("🛑 Stopping Stability Update Interval");
        clearInterval(stabilityInterval);
    };
}, [processCompleted, state.currentState]); // ✅ Only update when state changes

    return {
        ...state,
        secondsLeft,
        progress,
        handleComplete,
        setCurrentState: (newState: React.SetStateAction<StateKey>) =>
            updateState({
                currentState: typeof newState === "function" ? newState(state.currentState) : newState,
            }),
    };
};