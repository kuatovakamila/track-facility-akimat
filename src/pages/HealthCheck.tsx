import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { toast } from "react-hot-toast";
import { StateKey } from "../lib/constants";

const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 30000;

type SensorData = {
	temperature?: string;
	bpm?: string;
	alcoholLevel?: string;
	sensorReady?: boolean;
};

type HealthCheckState = {
	currentState: StateKey;
	stabilityTime: number;
	temperatureData: { temperature: number };
	pulseData: { pulse: number };
	alcoholData: { alcoholLevel: string };
	sensorReady: boolean;
	secondsLeft: number;
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
		pulseData: { pulse: 0 },
		alcoholData: { alcoholLevel: "Не определено" },
		sensorReady: false,
		secondsLeft: 30,
	});

	const refs = useRef({
		socket: null as Socket | null,
		tempTimeout: null as NodeJS.Timeout | null,
		pulseTimeout: null as NodeJS.Timeout | null,
		alcoholTimeout: null as NodeJS.Timeout | null,
		lastDataTime: Date.now(),
		hasTimedOutTemp: false,
		hasTimedOutPulse: false,
		hasTimedOutAlcohol: false,
		isSubmitting: false,
		finalAlcoholLevel: "",
		hasBeenReady: false,
		tempStability: 0,
		pulseStability: 0,
	}).current;

	const updateState = useCallback(
		<K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
			setState((prev) => ({ ...prev, ...updates }));
		},
		[]
	);

	const handleComplete = useCallback(async () => {
		if (refs.isSubmitting || refs.hasTimedOutAlcohol || state.currentState !== "ALCOHOL") return;
		refs.isSubmitting = true;

		try {
			refs.socket?.disconnect();

			const faceId = localStorage.getItem("faceId");
			if (!faceId) throw new Error("Face ID not found");

			localStorage.setItem("finalTemperature", JSON.stringify(state.temperatureData.temperature));
			localStorage.setItem("finalPulse", JSON.stringify(state.pulseData.pulse));
			localStorage.setItem("finalAlcoholLevel", JSON.stringify(refs.finalAlcoholLevel));

			const response = await fetch("http://localhost:3001/health", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					temperatureData: state.temperatureData,
					pulseData: state.pulseData,
					alcoholData: { alcoholLevel: refs.finalAlcoholLevel },
					faceId,
				}),
			});

			if (!response.ok) throw new Error("Request failed");

			navigate("/final-results", {
				state: {
					temperature: state.temperatureData.temperature,
					pulse: state.pulseData.pulse,
					alcoholLevel: refs.finalAlcoholLevel,
				},
				replace: true,
			});
		} catch (error) {
			console.error("❌ Submission error:", error);
			refs.isSubmitting = false;
		}
	}, [state, navigate]);

	const handleTimeout = useCallback((type: "TEMPERATURE" | "PULSE" | "ALCOHOL") => {
		if (type === "TEMPERATURE" && refs.hasTimedOutTemp) return;
		if (type === "PULSE" && refs.hasTimedOutPulse) return;
		if (type === "ALCOHOL" && refs.hasTimedOutAlcohol) return;

		if (type === "TEMPERATURE") refs.hasTimedOutTemp = true;
		else if (type === "PULSE") refs.hasTimedOutPulse = true;
		else if (type === "ALCOHOL") refs.hasTimedOutAlcohol = true;

		toast.error(`Сбой связи с сенсором: ${type}`);
		setTimeout(() => navigate("/", { replace: true }), 1000);
	}, [navigate]);

	const handleDataEvent = useCallback((data: SensorData) => {
		if (refs.hasTimedOutTemp || refs.hasTimedOutPulse || refs.hasTimedOutAlcohol) return;

		if (data.sensorReady && !refs.hasBeenReady) {
			refs.hasBeenReady = true;
			updateState({ sensorReady: true });
		}

		let transitioned = false;

		if (data.temperature) {
			const t = parseFloat(data.temperature);
			refs.tempStability++;
			updateState({ temperatureData: { temperature: t } });

			clearTimeout(refs.tempTimeout!);
			refs.tempTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
		}

		if (data.bpm !== undefined) {
			const p = Number(data.bpm);
			refs.pulseStability++;
			updateState({ pulseData: { pulse: p } });

			clearTimeout(refs.pulseTimeout!);
			refs.pulseTimeout = setTimeout(() => handleTimeout("PULSE"), SOCKET_TIMEOUT);
		}

		// Переход к алкоголю, если обе стабильности достигнуты
		if (
			!transitioned &&
			state.currentState !== "ALCOHOL" &&
			refs.tempStability >= MAX_STABILITY_TIME &&
			refs.pulseStability >= MAX_STABILITY_TIME
		) {
			updateState({ currentState: "ALCOHOL", stabilityTime: 0 });
			transitioned = true;
		}

		if (data.alcoholLevel && refs.hasBeenReady) {
			refs.finalAlcoholLevel = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";
			updateState({
				stabilityTime: MAX_STABILITY_TIME,
				alcoholData: { alcoholLevel: refs.finalAlcoholLevel },
			});
			clearTimeout(refs.alcoholTimeout!);
			refs.alcoholTimeout = setTimeout(() => handleTimeout("ALCOHOL"), SOCKET_TIMEOUT);
			handleComplete();
		}
	}, [handleComplete, handleTimeout, state.currentState, updateState]);

	useEffect(() => {
		if (!refs.socket) {
			refs.socket = io("http://localhost:3001", {
				transports: ["websocket"],
			});
	 }

		// Сброс всех подписок
		refs.socket.off("temperature");
		refs.socket.off("heartbeat");
		refs.socket.off("alcohol");
		refs.socket.off("sensorReady");

		// Всегда слушаем и температуру, и пульс, и алкоголь
		refs.socket.on("temperature", handleDataEvent);
		refs.socket.on("heartbeat", handleDataEvent);
		refs.socket.on("alcohol", handleDataEvent);
		refs.socket.on("sensorReady", handleDataEvent);

		// Устанавливаем таймеры
		if (!refs.tempTimeout) {
			refs.tempTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
		}
		if (!refs.pulseTimeout) {
			refs.pulseTimeout = setTimeout(() => handleTimeout("PULSE"), SOCKET_TIMEOUT);
		}
		if (state.currentState === "ALCOHOL" && !refs.alcoholTimeout) {
			refs.alcoholTimeout = setTimeout(() => handleTimeout("ALCOHOL"), SOCKET_TIMEOUT);
		}

		return () => {
			refs.socket?.off("temperature");
			refs.socket?.off("heartbeat");
			refs.socket?.off("alcohol");
			refs.socket?.off("sensorReady");

			clearTimeout(refs.tempTimeout!);
			clearTimeout(refs.pulseTimeout!);
			clearTimeout(refs.alcoholTimeout!);
			refs.tempTimeout = null;
			refs.pulseTimeout = null;
			refs.alcoholTimeout = null;
		};
	}, [state.currentState, handleTimeout, handleDataEvent]);

	return {
		...state,
		handleComplete,
		setCurrentState: (newState) =>
			updateState({
				currentState: typeof newState === "function" ? newState(state.currentState) : newState,
			}),
	};
};
