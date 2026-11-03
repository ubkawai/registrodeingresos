import { useEffect, useRef, useState } from "react";
import { Camera, XCircle, Flashlight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { extractDniFromBarcode } from "@/lib/dni";

// ⬇️ IMPORTAMOS ZXING EN WASM
import { readBarcodes, type ReaderOptions } from "zxing-wasm";

// Proporción ancho/alto de la franja de la cámara (horizontal, como el código del DNI)
const STRIP_ASPECT = 2.4;

interface ScannerProps {
  onScanSuccess: (dni: string, fullName: string) => void;
  isActive: boolean;
  onClose: () => void;
}

export const Scanner = ({ onScanSuccess, isActive, onClose }: ScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const lastScanRef = useRef(0);
  const loopIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isActive && !isScanning) {
      startScanner();
    }

    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const startScanner = async () => {
    try {
      // 1) Encendemos la cámara
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" } as any],
        } as any,
        audio: false,
      });

      if (!videoRef.current) return;

      videoRef.current.srcObject = stream;
      trackRef.current = stream.getVideoTracks()[0];

      // 2) Iniciamos el loop de escaneo con WASM
      startScanLoop();

      setIsScanning(true);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo acceder a la cámara");
      onClose();
    }
  };

  const startScanLoop = () => {
    if (loopIdRef.current !== null) return;

    const loop = async () => {
      await scanFrameWithWasm();
      loopIdRef.current = window.requestAnimationFrame(loop);
    };

    loopIdRef.current = window.requestAnimationFrame(loop);
  };

  const stopScanner = async () => {
    try {
      if (loopIdRef.current !== null) {
        window.cancelAnimationFrame(loopIdRef.current);
        loopIdRef.current = null;
      }

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }

      setIsScanning(false);
    } catch (err) {
      console.error("Stop error:", err);
    }
  };

  // 🔔 Sonido
  const playBeep = () => {
    const audio = new Audio("/beep.mp3");
    audio.volume = 0.4;
    audio.play().catch(() => {});
  };

  // 📳 Vibración
  const vibrate = () => {
    if (navigator.vibrate) navigator.vibrate(120);
  };

  // 🔦 Linterna
  const toggleFlash = async () => {
    try {
      const track = trackRef.current;
      if (!track) return;

      const caps: any = track.getCapabilities();
      if (!caps.torch) {
        toast.error("El dispositivo no soporta linterna");
        return;
      }

      await track.applyConstraints({
        advanced: [{ torch: !flashOn }] as any,
      });

      setFlashOn(!flashOn);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo activar la linterna");
    }
  };

  // 🧠 Escaneo del frame con WASM (PDF417 principal)
  const scanFrameWithWasm = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) return;

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (!videoW || !videoH) return;

    // Solo analizamos la franja visible (el video se muestra con object-cover)
    let width = videoW;
    let height = Math.round(videoW / STRIP_ASPECT);
    if (height > videoH) {
      height = videoH;
      width = Math.round(videoH * STRIP_ASPECT);
    }
    const sx = Math.round((videoW - width) / 2);
    const sy = Math.round((videoH - height) / 2);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Dibujamos la franja central del frame actual
    ctx.drawImage(video, sx, sy, width, height, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    try {
      const options: ReaderOptions = {
        // PDF417 del reverso del DNI y el código de barras lineal con el número
        formats: [
          "PDF417",
          "Code128",
          "Code39",
          "Code93",
          "ITF",
          "Codabar",
          "EAN-13",
          "QRCode",
          "DataMatrix",
        ],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      };

      const results = await readBarcodes(imageData, options);
      if (!results || results.length === 0) return;

      const now = Date.now();
      if (now - lastScanRef.current < 1500) return; // anti-duplicados
      lastScanRef.current = now;

      const result = results[0];
      const text = result.text;

      // Un código que no trae un DNI (p. ej. otro código del carné) se ignora
      // y se sigue buscando.
      if (!extractDniFromBarcode(text)) return;

      vibrate();
      playBeep();
      handleScanSuccess(text);
    } catch (err) {
      // No hacemos toast aquí para no saturar, solo log
      // console.error("WASM scan error:", err);
    }
  };

  const handleScanSuccess = (text: string) => {
    try {
      let dni = "";
      let fullName = "";

      // Parsing del DNI peruano desde PDF417
      dni = extractDniFromBarcode(text);
      if (text.length >= 125) {
        const ap1 = text.substring(10, 50).trim();
        const ap2 = text.substring(50, 90).trim();
        const nombres = text.substring(90, 125).trim();
        fullName = `${nombres} ${ap1} ${ap2}`;
      } else {
        fullName = "Nombre no disponible";
      }

      if (!dni) {
        toast.error("No se pudo leer el DNI, intenta nuevamente");
        return;
      }

      stopScanner();
      onScanSuccess(dni, fullName);
      toast.success("DNI leído correctamente");
    } catch (err) {
      console.error(err);
      toast.error("Error procesando el código");
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onClose();
  };

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex justify-between items-center p-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Camera className="w-6 h-6" />
          Escanear DNI
        </h2>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFlash}
            className="text-white hover:bg-white/10"
          >
            <Flashlight
              className={`w-6 h-6 ${flashOn ? "text-yellow-400" : ""}`}
            />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="text-white hover:bg-white/10"
          >
            <XCircle className="w-6 h-6" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-md overflow-hidden rounded-xl shadow-lg ring-2 ring-white/20"
          style={{ aspectRatio: `${STRIP_ASPECT}` }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />
          {/* Esquinas del marco a los costados de la franja */}
          <div className="pointer-events-none absolute inset-y-3 left-3 w-6 rounded-l-md border-y-4 border-l-4 border-green-400" />
          <div className="pointer-events-none absolute inset-y-3 right-3 w-6 rounded-r-md border-y-4 border-r-4 border-green-400" />
          {/* Línea verde que barre la franja buscando el código */}
          <div className="pointer-events-none absolute inset-x-6 h-0.5 -translate-y-1/2 animate-scan-line bg-green-400 shadow-[0_0_8px_2px_rgba(74,222,128,0.8)]" />
        </div>
        {/* Canvas oculto para procesar los frames con WASM */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="p-4 text-center text-white">
        <p className="text-sm opacity-80">
          Enfoca el código de barras del DNI, de cerca y con buena luz
        </p>
      </div>
    </div>
  );
};
