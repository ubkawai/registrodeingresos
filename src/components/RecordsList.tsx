import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CircleCheck, CircleX, ScanBarcode, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
  fuente?: "bd" | "api";
}

interface RecordsListProps {
  records: Record[];
  // Muestra primero el último registrado (lista en curso)
  newestFirst?: boolean;
  highlightId?: string | null;
  onRemove?: (id: string) => void;
  emptyText?: string;
  // DNIs de la lista de invitados: check verde si está, X roja si no
  padron?: Set<string> | null;
}

export const RecordsList = ({
  records,
  newestFirst = false,
  highlightId,
  onRemove,
  padron,
  emptyText = "Escanea un DNI y la persona aparecerá aquí con la hora de llegada.",
}: RecordsListProps) => {
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <ScanBarcode className="mb-3 h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
        <p className="font-sign text-xl font-bold">Nadie registrado todavía</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const numbered = records.map((r, i) => ({ r, n: i + 1 }));
  const rows = newestFirst ? [...numbered].reverse() : numbered;

  return (
    <ol className="divide-y divide-border/70">
      {rows.map(({ r, n }) => {
        const enLista = padron?.has(r.dni_number);
        return (
          <li
            key={r.id}
            className={cn(
              "group flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-muted/50",
              r.id === highlightId && "animate-row-in bg-muted/60"
            )}
          >
            <span
              className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
              title="Orden de llegada"
            >
              {n}
            </span>

            {padron &&
              (enLista ? (
                <CircleCheck
                  className="h-6 w-6 shrink-0 text-success"
                  strokeWidth={2.25}
                  aria-label="En la lista"
                >
                  <title>En la lista</title>
                </CircleCheck>
              ) : (
                <CircleX
                  className="h-6 w-6 shrink-0 text-destructive"
                  strokeWidth={2.25}
                  aria-label="No está en la lista"
                >
                  <title>No está en la lista</title>
                </CircleX>
              ))}

            <div className="min-w-0 flex-1">
              <p className="font-narrow truncate text-[15px] font-semibold leading-tight">
                {r.full_name}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="dni">{r.dni_number}</span>
                {r.fuente === "api" && (
                  <span className="text-xs text-accent" title="Datos obtenidos del API">
                    API
                  </span>
                )}
              </p>
            </div>

            <time
              className="shrink-0 text-sm tabular-nums text-muted-foreground"
              dateTime={r.scanned_at}
              title={format(new Date(r.scanned_at), "d 'de' MMMM yyyy, HH:mm:ss", {
                locale: es,
              })}
            >
              {format(new Date(r.scanned_at), "HH:mm")}
            </time>

            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Quitar ${r.full_name}`}
                title="Quitar de la lista"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
};
