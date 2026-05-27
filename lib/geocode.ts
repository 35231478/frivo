export interface CoordsResult {
  lat: number;
  lng: number;
}

export async function geocodeEndereco(
  logradouro: string,
  numero?: string,
  cidade?: string,
  estado?: string,
): Promise<CoordsResult | null> {
  const parts = [logradouro, numero, cidade, estado, "Brasil"].filter(Boolean);
  const q = parts.join(", ");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Frivo/1.0", "Accept-Language": "pt-BR" },
    });
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {}
  return null;
}
