import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecordsList } from "@/components/RecordsList";
import { Auth } from "@/components/Auth";
import { toast } from "sonner";
import { Camera, Save, LogOut, List, X } from "lucide-react";
import { createWorker, Worker, PSM } from "tesseract.js";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
  birth_date?: string;
}

type FactilizaDniResponse = {
  status: number;
  success: boolean;
  message: string;
  data?: {
    numero?: string;
    nombres?: string;
    apellido_paterno?: string;
    apellido_materno?: string;
    nombre_completo?: string;
    fecha_nacimiento?: string;
    sexo?: string;
    direccion_completa?: string;
  };
};

const FACTILIZA_TOKEN = import.meta.env.VITE_FACTILIZA_TOKEN as
  | string
  | undefined;

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);

  // Cámara
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // overlay -> pixels
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mrzOverlayRef = useRef<HTMLDivElement | null>(null);

  // UI
  const [ocrLoading, setOcrLoading] = useState(false);
  const [lastDni, setLastDni] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [lastBirth, setLastBirth] = useState<string | null>(null);

  // Auto-scan control
  const scanningRef = useRef(false);
  const processingRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);

  // Anti-dup / cooldown (misma lectura repetida)
  const lastDetectedRef = useRef<string | null>(null);
  const lastDetectedAtRef = useRef<number>(0);
  const COOLDOWN_MS = 2500;

  // ✅ Anti-dup REAL (no permitir duplicados en la lista)
  const seenDnisRef = useRef<Set<string>>(new Set());

  // ✅ NUEVO: anti-spam del toast "ya registrado"
  const lastDupToastAtRef = useRef<number>(0);
  const DUP_TOAST_COOLDOWN_MS = 2000;

  // OCR worker persistente
  const workerRef = useRef<Worker | null>(null);

  // Beep (/public/beep.wav)
  const beepRef = useRef<HTMLAudioElement | null>(null);

  // ====== Sync Set con currentRecords (por si se cambia estado) ======
  useEffect(() => {
    const s = new Set<string>();
    for (const r of currentRecords) s.add(r.dni_number);
    seenDnisRef.current = s;
  }, [currentRecords]);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadSavedLists();
  }, [session]);

  useEffect(() => {
    if (session && showSavedLists) loadSavedLists();
  }, [showSavedLists, session]);

  const loadSavedLists = async () => {
    const { data, error } = await supabase
      .from("scan_lists")
      .select(`*, scanned_records (*)`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("No se pudieron cargar las listas guardadas");
      return;
    }
    setSavedLists(data || []);
  };

  // ================== Extract DNI (ROBUSTO) ==================
  // - Busca PER + 8 dígitos aunque haya ruido antes (AI<PER...)
  // - Tolera PER mal leído (P?R / PE?)
  // - Reemplaza letras que suelen confundirse en dígitos dentro del bloque del DNI
  const extractDni = (raw: string) => {
    let t = (raw || "").toUpperCase();
    t = t.replace(/\s+/g, "");
    // normalización para OCR:
    // (en zona numérica suelen confundir O->0, I/L->1, S->5, B->8, Z->2)
    const normalizeDigits = (s: string) =>
      s
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/S/g, "5")
        .replace(/B/g, "8")
        .replace(/Z/g, "2");

    // 1) PER + 8
    let m = t.match(/PER[<]*([0-9OILSBZ]{8})/);
    if (m?.[1]) return normalizeDigits(m[1]);

    // 2) tolerancias: P?R + 8 / PE? + 8
    m = t.match(/P[A-Z]R[<]*([0-9OILSBZ]{8})/);
    if (m?.[1]) return normalizeDigits(m[1]);

    m = t.match(/PE[A-Z][<]*([0-9OILSBZ]{8})/);
    if (m?.[1]) return normalizeDigits(m[1]);

    // 3) último recurso: cualquier bloque de 8
    m = t.match(/([0-9OILSBZ]{8})/);
    if (m?.[1]) return normalizeDigits(m[1]);

    return "";
  };

  // ================== Worker init/destroy ==================
  const initWorker = async () => {
    if (workerRef.current) return;

    const w = await createWorker("eng");
    await w.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      preserve_interword_spaces: "1",
      // ✅ en tesseract.js/TS, PSM debe ser enum, no string/numero
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });

    workerRef.current = w;
  };

  const destroyWorker = async () => {
    if (!workerRef.current) return;
    try {
      await workerRef.current.terminate();
    } catch {}
    workerRef.current = null;
  };

  // ================== Beep ==================
  const ensureBeepUnlocked = async () => {
    try {
      if (!beepRef.current) {
        beepRef.current = new Audio("/beep.wav");
        beepRef.current.preload = "auto";
      }
      // unlock en móviles (puede fallar, ok)
      beepRef.current.volume = 0.001;
      beepRef.current.currentTime = 0;
      await beepRef.current.play();
      beepRef.current.pause();
      beepRef.current.volume = 1;
      beepRef.current.currentTime = 0;
    } catch {}
  };

  const playBeep = async () => {
    try {
      if (!beepRef.current) {
        beepRef.current = new Audio("/beep.wav");
        beepRef.current.preload = "auto";
      }
      beepRef.current.volume = 1;
      beepRef.current.currentTime = 0;
      await beepRef.current.play();
    } catch {}
  };

  // ================== Cámara open/close ==================
  const openCamera = async () => {
    try {
      // reset UI
      setLastDni(null);
      setLastName(null);
      setLastBirth(null);

      lastDetectedRef.current = null;
      lastDetectedAtRef.current = 0;

      setShowCamera(true);
      await new Promise((r) => setTimeout(r, 80)); // deja renderizar video + overlay

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      streamRef.current = stream;

      if (!videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setShowCamera(false);
        toast.error("No se pudo inicializar el video.");
        return;
      }

      videoRef.current.srcObject = stream;

      await new Promise<void>((resolve) => {
        const v = videoRef.current!;
        const onLoaded = () => {
          v.removeEventListener("loadedmetadata", onLoaded);
          resolve();
        };
        v.addEventListener("loadedmetadata", onLoaded);
      });

      await videoRef.current.play();

      setOcrLoading(true);
      await initWorker();
      await ensureBeepUnlocked();
      setOcrLoading(false);

      startAutoScan();
      toast.success(
        "Escaneo automático activo. Alinea el MRZ en la franja verde."
      );
    } catch (err: any) {
      console.error(err);
      setShowCamera(false);

      const name = err?.name || "";
      if (name === "NotAllowedError") toast.error("Permiso de cámara denegado.");
      else if (name === "NotFoundError") toast.error("No se encontró cámara.");
      else if (name === "NotReadableError")
        toast.error("La cámara está siendo usada por otra app.");
      else if (name === "SecurityError")
        toast.error("La cámara requiere HTTPS (o localhost).");
      else toast.error("No se pudo abrir la cámara. Revisa permisos o HTTPS.");
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const closeCamera = async () => {
    stopAutoScan();
    scanningRef.current = false;
    processingRef.current = false;

    stopStream();
    setShowCamera(false);

    await destroyWorker();
  };

  // ================== AutoScan loop ==================
  const startAutoScan = () => {
    stopAutoScan();
    scanningRef.current = true;

    const loop = async () => {
      if (!scanningRef.current) return;
      await scanTick();
      loopTimerRef.current = window.setTimeout(loop, 850);
    };

    loopTimerRef.current = window.setTimeout(loop, 400);
  };

  const stopAutoScan = () => {
    scanningRef.current = false;
    if (loopTimerRef.current) {
      window.clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
  };

  // ================== Captura y OCR (2 pasadas) ==================
  const scanTick = async () => {
    if (processingRef.current) return;
    if (!workerRef.current) return;
    if (!videoRef.current || !containerRef.current || !mrzOverlayRef.current)
      return;

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const now = Date.now();

    // cooldown contra el mismo DNI repetido
    if (
      lastDetectedRef.current &&
      now - lastDetectedAtRef.current < COOLDOWN_MS
    ) {
      return;
    }

    processingRef.current = true;

    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const mrzRect = mrzOverlayRef.current.getBoundingClientRect();

      const relX = mrzRect.left - containerRect.left;
      const relY = mrzRect.top - containerRect.top;
      const relW = mrzRect.width;
      const relH = mrzRect.height;

      const scaleX = vw / containerRect.width;
      const scaleY = vh / containerRect.height;

      let cropX = Math.floor(relX * scaleX);
      let cropY = Math.floor(relY * scaleY);
      let cropW = Math.floor(relW * scaleX);
      let cropH = Math.floor(relH * scaleY);

      // ✅ agranda el recorte para no cortar "PER" ni la 1ra línea
      const extraX = Math.floor(cropW * 0.14);
      const extraTop = Math.floor(cropH * 0.75); // sube bastante para incluir línea donde aparece PER
      const extraBottom = Math.floor(cropH * 0.25);

      cropX = Math.max(0, cropX - extraX);
      cropW = Math.min(vw - cropX, cropW + extraX * 2);

      cropY = Math.max(0, cropY - extraTop);
      cropH = Math.min(vh - cropY, cropH + extraTop + extraBottom);

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;

      const ctx = cropCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // PASADA 1 (color)
      const colorBlob = await new Promise<Blob | null>((resolve) =>
        cropCanvas.toBlob(resolve, "image/jpeg", 0.95)
      );
      if (!colorBlob) return;

      const r1 = await workerRef.current.recognize(colorBlob);
      const raw1 = (r1.data.text || "").toUpperCase();
      const dni1 = extractDni(raw1);

      if (dni1 && dni1.length === 8) {
        await onDniDetected(dni1);
        return;
      }

      // PASADA 2 (enhance)
      const up = 2;
      const enhanced = document.createElement("canvas");
      enhanced.width = cropW * up;
      enhanced.height = cropH * up;

      const ectx = enhanced.getContext("2d");
      if (!ectx) return;

      ectx.imageSmoothingEnabled = true;
      ectx.drawImage(cropCanvas, 0, 0, enhanced.width, enhanced.height);

      const img = ectx.getImageData(0, 0, enhanced.width, enhanced.height);
      const d = img.data;

      const TH = 150;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const v = gray > TH ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ectx.putImageData(img, 0, 0);

      const blob2 = await new Promise<Blob | null>((resolve) =>
        enhanced.toBlob(resolve, "image/jpeg", 0.95)
      );
      if (!blob2) return;

      const r2 = await workerRef.current.recognize(blob2);
      const raw2 = (r2.data.text || "").toUpperCase();
      const dni2 = extractDni(raw2);

      if (dni2 && dni2.length === 8) {
        await onDniDetected(dni2);
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      processingRef.current = false;
    }
  };

  // ================== API ==================
  const fetchFromApi = async (dni: string) => {
    if (!FACTILIZA_TOKEN) {
      toast.error("Falta VITE_FACTILIZA_TOKEN en tu .env");
      return { nombre: "No disponible", fechaNac: "" };
    }

    try {
      const res = await fetch(`https://api.factiliza.com/v1/dni/info/${dni}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${FACTILIZA_TOKEN}` },
      });

      const json = (await res.json()) as FactilizaDniResponse;

      if (!res.ok || !json?.success || !json.data) {
        console.error("Factiliza error:", json);
        return { nombre: "No disponible", fechaNac: "" };
      }

      const nombre =
        json.data.nombre_completo ||
        [
          json.data.apellido_paterno,
          json.data.apellido_materno,
          json.data.nombres,
        ]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "No disponible";

      const fechaNac = json.data.fecha_nacimiento || "";

      return { nombre, fechaNac };
    } catch (err) {
      console.error(err);
      return { nombre: "No disponible", fechaNac: "" };
    }
  };

  // ================== Detectado: anti-dup + beep + api + agrega ==================
  // ================== Detectado: anti-dup + beep + api + agrega ==================
const onDniDetected = async (dni: string) => {
  const now = Date.now();

  lastDetectedRef.current = dni;
  lastDetectedAtRef.current = now;

  // ✅ DNI ya registrado -> mostrar mensaje
  if (seenDnisRef.current.has(dni)) {
    if (now - lastDupToastAtRef.current > DUP_TOAST_COOLDOWN_MS) {
      toast.warning(`DNI ya registrado: ${dni}`);
      lastDupToastAtRef.current = now;
    }
    return;
  }

  // “reserva” el dni para evitar duplicado mientras consulta API
  seenDnisRef.current.add(dni);

  setOcrLoading(true);
  await playBeep();

  const { nombre, fechaNac } = await fetchFromApi(dni);

  setLastDni(dni);
  setLastName(nombre);
  setLastBirth(fechaNac);

  // ✅ SOLO validar "No disponible" (fecha puede venir vacía y está OK)
  const nombreOk = !!nombre && nombre.trim() !== "" && nombre !== "No disponible";
  if (!nombreOk) {
    // permite reintentar si el API falló
    seenDnisRef.current.delete(dni);

    setOcrLoading(false);
    toast.error("No disponible: no se agregará a la lista.");
    return;
  }

  setCurrentRecords((prev) => {
    if (prev.some((r) => r.dni_number === dni)) return prev;
    return [
      ...prev,
      {
        id: crypto.randomUUID(),
        dni_number: dni,
        full_name: nombre,
        scanned_at: new Date().toISOString(),
        birth_date: fechaNac || "", // puede ser vacío y no pasa nada
      },
    ];
  });

  setOcrLoading(false);
  toast.success(`Agregado: ${dni}`);
};


  // ================== Guardar lista ==================
  const handleSaveList = async () => {
    if (!listTitle.trim()) {
      toast.error("Ingresa un título para la lista");
      return;
    }
    if (currentRecords.length === 0) {
      toast.error("No hay registros para guardar");
      return;
    }

    setLoading(true);
    try {
      const { data: list, error: listErr } = await supabase
        .from("scan_lists")
        .insert({ title: listTitle, user_id: session.user.id })
        .select()
        .single();

      if (listErr) throw listErr;

      const { error: recErr } = await supabase.from("scanned_records").insert(
        currentRecords.map((r) => ({
          scan_list_id: list.id,
          dni_number: r.dni_number,
          full_name: r.full_name,
          scanned_at: r.scanned_at,
          user_id: session.user.id,
        }))
      );

      if (recErr) throw recErr;

      toast.success("Lista guardada");
      setCurrentRecords([]);
      setListTitle("");

      // ✅ limpia también el set de duplicados para una nueva lista
      seenDnisRef.current = new Set();

      await loadSavedLists();
    } catch (e: any) {
      console.error(e);
      toast.error("Error al guardar: " + (e?.message ?? ""));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
  };

  if (!session) return <Auth />;

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-4">
      <div className="flex justify-between mb-4">
        <h1 className="text-3xl font-bold">
          {showSavedLists ? "Listas guardadas" : "Registro del Cliente"}
        </h1>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" /> Salir
        </Button>
      </div>

      {!showSavedLists ? (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Titulo de la Lista</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Input
                  id="title"
                  placeholder="Asistencia 18/11/2025"
                  value={listTitle}
                  onChange={(e) => setListTitle(e.target.value)}
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button onClick={openCamera} disabled={ocrLoading}>
                  <Camera className="w-4 h-4 mr-2" />
                  Abrir cámara
                </Button>
              </div>

              {showCamera && (
                <div className="space-y-3">
                  <div className="w-full bg-black rounded-xl p-4 flex items-center justify-center">
                    <div
                      ref={containerRef}
                      className="relative w-[92vw] max-w-[520px] aspect-[1.6/1] rounded-xl border-2 border-white/80 overflow-hidden"
                    >
                      <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        autoPlay
                        muted
                        playsInline
                      />

                      <div
                        ref={mrzOverlayRef}
                        className="absolute left-1/2 bottom-[10%] -translate-x-1/2
                                   w-[92%] h-[22%] rounded-lg
                                   border-2 border-emerald-300/90 bg-emerald-300/10"
                      />

                      <div className="absolute bottom-2 left-0 right-0 text-center text-white text-xs drop-shadow">
                        Escaneo automático activo. Alinea el MRZ COMPLETO (PER + 8
                        dígitos).
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    onClick={closeCamera}
                    className="w-full"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cerrar cámara
                  </Button>
                </div>
              )}

              {(lastDni || ocrLoading) && (
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle>
                      {ocrLoading ? "Consultando…" : "Última lectura"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>DNI</Label>
                      <Input value={lastDni ?? ""} readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre completo</Label>
                      <Input value={lastName ?? ""} readOnly />
                    </div>
                    {/*<div className="space-y-2">
                      <Label>Fecha de nacimiento</Label>
                      <Input value={lastBirth ?? ""} readOnly />
                    </div>*/}
                  </CardContent>
                </Card>
              )}

              <Button
                onClick={handleSaveList}
                disabled={loading || currentRecords.length === 0}
                variant="secondary"
              >
                <Save className="w-4 h-4 mr-2" />
                Guardar lista ({currentRecords.length})
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registros actuales</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordsList records={currentRecords} />
            </CardContent>
          </Card>

          <Button
            variant="outline"
            className="w-full mt-4"
            onClick={() => setShowSavedLists(true)}
          >
            <List className="w-4 h-4 mr-2" />
            Ver listas guardadas ({savedLists.length})
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            className="mb-4"
            onClick={() => setShowSavedLists(false)}
          >
            Volver
          </Button>

          <div className="space-y-4">
            {savedLists.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No hay listas guardadas aún
                </CardContent>
              </Card>
            ) : (
              savedLists.map((list) => (
                <Card key={list.id}>
                  <CardHeader>
                    <CardTitle>{list.title}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {new Date(list.created_at).toLocaleString("es-ES")}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <RecordsList records={list.scanned_records || []} />
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Index;
