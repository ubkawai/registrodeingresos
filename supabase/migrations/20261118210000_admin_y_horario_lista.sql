-- 1) El administrador ve y modifica las listas de todas las cuentas
--    (bungalows, destino, terminar estadía…). Las demás cuentas siguen
--    viendo solo las suyas.
-- 2) Horario de cada lista: modalidad (estadía o full day) y fechas del
--    campamento. Con eso se calcula el check-in y el check-out programados:
--      Estadía:  check-in 17:00 del primer día, check-out 15:00 del último
--      Full day: 09:00 a 17:00 del mismo día
--    Pasado el check-out, quien sale ya no puede volver a entrar y deja de
--    contar como "no ha regresado".

-- ================== Administrador ==================
CREATE POLICY "Admin ve todas las listas"
ON public.scan_lists FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY "Admin actualiza todas las listas"
ON public.scan_lists FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admin elimina todas las listas"
ON public.scan_lists FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY "Admin ve todos los registros"
ON public.scanned_records FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY "Admin actualiza todos los registros"
ON public.scanned_records FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admin elimina todos los registros"
ON public.scanned_records FOR DELETE TO authenticated USING (public.is_admin());

-- ================== Horario de la lista ==================
-- Las fechas se guardan tal cual; los instantes programados los calcula la
-- app con la hora de Perú al guardar las fechas.
ALTER TABLE public.scan_lists
  ADD COLUMN modalidad TEXT CHECK (modalidad IN ('estadia', 'full_day')),
  ADD COLUMN fecha_inicio DATE,
  ADD COLUMN fecha_fin DATE,
  ADD COLUMN checkin_at TIMESTAMPTZ,
  ADD COLUMN checkout_at TIMESTAMPTZ;

-- ================== Puerta: respetar el check-out ==================
CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_centro_id UUID,
  p_dni TEXT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_nombre TEXT;
  v_lista_id UUID;
  v_lista TEXT;
  v_lugar TEXT;
  v_bungalow TEXT;
  v_checkout TIMESTAMPTZ;
  v_otro_centro TEXT;
  v_ultimo public.movimientos%ROWTYPE;
  v_mov public.movimientos%ROWTYPE;
  v_tipo TEXT;
BEGIN
  IF coalesce(public.mi_rol() IN ('admin', 'usuario'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede registrar movimientos' USING ERRCODE = '42501';
  END IF;

  IF p_dni IS NULL OR p_dni !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'dni_invalido', 'dni', p_dni);
  END IF;

  -- Lista activa del centro donde está registrado (la de llegada más reciente)
  SELECT r.full_name, l.id, l.title, g.nombre, b.nombre, l.checkout_at
  INTO v_nombre, v_lista_id, v_lista, v_lugar, v_bungalow, v_checkout
  FROM public.scanned_records r
  JOIN public.scan_lists l ON l.id = r.scan_list_id
  LEFT JOIN public.lugares g ON g.id = l.lugar_id
  LEFT JOIN public.bungalows b ON b.id = r.bungalow_id
  WHERE r.dni_number = p_dni
    AND l.centro_id = p_centro_id
    AND l.estadia_fin_at IS NULL
  ORDER BY r.scanned_at DESC
  LIMIT 1;

  IF v_lista_id IS NULL THEN
    -- ¿Está en una lista activa de otro centro?
    SELECT r.full_name, l.title, c.nombre
    INTO v_nombre, v_lista, v_otro_centro
    FROM public.scanned_records r
    JOIN public.scan_lists l ON l.id = r.scan_list_id
    LEFT JOIN public.centros c ON c.id = l.centro_id
    WHERE r.dni_number = p_dni AND l.estadia_fin_at IS NULL
    ORDER BY r.scanned_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'no_pertenece',
      'dni', p_dni,
      'nombre', v_nombre,
      'otro_centro', v_otro_centro,
      'lista', v_lista
    );
  END IF;

  -- Dos equipos leyendo el mismo DNI a la vez no crean dos movimientos
  PERFORM pg_advisory_xact_lock(hashtext('mov:' || v_lista_id::text || p_dni));

  SELECT * INTO v_ultimo
  FROM public.movimientos
  WHERE scan_list_id = v_lista_id AND dni_number = p_dni
  ORDER BY created_at DESC
  LIMIT 1;

  -- Doble lectura del lector: se ignora si marcó hace menos de 15 segundos
  IF v_ultimo.id IS NOT NULL AND v_ultimo.created_at > now() - interval '15 seconds' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'repetido',
      'dni', p_dni,
      'nombre', v_nombre,
      'lista', v_lista,
      'lugar', v_lugar,
      'bungalow', v_bungalow,
      'tipo', v_ultimo.tipo,
      'id', v_ultimo.id
    );
  END IF;

  -- Estaba fuera y su estadía ya terminó: no puede volver a entrar
  IF v_ultimo.tipo = 'salida' AND v_checkout IS NOT NULL AND now() >= v_checkout THEN
    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'estadia_terminada',
      'dni', p_dni,
      'nombre', v_nombre,
      'lista', v_lista,
      'lugar', v_lugar,
      'bungalow', v_bungalow,
      'checkout_at', v_checkout,
      'salida_at', v_ultimo.created_at
    );
  END IF;

  v_tipo := CASE WHEN v_ultimo.tipo = 'salida' THEN 'reingreso' ELSE 'salida' END;

  INSERT INTO public.movimientos (scan_list_id, dni_number, full_name, tipo, motivo)
  VALUES (v_lista_id, p_dni, v_nombre, v_tipo, nullif(trim(p_motivo), ''))
  RETURNING * INTO v_mov;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_mov.id,
    'tipo', v_tipo,
    'dni', p_dni,
    'nombre', v_nombre,
    'lista', v_lista,
    'lista_id', v_lista_id,
    'lugar', v_lugar,
    'bungalow', v_bungalow,
    'created_at', v_mov.created_at,
    'checkout_at', v_checkout,
    -- Salida después del check-out: ya no vuelve
    'final', v_tipo = 'salida' AND v_checkout IS NOT NULL AND now() >= v_checkout,
    -- En un reingreso: a qué hora había salido
    'salida_at', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.created_at END,
    'salida_motivo', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.motivo END
  );
