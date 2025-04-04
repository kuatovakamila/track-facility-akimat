import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { StateKey } from "../constants";
import toast from "react-hot-toast";

// Constants
const MAX_STABILITY_TIME = 7;
const SOCKET_TIMEOUT = 15000;
const STABILITY_UPDATE_INTERVAL = 1000;
const TIMEOUT_MESSAGE =
  "Не удается отследить данные, попробуйте еще раз или свяжитесь с администрацией.";

// Type definitions
type SensorData = {
  bpm?: string;
  temperature?: string;
  alcoholLevel?: string;
};

type HealthCheckState = {
  currentState: StateKey;
  stabilityTime: number;
  bpmData: { bpm: number };
  temperatureData: { temperature: number };
  alcoholData: { alcoholLevel: string };
  secondsLeft: number;
};

const STATE_SEQUENCE: StateKey[] = ["TEMPERATURE", "PULSE", "ALCOHOL"];

const configureSocketListeners = (
  socket: Socket,
  currentState: StateKey,
  handlers: {
    onData: (data: SensorData) => void;
    onError: () => void;
  }
) => {
  socket.removeAllListeners();
  socket.on("connect_error", handlers.onError);
  socket.on("error", handlers.onError);

  switch (currentState) {
    case "PULSE":
      socket.on("heartbeat", handlers.onData);
      break;
    case "TEMPERATURE":
      socket.on("temperature", handlers.onData);
      break;
    case "ALCOHOL":
      socket.on("alcohol", handlers.onData);
      break;
  }
};

