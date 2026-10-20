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
  emptyText = "Escanea un documento para agregar el primer registro",
}: RecordsListProps) => {
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ScanBarcode className="mb-3 h-8 w-8 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-sm font-medium">Aún no hay registros</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const numbered = records.map((r, i) => ({ r, n: i + 1 }));
  const rows = newestFirst ? [...numbered].reverse() : numbered;

  return (
    <ol>
      {rows.map(({ r, n }) => (
        <li
          key={r.id}
          className={cn(
            "group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60",
            r.id === highlightId && "animate-row-in bg-success/5"
          )}
        >
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground/60">
            {n}
          </span>

          {padron &&
            (padron.has(r.dni_number) ? (
              <CircleCheck
                className="h-5 w-5 shrink-0 text-success"
                aria-label="En la lista"
              >
                <title>En la lista</title>
              </CircleCheck>
            ) : (
              <CircleX
                className="h-5 w-5 shrink-0 text-destructive"
                aria-label="No está en la lista"
              >
                <title>No está en la lista</title>
              </CircleX>
            ))}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.full_name}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{r.dni_number}</span>
              {r.fuente === "api" && (
                <span className="rounded-full bg-accent/10 px-1.5 text-[10px] font-medium text-accent">
                  API
                </span>
              )}
            </p>
          </div>

          <time
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
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
              className="shrink-0 rounded-md p-1 text-muted-foreground opacity-40 transition hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Quitar ${r.full_name}`}
              title="Quitar de la lista"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
};
