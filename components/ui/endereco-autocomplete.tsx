"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country_code?: string;
  };
}

export interface EnderecoSelecionado {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  latitude: number;
  longitude: number;
}

interface EnderecoAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (endereco: EnderecoSelecionado) => void;
  placeholder?: string;
  disabled?: boolean;
}

const UF_MAP: Record<string, string> = {
  "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM",
  "Bahia": "BA", "Ceará": "CE", "Distrito Federal": "DF", "Espírito Santo": "ES",
  "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
  "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ",
  "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", "Rondônia": "RO",
  "Roraima": "RR", "Santa Catarina": "SC", "São Paulo": "SP", "Sergipe": "SE",
  "Tocantins": "TO",
};

export function EnderecoAutocomplete({
  value, onChange, onSelect, placeholder = "Digite o endereço…", disabled,
}: EnderecoAutocompleteProps) {
  const [sugestoes, setSugestoes] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const buscar = useCallback(async (q: string) => {
    if (q.length < 3) { setSugestoes([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=5&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Frivo/1.0", "Accept-Language": "pt-BR" },
        signal: ctrl.signal,
      });
      const data: NominatimResult[] = await res.json();
      setSugestoes(data);
      setAberto(data.length > 0);
    } catch (e: any) {
      if (e.name !== "AbortError") setSugestoes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => buscar(value), 500);
    return () => clearTimeout(timer);
  }, [value, buscar]);

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", handleClickFora);
    return () => document.removeEventListener("mousedown", handleClickFora);
  }, []);

  function selecionar(r: NominatimResult) {
    const a = r.address;
    const estado = UF_MAP[a.state ?? ""] ?? a.state ?? "";
    const cidade = a.city ?? a.town ?? a.village ?? "";
    const bairro = a.suburb ?? a.neighbourhood ?? "";
    const cep = a.postcode?.replace(/\D/g, "").replace(/(\d{5})(\d{3})/, "$1-$2") ?? "";

    onSelect({
      logradouro: a.road ?? "",
      numero: a.house_number ?? "",
      bairro,
      cidade,
      estado,
      cep,
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
    });

    onChange(a.road ?? r.display_name.split(",")[0]);
    setAberto(false);
    setSugestoes([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (sugestoes.length > 0) setAberto(true); }}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {aberto && sugestoes.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {sugestoes.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => selecionar(s)}
              className="flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-frivo-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
              <span className="text-xs text-gray-700 line-clamp-2">{s.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
