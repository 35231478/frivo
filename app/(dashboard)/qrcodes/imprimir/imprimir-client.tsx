"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Printer, ChevronLeft } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { neutro } from "@/lib/ui/tokens";

type Etiqueta = {
  id: string;
  codigo: string;
  imagem: string;
  equipamento: string | null;
  local: string | null;
};
type EmpresaInfo = { nome: string; telefone: string; email: string; site: string; logo: string | null };

const TAMANHOS: Record<string, number> = { "3x3": 3, "5x5": 5, "8x8": 8, "10x10": 10 }; // cm
const AJUDA = "Escolha o tamanho, o layout e os dados da etiqueta. A prévia mostra a folha em tamanho real; no celular, ela rola de lado.";
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
    <div className="space-y-5" data-imprimir-qrcodes>
      {/* Painel de opções (não imprime) */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/qrcodes" aria-label="Voltar para QR Codes" className="p-2 -ml-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt shrink-0">
              <ChevronLeft className="w-5 h-5" aria-hidden />
            </Link>
            <div className="min-w-0">
              <h1 className="page-title flex items-center gap-1.5">Imprimir QR Codes <Dica texto={AJUDA} rotulo="Imprimir QR Codes" lado="direita" /></h1>
              <p className="text-sm text-ink-muted" data-total-etiquetas>{etiquetas.length} {etiquetas.length === 1 ? "etiqueta" : "etiquetas"}</p>
            </div>
          </div>
          <Button onClick={() => window.print()} className="w-full sm:w-auto" data-imprimir><Printer className="w-4 h-4" aria-hidden /> Imprimir</Button>
        </div>

        <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6" data-opcoes-etiqueta>
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1.5">Tamanho da etiqueta</span>
              <Select value={tamanho} onChange={(e) => setTamanho(e.target.value)} data-tamanho>
                <option value="3x3">3 × 3 cm</option>
                <option value="5x5">5 × 5 cm</option>
                <option value="8x8">8 × 8 cm</option>
                <option value="10x10">10 × 10 cm</option>
              </Select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1.5">Layout</span>
              <Select value={layout} onChange={(e) => setLayout(e.target.value as "centro" | "lateral")} data-layout>
                <option value="centro">QR centralizado, dados embaixo</option>
                <option value="lateral">QR à esquerda, dados à direita</option>
              </Select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1.5">Etiquetas por página</span>
              <Select value={porPagina} onChange={(e) => setPorPagina(e.target.value)} data-por-pagina>
                <option value="1">1 por página</option>
                <option value="4">4 por página (2×2)</option>
                <option value="9">9 por página (3×3)</option>
                <option value="24">24 por página (4×6)</option>
              </Select>
            </label>
          </div>

          <div className="md:col-span-2">
            <p className="block text-sm font-medium text-ink mb-1.5">Dados na etiqueta</p>
            {/* Celular: uma coluna só (duas espremiam o rótulo contra a chave) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-surface-linha">
              <div className="sm:pr-3 divide-y divide-surface-linha">
                <ToggleSwitch label="Logo da empresa" checked={dados.logo} onChange={() => toggle("logo")} />
                <ToggleSwitch label="Nome da empresa" checked={dados.nomeEmpresa} onChange={() => toggle("nomeEmpresa")} />
                <ToggleSwitch label="Telefone" checked={dados.telefone} onChange={() => toggle("telefone")} />
                <ToggleSwitch label="E-mail" checked={dados.email} onChange={() => toggle("email")} />
              </div>
              <div className="sm:pl-3 divide-y divide-surface-linha border-t border-surface-linha sm:border-t-0">
                <ToggleSwitch label="Site" checked={dados.site} onChange={() => toggle("site")} />
                <ToggleSwitch label="Nome do equipamento" checked={dados.equipamento} onChange={() => toggle("equipamento")} />
                <ToggleSwitch label="Localização ou unidade" checked={dados.local} onChange={() => toggle("local")} />
                <ToggleSwitch label="Código da etiqueta (texto)" checked={dados.codigo} onChange={() => toggle("codigo")} />
              </div>
            </div>
          </div>
        </div>
        <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Prévia em tamanho real</p>
      </div>

      {/* Área de impressão. Na tela, a folha mantém o tamanho real e rola de lado dentro da moldura (no
          celular as colunas espremiam e uma etiqueta caía em cima da outra); no papel, sai como sempre. */}
      <div className="previa-etiquetas overflow-x-auto print:overflow-visible" data-previa-etiquetas>
      <div
        className="etiquetas-grid"
        style={{ display: "grid", gridTemplateColumns: `repeat(${colunas}, 1fr)`, gap: "0.4cm" }}
      >
        {etiquetas.map((et) => (
          <div
            key={et.id}
            className="etiqueta" data-etiqueta={et.id}
            style={{
              border: `1px solid ${neutro.borda}`,
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
            <img src={et.imagem} alt={`QR Code ${et.codigo}`} style={{ width: `${cm}cm`, height: `${cm}cm`, flexShrink: 0 }} />
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
              {dados.codigo && <div style={{ fontFamily: "monospace", color: neutro.secundario }}>{et.codigo}</div>}
            </div>
          </div>
        ))}
      </div>
      </div>

      <style>{`
        @media screen {
          .etiquetas-grid { min-width: max-content; }
        }
        @media print {
          @page { margin: 1cm; }
          body { background: #fff; }
          aside, header { display: none !important; }
          html, body, main { height: auto !important; overflow: visible !important; }
          .etiqueta { border-color: ${neutro.borda} !important; }
        }
      `}</style>
    </div>
  );
}
