import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecordsList } from "@/components/RecordsList";
import { Auth } from "@/components/Auth";
import { toast } from "sonner";
import { Camera, Save, LogOut, List, Check, X } from "lucide-react";
import { createWorker } from "tesseract.js";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
}

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);

  // 📸 cámara real
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // OCR
  const [ocrLoading, setOcrLoading] = useState(false);
  const [previewDni, setPreviewDni] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadSavedLists();
  }, [session]);

  // ✅ Extra: cuando el usuario entra a "Listas guardadas", refrescamos
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
      // Importante: mostrar UI primero para que el video exista
      setShowCamera(true);
      await new Promise((r) => setTimeout(r, 50));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error(err);
      toast.error("No se pudo abrir la cámara. Revisa permisos o HTTPS.");
      setShowCamera(false);
    }
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  };

  const captureAndOcr = async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );

    if (!blob) return;

    closeCamera();
    await processOcr(blob);
  };

  // ================== OCR ==================
  const processOcr = async (blob: Blob) => {
    setOcrLoading(true);
    toast.info("Analizando foto del DNI...");

    try {
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(blob);
      await worker.terminate();

      const text = data.text.replace(/\s+/g, " ").toUpperCase();
      console.log("OCR:", text);

      // DNI desde MRZ: PER########
      const dniMatch = text.match(/PER(\d{8})/);
      const dni = dniMatch?.[1] ?? "";

      // Nombre desde MRZ: APELLIDO<<NOMBRE<OTRO
      let fullName = "Nombre no disponible";
      const nameMatch = text.match(/[A-Z]{3,}<<[A-Z<]{3,}/);
      if (nameMatch) {
        const [last, first] = nameMatch[0].split("<<");
        fullName = `${first.replace(/</g, " ").trim()} ${last
          .replace(/</g, " ")
          .trim()}`;
      }

      if (!dni) {
        toast.error("No se pudo detectar el DNI. Toma otra foto con más luz.");
        return;
      }

      setPreviewDni(dni);
      setPreviewName(fullName);
      toast.success("Datos detectados. Confirma para agregar.");
    } catch (err) {
      console.error(err);
      toast.error("Error al procesar la imagen");
    } finally {
      setOcrLoading(false);
    }
  };

  const confirmPreview = () => {
    if (!previewDni) return;

    setCurrentRecords((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        dni_number: previewDni,
        full_name: previewName ?? "",
        scanned_at: new Date().toISOString(),
      },
    ]);

    setPreviewDni(null);
    setPreviewName(null);
  };

  const cancelPreview = () => {
    setPreviewDni(null);
    setPreviewName(null);
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
          {showSavedLists ? "Listas guardadas" : "Registro por DNI (OCR)"}
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

              <Button onClick={openCamera} disabled={ocrLoading}>
                <Camera className="w-4 h-4 mr-2" />
                Tomar foto del DNI
              </Button>

              {showCamera && (
                <div className="space-y-2">
                  <video
                    ref={videoRef}
                    className="w-full rounded-lg"
                    autoPlay
                    muted
                    playsInline
                  />
                  <div className="flex gap-2">
                    <Button onClick={captureAndOcr} className="flex-1">
                      <Check className="w-4 h-4 mr-2" />
                      Capturar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={closeCamera}
                      className="flex-1"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {previewDni && (
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle>Datos detectados (OCR)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>DNI</Label>
                      <Input value={previewDni} readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre completo</Label>
                      <Input value={previewName ?? ""} readOnly />
                    </div>

                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={confirmPreview}>
                        Confirmar y agregar
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        onClick={cancelPreview}
                      >
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
