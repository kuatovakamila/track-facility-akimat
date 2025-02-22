import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000; // ✅ Timeout for WebSocket connection

type SensorData = {
    temperature?: string;
    cameraStatus?: "failed" | "success";
};

type FirebaseAlcoholData = {
    power: number;
    sober: number;
    drunk: number;
    relay: number;
    ready: number;
    status: string;
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "ALCOHOL"];

export const useHealthCheck = (): HealthCheckState & {
    handleComplete: () => Promise<void>;
    setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
    const navigate = useNavigate();
    const [state, setState] = useState<HealthCheckState>({
        currentState: "TEMPERATURE",
        stabilityTime: 0,
        temperatureData: { temperature: 0 },
        alcoholData: { alcoholLevel: "Не определено" },
        secondsLeft: 15,
    });

    const refs = useRef({
        socket: null as Socket | null,
        stopPolling: false,
        completed: false,
        hasTimedOut: false,
        timeout: null as NodeJS.Timeout | null,
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

        console.warn("⏳ Timeout reached: No valid alcohol data received.");
        navigate("/");
    }, [navigate]);

    const handleTemperatureData = useCallback(
        (data: SensorData) => {
            if (!data || !data.temperature) return;

            console.log("📡 Temperature data received:", data);

            setState((prev) => ({
                ...prev,
                stabilityTime: prev.currentState === "TEMPERATURE"
                    ? Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME)
                    : prev.stabilityTime,
                temperatureData: { temperature: Number(data.temperature) || 0 },
            }));
        },
        []
    );

    const pollAlcoholData = useCallback(() => {
        if (refs.stopPolling) return;

        const alcoholRef = ref(db, "alcohol_value");
        console.log("🔄 Listening for alcohol data from Firebase...");

        const unsubscribe = onValue(alcoholRef, (snapshot) => {
            const data: FirebaseAlcoholData | null = snapshot.val();

            console.log("🔥 Firebase Alcohol Data:", data);

            if (!data || typeof data !== "object") {
                console.warn("⚠️ No valid alcohol data received. Waiting...");
                return;
            }

            const sober = Number(data.sober ?? -1);
            const drunk = Number(data.drunk ?? -1);

            console.log(`🔍 Extracted Values → Sober: ${sober}, Drunk: ${drunk}`);

            let alcoholStatus = "Не определено";
            if (sober === 0) {
                alcoholStatus = "Трезвый";
            } else if (drunk === 0) {
                alcoholStatus = "Пьяный";
            } else {
                console.warn("⚠️ No valid alcohol status yet. Still listening...");
                return;
            }

            console.log(`✅ Alcohol Status Set: ${alcoholStatus}`);

            refs.stopPolling = true;
            setState((prev) => ({
                ...prev,
                stabilityTime: MAX_STABILITY_TIME,
                alcoholData: { alcoholLevel: alcoholStatus },
            }));

            setTimeout(handleComplete, 300);
            unsubscribe(); // ✅ Stop listening once valid data is received
        });

        return () => {
            console.log("🛑 Unsubscribing from Firebase updates.");
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001", {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 3000,
            });

            refs.socket.on("connect", () => {
                console.log("✅ WebSocket connected.");
                refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT); // ✅ Start timeout
            });

            refs.socket.on("disconnect", (reason) => {
                console.warn("⚠️ WebSocket disconnected:", reason);
                refs.socket = null;
            });

            refs.socket.on("temperature", handleTemperatureData);
        }

        if (state.currentState === "ALCOHOL") {
            pollAlcoholData();
        }

        return () => {
            console.log("🛑 Cleanup: Disconnect WebSocket & Stop Polling");
            refs.socket?.disconnect();
            refs.socket = null;
            refs.stopPolling = true;
            clearTimeout(refs.timeout!); // ✅ Clear timeout
        };
    }, [state.currentState, handleTemperatureData, pollAlcoholData]);

    const handleComplete = useCallback(async () => {
        if (refs.completed) return;
        refs.completed = true;

        console.log("🚀 Checking state sequence...");

        const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);

        if (currentIndex < STATE_SEQUENCE.length - 1) {
            updateState({
                currentState: STATE_SEQUENCE[currentIndex + 1],
                stabilityTime: 0,
            });

            refs.completed = false;
            return;
        }

        console.log("✅ Completing authentication after ALCOHOL");

        try {
            refs.socket?.disconnect();
            refs.socket = null;

            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("❌ Face ID not found");

            console.log("📡 Sending final data...");

            localStorage.setItem("results", JSON.stringify({
                temperature: state.temperatureData.temperature,
                alcohol: state.alcoholData.alcoholLevel,
            }));

            refs.stopPolling = true;

            navigate("/complete-authentication", { state: { success: true } });
        } catch (error) {
            console.error("❌ Submission error:", error);
            toast.error("Ошибка отправки данных. Проверьте соединение.");
            refs.completed = false;
        }
    }, [state, navigate]);

    const setCurrentState = (newState: React.SetStateAction<StateKey>) => {
        updateState({
            currentState: typeof newState === "function" ? newState(state.currentState) : newState,
        });
    };

    return { ...state, handleComplete, setCurrentState };
};
