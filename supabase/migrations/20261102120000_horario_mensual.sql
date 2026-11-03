-- Horario mensual (rol de turnos) para personal con horario rotativo, como
-- vigilancia. Cada mes RR.HH. / el administrador asigna a cada trabajador el
-- turno de cada día (o descanso). Para esos trabajadores el turno fijo de la
-- ficha se ignora y la jornada toma el turno programado del día.

-- ================== Trabajadores ==================
ALTER TABLE public.trabajadores
  ADD COLUMN horario_mensual BOOLEAN NOT NULL DEFAULT false;

-- ================== Programación ==================
-- Una fila por trabajador y día. turno_id NULL = descanso.
-- Un día sin fila = sin programar.
CREATE TABLE public.programacion_turnos (
  dni TEXT NOT NULL REFERENCES public.trabajadores(dni) ON DELETE CASCADE,
  fecha DATE NOT NULL, -- día (hora de Lima) en que empieza el turno
  turno_id UUID REFERENCES public.turnos(id),
  updated_por UUID REFERENCES auth.users DEFAULT auth.uid(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (dni, fecha)
);

CREATE INDEX idx_programacion_fecha ON public.programacion_turnos(fecha);

ALTER TABLE public.programacion_turnos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RR.HH. ve la programación"
ON public.programacion_turnos FOR SELECT TO authenticated USING (public.es_rrhh());

CREATE POLICY "RR.HH. crea la programación"
ON public.programacion_turnos FOR INSERT TO authenticated WITH CHECK (public.es_rrhh());

CREATE POLICY "RR.HH. actualiza la programación"
ON public.programacion_turnos FOR UPDATE TO authenticated
USING (public.es_rrhh()) WITH CHECK (public.es_rrhh());

CREATE POLICY "RR.HH. borra la programación"
ON public.programacion_turnos FOR DELETE TO authenticated USING (public.es_rrhh());

CREATE OR REPLACE FUNCTION public.programacion_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_por := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER programacion_updated
BEFORE INSERT OR UPDATE ON public.programacion_turnos
FOR EACH ROW EXECUTE FUNCTION public.programacion_set_updated();

-- ================== Crear jornada ==================
-- Con horario mensual se busca el turno programado (del día anterior, del
-- mismo día o del siguiente) cuyo inicio esté más cerca de la entrada, hasta
-- 12 h de diferencia. Así la entrada de las 00:30 cae en el turno de noche
-- que empezó el día anterior. Si no hay ninguno (descanso o sin programar),
-- la jornada queda sin turno.
CREATE OR REPLACE FUNCTION public.crear_jornada(p_dni TEXT, p_t TIMESTAMPTZ)
RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mensual BOOLEAN;
  v_turno_id UUID;
  v_turno public.turnos%ROWTYPE;
  v_tol INTEGER;
  v_inicio TIMESTAMPTZ;
  v_nombre TEXT;
  v_j public.jornadas%ROWTYPE;
BEGIN
  SELECT horario_mensual INTO v_mensual FROM public.trabajadores WHERE dni = p_dni;

  IF v_mensual THEN
    SELECT p.turno_id, (p.fecha + t.hora_inicio) AT TIME ZONE 'America/Lima'
    INTO v_turno_id, v_inicio
    FROM public.programacion_turnos p JOIN public.turnos t ON t.id = p.turno_id
    WHERE p.dni = p_dni
      AND p.fecha BETWEEN (p_t AT TIME ZONE 'America/Lima')::date - 1
                      AND (p_t AT TIME ZONE 'America/Lima')::date + 1
      AND abs(extract(epoch FROM ((p.fecha + t.hora_inicio) AT TIME ZONE 'America/Lima') - p_t))
          <= 12 * 3600
    ORDER BY abs(extract(epoch FROM ((p.fecha + t.hora_inicio) AT TIME ZONE 'America/Lima') - p_t))
    LIMIT 1;

    IF v_turno_id IS NOT NULL THEN
      SELECT * INTO v_turno FROM public.turnos WHERE id = v_turno_id;
    ELSE
      v_nombre := CASE WHEN EXISTS (
        SELECT 1 FROM public.programacion_turnos
        WHERE dni = p_dni AND fecha = (p_t AT TIME ZONE 'America/Lima')::date
          AND turno_id IS NULL
      ) THEN 'Descanso' ELSE 'Sin programar' END;
    END IF;
  ELSE
    SELECT t.* INTO v_turno
    FROM public.trabajadores w JOIN public.turnos t ON t.id = w.turno_id
    WHERE w.dni = p_dni;

    IF v_turno.id IS NOT NULL THEN
      v_inicio := public.inicio_turno_cercano(p_t, v_turno.hora_inicio);
    END IF;
  END IF;

  SELECT tolerancia_min INTO v_tol FROM public.empleador LIMIT 1;

  INSERT INTO public.jornadas (
    dni, fecha, turno_id, turno_nombre, programada_inicio, programada_fin,
    refrigerio_min, tolerancia_min, entrada_at
  ) VALUES (
    p_dni,
    (coalesce(v_inicio, p_t) AT TIME ZONE 'America/Lima')::date,
    v_turno.id,
    coalesce(v_turno.nombre, v_nombre),
    v_inicio,
    v_inicio + public.duracion_turno(v_turno.hora_inicio, v_turno.hora_fin),
    coalesce(v_turno.refrigerio_min, 0),
    coalesce(v_tol, 0),
    p_t
  )
  RETURNING * INTO v_j;

  RETURN v_j;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_jornada(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
