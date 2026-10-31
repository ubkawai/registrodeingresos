import { useEffect, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, Clock, Loader2, Pencil, Plus, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cruzaMedianoche,
  hhmm,
  turnoHorario,
  type Empleador,
  type Turno,
} from "@/lib/asistencia";

export const Configuracion = ({
  turnos,
  empleador,
  onTurnosChange,
  onEmpleadorChange,
}: {
  turnos: Turno[];
  empleador: Empleador | null;
  onTurnosChange: () => Promise<void>;
  onEmpleadorChange: () => Promise<void>;
}) => {
  const [editando, setEditando] = useState<Turno | "nuevo" | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print:hidden">
        <h1 className="font-sign text-3xl font-bold">Turnos y empresa</h1>
        <p className="text-sm text-muted-foreground">
          Cambiar un horario no altera las jornadas ya registradas
        </p>
      </div>

      <div className="space-y-6 print:hidden">
        <EmpleadorForm empleador={empleador} onSaved={onEmpleadorChange} />

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5" />
              Turnos
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Horario para exhibir
              </Button>
              <Button size="sm" onClick={() => setEditando("nuevo")}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <ul className="divide-y">
              {turnos.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", !t.activo && "text-muted-foreground line-through")}>
                      {t.nombre}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="tabular-nums">{turnoHorario(t)}</span>
                      {cruzaMedianoche(t) && " (termina al día siguiente)"}
                      {" · "}
                      {t.refrigerio_min ? `refrigerio ${t.refrigerio_min} min` : "sin refrigerio"}
                    </p>
                  </div>
                  {!t.activo && <Badge variant="outline">Inactivo</Badge>}
                  <Button variant="ghost" size="icon" onClick={() => setEditando(t)} aria-label={`Editar ${t.nombre}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <p className="text-xs leading-relaxed text-muted-foreground">
          La norma pide exhibir permanentemente en el centro de trabajo el horario, la duración del
          refrigerio y la tolerancia. Usa “Horario para exhibir” para imprimirlo. El refrigerio no
          puede ser menor de 45 minutos.
        </p>
      </div>

      {/* ================== Cartel imprimible ================== */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">Horario de trabajo</h1>
        <p className="mt-1">
          {empleador?.razon_social} {empleador?.ruc && `· RUC ${empleador.ruc}`}
        </p>
        <table className="mt-6 w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="border px-3 py-2">Turno</th>
              <th className="border px-3 py-2">Ingreso</th>
              <th className="border px-3 py-2">Salida</th>
              <th className="border px-3 py-2">Refrigerio</th>
            </tr>
          </thead>
          <tbody>
            {turnos
              .filter((t) => t.activo)
              .map((t) => (
                <tr key={t.id}>
                  <td className="border px-3 py-2">{t.nombre}</td>
                  <td className="border px-3 py-2">{hhmm(t.hora_inicio)}</td>
                  <td className="border px-3 py-2">
                    {hhmm(t.hora_fin)}
                    {cruzaMedianoche(t) && " (día siguiente)"}
                  </td>
                  <td className="border px-3 py-2">
                    {t.refrigerio_min ? `${t.refrigerio_min} minutos` : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-4">
          Tolerancia de ingreso:{" "}
          {empleador?.tolerancia_min ? `${empleador.tolerancia_min} minutos` : "no hay tolerancia"}
        </p>
        <p className="mt-2 text-sm">
          Registro de control de asistencia conforme al D.S. 004-2006-TR. La asistencia se marca de
          forma personal con el DNI.
        </p>
      </div>

      <TurnoDialog
        turno={editando}
        onClose={() => setEditando(null)}
        onSaved={async () => {
          setEditando(null);
          await onTurnosChange();
        }}
      />
    </div>
  );
};

const EmpleadorForm = ({
  empleador,
  onSaved,
}: {
  empleador: Empleador | null;
  onSaved: () => Promise<void>;
}) => {
  const [razon, setRazon] = useState("");
  const [ruc, setRuc] = useState("");
  const [tolerancia, setTolerancia] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRazon(empleador?.razon_social ?? "");
    setRuc(empleador?.ruc ?? "");
    setTolerancia(String(empleador?.tolerancia_min ?? 0));
  }, [empleador]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ruc && !/^\d{11}$/.test(ruc)) {
      toast.error("El RUC debe tener 11 dígitos");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("empleador")
      .update({
        razon_social: razon.trim(),
        ruc,
        tolerancia_min: Math.min(60, Math.max(0, Number(tolerancia) || 0)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Datos del empleador guardados");
    await onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-5 w-5" />
          Empleador
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="razon">Razón social</Label>
            <Input id="razon" value={razon} onChange={(e) => setRazon(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ruc">RUC</Label>
            <Input
              id="ruc"
              value={ruc}
              onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
              inputMode="numeric"
              className="dni"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tol">Tolerancia (min)</Label>
            <Input
              id="tol"
              type="number"
              min={0}
              max={60}
              value={tolerancia}
              onChange={(e) => setTolerancia(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          La tolerancia se aplica a las jornadas que empiecen desde ahora. Una entrada después de
          la tolerancia cuenta la tardanza completa desde la hora de ingreso.
        </p>
      </CardContent>
    </Card>
  );
};

const TurnoDialog = ({
  turno,
  onClose,
  onSaved,
}: {
  turno: Turno | "nuevo" | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) => {
  const nuevo = turno === "nuevo";
  const [nombre, setNombre] = useState("");
  const [inicio, setInicio] = useState("08:00");
  const [fin, setFin] = useState("17:00");
  const [refrigerio, setRefrigerio] = useState("45");
  const [activo, setActivo] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!turno) return;
    const t = turno === "nuevo" ? null : turno;
    setNombre(t?.nombre ?? "");
    setInicio(hhmm(t?.hora_inicio) || "08:00");
    setFin(hhmm(t?.hora_fin) || "17:00");
    setRefrigerio(String(t?.refrigerio_min ?? 45));
    setActivo(t?.activo ?? true);
  }, [turno]);

  const ref = Number(refrigerio) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inicio === fin) {
      toast.error("La hora de salida debe ser distinta a la de ingreso");
      return;
    }
    setSaving(true);
    const fila = {
      nombre: nombre.trim(),
      hora_inicio: inicio,
      hora_fin: fin,
      refrigerio_min: Math.max(0, ref),
      activo,
    };
    const { error } = nuevo
      ? await supabase.from("turnos").insert(fila)
      : await supabase.from("turnos").update(fila).eq("id", (turno as Turno).id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(nuevo ? "Turno creado" : "Turno actualizado");
    await onSaved();
  };

  return (
    <Dialog open={!!turno} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{nuevo ? "Nuevo turno" : "Editar turno"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="t-nombre">Nombre</Label>
            <Input id="t-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-inicio">Ingreso</Label>
              <Input id="t-inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-fin">Salida</Label>
              <Input id="t-fin" type="time" value={fin} onChange={(e) => setFin(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-ref">Refrigerio (min)</Label>
              <Input
                id="t-ref"
                type="number"
                min={0}
                max={180}
                value={refrigerio}
                onChange={(e) => setRefrigerio(e.target.value)}
              />
            </div>
          </div>
          {fin <= inicio && (
            <p className="text-sm text-muted-foreground">Este turno termina al día siguiente.</p>
          )}
          {ref > 0 && ref < 45 && (
            <p className="text-sm text-warning">
              El refrigerio no debería ser menor de 45 minutos (D.S. 008-2002-TR).
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Turno activo
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