export const useHealthCheck = (): HealthCheckState & {
  handleComplete: () => Promise<void>;
  setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
} => {
  const navigate = useNavigate();

  const [state, setState] = useState<Omit<HealthCheckState, "secondsLeft">>({
    currentState: "TEMPERATURE",
    stabilityTime: 0,
    bpmData: { bpm: 0 },
    temperatureData: { temperature: 0 },
    alcoholData: { alcoholLevel: "undefined" },
  });

  const [secondsLeft, setSecondsLeft] = useState(15);

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
    toast.error(TIMEOUT_MESSAGE, {
      duration: 3000,
      style: {
        background: "#272727",
        color: "#fff",
        borderRadius: "8px",
      },
    });
    navigate("/");
  }, [navigate]);

  const handleDataEvent = useCallback(
    (data: SensorData) => {
      if (!data) return;

      refs.lastDataTime = Date.now();
      clearTimeout(refs.timeout!);
      refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

      setState((prev) => {
        const isPulse = prev.currentState === "PULSE";
        const isTemp = prev.currentState === "TEMPERATURE";
        const isAlcohol = prev.currentState === "ALCOHOL";

        return {
          ...prev,
          stabilityTime: Math.min(prev.stabilityTime + 1, MAX_STABILITY_TIME),
          bpmData:
            isPulse && data.bpm
              ? { bpm: Number(data.bpm) }
              : prev.bpmData,
          temperatureData:
            isTemp && data.temperature
              ? { temperature: Number(data.temperature) }
              : prev.temperatureData,
          alcoholData:
            isAlcohol && data.alcoholLevel
              ? { alcoholLevel: data.alcoholLevel }
              : prev.alcoholData,
        };
      });
    },
    [handleTimeout]
  );

  const setupSocketForState = useCallback(
    (socket: Socket, currentState: StateKey) => {
      configureSocketListeners(socket, currentState, {
        onData: handleDataEvent,
        onError: handleTimeout,
      });
    },
    [handleDataEvent, handleTimeout]
  );

  useEffect(() => {
    refs.hasTimedOut = false;

    const socket = io(import.meta.env.VITE_SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    refs.socket = socket;
    refs.timeout = setTimeout(handleTimeout, SOCKET_TIMEOUT);

    setupSocketForState(socket, state.currentState);

    const stabilityInterval = setInterval(() => {
      if (Date.now() - refs.lastDataTime > STABILITY_UPDATE_INTERVAL) {
        updateState({
          stabilityTime: Math.max(state.stabilityTime - 1, 0),
        });
      }
    }, STABILITY_UPDATE_INTERVAL);

    return () => {
      socket.disconnect();
      clearTimeout(refs.timeout!);
      clearInterval(stabilityInterval);
    };
  }, [
    state.currentState,
    state.stabilityTime,
    handleTimeout,
    handleDataEvent,
    setupSocketForState,
    updateState,
  ]);

  useEffect(() => {
    setSecondsLeft(15);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [state.currentState]);

  const handleComplete = useCallback(async () => {
    if (refs.isSubmitting) return;
    refs.isSubmitting = true;

    const currentIndex = STATE_SEQUENCE.indexOf(state.currentState);
    if (currentIndex < STATE_SEQUENCE.length - 1) {
      updateState({
        currentState: STATE_SEQUENCE[currentIndex + 1],
        stabilityTime: 0,
      });
      refs.isSubmitting = false;
      return;
    }

    try {
      refs.socket?.disconnect();
      const faceId = localStorage.getItem("faceId");
      if (!faceId) throw new Error("Face ID not found");

      const response = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/health`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bpmData: state.bpmData,
            temperatureData: state.temperatureData,
            alcoholData: state.alcoholData,
            faceId,
          }),
        }
      );

      if (!response.ok) throw new Error("Request failed");

      localStorage.setItem(
        "results",
        JSON.stringify({
          bpm: state.bpmData.bpm,
          temperature: state.temperatureData.temperature,
          alcohol: state.alcoholData.alcoholLevel,
        })
      );

      navigate("/complete-authentication", { state: { success: true } });
    } catch (error) {
      console.error("Submission error:", error);
      refs.isSubmitting = false;
    }
  }, [state, navigate, updateState]);

  return {
    ...state,
    secondsLeft,
    handleComplete,
    setCurrentState: (newState: React.SetStateAction<StateKey>) =>
      updateState({
        currentState:
          typeof newState === "function"
            ? newState(state.currentState)
            : newState,
      }),
  };
};

 
//  import { useState, useEffect, useCallback, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { io, type Socket } from "socket.io-client";
// import { toast } from "react-hot-toast";
// import { StateKey } from "../constants";

// // Constants
// const MAX_STABILITY_TIME = 7; // 7 seconds for progress completion
// const SOCKET_TIMEOUT = 30000; // 20 seconds timeout before showing an error

// // Define sensor data types
// type SensorData = {
//     temperature?: string;
//     alcoholLevel?: string;
//     cameraStatus?: "failed" | "success";
// };

// type HealthCheckState = {
//     currentState: StateKey;
//     stabilityTime: number;
//     temperatureData: { temperature: number };
//     alcoholData: { alcoholLevel: string };
//     secondsLeft: number;
// };

// export const useHealthCheck = (): HealthCheckState & {
//     handleComplete: () => Promise<void>;
//     setCurrentState: React.Dispatch<React.SetStateAction<StateKey>>;
// } => {
//     const navigate = useNavigate();
//     const [state, setState] = useState<HealthCheckState>({
//         currentState: "TEMPERATURE",
//         stabilityTime: 0,
//         temperatureData: { temperature: 0 },
//         alcoholData: { alcoholLevel: "Не определено" },
//         secondsLeft: 7,
//     });

//     const refs = useRef({
//         socket: null as Socket | null,
//         temperatureTimeout: null as NodeJS.Timeout | null,
//         alcoholTimeout: null as NodeJS.Timeout | null,
//         hasTimedOutTemperature: false,
//         hasTimedOutAlcohol: false,
//         isSubmitting: false,
//         finalAlcoholLevel: "", // Store the final alcohol level
//     }).current;

//     const updateState = useCallback(
//         <K extends keyof HealthCheckState>(updates: Pick<HealthCheckState, K>) => {
//             setState((prev) => ({ ...prev, ...updates }));
//         },
//         []
//     );

//     const handleTimeout = useCallback(
//         (type: "TEMPERATURE" | "ALCOHOL") => {
//             if (type === "TEMPERATURE" && refs.hasTimedOutTemperature) return;
//             if (type === "ALCOHOL" && refs.hasTimedOutAlcohol) return;

//             if (type === "TEMPERATURE") {
//                 refs.hasTimedOutTemperature = true;
//                 console.warn("⏳ Timeout для TEMPERATURE, переход в ALCOHOL...");
//                 updateState({ currentState: "ALCOHOL", stabilityTime: 0 });

//                 clearTimeout(refs.temperatureTimeout!);
//             } else if (type === "ALCOHOL") {
//                 // 🚀 FIX: Prevent `toast.error` if alcohol was detected!
//                 if (refs.finalAlcoholLevel) return;

//                 refs.hasTimedOutAlcohol = true;
//                 console.warn("⏳ Timeout для ALCOHOL, показываем ошибку...");
//                 toast.error("Вы неправильно подули, повторите попытку.");
//                 setTimeout(() => navigate("/", { replace: true }), 1000);

//                 clearTimeout(refs.alcoholTimeout!);
//             }
//         },
//         [navigate]
//     );

//     const handleDataEvent = useCallback((data: SensorData) => {
//         console.log("📡 Received sensor data:", JSON.stringify(data));

//         if (!data || (!data.temperature && !data.alcoholLevel)) {
//             console.warn("⚠️ No valid sensor data received");
//             return;
//         }

//         // ✅ If temperature data is received, update it
//         if (data.temperature) {
//             const tempValue = parseFloat(Number(data.temperature).toFixed(2)) || 0;
//             console.log(`🌡️ Temperature received: ${tempValue}°C`);

//             setState((prev) => {
//                 let nextState = prev.currentState;
//                 let nextStabilityTime = prev.stabilityTime + 1;

//                 // ✅ Progress temperature stability time
//                 if (prev.currentState === "TEMPERATURE") {
//                     if (nextStabilityTime >= MAX_STABILITY_TIME) {
//                         nextState = "ALCOHOL";
//                         nextStabilityTime = 0;
//                         console.log("🔄 Switching to ALCOHOL...");
//                     }
//                 }

//                 return {
//                     ...prev,
//                     stabilityTime: nextStabilityTime,
//                     temperatureData: { temperature: tempValue },
//                     currentState: nextState,
//                 };
//             });

//             if (refs.temperatureTimeout !== null) {
//                 clearTimeout(refs.temperatureTimeout);
//             }
//             refs.temperatureTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
//         }

//         // ✅ If valid alcohol data is received, update state & clear timeout
//         if (data.alcoholLevel === "normal" || data.alcoholLevel === "abnormal") {
//             console.log("✅ Valid alcohol data received, updating state...");

//             if (refs.alcoholTimeout !== null) {
//                 clearTimeout(refs.alcoholTimeout);
//                 refs.alcoholTimeout = null;
//             }

//             refs.finalAlcoholLevel = data.alcoholLevel === "normal" ? "Трезвый" : "Пьяный";

//             console.log("📡 Updated finalAlcoholLevel:", refs.finalAlcoholLevel);

//             setState((prev) => ({
//                 ...prev,
//                 stabilityTime: MAX_STABILITY_TIME,
//                 alcoholData: { alcoholLevel: refs.finalAlcoholLevel },
//             }));

//             handleComplete();
//             return;
//         }
//     }, []);

//     const handleComplete = useCallback(async () => {
//         if (refs.isSubmitting || refs.hasTimedOutAlcohol || state.currentState !== "ALCOHOL") return;
//         refs.isSubmitting = true;

//         // ✅ Ensure timeouts are cleared before submission
//         if (refs.alcoholTimeout !== null) {
//             clearTimeout(refs.alcoholTimeout);
//             refs.alcoholTimeout = null;
//         }

//         if (refs.temperatureTimeout !== null) {
//             clearTimeout(refs.temperatureTimeout);
//             refs.temperatureTimeout = null;
//         }

//         console.log("🚀 Submitting health check data with:", {
//             temperature: state.temperatureData.temperature,
//             alcoholLevel: refs.finalAlcoholLevel,
//         });

//         try {
//             // 🚀 FIX: Store values in `localStorage` to persist after navigation
//             localStorage.setItem("finalTemperature", JSON.stringify(state.temperatureData.temperature));
//             localStorage.setItem("finalAlcoholLevel", JSON.stringify(refs.finalAlcoholLevel));

//             navigate("/final-results", { replace: true });

//             return;
//         } catch (error) {
//             console.error("❌ Submission error:", error);
//             refs.isSubmitting = false;
//         }
//     }, [state, navigate]);

//     useEffect(() => {
//         if (!refs.socket) {
//             refs.socket = io("http://localhost:3001", {
//                 transports: ["websocket"],
//                 reconnection: true,
//                 reconnectionAttempts: Infinity,
//                 reconnectionDelay: 1000,
//             });
//         }

//         refs.socket.off("temperature");
//         refs.socket.off("alcohol");

//         if (state.currentState === "TEMPERATURE") {
//             refs.socket.on("temperature", handleDataEvent);
//         } else if (state.currentState === "ALCOHOL") {
//             refs.socket.on("alcohol", handleDataEvent);
//         }

//         refs.temperatureTimeout = setTimeout(() => handleTimeout("TEMPERATURE"), SOCKET_TIMEOUT);
//         refs.alcoholTimeout = setTimeout(() => handleTimeout("ALCOHOL"), SOCKET_TIMEOUT);
//     }, [state.currentState, handleTimeout, handleDataEvent]);

//     return {
//         ...state,
//         handleComplete,
//         setCurrentState: (newState) => updateState({ currentState: typeof newState === "function" ? newState(state.currentState) : newState }),
//     };
// };



 