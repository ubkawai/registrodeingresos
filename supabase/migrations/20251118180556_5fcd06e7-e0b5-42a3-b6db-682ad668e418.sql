-- Crear tabla para listas de escaneo
CREATE TABLE public.scan_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users NOT NULL
);

-- Crear tabla para registros de DNI escaneados
CREATE TABLE public.scanned_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_list_id UUID REFERENCES public.scan_lists(id) ON DELETE CASCADE NOT NULL,
  dni_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users NOT NULL
);

-- Habilitar Row Level Security
ALTER TABLE public.scan_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanned_records ENABLE ROW LEVEL SECURITY;

-- Políticas para scan_lists
CREATE POLICY "Los usuarios pueden ver sus propias listas"
ON public.scan_lists FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden crear sus propias listas"
ON public.scan_lists FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias listas"
ON public.scan_lists FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias listas"
ON public.scan_lists FOR DELETE
USING (auth.uid() = user_id);

-- Políticas para scanned_records
CREATE POLICY "Los usuarios pueden ver sus propios registros"
ON public.scanned_records FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden crear sus propios registros"
ON public.scanned_records FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios registros"
ON public.scanned_records FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios registros"
ON public.scanned_records FOR DELETE
USING (auth.uid() = user_id);

-- Índices para mejor rendimiento
CREATE INDEX idx_scan_lists_user_id ON public.scan_lists(user_id);
CREATE INDEX idx_scanned_records_list_id ON public.scanned_records(scan_list_id);
CREATE INDEX idx_scanned_records_user_id ON public.scanned_records(user_id);