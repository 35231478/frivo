import { useEffect, useRef, useCallback } from "react";
import { geocodeEndereco, type CoordsResult } from "@/lib/geocode";

interface EnderecoFields {
  logradouro: string;
  numero?: string;
  cidade: string;
  estado: string;
}

export function useAutoGeocode(
  fields: EnderecoFields,
  onResult: (coords: CoordsResult) => void,
) {
  const lastQuery = useRef("");

  const doGeocode = useCallback(async () => {
    const { logradouro, numero, cidade, estado } = fields;
    if (!logradouro || !cidade || !estado) return;

    const query = `${logradouro}|${numero ?? ""}|${cidade}|${estado}`;
    if (query === lastQuery.current) return;
    lastQuery.current = query;

    const coords = await geocodeEndereco(logradouro, numero, cidade, estado);
    if (coords) onResult(coords);
  }, [fields.logradouro, fields.numero, fields.cidade, fields.estado, onResult]);

  useEffect(() => {
    const timer = setTimeout(doGeocode, 1000);
    return () => clearTimeout(timer);
  }, [doGeocode]);
}