END;
$$;

-- Listas activas del centro, ocupación por bungalow y quiénes están fuera.
-- Quien salió y ya pasó el check-out de su lista cuenta como "retirado": no
-- está fuera ni dentro.
CREATE OR REPLACE FUNCTION public.estado_puerta(p_centro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF coalesce(public.mi_rol() IN ('admin', 'usuario'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede ver la puerta' USING ERRCODE = '42501';
  END IF;

  WITH listas AS (
    SELECT l.id, l.title, l.created_at, l.closed_at, l.checkout_at,
           coalesce(l.checkout_at <= now(), false) AS checkout_pasado,
           g.nombre AS lugar
    FROM public.scan_lists l
    LEFT JOIN public.lugares g ON g.id = l.lugar_id
    WHERE l.centro_id = p_centro_id AND l.estadia_fin_at IS NULL
  ),
  personas AS (
    SELECT DISTINCT ON (r.scan_list_id, r.dni_number)
      r.scan_list_id, r.dni_number, r.full_name, r.bungalow_id, b.nombre AS bungalow
    FROM public.scanned_records r
    JOIN listas ON listas.id = r.scan_list_id
    LEFT JOIN public.bungalows b ON b.id = r.bungalow_id
    ORDER BY r.scan_list_id, r.dni_number, r.scanned_at
  ),
  ultimo AS (
    SELECT DISTINCT ON (m.scan_list_id, m.dni_number)
      m.scan_list_id, m.dni_number, m.tipo, m.created_at, m.motivo, m.id
    FROM public.movimientos m
    JOIN listas ON listas.id = m.scan_list_id
    ORDER BY m.scan_list_id, m.dni_number, m.created_at DESC
  ),
  estado AS (
    SELECT p.*, l.lugar, u.created_at AS mov_at, u.motivo, u.id AS mov_id,
           coalesce(u.tipo = 'salida', false) AND l.checkout_pasado AS retirado,
           coalesce(u.tipo = 'salida', false) AND NOT l.checkout_pasado AS fuera,
           NOT coalesce(u.tipo = 'salida', false) AND l.checkout_pasado AS por_salir
    FROM personas p
    JOIN listas l ON l.id = p.scan_list_id
    LEFT JOIN ultimo u USING (scan_list_id, dni_number)
  )
  SELECT jsonb_build_object(
    'listas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'lugar', l.lugar,
        'created_at', l.created_at,
        'en_llegada', l.closed_at IS NULL,
        'checkout_at', l.checkout_at,
        -- En estadía (sin contar a los que ya se retiraron)
        'total', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND NOT e.retirado),
        'fuera', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND e.fuera),
        'retirados', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND e.retirado),
        -- Siguen dentro aunque ya pasó el check-out
        'por_salir', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND e.por_salir)
      ) ORDER BY l.lugar NULLS LAST, l.created_at)
      FROM listas l
    ), '[]'::jsonb),
    -- Ocupación: lugar + bungalow (NULL = sin bungalow asignado)
    'bungalows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'lugar', x.lugar,
        'bungalow', x.bungalow,
        'total', x.total,
        'fuera', x.fuera
      ) ORDER BY x.lugar NULLS LAST, x.bungalow NULLS LAST)
      FROM (
        SELECT e.lugar, e.bungalow, count(*) AS total, count(*) FILTER (WHERE e.fuera) AS fuera
        FROM estado e
        WHERE NOT e.retirado
        GROUP BY e.lugar, e.bungalow
      ) x
    ), '[]'::jsonb),
    'fuera', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.mov_id,
        'dni', e.dni_number,
        'nombre', e.full_name,
        'lista_id', e.scan_list_id,
        'lista', l.title,
        'lugar', e.lugar,
        'bungalow', e.bungalow,
        'checkout_at', l.checkout_at,
        'salida_at', e.mov_at,
        'motivo', e.motivo
      ) ORDER BY e.mov_at)
      FROM estado e JOIN listas l ON l.id = e.scan_list_id
      WHERE e.fuera
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;
