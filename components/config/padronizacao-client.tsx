"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { SomenteLeitura } from "@/components/config/permissao-config";
import type { PlanoLimpeza, ResultadoLimpeza } from "@/lib/texto/limpeza";

const COLUNAS: ColunaPro[] = [
  { id: "cadastro", titulo: "Cadastro", largura: 180, obrigatoria: true },
  { id: "campo", titulo: "Campo", largura: 140 },
  { id: "de", titulo: "De", minimo: 140 },
  { id: "para", titulo: "Para", largura: 280, obrigatoria: true },
];

/**
 * Padronização de digitação dos dados antigos. Primeiro a PRÉVIA (lista o que mudaria, de → para, sem
 * gravar), no padrão de lista; depois, se houver mudanças, o botão aplica de verdade — com a confirmação
 * própria e o aviso (toast). Só quem gerencia as Configurações: sem a permissão, a tela não oferece
 * nem a prévia (a rota recusa as duas).
 */
export function PadronizacaoClient({ podeAplicar }: { podeAplicar: boolean }) {
  const [plano, setPlano] = useState<PlanoLimpeza | null>(null);
  const [resultado, setResultado] = useState<ResultadoLimpeza | null>(null);
  const [carregando, setCarregando] = useState<"previa" | "aplicar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function prever() {
    setCarregando("previa"); setErro(null); setResultado(null);
    try {
      const r = await fetch("/api/configuracoes/padronizacao");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível gerar a prévia."); return; }
      setPlano(j as PlanoLimpeza);
    } catch { setErro("Sem conexão. Tente de novo."); }
    finally { setCarregando(null); }
  }

  async function aplicar() {
    if (!plano) return;
    if (!(await confirmar({
      titulo: "Aplicar a padronização?",
      mensagem: `Grava ${plano.totalCampos} campos em ${plano.totalRegistros} registros. Não dá para desfazer em lote.`,
      perigo: true, confirmarTexto: "Aplicar",
    }))) return;
    setCarregando("aplicar"); setErro(null);
    try {
      const r = await fetch("/api/configuracoes/padronizacao", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível aplicar."); toast(j.erro ?? "Não foi possível aplicar a padronização.", "erro"); return; }
      const res = j as ResultadoLimpeza;
      setResultado(res);
      setPlano(null);
      toast(res.totalCampos === 0 ? "Nada a ajustar: os dados já estavam padronizados." : `Padronização aplicada: ${res.totalCampos} campos em ${res.totalRegistros} registros.`);
    } catch { setErro("Sem conexão. Tente de novo."); }
    finally { setCarregando(null); }
  }

  if (!podeAplicar) return <SomenteLeitura />;

  const nada = plano && plano.totalCampos === 0;

  return (
    <div className="space-y-5" data-padronizacao>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={prever} loading={carregando === "previa"} data-prever>
          Pré-visualizar mudanças
        </Button>
        {plano && plano.totalCampos > 0 && (
          <Button variant="primary" onClick={aplicar} loading={carregando === "aplicar"} disabled={carregando !== null} data-aplicar>
            Aplicar padronização
          </Button>
        )}
      </div>

      {erro && <p role="alert" className="text-sm text-atrasado" data-erro-padronizacao>{erro}</p>}

      {resultado && (
        <div className="rounded-lg border border-ok/30 bg-ok/5 p-4" data-resultado-padronizacao>
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Check className="w-4 h-4 text-ok" aria-hidden />
            {resultado.totalCampos === 0
              ? "Nada a ajustar: os dados já estão padronizados."
              : `Padronização aplicada: ${resultado.totalCampos} campos em ${resultado.totalRegistros} registros.`}
          </p>
          {resultado.porEntidade.length > 0 && <ResumoEntidades itens={resultado.porEntidade} />}
        </div>
      )}

      {nada && (
        <p className="text-sm text-ink-muted" data-nada-a-ajustar>Nada a ajustar: os dados já estão padronizados.</p>
      )}

      {plano && plano.totalCampos > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-surface-border bg-surface p-4" data-resumo-previa>
            <p className="text-sm text-ink">
              {plano.totalCampos} campos em {plano.totalRegistros} registros mudariam. Nada foi gravado ainda.
            </p>
            <ResumoEntidades itens={plano.porEntidade} />
          </div>
          {/* Celular: cada mudança vira um cartão */}
          <ul className="sm:hidden space-y-2" data-cartoes>
            {plano.amostra.map((m, i) => (
              <li key={i} className="border border-surface-border rounded-lg bg-white p-3 text-sm">
                <p className="text-xs text-ink-muted">{m.rotulo} · {m.campo}</p>
                <p className="text-ink-muted line-through break-words">{m.de}</p>
                <p className="text-ink break-words flex items-start gap-1"><ArrowRight className="w-3 h-3 text-ink-subtle mt-1 shrink-0" aria-hidden />{m.para}</p>
              </li>
            ))}
          </ul>
          <TabelaPro
            tela="config-padronizacao" quebra="sm" className="border border-surface-border rounded-lg overflow-hidden" colunas={COLUNAS}
            barra={<span data-total-previa>Prévia{plano.amostraLimitada ? ` (primeiras ${plano.amostra.length})` : `: ${plano.amostra.length} mudanças`}</span>}
            linhas={plano.amostra.map((m, i) => ({
              id: String(i), titulos: { de: m.de, para: m.para },
              celulas: {
                cadastro: <span className="text-ink-muted">{m.rotulo}</span>,
                campo: <span className="text-ink-muted">{m.campo}</span>,
                de: <span className="text-ink-muted line-through">{m.de}</span>,
                para: <span className="inline-flex items-center gap-1 text-ink"><ArrowRight className="w-3 h-3 text-ink-subtle shrink-0" aria-hidden />{m.para}</span>,
              },
            }))}
          />
        </div>
      )}
    </div>
  );
}

function ResumoEntidades({ itens }: { itens: { entidade: string; rotulo: string; registros: number; campos: number }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
      {itens.map((e) => (
        <li key={e.entidade}>
          <span className="text-ink">{e.rotulo}</span>: {e.registros} registros, {e.campos} campos
        </li>
      ))}
    </ul>
  );
}
