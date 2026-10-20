-- Lista en vivo: cada lectura se guarda al instante en una lista "abierta"
-- y todos los equipos con la misma cuenta la ven en tiempo real (Realtime).

-- Lista abierta = closed_at NULL. Las listas que ya existían quedan cerradas.
ALTER TABLE public.scan_lists ADD COLUMN closed_at TIMESTAMP WITH TIME ZONE;
UPDATE public.scan_lists SET closed_at = created_at WHERE closed_at IS NULL;

-- Solo una lista abierta por usuario (evita que PC y celular abran dos a la vez)
CREATE UNIQUE INDEX scan_lists_one_open_per_user
ON public.scan_lists(user_id) WHERE closed_at IS NULL;

-- De dónde salió el nombre: 'bd' (base de acampantes) | 'api'
ALTER TABLE public.scanned_records ADD COLUMN fuente TEXT;

-- Un DNI no se repite dentro de la misma lista, aunque se escanee desde dos equipos
DELETE FROM public.scanned_records a
USING public.scanned_records b
WHERE a.scan_list_id = b.scan_list_id
  AND a.dni_number = b.dni_number
  AND (a.scanned_at, a.id) > (b.scanned_at, b.id);

ALTER TABLE public.scanned_records
ADD CONSTRAINT scanned_records_list_dni_unique UNIQUE (scan_list_id, dni_number);

-- Activar Realtime en ambas tablas
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_lists;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scanned_records;
