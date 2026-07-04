"use client";

import React, { useState, useEffect, useRef } from "react";
import Script from "next/script";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  Video,
  Activity,
  UserPlus,
  Users,
  Settings,
  Mic,
  MicOff,
  Volume2,
  RefreshCw,
  Trash2,
  Brain,
  Sparkles,
  Circle,
  Play,
  Square,
  Home,
  ChevronRight,
  ChevronDown,
  Wifi,
  WifiOff,
  MessageSquare,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

const MODEL_URL = "/models";
const DETECT_MS = 500;

interface Person {
  id: string;
  name: string;
  relation: string;
  note_count?: number;
}

interface MatchMessage {
  type: string;
  person_id: string;
  name: string;
  relation: string;
  summary: string | null;
  distance: number;
}

interface SummaryMessage {
  type: string;
  person_id: string;
  summary: string;
}

interface LogEntry {
  time: string;
  message: string;
  kind: "info" | "warn" | "err" | "match";
}

export default function CameraPage() {
  const router = useRouter();
  const [modelsReady, setModelsReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [stageHint, setStageHint] = useState("Loading face models...");
  const [fpsPill, setFpsPill] = useState("idle");

  // WebSocket and Live Matching states
  const [activePerson, setActivePerson] = useState<Person | null>(null);
  const [matchedSummary, setMatchedSummary] = useState<string | null>(null);
  const [matchedDistance, setMatchedDistance] = useState<number | null>(null);
  const [overlayCardPos, setOverlayCardPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [showCard, setShowCard] = useState(false);

  // App settings & log states
  const [statusText, setStatusText] = useState("connecting…");
  const [statusKind, setStatusKind] = useState<"ok" | "warn" | "err" | "connecting">("connecting");
  const [threshold, setThreshold] = useState<number>(0.55);
  const [people, setPeople] = useState<Person[]>([]);
  const [ops, setOps] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [llmProvider, setLlmProvider] = useState<"openai" | "anthropic" | "ollama" | "openrouter" | "deepseek" | "google">("openai");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");

  // Input states
  const [enName, setEnName] = useState("");
  const [enRelation, setEnRelation] = useState("");
  const [enSeed, setEnSeed] = useState("");
  const [noteInput, setNoteInput] = useState("");

  // Button disabled/loading states
  const [enrolling, setEnrolling] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  // Recording audio states
  const [transcribing, setTranscribing] = useState(false);

  // Auto-listen conversation agent states
  const [micMuted, setMicMuted] = useState(false);
  const [autoListening, setAutoListening] = useState(false);
  const [conversationSummary, setConversationSummary] = useState<{ short: string; bullets: string[] } | null>(null);
  const [showBullets, setShowBullets] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const autoChunkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const loopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activePersonIdRef = useRef<string | null>(null);
  const lastMatchIdRef = useRef<string | null>(null);
  const detectingRef = useRef<boolean>(false);
  const listeningRef = useRef(false);

  const getBackendUrl = () => {
    if (process.env.NEXT_PUBLIC_BACKEND_URL) {
      return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "");
    }
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = 8000;
    return `${protocol}//${host}:${port}`;
  };

  const getWsUrl = () => {
    if (process.env.NEXT_PUBLIC_BACKEND_URL) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "");
      const wsProto = backendUrl.startsWith("https") ? "wss" : "ws";
      try {
        const url = new URL(backendUrl);
        return `${wsProto}://${url.host}/ws`;
      } catch (e) {
        // Fallback if not a valid URL
        return `${wsProto}://${backendUrl.replace(/^https?:\/\//, "")}/ws`;
      }
    }
    if (typeof window === "undefined") return "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    const port = 8000;
    return `${proto}://${host}:${port}/ws`;
  };

  const addLog = (message: string, kind: "info" | "warn" | "err" | "match" = "info") => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [{ time, message, kind }, ...prev].slice(0, 40));
  };

  const getFaceApi = () => {
    if (typeof window !== "undefined") {
      return (window as any).faceapi;
    }
    return null;
  };

  const loadModels = async () => {
    const faceapi = getFaceApi();
    if (!faceapi) {
      setStageHint("Waiting for face-api.js to load...");
      return;
    }
    setStageHint("Loading face models...");
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setModelsReady(true);
      setStageHint("Press Start camera to begin.");
      addLog("Face models loaded successfully.");
    } catch (err) {
      console.error(err);
      setStageHint("Failed to load face models. Check network.");
      addLog("Failed to load face models.", "err");
    }
  };

  const api = async (path: string, body?: any) => {
    const opts = body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {};
    const r = await fetch(`${getBackendUrl()}${path}`, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  };

  const refreshStatus = async () => {
    try {
      const s = await api("/api/status");
      const mode = s.memory.mode;
      if (mode === "cloud") {
        setStatusKind("ok");
        setStatusText("Cognee Cloud connected");
      } else if (mode === "local") {
        setStatusKind("ok");
        setStatusText("Cognee (local) ready");
      } else {
        setStatusKind("warn");
        setStatusText("Cognee offline — local fallback");
      }
      if (typeof s.threshold === "number") {
        setThreshold(s.threshold);
      }
    } catch {
      setStatusKind("err");
      setStatusText("Backend unreachable");
    }
  };

  const refreshPeople = async () => {
    try {
      const { people: fetchedPeople } = await api("/api/people");
      setPeople(fetchedPeople);
    } catch {
      // silently fail
    }
  };

  const refreshOps = async () => {
    try {
      const { ops: fetchedOps } = await api("/api/ops");
      setOps(fetchedOps);
    } catch {
      // silently fail
    }
  };

  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => addLog("Recall channel open.");
    ws.onclose = () => {
      addLog("Recall channel closed, retrying...", "warn");
      setTimeout(connectWS, 1500);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "match") {
          onMatch(m);
        } else if (m.type === "summary") {
          onSummary(m);
        } else {
          onNoMatch();
        }
      } catch (err) {
        console.error("WS error:", err);
      }
    };
  };

  const onMatch = (m: MatchMessage) => {
    const isNewMatch = m.person_id !== lastMatchIdRef.current;
    setShowCard(true);
    setMatchedSummary(m.summary || "Recalling memory…");
    setMatchedDistance(m.distance);

    const matchedPerson: Person = {
      id: m.person_id,
      name: m.name,
      relation: m.relation,
    };
    setActivePerson(matchedPerson);
    activePersonIdRef.current = m.person_id;

    if (isNewMatch) {
      addLog(`Recognised ${m.name} (distance: ${m.distance})`, "match");
      lastMatchIdRef.current = m.person_id;
    }
  };

  const onSummary = (m: SummaryMessage) => {
    if (m.person_id !== lastMatchIdRef.current) return; // stale
    setMatchedSummary(m.summary);
  };

  const onNoMatch = () => {
    setShowCard(false);
    lastMatchIdRef.current = null;
  };

  const sendDescriptor = (descriptor: number[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "recall", descriptor }));
    }
  };

  const detectOnce = async () => {
    const faceapi = getFaceApi();
    const video = videoRef.current;
    if (!modelsReady || !streaming || !faceapi || !video) return null;

    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    return faceapi
      .detectSingleFace(video, opts)
      .withFaceLandmarks()
      .withFaceDescriptor();
  };

  const drawAndPlace = (det: any) => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const faceapi = getFaceApi();
    if (!video || !canvas || !faceapi) return;

    const size = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(canvas, size);
    const r = faceapi.resizeResults(det, size);
    const box = r.detection.box;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, size.width, size.height);

    // Change 1: frosted glass face box — 3-layer stacked stroke
    // Layer 1: wide diffuse glow halo
    ctx.strokeStyle = "rgba(200,210,255,0.18)";
    ctx.lineWidth = 10;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    // Layer 2: mid glow
    ctx.strokeStyle = "rgba(180,195,255,0.30)";
    ctx.lineWidth = 4;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    // Layer 3: sharp bright core line
    ctx.strokeStyle = "rgba(230,235,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Compute mirrored left position for floating card overlay
    const mirroredX = size.width - (box.x + box.width);
    const cardW = 300;
    const cardH = 180;
    
    // Position card horizontally: center under face
    const faceCenterX = mirroredX + box.width / 2;
    let left = faceCenterX - cardW / 2;
    left = Math.max(8, Math.min(left, size.width - cardW - 8));
    
    // Position card vertically: try below face first, then above
    const bottomSpace = size.height - (box.y + box.height);
    let top;
    
    if (bottomSpace > cardH + 16) {
      // Enough space below - position below face with gap
      top = Math.min(box.y + box.height + 12, size.height - cardH - 8);
    } else if (box.y > cardH + 16) {
      // Not enough below but enough above - position above face with gap
      top = Math.max(8, box.y - cardH - 12);
    } else {
      // Limited space - just center vertically with small padding
      top = Math.max(8, Math.min(box.y + box.height / 2 - cardH / 2, size.height - cardH - 8));
    }
    
    setOverlayCardPos({ left, top });
  };

  const clearOverlay = () => {
    const canvas = overlayRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setStreaming(true);
          addLog("Camera stream started.");
        };
      }
    } catch {
      toast.error("Camera access denied or unavailable.");
      setStageHint("Camera blocked. Please allow access and reload.");
    }
  };

  const stopCamera = () => {
    setStreaming(false);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    clearOverlay();
    onNoMatch();
    setActivePerson(null);
    activePersonIdRef.current = null;
    setConversationSummary(null);
    setShowBullets(false);
    setFpsPill("idle");
    setStageHint("Press Start camera to begin.");
    addLog("Camera stream stopped.");
  };

  // Detection loop
  useEffect(() => {
    if (!streaming || !modelsReady) return;

    const runLoop = async () => {
      if (!streaming) return;
      if (!detectingRef.current) {
        detectingRef.current = true;
        const t0 = performance.now();
        try {
          const det = await detectOnce();
          if (det) {
            drawAndPlace(det);
            sendDescriptor(Array.from(det.descriptor));
            setFpsPill(`face • ${Math.round(performance.now() - t0)}ms`);
          } else {
            clearOverlay();
            onNoMatch();
            setFpsPill("no face");
          }
        } catch {
          setFpsPill("detect error");
        } finally {
          detectingRef.current = false;
        }
      }
      loopTimeoutRef.current = setTimeout(runLoop, DETECT_MS);
    };

    loopTimeoutRef.current = setTimeout(runLoop, DETECT_MS);

    return () => {
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
    };
  }, [streaming, modelsReady]);

  // Initial startup hook
  useEffect(() => {
    // Verify auth status
    fetch(`${getBackendUrl()}/api/auth/me`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Unauthenticated");
        return r.json();
      })
      .then((data) => {
        // Authenticated! Proceed with initializing services
        connectWS();
        refreshStatus();
        refreshPeople();
        refreshOps();

        fetch(`${getBackendUrl()}/api/llm/config`, { credentials: "include" })
          .then((res) => res.json())
          .then((cfg) => {
            if (cfg.provider) setLlmProvider(cfg.provider);
            if (cfg.api_key) setLlmApiKey(cfg.api_key);
            if (cfg.model) setLlmModel(cfg.model);
            if (cfg.base_url) setLlmBaseUrl(cfg.base_url);
          })
          .catch(() => {});
      })
      .catch(() => {
        toast.error("Please sign in first.");
        router.push("/login?redirect=/camera");
      });

    const statusInterval = setInterval(refreshStatus, 15000);
    const opsInterval = setInterval(refreshOps, 4000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(opsInterval);
      if (wsRef.current) wsRef.current.close();
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enName.trim() || !enRelation.trim()) {
      return toast.error("Name and relation are required.");
    }
    if (!streaming) {
      return toast.error("Start the camera first to capture a face.");
    }

    setEnrolling(true);
    addLog("Capturing face descriptor for enrollment...");
    try {
      const det = await detectOnce();
      if (!det) {
        setEnrolling(false);
        return toast.error("No face detected. Look straight at the camera and try again.");
      }

      const descriptor = Array.from(det.descriptor);
      const res = await api("/api/enroll", {
        name: enName.trim(),
        relation: enRelation.trim(),
        descriptor,
        seed: enSeed.trim() || undefined,
      });

      toast.success(`Successfully enrolled ${res.person.name}!`);
      addLog(`Enrolled ${res.person.name} (${res.person.relation})`, "match");
      setEnName("");
      setEnRelation("");
      setEnSeed("");
      refreshPeople();
    } catch (err: any) {
      toast.error(err.message || "Failed to enroll contact.");
    } finally {
      setEnrolling(false);
    }
  };

  const handleAddNote = async () => {
    const pid = activePersonIdRef.current;
    if (!pid) return toast.error("No one is currently recognised.");
    if (!noteInput.trim()) return;

    setAddingNote(true);
    try {
      const res = await api("/api/note", { person_id: pid, text: noteInput.trim() });
      addLog(`Saved note to ${activePerson?.name}'s session memory (${res.note_count} pending)`);
      toast.success("Observation added to session memory.");
      setNoteInput("");
      refreshPeople();
    } catch (err: any) {
      toast.error(err.message || "Failed to save note.");
    } finally {
      setAddingNote(false);
    }
  };

  const CHUNK_MS = 8000;

  // Records one ~8s clip on `stream`, sends it off, then immediately starts
  // the next clip, for as long as listeningRef stays true. This is the
  // ponytail stand-in for real streaming STT: it reuses the existing
  // whisper /api/transcribe endpoint instead of standing up a new
  // streaming pipeline, at the cost of ~8-10s of lag per line of transcript.
  const recordChunk = (stream: MediaStream) => {
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      sendAudioBlob(new Blob(audioChunksRef.current, { type: "audio/webm" }));
      if (listeningRef.current && micStreamRef.current) {
        recordChunk(micStreamRef.current);
      }
    };

    recorder.start();
    autoChunkTimerRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, CHUNK_MS);
  };

  const startAutoListen = async () => {
    if (listeningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      listeningRef.current = true;
      setAutoListening(true);
      addLog("Conversation agent listening...");
      recordChunk(stream);
    } catch {
      toast.error("Microphone permission denied.");
      setMicMuted(true);
    }
  };

  const stopAutoListen = () => {
    listeningRef.current = false;
    setAutoListening(false);
    if (autoChunkTimerRef.current) clearTimeout(autoChunkTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  };

  // Drives the listening loop off camera + recognised-person + mute state,
  // keyed on person id (not the object) so re-recognising the same face
  // every detection tick doesn't restart the recorder.
  useEffect(() => {
    if (streaming && activePerson?.id && !micMuted) {
      startAutoListen();
    } else {
      stopAutoListen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, activePerson?.id, micMuted]);

  const toggleMicMute = () => {
    if (!activePerson?.id) return toast.error("No one is currently recognised yet.");
    setMicMuted((m) => !m);
  };

  const refreshConversationSummary = async (pid: string) => {
    try {
      const data = await fetch(`${getBackendUrl()}/api/conversation/summary?person_id=${pid}`).then((r) => r.json());
      if (activePersonIdRef.current === pid) setConversationSummary(data);
    } catch {
      // silently fail, keep showing the last known summary
    }
  };

  const sendAudioBlob = async (blob: Blob) => {
    const pid = activePersonIdRef.current;
    if (!pid || blob.size === 0) return;

    setTranscribing(true);
    const form = new FormData();
    form.append("person_id", pid);
    form.append("audio", blob, "clip.webm");

    try {
      const r = await fetch(`${getBackendUrl()}/api/transcribe`, { method: "POST", body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

      addLog(`Transcribed: "${data.transcript}"`);
      refreshPeople();
      refreshConversationSummary(pid);
    } catch (err: any) {
      // Empty/silent clips 422 constantly during normal pauses in speech;
      // only surface real failures, not "no audio this chunk".
      if (err.message && !err.message.includes("transcription unavailable")) {
        addLog(err.message, "warn");
      }
    } finally {
      setTranscribing(false);
    }
  };

  const handleDistill = async () => {
    const pid = activePersonIdRef.current;
    if (!pid) return toast.error("No one is currently recognised.");

    setDistilling(true);
    addLog(`Distilling session notes for ${activePerson?.name} into permanent graph...`);
    try {
      const res = await api("/api/distill", { person_id: pid });
      addLog(`Distilled fact: "${res.distilled}"`, "match");
      toast.success("Notes distilled to permanent memory!");
      setMatchedSummary(res.reminder);
      setConversationSummary(null);
      setShowBullets(false);
      refreshPeople();
    } catch (err: any) {
      toast.error(err.message || "Failed to distill memory.");
    } finally {
      setDistilling(false);
    }
  };

  const handleForgetPerson = async () => {
    const pid = activePersonIdRef.current;
    if (!pid || !activePerson) return;

    const confirmForget = window.confirm(
      `Are you sure you want to forget ${activePerson.name}? This will permanently delete their Cognee graph dataset and local face registration.`
    );
    if (!confirmForget) return;

    setForgetting(true);
    addLog(`Deleting registry entry and Cognee dataset for ${activePerson.name}...`, "warn");
    try {
      await api(`/api/forget/${pid}`);
      toast.success(`${activePerson.name} has been forgotten.`);
      addLog(`Forgot ${activePerson.name} fully.`, "warn");
      setActivePerson(null);
      activePersonIdRef.current = null;
      lastMatchIdRef.current = null;
      setShowCard(false);
      setConversationSummary(null);
      setShowBullets(false);
      refreshPeople();
      refreshOps();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete person.");
    } finally {
      setForgetting(false);
    }
  };

  const handleThresholdChange = async (val: number[]) => {
    const value = val[0];
    setThreshold(value);
    try {
      const res = await api("/api/threshold", { value });
      setThreshold(res.threshold);
    } catch (err: any) {
      toast.error(err.message || "Failed to set threshold.");
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div className="min-h-screen bg-black text-foreground antialiased font-sans">
      {/* Script loader for vladmandic face-api */}
      <Script
        src="/face-api.js"
        onLoad={() => {
          addLog("face-api.js loaded locally.");
          loadModels();
        }}
        onError={() => {
          addLog("Failed to load face-api.js locally.", "err");
          setStageHint("Failed to load face-api.js.");
        }}
      />

      {/* ── HEADER ── */}
      <header className="border-b border-foreground/10 bg-card/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-6 h-18 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="font-display text-2xl tracking-tight text-white transition-colors group-hover:text-white/80">
                ForgetMeNot
              </span>
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-muted-foreground border-l border-foreground/10 pl-6">
              <Brain className="w-3.5 h-3.5 text-white/50" />
              <span>Agentic Memory Dashboard</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div
              className={`flex items-center gap-2 text-xs font-mono border rounded-full px-3 py-1.5 shadow-sm transition-all bg-black/40 ${
                statusKind === "ok"
                  ? "border-green-500/20 text-green-400"
                  : statusKind === "warn"
                  ? "border-yellow-500/20 text-yellow-400"
                  : "border-red-500/20 text-red-400"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  statusKind === "ok"
                    ? "bg-green-400 animate-pulse"
                    : statusKind === "warn"
                    ? "bg-yellow-400"
                    : "bg-red-400"
                }`}
              />
              <span>{statusText}</span>
            </div>
            <Link href="/">
              <Button size="sm" variant="ghost" className="text-white/70 hover:text-white rounded-full">
                <Home className="w-4 h-4 mr-2" />
                Landing
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── MAIN DASHBOARD GRID ── */}
      {/* 3-column layout: Left Sidebar (3/12), Center Camera (6/12), Right Panel (3/12) */}
      <main className="max-w-[1600px] mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: CONTACTS & SETTINGS (3/12) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Known Contacts List Section */}
          <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-white/60" />
                <h3 className="font-mono text-xs uppercase tracking-wider text-white">Enrolled Contacts</h3>
              </div>
              <Badge variant="secondary" className="font-mono text-xs text-white bg-white/10 rounded-md">
                {people.length}
              </Badge>
            </div>

            {people.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground py-4 text-center">
                No contacts enrolled yet. Add someone below!
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 max-h-[160px] overflow-y-auto pr-1">
                {people.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2.5 p-2.5 border border-foreground/5 bg-black/20 rounded-xl hover:border-foreground/10 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 border border-foreground/10 text-white font-mono text-xs flex items-center justify-center font-bold shrink-0">
                      {getInitials(p.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{p.relation}</div>
                    </div>
                    <Badge variant="outline" className="text-[9px] font-mono text-white/50 border-foreground/10 shrink-0">
                      {p.note_count ? `${p.note_count}n` : "✓"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ENROLL SOMEONE PANEL */}
          <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-4 shadow-lg">
            <div className="flex items-center gap-2 pb-2 border-b border-foreground/5">
              <UserPlus className="w-4 h-4 text-white/60" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-white">Enroll Someone</h3>
            </div>
            
            <p className="text-[11px] font-sans text-muted-foreground leading-normal mb-1 font-light">
              Look straight into the camera, fill in their information, and capture their profile.
            </p>

            <form onSubmit={handleEnroll} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Name</label>
                <Input
                  placeholder="Grandma Rose"
                  value={enName}
                  onChange={(e) => setEnName(e.target.value)}
                  disabled={enrolling}
                  className="bg-black/30 border-foreground/10 text-xs h-9 rounded-xl"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Relation</label>
                <Input
                  placeholder="grandmother"
                  value={enRelation}
                  onChange={(e) => setEnRelation(e.target.value)}
                  disabled={enrolling}
                  className="bg-black/30 border-foreground/10 text-xs h-9 rounded-xl"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Seed memory (optional)</label>
                <Input
                  placeholder="Loves gardening."
                  value={enSeed}
                  onChange={(e) => setEnSeed(e.target.value)}
                  disabled={enrolling}
                  className="bg-black/30 border-foreground/10 text-xs h-9 rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={enrolling}
                className="w-full bg-white hover:bg-neutral-200 text-black h-9 rounded-xl font-mono text-xs mt-2"
              >
                {enrolling ? "Enrolling contact..." : "Capture & enroll"}
              </Button>
            </form>
          </div>

          {/* SENSITIVITY PANEL */}
          <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
              <div className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-white/60" />
                <h3 className="font-mono text-xs uppercase tracking-wider text-white">Face sensitivity</h3>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] border-foreground/10 text-white bg-black/40 px-1.5 py-0.5">
                {threshold.toFixed(2)}
              </Badge>
            </div>

            <Slider
              value={[threshold]}
              onValueChange={handleThresholdChange}
              min={0.3}
              max={0.9}
              step={0.01}
              className="my-1"
            />

            <p className="text-[9px] font-sans text-muted-foreground leading-normal font-light">
              Lower = stricter matches. Higher = looser matching.
            </p>
          </div>

        </div>

        {/* CENTER COLUMN: CAMERA FEED (6/12) */}
        <div className="lg:col-span-6 flex flex-col gap-5">
          <div className="relative border border-foreground/10 bg-card rounded-2xl overflow-hidden shadow-2xl group">
            
            {/* Visual Aspect Ratio Container (4:3) */}
            <div className="relative aspect-[4/3] w-full bg-neutral-950">
              
              {/* Video Feed */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover select-none scale-x-[-1]"
              />

              {/* Overlay Canvas */}
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none scale-x-[-1]"
              />

              {/* Live Overlay card anchored to the face */}
              {showCard && activePerson && (
                <div
                  // Change 2b: Apple frosted glass card
                  className="absolute z-10 w-[300px] rounded-2xl p-4 pointer-events-none animate-in fade-in zoom-in-95 duration-200
                    bg-white/10 backdrop-blur-2xl
                    border border-white/30
                    shadow-[0_12px_40px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(255,255,255,0.06)]
                    ring-1 ring-white/10"
                  style={{
                    left: `${overlayCardPos.left}px`,
                    top: `${overlayCardPos.top}px`,
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-display text-lg text-blue-950 font-bold">
                      {activePerson.name}
                    </h4>
                    <p className="text-xs font-mono text-blue-900/80 font-semibold">
                      {activePerson.relation}
                    </p>
                  </div>
                  {matchedDistance !== null && (
                    <Badge variant="outline" className="text-[10px] bg-blue-950/5 border-blue-900/20 text-blue-900/90 font-mono">
                      dist: {matchedDistance.toFixed(2)}
                    </Badge>
                  )}
                  <div className="border-t border-blue-900/20 pt-2 mt-2">
                    <p className="text-sm text-blue-950 leading-relaxed font-sans font-medium">
                      {matchedSummary}
                    </p>
                  </div>
                </div>
              )}

              {/* Loader/Hint Overlay */}
              {(!streaming || !modelsReady) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-black/90 backdrop-blur-sm z-20">
                  <div className="w-12 h-12 rounded-full border-2 border-foreground/10 border-t-white animate-spin mb-4" />
                  <p className="text-sm font-mono text-muted-foreground">{stageHint}</p>
                </div>
              )}
            </div>

            {/* Footer with camera actions */}
            <div className="border-t border-foreground/10 px-6 py-5 flex items-center justify-between bg-black/40">
              <div className="flex items-center gap-4">
                {!streaming ? (
                  <Button
                    onClick={startCamera}
                    disabled={!modelsReady}
                    className="h-14 px-8 rounded-full font-mono text-sm font-semibold flex items-center gap-2.5
                      bg-gradient-to-r from-green-500 to-emerald-400 text-black
                      shadow-[0_0_28px_-6px_rgba(16,185,129,0.7)]
                      hover:from-green-400 hover:to-emerald-300 hover:shadow-[0_0_36px_-4px_rgba(16,185,129,0.85)]
                      transition-all active:scale-95 disabled:opacity-40 disabled:shadow-none"
                  >
                    <Play className="w-5 h-5 fill-black" />
                    Start Camera
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={stopCamera}
                      className="h-14 px-8 rounded-full font-mono text-sm font-semibold flex items-center gap-2.5
                        bg-gradient-to-r from-red-600 to-rose-500 text-white
                        shadow-[0_0_28px_-6px_rgba(244,63,94,0.7)]
                        hover:from-red-500 hover:to-rose-400 hover:shadow-[0_0_36px_-4px_rgba(244,63,94,0.85)]
                        transition-all active:scale-95"
                    >
                      <Square className="w-5 h-5 fill-white" />
                      Stop Camera
                    </Button>

                    {/* Mic mute/unmute — separate control from the camera, iOS-style circular toggle */}
                    <button
                      onClick={toggleMicMute}
                      title={micMuted ? "Unmute microphone" : "Mute microphone"}
                      className={`h-14 w-14 rounded-full flex items-center justify-center transition-all active:scale-95 shrink-0 border ${
                        micMuted
                          ? "bg-gradient-to-b from-red-500/25 to-red-600/10 border-red-500/40 text-red-400"
                          : "bg-gradient-to-b from-green-500/25 to-emerald-600/10 border-green-500/40 text-green-400 shadow-[0_0_20px_-8px_rgba(16,185,129,0.8)]"
                      }`}
                    >
                      {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className={`w-5 h-5 ${autoListening ? "animate-pulse" : ""}`} />}
                    </button>
                  </>
                )}
              </div>
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground bg-black/40 px-3 py-1 border-foreground/10">
                {fpsPill}
              </Badge>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: ACTION PANELS & LOGS (3/12 — squeezed to fit) */}
        <div className="lg:col-span-3 flex flex-col gap-4">

          {/* ACTIVE PERSON PANEL (In View Now) */}
          {activePerson && (
            <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-4 shadow-lg animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between border-b border-foreground/5 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  <h3 className="font-mono text-xs uppercase tracking-wider text-green-400">In View Now</h3>
                </div>
                <div className="w-2 h-2 rounded-full bg-green-400 animate-ping" />
              </div>

              <div className="flex items-center gap-3 p-2.5 bg-white/5 border border-foreground/10 rounded-xl">
                <div className="w-9 h-9 rounded-full bg-white/10 text-white font-mono text-xs flex items-center justify-center font-bold shrink-0">
                  {getInitials(activePerson.name)}
                </div>
                <div>
                  <h4 className="font-display text-base text-white font-semibold">{activePerson.name}</h4>
                  <p className="text-xs font-mono text-muted-foreground">{activePerson.relation}</p>
                </div>
              </div>

              {/* Add observation textarea */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Add observation (session memory)
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. mentioned her rose garden again"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                    disabled={addingNote}
                    className="bg-black/30 border-foreground/10 text-xs h-9 rounded-xl"
                  />
                  <Button
                    onClick={handleAddNote}
                    disabled={addingNote || !noteInput.trim()}
                    className="bg-white hover:bg-neutral-200 text-black h-9 px-4 rounded-xl font-mono text-xs"
                  >
                    {addingNote ? "…" : "Add"}
                  </Button>
                </div>
              </div>

              {/* Conversation agent: auto listen → transcript → summary card */}
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-4 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-white/60" />
                    <h4 className="text-xs font-mono uppercase tracking-wider text-white/80">Conversation</h4>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        autoListening ? "bg-emerald-400 animate-pulse" : "bg-white/20"
                      }`}
                    />
                    <span className={autoListening ? "text-emerald-400" : "text-white/40"}>
                      {micMuted ? "muted" : autoListening ? "listening" : transcribing ? "transcribing" : "idle"}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-white/90 font-light leading-relaxed">
                  {conversationSummary?.short || "Say something — the agent is listening and will summarize as you talk."}
                </p>

                {conversationSummary && conversationSummary.bullets.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowBullets((v) => !v)}
                      className="self-start flex items-center gap-1 text-[11px] font-mono text-white/50 hover:text-white transition-colors"
                    >
                      {showBullets ? "Hide details" : "View more details"}
                      <ChevronDown className={`w-3 h-3 transition-transform ${showBullets ? "rotate-180" : ""}`} />
                    </button>
                    {showBullets && (
                      <ul className="flex flex-col gap-1.5 pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                        {conversationSummary.bullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-white/70">
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-white/30 shrink-0" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              {/* Distill section */}
              <div className="flex flex-col gap-2 border-t border-foreground/5 pt-4">
                <Button
                  onClick={handleDistill}
                  disabled={distilling}
                  className="w-full bg-white hover:bg-neutral-200 text-black h-11 rounded-xl text-xs font-mono flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 fill-black" />
                  {distilling ? "Distilling Memory..." : "Distill notes → permanent memory"}
                </Button>
                <p className="text-[11px] font-sans text-muted-foreground leading-normal mt-1 font-light">
                  Notes stack up in the session tier. Distilling promotes them into the durable Cognee knowledge graph.
                </p>
              </div>

              {/* Forget section */}
              <div className="flex flex-col gap-2 border-t border-foreground/5 pt-4">
                <Button
                  onClick={handleForgetPerson}
                  disabled={forgetting}
                  variant="outline"
                  className="w-full border-red-500/20 hover:bg-red-500/15 text-red-400 h-10 rounded-xl text-xs font-mono flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {forgetting ? "Forgetting..." : "Forget this person"}
                </Button>
                <p className="text-[10px] font-sans text-red-400/60 leading-normal font-light">
                  Irreversible. Deletes Cognee memory dataset and local face registration.
                </p>
              </div>
            </div>
          )}

          {/* Toggle Logs Button Card */}
          <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <Button
              onClick={() => setShowLogs(!showLogs)}
              variant="outline"
              className="w-full border-foreground/10 hover:bg-white/5 text-white/80 h-10 rounded-xl text-xs font-mono flex items-center justify-center gap-2"
            >
              <Activity className="w-3.5 h-3.5" />
              {showLogs ? "Hide Logs" : "See Logs"}
            </Button>

            {showLogs && (
              <div className="flex flex-col gap-4 mt-2 pt-4 border-t border-foreground/5 animate-in fade-in duration-200">
                
                {/* Memory Operations */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-white/60" />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white">Memory Operations</h3>
                    </div>
                    <Badge variant="secondary" className="font-mono text-[10px] text-white bg-white/10 rounded-md">
                      {ops.length} ops
                    </Badge>
                  </div>

                  <div className="bg-black/30 border border-foreground/10 rounded-xl p-3 h-[120px] overflow-y-auto font-mono text-[10px] text-muted-foreground flex flex-col gap-1.5">
                    {ops.length === 0 ? (
                      <div className="text-center py-8 text-neutral-600">No memory operations tracked yet</div>
                    ) : (
                      [...ops].reverse().map((op, idx) => (
                        <div key={idx} className="flex gap-2 text-neutral-300 leading-normal border-b border-foreground/5 pb-1">
                          <span className="text-white/40 shrink-0">&gt;</span>
                          <span className="break-all">{op}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] font-sans text-muted-foreground leading-normal font-light">
                    Live log of Cognee graph calls: remember, recall, improve, forget.
                  </p>
                </div>

                {/* Console Logs */}
                <div className="flex flex-col gap-3 border-t border-foreground/5 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-white/60" />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white">Console Logs</h3>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-foreground/10 rounded-xl p-3 h-[120px] overflow-y-auto font-mono text-[10px] flex flex-col gap-1.5">
                    {logs.length === 0 ? (
                      <div className="text-center py-8 text-neutral-600">Console idle</div>
                    ) : (
                      logs.map((log, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-2 leading-normal border-b border-foreground/5 pb-1 ${
                            log.kind === "match"
                              ? "text-green-400"
                              : log.kind === "warn"
                              ? "text-yellow-400"
                              : log.kind === "err"
                              ? "text-red-400"
                              : "text-neutral-300"
                          }`}
                        >
                          <span className="text-white/20 shrink-0">[{log.time}]</span>
                          <span>{log.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Toggle API Settings Button Card */}
          <div className="border border-foreground/10 bg-card/40 backdrop-blur-xl rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
            <Button
              onClick={() => setShowApiSettings(!showApiSettings)}
              variant="outline"
              className="w-full border-foreground/10 hover:bg-white/5 text-white/80 h-10 rounded-xl text-xs font-mono flex items-center justify-center gap-2"
            >
              <Settings className="w-3.5 h-3.5" />
              {showApiSettings ? "Hide API Settings" : "LLM API Settings"}
            </Button>

            {showApiSettings && (
              <div className="flex flex-col gap-4 mt-2 pt-4 border-t border-foreground/5 animate-in fade-in duration-200">
                
                {/* LLM Provider Selection */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-white/60" />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white">LLM Provider</h3>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <select
                      value={llmProvider}
                      onChange={(e) => setLlmProvider(e.target.value as any)}
                      className="bg-black/30 border border-foreground/10 rounded-xl p-2.5 text-white text-xs font-mono focus:outline-none focus:border-foreground/30"
                    >
                      <option value="openai">OpenAI (GPT-4o, etc)</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="openrouter">OpenRouter (Multi-provider)</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="google">Google (Gemini)</option>
                      <option value="ollama">Ollama (Local)</option>
                    </select>
                  </div>
                  <p className="text-[10px] font-sans text-muted-foreground leading-normal font-light">
                    Select your LLM provider for memory distillation and reminders.
                  </p>
                </div>

                {/* API Key Input */}
                {llmProvider !== "ollama" && (
                  <div className="flex flex-col gap-3 border-t border-foreground/5 pt-4">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-white/60" />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white">API Key</h3>
                    </div>

                    <Input
                      type="password"
                      placeholder={`Enter your ${llmProvider} API key...`}
                      value={llmApiKey}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                      className="bg-black/30 border border-foreground/10 rounded-xl text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-foreground/30"
                    />
                    <p className="text-[10px] font-sans text-muted-foreground leading-normal font-light">
                      Your API key is stored locally and sent only to the LLM provider. Never shared or stored on our servers.
                    </p>
                  </div>
                )}

                {/* Ollama Base URL Input */}
                {llmProvider === "ollama" && (
                  <div className="flex flex-col gap-3 border-t border-foreground/5 pt-4">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-white/60" />
                      <h3 className="font-mono text-xs uppercase tracking-wider text-white">Ollama Base URL</h3>
                    </div>

                    <Input
                      type="text"
                      placeholder="http://localhost:11434/v1"
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                      className="bg-black/30 border border-foreground/10 rounded-xl text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-foreground/30"
                    />
                    <p className="text-[10px] font-sans text-muted-foreground leading-normal font-light">
                      Must be reachable from the backend server, not just your browser (e.g. use local IP or a tunnel if the server is remote).
                    </p>
                  </div>
                )}

                {/* Model Selection */}
                <div className="flex flex-col gap-3 border-t border-foreground/5 pt-4">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-white/60" />
                    <h3 className="font-mono text-xs uppercase tracking-wider text-white">Model</h3>
                  </div>

                  <Input
                    type="text"
                    placeholder={
                      llmProvider === "openai" ? "gpt-4o-mini" :
                      llmProvider === "anthropic" ? "claude-3-5-sonnet-20241022" :
                      llmProvider === "openrouter" ? "anthropic/claude-3.5-sonnet" :
                      llmProvider === "deepseek" ? "deepseek-chat" :
                      llmProvider === "google" ? "gemini-2.0-flash" :
                      "mistral:latest"
                    }
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="bg-black/30 border border-foreground/10 rounded-xl text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-foreground/30"
                  />
                  <p className="text-[10px] font-sans text-muted-foreground leading-normal font-light">
                    Model name to use for summarization and distillation.
                  </p>
                </div>

                {/* Save Settings Button */}
                <Button
                  onClick={() => {
                    fetch(`${getBackendUrl()}/api/llm/config`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({
                        provider: llmProvider,
                        api_key: llmApiKey,
                        model: llmModel,
                        base_url: llmBaseUrl,
                      }),
                    })
                      .then((r) => r.json())
                      .then((data) => {
                        if (data.success) {
                          addLog("LLM settings saved", "info");
                          toast.success("LLM settings saved");
                        } else {
                          addLog(`LLM settings error: ${data.error}`, "err");
                          toast.error(data.error || "Failed to save LLM settings");
                        }
                      })
                      .catch((e) => {
                        addLog(`LLM settings error: ${e.message}`, "err");
                        toast.error("Failed to save LLM settings");
                      });
                  }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white h-10 rounded-xl text-xs font-mono"
                >
                  Save LLM Settings
                </Button>
              </div>
            )}
          </div>

        </div>

      </main>
    </div>
  );
}
