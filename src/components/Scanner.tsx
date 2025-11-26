import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
} from "@zxing/library";

import { Camera, XCircle, Flashlight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ScannerProps {
  onScanSuccess: (dni: string, fullName: string) => void;
  isActive: boolean;
  onClose: () => void;
}

export const Scanner = ({ onScanSuccess, isActive, onClose }: ScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  let lastScanTimestamp = 0;

  // ============================
  // USE EFFECT
  // ============================
  useEffect(() => {
    if (isActive && !isScanning) {
      startScanner();
    }

    return () => stopScanner();
  }, [isActive]);

  // ============================
  // START SCANNER (CORREGIDO)
  // ============================
  const startScanner = async () => {
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);

      codeReaderRef.current = new BrowserMultiFormatReader(hints);

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();

      if (!devices.length) throw new Error("No se encontraron cámaras");

      // 📌 Selección segura de cámara (corrige labels vacíos)
      let cameraId = devices[0].deviceId;

      if (devices.length > 1) {
        const backCam = devices.find((d) =>
          (d.label?.toLowerCase() ?? "").includes("back") ||
          (d.label?.toLowerCase() ?? "").includes("rear")
        );
        if (backCam) cameraId = backCam.deviceId;
      }

      // 📌 Stream SIN advanced (corrige error en Chrome)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: cameraId ? { exact: cameraId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      videoRef.current!.srcObject = stream;
      trackRef.current = stream.getVideoTracks()[0];

      // ============================
      // ESCANEO CONTINUO
      // ============================
      codeReaderRef.current.decodeFromVideoDevice(
        cameraId,
        videoRef.current!,
        (result) => {
          if (result) {
            const now = Date.now();
            if (now - lastScanTimestamp < 2000) return;

            lastScanTimestamp = now;

            vibrate();
            playBeep();
            handleScanSuccess(result.getText());
          }
        }
      );

      setIsScanning(true);
    } catch (error: any) {
      console.error("CAMERA ERROR:", error);
      toast.error(`No se pudo acceder a la cámara: ${error.message}`);
      onClose();
    }
  };

  // ============================
  // STOP SCANNER
  // ============================
  const stopScanner = async () => {
    try {
      const reader: any = codeReaderRef.current;
      if (reader?.reset) reader.reset();
      if (reader?.stopContinuousDecode) reader.stopContinuousDecode();

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }

      videoRef.current!.srcObject = null;
      setIsScanning(false);
    } catch (err) {
      console.error("Stop error:", err);
    }
  };

  // ============================
  // EFECTOS DE BEEP Y VIBRACIÓN
  // ============================
  const playBeep = () => {
    const audio = new Audio("/beep.mp3");
    audio.volume = 0.4;
    audio.play().catch(() => {});
  };

  const vibrate = () => {
    if (navigator.vibrate) navigator.vibrate(120);
  };

  // ============================
  // FLASH ON/OFF
  // ============================
  const toggleFlash = async () => {
    try {
      const track = trackRef.current;
      if (!track) return;

      const caps: any = track.getCapabilities();
      if (!caps?.torch) {
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

  // ============================
  // PROCESAR RESULTADO DNI
  // ============================
  const handleScanSuccess = (text: string) => {
    try {
      let dni = "";
      let fullName = "";

      if (text.length >= 125) {
        dni = text.substring(2, 10).trim();
        const ap1 = text.substring(10, 50).trim();
        const ap2 = text.substring(50, 90).trim();
        const nombres = text.substring(90, 125).trim();
        fullName = `${nombres} ${ap1} ${ap2}`;
      } else {
        const match = text.match(/\d{8}/);
        dni = match ? match[0] : "";
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

  // ============================
  // CERRAR SCANNER
  // ============================
  const handleClose = async () => {
    await stopScanner();
    onClose();
  };

  if (!isActive) return null;

  // ============================
  // UI (SIN MODIFICACIONES)
  // ============================
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
        <video
          ref={videoRef}
          className="rounded-xl w-full max-w-md shadow-lg"
          autoPlay
          muted
        />
      </div>

      <div className="p-4 text-center text-white">
        <p className="text-sm opacity-80">
          Enfoca el código PDF417 del DNI dentro del marco
        </p>
      </div>
    </div>
  );
};
