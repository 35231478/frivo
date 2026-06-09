"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Printer, ChevronLeft } from "lucide-react";

type Etiqueta = {
  id: string;
  codigo: string;
  imagem: string;
  equipamento: string | null;
  local: string | null;
};
type EmpresaInfo = { nome: string; telefone: string; email: string; site: string; logo: string | null };

const TAMANHOS: Record<string, number> = { "3x3": 3, "5x5": 5, "8x8": 8, "10x10": 10 }; // cm
const POR_PAGINA: Record<string, number> = { "1": 1, "4": 2, "9": 3, "24": 4 }; // colunas no grid

export function ImprimirClient({ etiquetas, empresa }: { etiquetas: Etiqueta[]; empresa: EmpresaInfo }) {
  const [tamanho, setTamanho] = useState("5x5");
  const [layout, setLayout] = useState<"centro" | "lateral">("centro");
  const [porPagina, setPorPagina] = useState("9");
  const [dados, setDados] = useState({
    logo: true, nomeEmpresa: true, telefone: true, email: false, site: false,
    equipamento: true, local: true, codigo: true,
  });

  function toggle(k: keyof typeof dados) {
    setDados((d) => ({ ...d, [k]: !d[k] }));
  }

  const cm = TAMANHOS[tamanho];
  const colunas = POR_PAGINA[porPagina];

  return (
    <div className="space-y-6">
      {/* Painel de opções (não imprime) */}
      <div className="print:hidden space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/qrcodes" className="p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-ink tracking-tight">Imprimir QR Codes</h1>
              <p className="text-sm text-ink-muted mt-1">{etiquetas.length} etiqueta(s) — personalize e imprima</p>
            </div>
          </div>
          <Button onClick={() => window.print()}><Printer className="w-4 h-4" /> Imprimir</Button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Tamanho da etiqueta</label>
              <Select value={tamanho} onChange={(e) => setTamanho(e.target.value)}>
                <option value="3x3">3 × 3 cm</option>
                <option value="5x5">5 × 5 cm</option>
                <option value="8x8">8 × 8 cm</option>
                <option value="10x10">10 × 10 cm</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Layout</label>
              <Select value={layout} onChange={(e) => setLayout(e.target.value as "centro" | "lateral")}>
                <option value="centro">QR centralizado + dados embaixo</option>
                <option value="lateral">QR à esquerda + dados à direita</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Etiquetas por página</label>
              <Select value={porPagina} onChange={(e) => setPorPagina(e.target.value)}>
                <option value="1">1 por página</option>
                <option value="4">4 por página (2×2)</option>
                <option value="9">9 por página (3×3)</option>
                <option value="24">24 por página (4×6)</option>
              </Select>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-ink mb-1.5">Dados na etiqueta</label>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="pr-3 divide-y divide-gray-100">
                <ToggleSwitch label="Logo da empresa" checked={dados.logo} onChange={() => toggle("logo")} />
                <ToggleSwitch label="Nome da empresa" checked={dados.nomeEmpresa} onChange={() => toggle("nomeEmpresa")} />
                <ToggleSwitch label="Telefone" checked={dados.telefone} onChange={() => toggle("telefone")} />
                <ToggleSwitch label="E-mail" checked={dados.email} onChange={() => toggle("email")} />
              </div>
              <div className="pl-3 divide-y divide-gray-100">
                <ToggleSwitch label="Site" checked={dados.site} onChange={() => toggle("site")} />
                <ToggleSwitch label="Nome do equipamento" checked={dados.equipamento} onChange={() => toggle("equipamento")} />
                <ToggleSwitch label="Localização/Unidade" checked={dados.local} onChange={() => toggle("local")} />
                <ToggleSwitch label="Código QR (texto)" checked={dados.codigo} onChange={() => toggle("codigo")} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Área de impressão */}
      <div
        className="etiquetas-grid"
        style={{ display: "grid", gridTemplateColumns: `repeat(${colunas}, 1fr)`, gap: "0.4cm" }}
      >
        {etiquetas.map((et) => (
          <div
            key={et.id}
            className="etiqueta"
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "0.3cm",
              display: "flex",
              flexDirection: layout === "centro" ? "column" : "row",
              alignItems: "center",
              gap: "0.25cm",
              breakInside: "avoid",
              textAlign: layout === "centro" ? "center" : "left",
            }}
          >
            <img src={et.imagem} alt={et.codigo} style={{ width: `${cm}cm`, height: `${cm}cm`, flexShrink: 0 }} />
            <div style={{ fontSize: cm <= 3 ? 7 : cm <= 5 ? 9 : 11, lineHeight: 1.3, minWidth: 0 }}>
              {dados.logo && empresa.logo && (
                <img src={empresa.logo} alt="logo" style={{ maxHeight: "0.6cm", margin: layout === "centro" ? "0 auto 2px" : "0 0 2px", objectFit: "contain" }} />
              )}
              {dados.nomeEmpresa && empresa.nome && <div style={{ fontWeight: 700 }}>{empresa.nome}</div>}
              {dados.telefone && empresa.telefone && <div>{empresa.telefone}</div>}
              {dados.email && empresa.email && <div>{empresa.email}</div>}
              {dados.site && empresa.site && <div>{empresa.site}</div>}
              {dados.equipamento && et.equipamento && <div style={{ fontWeight: 600 }}>{et.equipamento}</div>}
              {dados.local && et.local && <div>{et.local}</div>}
              {dados.codigo && <div style={{ fontFamily: "monospace", color: "#64748b" }}>{et.codigo}</div>}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          @page { margin: 1cm; }
          body { background: #fff; }
          aside, header { display: none !important; }
          html, body, main { height: auto !important; overflow: visible !important; }
          .etiqueta { border-color: #cbd5e1 !important; }
        }
      `}</style>
    </div>
  );
}
