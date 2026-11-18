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
import { Building2, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { horaCorta, type Centro, type Lugar } from "@/lib/estadia";

// Solo el administrador: crea los centros (con su hora límite de regreso) y
// los lugares o alojamientos de cada centro.
export const CentrosDialog = ({
  open,
  onOpenChange,
  centros,
  lugares,
  onCambio,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centros: Centro[];
  lugares: Lugar[];
  onCambio: () => void;
}) => {
  const [nombre, setNombre] = useState("");
  const [hora, setHora] = useState("23:00");
  const [guardando, setGuardando] = useState(false);

  const crearCentro = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    if (!n) return;
    setGuardando(true);
    const { error } = await supabase.from("centros").insert({ nombre: n, hora_limite: hora });
    setGuardando(false);
    if (error) {
      toast.error(
        error.code === "23505" ? `Ya existe un centro llamado "${n}"` : "No se pudo crear: " + error.message
      );
      return;
    }
    toast.success(`Centro creado: ${n}`);
    setNombre("");
    onCambio();
  };

  const actualizar = async (tabla: "centros" | "lugares", id: string, cambios: object) => {
    const { error } = await supabase.from(tabla).update(cambios).eq("id", id);
    if (error) {
      toast.error(
        error.code === "23505" ? "Ya existe uno con ese nombre" : "No se pudo guardar: " + error.message
      );
    }
    onCambio();
  };

  const eliminarCentro = async (c: Centro) => {
    if (
      !window.confirm(
        `¿Eliminar el centro "${c.nombre}" y todos sus lugares? Las listas quedarán sin centro. ` +
          "Si solo ya no se usa, mejor desactívalo."
      )
    )
      return;
    const { error } = await supabase.from("centros").delete().eq("id", c.id);
    if (error) toast.error("No se pudo eliminar: " + error.message);
    else toast(`Eliminado: ${c.nombre}`);
    onCambio();
  };

  const eliminarLugar = async (l: Lugar) => {
    if (!window.confirm(`¿Eliminar "${l.nombre}"? Las listas que iban ahí quedarán sin lugar.`)) return;
    const { error } = await supabase.from("lugares").delete().eq("id", l.id);
    if (error) toast.error("No se pudo eliminar: " + error.message);
    else toast(`Eliminado: ${l.nombre}`);
    onCambio();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-sign text-2xl font-bold">Centros y lugares</DialogTitle>
          <DialogDescription>
            Cada centro tiene su puerta y su hora límite: pasada esa hora se avisa quién no ha
            regresado. Dentro de cada centro están sus lugares o alojamientos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={crearCentro} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="centro-nombre">Nuevo centro</Label>
            <Input
              id="centro-nombre"
              placeholder="Ej. Kawai"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="w-28 space-y-1.5">
            <Label htmlFor="centro-hora">Hora límite</Label>
            <Input
              id="centro-hora"
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

        {centros.length === 0 ? (
          <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            Todavía no hay centros.
          </p>
        ) : (
          <div className="space-y-3">
            {centros.map((c) => (
              <CentroCard
                key={c.id}
                centro={c}
                lugares={lugares.filter((l) => l.centro_id === c.id)}
                onActualizar={actualizar}
                onEliminarCentro={eliminarCentro}
                onEliminarLugar={eliminarLugar}
                onCambio={onCambio}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const CentroCard = ({
  centro: c,
  lugares,
  onActualizar,
  onEliminarCentro,
  onEliminarLugar,
  onCambio,
}: {
  centro: Centro;
  lugares: Lugar[];
  onActualizar: (tabla: "centros" | "lugares", id: string, cambios: object) => void;
  onEliminarCentro: (c: Centro) => void;
  onEliminarLugar: (l: Lugar) => void;
  onCambio: () => void;
}) => {
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const crearLugar = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nuevo.trim();
    if (!n) return;
    setGuardando(true);
    const { error } = await supabase.from("lugares").insert({ nombre: n, centro_id: c.id });
    setGuardando(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? `"${n}" ya existe en ${c.nombre}`
          : "No se pudo crear: " + error.message
      );
      return;
    }
    setNuevo("");
    onCambio();
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2.5">
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <input
          defaultValue={c.nombre}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== c.nombre) onActualizar("centros", c.id, { nombre: v });
            else e.target.value = c.nombre;
          }}
          className="min-w-0 flex-1 rounded-sm bg-transparent font-semibold outline-none focus:ring-2 focus:ring-ring"
          aria-label="Nombre del centro"
        />
        <Input
          type="time"
          defaultValue={horaCorta(c.hora_limite)}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== horaCorta(c.hora_limite))
              onActualizar("centros", c.id, { hora_limite: e.target.value });
          }}
          className="h-8 w-[6.5rem] bg-card"
          aria-label={`Hora límite de ${c.nombre}`}
          title="Hora límite de regreso"
        />
        <Switch
          checked={c.activo}
          onCheckedChange={(v) => onActualizar("centros", c.id, { activo: v })}
          aria-label={c.activo ? "Activo" : "Inactivo"}
          title={c.activo ? "Activo" : "Inactivo (no se ofrece en listas nuevas)"}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onEliminarCentro(c)}
          aria-label={`Eliminar ${c.nombre}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="divide-y">
        {lugares.map((l) => (
          <div key={l.id} className="flex items-center gap-3 py-2 pl-9 pr-3">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              defaultValue={l.nombre}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== l.nombre) onActualizar("lugares", l.id, { nombre: v });
                else e.target.value = l.nombre;
              }}
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm outline-none focus:ring-2 focus:ring-ring"
              aria-label="Nombre del lugar"
            />
            <Switch
              checked={l.activo}
              onCheckedChange={(v) => onActualizar("lugares", l.id, { activo: v })}
              aria-label={l.activo ? "Activo" : "Inactivo"}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onEliminarLugar(l)}
              aria-label={`Eliminar ${l.nombre}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <form onSubmit={crearLugar} className="flex items-center gap-2 py-2 pl-9 pr-3">
          <Input
            placeholder={`Agregar lugar en ${c.nombre} (ej. Casona)`}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            className="h-8 text-sm"
            autoComplete="off"
          />
          <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={guardando || !nuevo.trim()}>
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </div>
    </div>
  );
};
