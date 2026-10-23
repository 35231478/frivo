"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { confirmar, toast } from "@/components/ui/avisos";
import { OrcamentoForm } from "@/components/forms/orcamento-form";
import type { DadosNovoOrcamento } from "@/lib/orcamentos/form-dados";

/**
 * "Criar orçamento" SEM sair da OS: abre o construtor de verdade do módulo comercial
 * (OrcamentoForm, a mesma tela de /orcamentos/novo e a mesma API) numa gaveta, já com o cliente
 * da OS e a OS vinculada. Ao salvar, o orçamento aparece na aba Comercial e a gaveta fecha.
 * Quem não pode criar orçamento não vê o botão (o servidor também recusa: orcamentos.criar).
 */
export function OsNovoOrcamento({ osId, numeroOs, onCriado }: { osId: string; numeroOs: string; onCriado: (orcamento: any) => void }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<DadosNovoOrcamento | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setDados(null); setErro("");
    let vivo = true;
    fetch(`/api/orcamentos/form-dados?osId=${encodeURIComponent(osId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok) setDados(d); else setErro(d.erro ?? "Não foi possível abrir o orçamento.");
      })
      .catch(() => vivo && setErro("Erro de conexão."));
    return () => { vivo = false; };
  }, [aberto, osId]);

  async function fechar() {
    // Gaveta com o construtor aberto: fechar sem querer perderia o que foi montado
    if (dados && !(await confirmar({ mensagem: "Fechar sem criar o orçamento? O que foi preenchido será perdido.", confirmarTexto: "Fechar", perigo: true }))) return;
    setAberto(false);
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} data-criar-orcamento
        className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm">
        <Plus className="w-4 h-4" /> Criar orçamento
      </button>
      <Drawer aberto={aberto} onFechar={fechar} titulo={`Novo orçamento — ${numeroOs}`} largura="w-full sm:w-[88vw] sm:max-w-[1180px]">
        <div data-gaveta-orcamento>
          {erro && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          {!erro && !dados && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Abrindo o construtor de orçamento…</p>}
          {dados && (
            <OrcamentoForm
              mode="novo" {...dados}
              embutido={{
                osId,
                onCancelar: fechar,
                onSalvo: (orc) => {
                  setAberto(false);
                  toast(`Orçamento ${orc.codigo} criado e vinculado a esta OS.`);
                  onCriado(orc);
                },
              }}
            />
          )}
        </div>
      </Drawer>
    </>
  );
}
