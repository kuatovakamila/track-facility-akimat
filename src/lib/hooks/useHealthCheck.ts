import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 20000; // Increased timeout

// Define sensor data types
type SensorData = {
    temperature?: string;
    alcoholLevel?: string;
    cameraStatus?: 'failed' | 'success';
};

type HealthCheckState = {
    currentState: StateKey;
    stabilityTime: number;
    temperatureData: { temperature: number };
    alcoholData: { alcoholLevel: string };
    secondsLeft: number;
};

// Function to configure WebSocket listeners
const configureSocketListeners = (
    socket: Socket,
    currentState: StateKey,
    handlers: {
        onData: (data: SensorData) => void;
        onError: () => void;
    }
) => {
    socket.off("temperature");
    socket.off("alcohol");
    socket.off("camera");

    console.log(`🔄 Setting up WebSocket listeners for state: ${currentState}`);

    socket.onAny((event, data) => {
        console.log(`📡 Received event: ${event}`, data);
    });

    if (currentState === "TEMPERATURE") {
        socket.on("temperature", handlers.onData);
    } else if (currentState === "ALCOHOL") {
        console.log("✅ Listening for alcohol data...");
        socket.on("alcohol", handlers.onData);
    }

    socket.on("camera", handlers.onData);
};

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
        timeout: null as NodeJS.Timeout | null,
        lastDataTime: Date.now(),
        hasTimedOut: false,
        isSubmitting: false,
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
        console.warn("⏳ Timeout reached");
        if (state.currentState === "ALCOHOL") {
            navigate("/");
        }
    }, [state.currentState, navigate]);

    const handleDataEvent = useCallback(
        (data: SensorData) => {
            console.log("📡 Received sensor data:", data);

            if (!data || (!data.temperature && !data.alcoholLevel && !data.cameraStatus)) {
                console.warn("⚠️ No valid sensor data received");
                return;
            }

            refs.lastDataTime = Date.now();
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

            let alcoholStatus = "Не определено";
            if (data.alcoholLevel !== undefined && data.alcoholLevel !== null) {
                alcoholStatus = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
            }

            setState((prev) => {
                const isTemperatureStable = prev.currentState === "TEMPERATURE" && prev.stabilityTime + 1 >= MAX_STABILITY_TIME;
                const nextState = isTemperatureStable ? "ALCOHOL" : prev.currentState;

                return {
                    ...prev,
                    stabilityTime: isTemperatureStable ? 0 : Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
                    temperatureData: prev.currentState === "TEMPERATURE"
                        ? { temperature: parseFloat(Number(data.temperature).toFixed(2)) || 0 }
                        : prev.temperatureData,
                    alcoholData: prev.currentState === "ALCOHOL"
                        ? { alcoholLevel: alcoholStatus }
                        : prev.alcoholData,
                    currentState: nextState,
                };
            });
        },
        [handleTimeout]
    );

    useEffect(() => {
        if (!refs.socket) {
            refs.socket = io(import.meta.env.VITE_SERVER_URL, {
                transports: ["websocket"],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
            });

            refs.socket.on("connect", () => console.log("✅ WebSocket connected"));
            refs.socket.on("disconnect", () => console.warn("❌ WebSocket disconnected"));
        }

        configureSocketListeners(refs.socket, state.currentState, {
            onData: handleDataEvent,
            onError: handleTimeout,
        });

        return () => {
            console.log("🔄 Cleaning up WebSocket listeners");
            refs.socket?.off("temperature");
            refs.socket?.off("alcohol");
            refs.socket?.off("camera");
        };
    }, [state.currentState, handleTimeout, handleDataEvent]);

    useEffect(() => {
        if (state.currentState === "ALCOHOL") {
            console.log("🔄 Resetting timeout for alcohol measurement");
            clearTimeout(refs.timeout!);
            refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);
        }
    }, [state.currentState]);

    useEffect(() => {
        if (refs.socket && !refs.socket.connected) {
            console.log("🔄 Reconnecting WebSocket...");
            refs.socket.connect();
        }
    }, [state.currentState]);

    const handleComplete = useCallback(async () => {
        if (refs.isSubmitting || state.currentState !== "ALCOHOL") return;
        refs.isSubmitting = true;

        try {
            refs.socket?.disconnect();
            const faceId = localStorage.getItem("faceId");
            if (!faceId) throw new Error("Face ID not found");

            console.log("🚀 Submitting health check data...");
            const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/health`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    temperatureData: state.temperatureData,
                    alcoholData: state.alcoholData,
                    faceId,
                }),
            });

            if (!response.ok) throw new Error("Request failed");

            navigate("/complete-authentication", { replace: true });
        } catch (error) {
            console.error("❌ Submission error:", error);
            refs.isSubmitting = false;
        }
    }, [state, navigate, refs]);

    return {
        ...state,
        handleComplete,
        setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
    };
};
