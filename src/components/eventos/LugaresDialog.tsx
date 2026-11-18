import { useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { horaCorta, type Lugar } from "@/lib/estadia";

// Solo el administrador: crea los lugares (sedes) a donde van las listas y
// define la hora límite de regreso de cada uno.
export const LugaresDialog = ({
  open,
  onOpenChange,
  lugares,
  onCambio,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lugares: Lugar[];
  onCambio: () => void;
}) => {
  const [nombre, setNombre] = useState("");
  const [hora, setHora] = useState("23:00");
  const [guardando, setGuardando] = useState(false);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    if (!n) return;
    setGuardando(true);
    const { error } = await supabase.from("lugares").insert({ nombre: n, hora_limite: hora });
    setGuardando(false);
    if (error) {
      toast.error(
        error.code === "23505" ? `Ya existe un lugar llamado "${n}"` : "No se pudo crear: " + error.message
      );
      return;
    }
    toast.success(`Lugar creado: ${n}`);
    setNombre("");
    onCambio();
  };

  const actualizar = async (l: Lugar, cambios: Partial<Lugar>) => {
    const { error } = await supabase.from("lugares").update(cambios).eq("id", l.id);
    if (error) toast.error("No se pudo guardar: " + error.message);
    onCambio();
  };

  const eliminar = async (l: Lugar) => {
    if (
      !window.confirm(
        `¿Eliminar "${l.nombre}"? Las listas que iban a este lugar quedarán sin lugar. ` +
          "Si solo ya no se usa, mejor desactívalo."
      )
    )
      return;
    const { error } = await supabase.from("lugares").delete().eq("id", l.id);
    if (error) toast.error("No se pudo eliminar: " + error.message);
    else toast(`Eliminado: ${l.nombre}`);
    onCambio();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-sign text-2xl font-bold">Lugares</DialogTitle>
          <DialogDescription>
            Sedes o instalaciones a donde va cada lista. La hora límite es cuando deben haber
            regresado los que salieron; pasada esa hora la puerta avisa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={crear} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="lugar-nombre">Nuevo lugar</Label>
            <Input
              id="lugar-nombre"
              placeholder="Ej. Campamento Norte"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="w-28 space-y-1.5">
            <Label htmlFor="lugar-hora">Hora límite</Label>
            <Input
              id="lugar-hora"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={guardando || !nombre.trim()}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Agregar</span>
          </Button>
        </form>

        <div className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
          {lugares.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Todavía no hay lugares.
            </p>
          ) : (
            lugares.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  defaultValue={l.nombre}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== l.nombre) actualizar(l, { nombre: v });
                    else e.target.value = l.nombre;
                  }}
                  className="min-w-0 flex-1 rounded-sm bg-transparent font-medium outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Nombre del lugar"
                />
                <Input
                  type="time"
                  defaultValue={horaCorta(l.hora_limite)}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== horaCorta(l.hora_limite))
                      actualizar(l, { hora_limite: e.target.value });
                  }}
                  className="h-8 w-[6.5rem]"
                  aria-label={`Hora límite de ${l.nombre}`}
                />
                <Switch
                  checked={l.activo}
                  onCheckedChange={(v) => actualizar(l, { activo: v })}
                  aria-label={l.activo ? "Activo" : "Inactivo"}
                  title={l.activo ? "Activo" : "Inactivo (no se ofrece en listas nuevas)"}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => eliminar(l)}
                  aria-label={`Eliminar ${l.nombre}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
