import { supabase } from "@/integrations/client";

export type Persona = {
  dni: string;
  nombre_completo: string;
  nombres?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  fecha_nacimiento?: string | null;
};

export type LookupResult =
  | { ok: true; persona: Persona; fuente: "bd" | "api" }
  | { ok: false; error: string };

type FactilizaDniResponse = {
  status: number;
  success: boolean;
  message: string;
  data?: {
    numero?: string;
    nombres?: string;
    apellido_paterno?: string;
    apellido_materno?: string;
    nombre_completo?: string;
    fecha_nacimiento?: string;
  };
};

const FACTILIZA_TOKEN = import.meta.env.VITE_FACTILIZA_TOKEN as
  | string
  | undefined;

// ================== Código leído -> DNI ==================
// - Código de barras simple: solo el número (8 dígitos), a veces con un
//   dígito verificador al final (9 dígitos).
// - PDF417 del DNI: texto largo con el DNI en las posiciones 2..10.
export const extractDniFromBarcode = (raw: string): string => {
  const text = (raw || "").trim();
  const digits = text.replace(/\D/g, "");

  if (/^\d{8}$/.test(text)) return text;
  if (/^\d{9}$/.test(text)) return text.slice(0, 8);

  if (text.length >= 125) {
    const pdf417Dni = text.substring(2, 10);
    if (/^\d{8}$/.test(pdf417Dni)) return pdf417Dni;
  }

  if (digits.length === 8) return digits;

  const m = text.match(/\d{8}/);
  return m ? m[0] : "";
};

// ================== 1) Base de acampantes ==================
const findInAcampantes = async (dni: string): Promise<Persona | null> => {
  const { data, error } = await supabase
    .from("acampantes")
    .select(
      "dni, nombre_completo, nombres, apellido_paterno, apellido_materno, fecha_nacimiento"
    )
    .eq("dni", dni)
    .maybeSingle();

  if (error) {
    console.error("Error consultando acampantes:", error);
    return null;
  }
  return data;
};

// ================== 2) API Factiliza ==================
const fetchFromApi = async (dni: string): Promise<Persona | null> => {
  if (!FACTILIZA_TOKEN) {
    console.error("Falta VITE_FACTILIZA_TOKEN en tu .env");
    return null;
  }

  try {
    const res = await fetch(`https://api.factiliza.com/v1/dni/info/${dni}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${FACTILIZA_TOKEN}` },
    });

    const json = (await res.json()) as FactilizaDniResponse;

    if (!res.ok || !json?.success || !json.data) {
      console.error("Factiliza error:", json);
      return null;
    }

    const d = json.data;
    const nombre_completo =
      d.nombre_completo ||
      [d.apellido_paterno, d.apellido_materno, d.nombres]
        .filter(Boolean)
        .join(" ")
        .trim();

    if (!nombre_completo) return null;

    return {
      dni,
      nombre_completo,
      nombres: d.nombres ?? null,
      apellido_paterno: d.apellido_paterno ?? null,
      apellido_materno: d.apellido_materno ?? null,
      fecha_nacimiento: d.fecha_nacimiento ?? null,
    };
  } catch (err) {
    console.error(err);
    return null;
  }
};

// Guarda lo que trajo el API para no volver a consultarlo la próxima vez.
const saveToAcampantes = async (persona: Persona) => {
  const { error } = await supabase
    .from("acampantes")
    .upsert({ ...persona, fuente: "api" }, { onConflict: "dni" });
  if (error) console.error("No se pudo guardar en acampantes:", error);
};

// ================== Flujo: BD primero, luego API ==================
export const lookupDni = async (dni: string): Promise<LookupResult> => {
  const local = await findInAcampantes(dni);
  if (local) return { ok: true, persona: local, fuente: "bd" };

  const remote = await fetchFromApi(dni);
  if (!remote) {
    return { ok: false, error: "No encontrado en acampantes ni en el API" };
  }

  await saveToAcampantes(remote);
  return { ok: true, persona: remote, fuente: "api" };
};
