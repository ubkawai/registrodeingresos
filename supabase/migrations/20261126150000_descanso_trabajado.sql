-- Trabajo en el día de descanso.
-- Cuando un trabajador con horario mensual marca entrada en un día programado
-- como Descanso, el marcador pregunta cómo se toma ese día:
--  - 'horas_extras': todo el tiempo trabajado cuenta como sobretiempo.
--  - 'cambio_descanso': el descanso se pasa a otro día y hoy es una jornada
--    normal de 8 h desde la entrada (sin tardanza; lo que pase de 8 h es
--    sobretiempo y si sale antes queda como salida anticipada).

ALTER TABLE public.jornadas ADD COLUMN descanso_trabajado TEXT
  CHECK (descanso_trabajado IN ('horas_extras', 'cambio_descanso'));

-- ¿A esa hora el trabajador está en su día de descanso? Misma búsqueda que
-- crear_jornada: no hay turno programado cuyo inicio esté a menos de 12 h y
-- ese día está marcado como Descanso.
CREATE OR REPLACE FUNCTION public.dia_de_descanso(p_dni TEXT, p_t TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT horario_mensual FROM public.trabajadores WHERE dni = p_dni), false)
     AND NOT EXISTS (
       SELECT 1
       FROM public.programacion_turnos p JOIN public.turnos t ON t.id = p.turno_id
       WHERE p.dni = p_dni
         AND p.fecha BETWEEN (p_t AT TIME ZONE 'America/Lima')::date - 1
                         AND (p_t AT TIME ZONE 'America/Lima')::date + 1
         AND abs(extract(epoch FROM ((p.fecha + t.hora_inicio) AT TIME ZONE 'America/Lima') - p_t))
             <= 12 * 3600
     )
     AND EXISTS (
       SELECT 1 FROM public.programacion_turnos
       WHERE dni = p_dni AND fecha = (p_t AT TIME ZONE 'America/Lima')::date
         AND turno_id IS NULL
     );
