import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Clock } from "lucide-react";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
}

interface RecordsListProps {
  records: Record[];
}

export const RecordsList = ({ records }: RecordsListProps) => {
  if (records.length === 0) {
    return (
      <div className="text-center py-12">
        <User className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
        <p className="text-lg text-muted-foreground">
          No hay registros escaneados aún
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Usa el escáner para agregar DNIs a esta lista
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record, index) => (
        <Card key={record.id} className="p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="text-xs">
                  #{index + 1}
                </Badge>
                <h3 className="font-semibold text-lg">{record.full_name}</h3>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <User className="w-4 h-4" />
                <span className="font-mono">DNI: {record.dni_number}</span>
              </div>
              
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(record.scanned_at), "d 'de' MMMM, yyyy", { locale: es })}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(new Date(record.scanned_at), "HH:mm:ss")}
                </div>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
