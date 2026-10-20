-- Base de acampantes: se consulta antes que el API de DNI.
-- Lo que devuelve el API se guarda aquí para no volver a consultarlo.
CREATE TABLE public.acampantes (
  dni TEXT PRIMARY KEY CHECK (dni ~ '^[0-9]{8}$'),
  nombre_completo TEXT NOT NULL,
  nombres TEXT,
  apellido_paterno TEXT,
  apellido_materno TEXT,
  fecha_nacimiento TEXT,
  fuente TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'api'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.acampantes ENABLE ROW LEVEL SECURITY;

-- Base compartida entre todos los usuarios que inician sesión
CREATE POLICY "Usuarios autenticados pueden ver acampantes"
ON public.acampantes FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Usuarios autenticados pueden crear acampantes"
ON public.acampantes FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden actualizar acampantes"
ON public.acampantes FOR UPDATE
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.acampantes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER acampantes_updated_at
BEFORE UPDATE ON public.acampantes
FOR EACH ROW EXECUTE FUNCTION public.acampantes_set_updated_at();
