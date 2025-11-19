import { useState, useEffect } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scanner } from "@/components/Scanner";
import { RecordsList } from "@/components/RecordsList";
import { Auth } from "@/components/Auth";
import { toast } from "sonner";
import { Camera, Save, LogOut, List } from "lucide-react";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
}

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);

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
    if (session) {
      loadSavedLists();
    }
  }, [session]);

  const loadSavedLists = async () => {
    const { data, error } = await supabase
      .from("scan_lists")
      .select(`
        *,
        scanned_records (*)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading lists:", error);
    } else {
      setSavedLists(data || []);
    }
  };

  const handleScanSuccess = (dni: string, fullName: string) => {
    const newRecord: Record = {
      id: crypto.randomUUID(),
      dni_number: dni,
      full_name: fullName,
      scanned_at: new Date().toISOString(),
    };

    setCurrentRecords((prev) => [...prev, newRecord]);
    setIsScannerActive(false);
  };

  const handleSaveList = async () => {
    if (!listTitle.trim()) {
      toast.error("Por favor ingresa un título para la lista");
      return;
    }

    if (currentRecords.length === 0) {
      toast.error("No hay registros para guardar");
      return;
    }

    setLoading(true);

    try {
      // Create the list
      const { data: listData, error: listError } = await supabase
        .from("scan_lists")
        .insert({
          title: listTitle,
          user_id: session.user.id,
        })
        .select()
        .single();

      if (listError) throw listError;

      // Insert all records
      const recordsToInsert = currentRecords.map((record) => ({
        scan_list_id: listData.id,
        dni_number: record.dni_number,
        full_name: record.full_name,
        scanned_at: record.scanned_at,
        user_id: session.user.id,
      }));

      const { error: recordsError } = await supabase
        .from("scanned_records")
        .insert(recordsToInsert);

      if (recordsError) throw recordsError;

      toast.success("Lista guardada exitosamente");
      setCurrentRecords([]);
      setListTitle("");
      loadSavedLists();
    } catch (error: any) {
      toast.error("Error al guardar la lista: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
  };

  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <div className="container max-w-4xl mx-auto p-4 pb-20">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-foreground">Escáner de DNI</h1>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Salir
          </Button>
        </div>

        {!showSavedLists ? (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Nueva Lista de Escaneo</CardTitle>
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

                <div className="flex gap-2">
                  <Button
                    onClick={() => setIsScannerActive(true)}
                    className="flex-1"
                    disabled={loading}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Escanear DNI
                  </Button>
                  <Button
                    onClick={handleSaveList}
                    disabled={loading || currentRecords.length === 0}
                    variant="secondary"
                    className="flex-1"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Guardar Lista ({currentRecords.length})
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Registros Actuales</CardTitle>
              </CardHeader>
              <CardContent>
                <RecordsList records={currentRecords} />
              </CardContent>
            </Card>

            <div className="mt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowSavedLists(true)}
              >
                <List className="w-4 h-4 mr-2" />
                Ver Listas Guardadas ({savedLists.length})
              </Button>
            </div>
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

      <Scanner
        isActive={isScannerActive}
        onScanSuccess={handleScanSuccess}
        onClose={() => setIsScannerActive(false)}
      />
    </div>
  );
};

export default Index;
