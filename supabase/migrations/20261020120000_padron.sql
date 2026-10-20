-- Lista de invitados (padrón) cargada desde Excel/CSV/PDF.
-- Se guarda en la propia lista como [{ "dni": "12345678", "nombre": "..." }]
-- para que todos los equipos la vean y quede en el historial.
ALTER TABLE public.scan_lists ADD COLUMN padron JSONB;
ALTER TABLE public.scan_lists ADD COLUMN padron_archivo TEXT;
