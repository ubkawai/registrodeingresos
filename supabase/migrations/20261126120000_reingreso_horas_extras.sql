-- Reingreso en el mismo día = horas extras.
-- Si el trabajador ya hizo su turno y vuelve a entrar, la nueva jornada se
-- marca como reingreso: sin horario programado (no hay tardanza), sin
-- refrigerio (la siguiente lectura es la salida) y todo el tiempo entre esa
-- entrada y esa salida cuenta como sobretiempo.

ALTER TABLE public.jornadas ADD COLUMN reingreso BOOLEAN NOT NULL DEFAULT false;

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
  v_reingreso BOOLEAN := false;
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

  -- ¿Es un reingreso? Solo para quien tiene turno. Lo es si entró en las
  -- últimas 16 h y además:
  --  - ese turno ya tiene su jornada (vuelve tras salir, ej. 19:00 en un
  --    turno de 08:00 a 17:00), o
  --  - la hora no es la de ningún turno (más de 3 h antes o después del
  --    inicio; ej. 21:00, que quedaría pegado al turno de mañana).
  IF v_inicio IS NOT NULL THEN
    v_reingreso := EXISTS (
      SELECT 1 FROM public.jornadas j
      WHERE j.dni = p_dni
        AND j.entrada_at > p_t - interval '16 hours'
        AND j.entrada_at < p_t
        AND (j.programada_inicio = v_inicio
             OR abs(extract(epoch FROM p_t - v_inicio)) > 3 * 3600)
    );
  END IF;

  SELECT tolerancia_min INTO v_tol FROM public.empleador LIMIT 1;

  IF v_reingreso THEN
    -- Se guarda el turno (así la siguiente lectura es directamente la
    -- salida) pero sin horario ni refrigerio
    INSERT INTO public.jornadas (
      dni, fecha, turno_id, turno_nombre, programada_inicio, programada_fin,
      refrigerio_min, tolerancia_min, entrada_at, reingreso
    ) VALUES (
      p_dni,
      (p_t AT TIME ZONE 'America/Lima')::date,
      v_turno.id,
      'Reingreso (horas extras)',
      NULL,
      NULL,
      0,
      0,
      p_t,
      true
    )
    RETURNING * INTO v_j;
    RETURN v_j;
  END IF;

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
