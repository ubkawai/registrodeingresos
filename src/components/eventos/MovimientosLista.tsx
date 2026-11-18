import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { AlarmClock, ArrowLeftFromLine, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  descargarCsv,
  duracion,
  estaVencido,
  filasMovimientos,
  salidasConReingreso,
  vencimiento,
  type Lugar,
  type Movimiento,
} from "@/lib/estadia";

// Salidas y reingresos de una lista, para revisar la estadía y exportar
export const MovimientosLista = ({
  listaId,
  titulo,
  lugar,
}: {
  listaId: string;
  titulo: string;
  lugar: Lugar | null;
}) => {
  const [movs, setMovs] = useState<Movimiento[] | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("movimientos")
      .select("*")
      .eq("scan_list_id", listaId)
      .order("created_at")
      .then(({ data, error }) => {
        if (error) console.error(error);
        if (vivo) setMovs((data ?? []) as Movimiento[]);
      });
    return () => {
      vivo = false;
    };
  }, [listaId]);

  const salidas = useMemo(() => (movs ? salidasConReingreso(movs).reverse() : []), [movs]);
  const hora = lugar?.hora_limite ?? null;

  if (!movs) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando salidas…
      </p>
    );
  }

  const sinRegresar = salidas.filter((s) => !s.reingreso).length;
  const tarde = (s: (typeof salidas)[number]) =>
    !!hora &&
    (s.reingreso
      ? new Date(s.reingreso.created_at) > vencimiento(s.salida.created_at, hora)
      : estaVencido(s.salida.created_at, hora));

  return (
    <div className="px-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm font-semibold">
          Salidas durante la estadía
          <span className="ml-2 font-normal text-muted-foreground">
            {salidas.length === 0
              ? "ninguna"
              : `${salidas.length} ${salidas.length === 1 ? "salida" : "salidas"}` +
                (sinRegresar ? ` · ${sinRegresar} sin regresar` : "")}
          </span>
        </p>
        {salidas.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              descargarCsv(
                `salidas_${titulo.replace(/[^\w-]+/g, "_")}.csv`,
                filasMovimientos(titulo, lugar?.nombre ?? "", hora, movs)
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Excel
          </Button>
        )}
      </div>

      {salidas.length > 0 && (
        <ol className="mt-2 divide-y divide-border/70">
          {salidas.map((s) => {
            const fueraDeHora = tarde(s);
            return (
              <li
                key={s.salida.id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2",
                  fueraDeHora && "bg-destructive/10"
                )}
              >
                {fueraDeHora ? (
                  <AlarmClock className="h-4 w-4 shrink-0 text-destructive" aria-label="Fuera de hora" />
                ) : (
                  <ArrowLeftFromLine className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-narrow truncate text-sm font-semibold">{s.salida.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="dni">{s.salida.dni_number}</span>
                    {s.salida.motivo && <> · {s.salida.motivo}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  <p>
                    {format(new Date(s.salida.created_at), "dd/MM HH:mm")} →{" "}
                    {s.reingreso ? (
                      format(new Date(s.reingreso.created_at), "HH:mm")
                    ) : (
                      <span className="font-semibold text-destructive">no regresó</span>
                    )}
                  </p>
                  {s.reingreso && <p>{duracion(s.salida.created_at, s.reingreso.created_at)} fuera</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