$$;
REVOKE EXECUTE ON FUNCTION public.dia_de_descanso(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ================== crear_jornada ==================
-- Nuevo parámetro p_descanso (cómo se toma el día de descanso trabajado).
-- registrar_marca_manual la sigue llamando con dos argumentos.
DROP FUNCTION public.crear_jornada(TEXT, TIMESTAMPTZ);

CREATE FUNCTION public.crear_jornada(p_dni TEXT, p_t TIMESTAMPTZ, p_descanso TEXT DEFAULT NULL)
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

  SELECT tolerancia_min INTO v_tol FROM public.empleador LIMIT 1;

  -- Día de descanso trabajado
  IF v_nombre = 'Descanso' AND p_descanso IN ('horas_extras', 'cambio_descanso') THEN
    INSERT INTO public.jornadas (
      dni, fecha, turno_id, turno_nombre, programada_inicio, programada_fin,
      refrigerio_min, tolerancia_min, entrada_at, descanso_trabajado
    ) VALUES (
      p_dni,
      (p_t AT TIME ZONE 'America/Lima')::date,
      NULL,
      CASE p_descanso WHEN 'horas_extras' THEN 'Descanso trabajado (horas extras)'
                      ELSE 'Cambio de descanso (8 h)' END,
      CASE WHEN p_descanso = 'cambio_descanso' THEN p_t END,
      CASE WHEN p_descanso = 'cambio_descanso' THEN p_t + interval '8 hours' END,
      0,
      0,
      p_t,
      p_descanso
    )
    RETURNING * INTO v_j;
    RETURN v_j;
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
REVOKE EXECUTE ON FUNCTION public.crear_jornada(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;

-- ================== marcar_asistencia ==================
-- Nuevo parámetro p_descanso. Sin él, una entrada en día de descanso responde
-- motivo 'descanso' para que el marcador pregunte.
DROP FUNCTION public.marcar_asistencia(TEXT, TEXT);

CREATE FUNCTION public.marcar_asistencia(
  p_dni TEXT,
  p_tipo TEXT DEFAULT NULL,
  p_descanso TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ahora TIMESTAMPTZ := now();
  v_trab public.trabajadores%ROWTYPE;
  v_ultima public.marcas%ROWTYPE;
  v_jornada public.jornadas%ROWTYPE;
  v_marca public.marcas%ROWTYPE;
  v_tipo TEXT;
  v_opciones TEXT[];
  v_sugerida TEXT;
  v_descanso TEXT;
BEGIN
  IF coalesce(public.tiene_rol('admin', 'rrhh', 'kiosko'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede registrar asistencia' USING ERRCODE = '42501';
  END IF;

  IF p_dni IS NULL OR p_dni !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'dni_invalido', 'dni', p_dni);
  END IF;

  SELECT * INTO v_trab FROM public.trabajadores WHERE dni = p_dni;
  IF v_trab.dni IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_registrado', 'dni', p_dni);
  END IF;
  IF NOT v_trab.activo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inactivo', 'dni', p_dni,
                              'nombre', v_trab.nombre_completo);
  END IF;

  -- Dos equipos leyendo el mismo DNI a la vez no crean dos marcas
  PERFORM pg_advisory_xact_lock(hashtext('marca:' || p_dni));

  SELECT * INTO v_ultima
  FROM public.marcas
  WHERE dni = p_dni AND anulada_at IS NULL
  ORDER BY marcado_at DESC
  LIMIT 1;

  -- Doble lectura: se ignora si marcó hace menos de 2 minutos
  IF v_ultima.id IS NOT NULL AND v_ahora - v_ultima.marcado_at < interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'reciente', 'dni', p_dni,
                              'nombre', v_trab.nombre_completo, 'tipo', v_ultima.tipo,
                              'marcado_at', v_ultima.marcado_at);
  END IF;

  -- ¿Tiene una jornada abierta? Si olvidó marcar la salida, la jornada se
  -- da por abandonada 6 h después del fin del turno (16 h sin turno, y nunca
  -- más de 20 h desde la entrada) y la siguiente lectura es una nueva entrada.
  IF v_ultima.id IS NOT NULL AND v_ultima.tipo <> 'salida' THEN
    SELECT * INTO v_jornada FROM public.jornadas WHERE id = v_ultima.jornada_id;
    IF v_ahora > least(coalesce(v_jornada.programada_fin + interval '6 hours',
                                v_jornada.entrada_at + interval '16 hours'),
                       v_jornada.entrada_at + interval '20 hours') THEN
      v_jornada := NULL;
    END IF;
  END IF;

  IF v_jornada.id IS NULL THEN
    v_tipo := 'entrada';
  ELSIF v_ultima.tipo = 'inicio_refrigerio' THEN
    v_tipo := 'fin_refrigerio';
  ELSIF (v_jornada.turno_id IS NOT NULL AND v_jornada.refrigerio_min = 0) OR EXISTS (
    SELECT 1 FROM public.marcas
    WHERE jornada_id = v_jornada.id AND anulada_at IS NULL AND tipo = 'fin_refrigerio'
  ) THEN
    v_tipo := 'salida';
  ELSE
    v_opciones := ARRAY['inicio_refrigerio', 'salida'];
    v_sugerida := CASE
      WHEN v_jornada.programada_fin IS NULL
           OR v_ahora >= v_jornada.programada_fin - interval '1 hour' THEN 'salida'
      ELSE 'inicio_refrigerio' END;

    IF p_tipo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'elegir', 'dni', p_dni,
                                'nombre', v_trab.nombre_completo,
                                'opciones', to_jsonb(v_opciones), 'sugerida', v_sugerida);
    END IF;
    IF NOT (p_tipo = ANY (v_opciones)) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'tipo_invalido', 'dni', p_dni);
    END IF;
    v_tipo := p_tipo;
  END IF;

  IF p_tipo IS NOT NULL AND p_tipo <> v_tipo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'tipo_invalido', 'dni', p_dni);
  END IF;

  IF v_tipo = 'entrada' THEN
    -- Entrada en su día de descanso: se pregunta cómo se toma
    IF public.dia_de_descanso(p_dni, v_ahora) THEN
      IF p_descanso IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'descanso', 'dni', p_dni,
                                  'nombre', v_trab.nombre_completo,
                                  'opciones', '["horas_extras", "cambio_descanso"]'::jsonb,
                                  'sugerida', 'horas_extras');
      END IF;
      IF p_descanso NOT IN ('horas_extras', 'cambio_descanso') THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'tipo_invalido', 'dni', p_dni);
      END IF;
      v_descanso := p_descanso;
    END IF;
    v_jornada := public.crear_jornada(p_dni, v_ahora, v_descanso);
  END IF;

  INSERT INTO public.marcas (jornada_id, dni, tipo, marcado_at, origen, registrado_por)
  VALUES (v_jornada.id, p_dni, v_tipo, v_ahora, 'lector', auth.uid())
  RETURNING * INTO v_marca;

  RETURN public.resumen_marca(v_marca);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.marcar_asistencia(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_asistencia(TEXT, TEXT, TEXT) TO authenticated;
