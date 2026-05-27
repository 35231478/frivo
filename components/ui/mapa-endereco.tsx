"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);

interface MapaEnderecoProps {
  logradouro?: string;
  numero?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
}

interface Coords {
  lat: number;
  lng: number;
}

function montarQuery(p: MapaEnderecoProps): string {
  const parts = [p.logradouro, p.numero, p.cidade, p.estado, "Brasil"].filter(Boolean);
  return parts.join(", ");
}

function googleMapsUrl(coords: Coords, endereco: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
}

export function MapaEndereco(props: MapaEnderecoProps) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [icon, setIcon] = useState<any>(null);

  const temEndereco = !!(props.logradouro && props.cidade && props.estado);
  const query = montarQuery(props);

  useEffect(() => {
    import("leaflet").then((L) => {
      // Fix default marker icons for webpack/next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      setIcon(new L.Icon.Default());
      setLeafletReady(true);
    });
  }, []);

  const geocode = useCallback(async () => {
    if (!temEndereco) { setCoords(null); return; }
    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Frivo/1.0", "Accept-Language": "pt-BR" },
      });
      const data = await res.json();
      if (data.length > 0) {
        setCoords({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
      } else {
        setCoords(null);
      }
    } catch {
      setCoords(null);
    } finally {
      setLoading(false);
    }
  }, [query, temEndereco]);

  useEffect(() => {
    const timer = setTimeout(geocode, 800);
    return () => clearTimeout(timer);
  }, [geocode]);

  if (!temEndereco) return null;

  if (loading) {
    return (
      <div className="h-[200px] rounded-lg bg-gray-100 flex items-center justify-center">
        <span className="text-xs text-gray-400">Carregando mapa…</span>
      </div>
    );
  }

  if (!coords || !leafletReady || !icon) return null;

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div className="rounded-lg overflow-hidden border border-gray-200">
        <MapContainer
          center={[coords.lat, coords.lng]}
          zoom={16}
          style={{ height: "200px", width: "100%" }}
          scrollWheelZoom={false}
          key={`${coords.lat}-${coords.lng}`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[coords.lat, coords.lng]} icon={icon}>
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-medium">{props.logradouro}{props.numero ? `, ${props.numero}` : ""}</p>
                <p className="text-gray-500">{props.cidade} — {props.estado}</p>
                <a
                  href={googleMapsUrl(coords, query)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline mt-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Abrir no Google Maps
                </a>
              </div>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    </>
  );
}
