import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecordsList } from "@/components/RecordsList";
import { Auth } from "@/components/Auth";
import { toast } from "sonner";
import {
  Camera,
  Save,
  LogOut,
  List,
  Check,
  X,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { createWorker } from "tesseract.js";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
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

const FACTILIZA_TOKEN = import.meta.env.VITE_FACTILIZA_TOKEN as string | undefined;

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);

  // 📸 Cámara
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ✅ refs overlay -> pixels
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mrzOverlayRef = useRef<HTMLDivElement | null>(null);

  // OCR + Preview
  const [ocrLoading, setOcrLoading] = useState(false);
  const [previewDni, setPreviewDni] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewBirth, setPreviewBirth] = useState<string | null>(null);

  // Debug recorte
  const [showCropPreview, setShowCropPreview] = useState(false);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
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
      console.error("Error loading lists:", error);
      toast.error("No se pudieron cargar las listas guardadas");
      return;
    }
    setSavedLists(data || []);
  };

  // ================== CÁMARA ==================
  const openCamera = async () => {
    try {
      setShowCamera(true);
      await new Promise((r) => setTimeout(r, 60));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      } else {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setShowCamera(false);
        toast.error("No se pudo inicializar el video.");
      }
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

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  };

  // ================== CAPTURA (recorta EXACTO lo verde) ==================
  const captureAndOcr = async () => {
    if (!videoRef.current || !containerRef.current || !mrzOverlayRef.current) return;

    const video = videoRef.current;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;

    // DOM rects
    const containerRect = containerRef.current.getBoundingClientRect();
    const mrzRect = mrzOverlayRef.current.getBoundingClientRect();

    const relX = mrzRect.left - containerRect.left;
    const relY = mrzRect.top - containerRect.top;
    const relW = mrzRect.width;
    const relH = mrzRect.height;

    const scaleX = vw / containerRect.width;
    const scaleY = vh / containerRect.height;

    const cropX = Math.max(0, Math.floor(relX * scaleX));
    const cropY = Math.max(0, Math.floor(relY * scaleY));
    const cropW = Math.min(vw - cropX, Math.floor(relW * scaleX));
    const cropH = Math.min(vh - cropY, Math.floor(relH * scaleY));

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;

    const ctx = cropCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Preview color (debug)
    if (showCropPreview) {
      const colorBlob = await new Promise<Blob | null>((resolve) =>
        cropCanvas.toBlob(resolve, "image/jpeg", 0.95)
      );
      if (colorBlob) {
        if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
        setCropPreviewUrl(URL.createObjectURL(colorBlob));
      }
    }

    // Mejorar: escala + binarización
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

    const TH = 120;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = gray > TH ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ectx.putImageData(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      enhanced.toBlob(resolve, "image/jpeg", 0.95)
    );
    if (!blob) return;

    closeCamera();
    await processOcr(blob);
  };

  // ================== OCR -> SOLO DNI ==================
  const processOcr = async (blob: Blob) => {
    setOcrLoading(true);
    toast.info("Leyendo DNI (OCR)...");

    try {
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        preserve_interword_spaces: "1",
      });

      const { data } = await worker.recognize(blob);
      await worker.terminate();

      // OJO: aquí NO quitamos todo sin control: lo normalizamos a una sola cadena
      let text = (data.text || "").toUpperCase();
      text = text.replace(/\s+/g, ""); // MRZ sin espacios
      console.log("MRZ OCR:", text);

      // ✅ Extrae DNI desde MRZ con tolerancias (tu ejemplo: AI<PER41890829<1...)
      const dniMatch =
        text.match(/PER(\d{8})/) ||
        text.match(/P[A-Z]R(\d{8})/) ||
        text.match(/PE[A-Z](\d{8})/) ||
        text.match(/PER[<]*?(\d{8})/);

      const dni = dniMatch?.[1] ?? "";

      if (!dni) {
        toast.error("No se pudo leer el DNI. Acerca el MRZ, evita reflejos y captura de nuevo.");
        return;
      }

      setPreviewDni(dni);

      // ✅ Ahora validamos y traemos datos por API
      await fetchAndFillFromApi(dni);
    } catch (err) {
      console.error(err);
      toast.error("Error al procesar el OCR");
    } finally {
      setOcrLoading(false);
    }
  };

  // ================== API FACTILIZA ==================
  const fetchAndFillFromApi = async (dni: string) => {
    if (!FACTILIZA_TOKEN) {
      toast.error("Falta VITE_FACTILIZA_TOKEN en tu .env");
      return;
    }

    toast.info("Consultando datos del DNI...");

    try {
      const res = await fetch(`https://api.factiliza.com/v1/dni/info/${dni}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${FACTILIZA_TOKEN}`,
        },
      });

      const json = (await res.json()) as FactilizaDniResponse;

      if (!res.ok || !json?.success || !json.data) {
        console.error("Factiliza error:", json);
        toast.error("No se pudo obtener datos del DNI desde el API");
        setPreviewName("No disponible");
        setPreviewBirth("");
        return;
      }

      // data.nombre_completo y data.fecha_nacimiento existen en la doc :contentReference[oaicite:1]{index=1}
      const nombre =
        json.data.nombre_completo ||
        [json.data.apellido_paterno, json.data.apellido_materno, json.data.nombres]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "No disponible";

      const fechaNac = json.data.fecha_nacimiento || "";

      setPreviewName(nombre);
      setPreviewBirth(fechaNac);

      toast.success("Datos obtenidos del API. Confirma para agregar.");
    } catch (err) {
      console.error(err);
      toast.error("Error consultando el API (revisa token / CORS / red)");
      setPreviewName("No disponible");
      setPreviewBirth("");
    }
  };

  // ================== CONFIRMAR ==================
  const confirmPreview = () => {
    if (!previewDni) return;

    setCurrentRecords((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        dni_number: previewDni,
        full_name: previewName ?? "No disponible",
        scanned_at: new Date().toISOString(),
      },
    ]);

    setPreviewDni(null);
    setPreviewName(null);
    setPreviewBirth(null);
  };

  const cancelPreview = () => {
    setPreviewDni(null);
    setPreviewName(null);
    setPreviewBirth(null);
  };

  // ================== GUARDADO ==================
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
          // Si luego agregas columna birth_date, recién lo guardas aquí.
          // birth_date: ???,
        }))
      );

      if (recErr) throw recErr;

      toast.success("Lista guardada");
      setCurrentRecords([]);
      setListTitle("");
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
          {showSavedLists ? "Listas guardadas" : "Registro por DNI (OCR + API)"}
        </h1>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" /> Salir
        </Button>
      </div>

      {!showSavedLists ? (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Nueva Lista</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título de la lista</Label>
                <Input
                  id="title"
                  placeholder="Ej: Asistencia 18/11/2025"
                  value={listTitle}
                  onChange={(e) => setListTitle(e.target.value)}
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button onClick={openCamera} disabled={ocrLoading}>
                  <Camera className="w-4 h-4 mr-2" />
                  Abrir cámara
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCropPreview((v) => !v)}
                >
                  {showCropPreview ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-2" /> Ocultar recorte
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" /> Ver recorte MRZ
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPreviewDni(null);
                    setPreviewName(null);
                    setPreviewBirth(null);
                    toast.info("Listo, vuelve a capturar.");
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reintentar
                </Button>
              </div>

              {/* CÁMARA + MARCO GUIA */}
              {showCamera && (
                <div className="space-y-2">
                  <div
                    ref={containerRef}
                    className="relative w-full overflow-hidden rounded-lg border"
                  >
                    <video ref={videoRef} className="w-full" autoPlay muted playsInline />

                    {/* Overlay guía */}
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute inset-0 bg-black/35" />

                      <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                                   w-[90%] max-w-[520px] aspect-[1.6/1] rounded-xl
                                   border-2 border-white/80 bg-transparent shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]"
                      />

                      {/* ✅ Este rectángulo se usa para recortar */}
                      <div
                        ref={mrzOverlayRef}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[22%]
                                   w-[86%] max-w-[500px] h-[20%] rounded-lg
                                   border-2 border-emerald-300/90 bg-emerald-300/10"
                      />

                      <div className="absolute bottom-3 left-0 right-0 text-center text-white text-sm drop-shadow">
                        Alinea el DNI dentro del marco. El MRZ va en la franja verde.
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={captureAndOcr} className="flex-1" disabled={ocrLoading}>
                      <Check className="w-4 h-4 mr-2" />
                      Capturar y analizar
                    </Button>
                    <Button variant="outline" onClick={closeCamera} className="flex-1">
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {/* Preview del recorte MRZ (debug) */}
              {showCropPreview && cropPreviewUrl && (
                <Card className="border-emerald-300/40">
                  <CardHeader>
                    <CardTitle>Vista previa del recorte MRZ (debug)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <img
                      src={cropPreviewUrl}
                      alt="MRZ crop preview"
                      className="w-full rounded-md border"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Si aquí el MRZ se ve cortado/borroso, acerca el DNI y evita reflejos.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Preview (DNI + API) */}
              {previewDni && (
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle>Datos detectados</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>DNI</Label>
                      <Input value={previewDni} readOnly />
                    </div>

                    <div className="space-y-2">
                      <Label>Nombre completo (API)</Label>
                      <Input value={previewName ?? ""} readOnly />
                    </div>

                    <div className="space-y-2">
                      <Label>Fecha de nacimiento (API)</Label>
                      <Input value={previewBirth ?? ""} readOnly />
                    </div>

                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={confirmPreview}>
                        Confirmar y agregar
                      </Button>
                      <Button className="flex-1" variant="outline" onClick={cancelPreview}>
                        Cancelar
                      </Button>
                    </div>
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
          <Button variant="outline" className="mb-4" onClick={() => setShowSavedLists(false)}>
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
