"use client";

import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { formatarDataHora } from "@/lib/utils";
import { ehParte, ROTULO_PARTE, situacaoExportacao, type Parte, type SituacaoExportacao } from "@/lib/exportacao/arquivos";

export interface ExportacaoLinha {
  id: string;
  usuarioNome: string;
  parte: string;
  criadoEm: string;
  concluidaEm: string | null;
  arquivos: number | null;
  linhas: number | null;
  erro: string | null;
}

const URL_BAIXAR = "/api/configuracoes/exportar-dados/baixar";
const URL_HISTORICO = "/api/configuracoes/exportar-dados";
const PARTES: Exclude<Parte, "tudo">[] = ["cadastros", "operacao", "financeiro"];
const SITUACAO: Record<SituacaoExportacao, { tom: TomStatus; texto: string }> = {
  concluida: { tom: "ok", texto: "Concluída" },
  andamento: { tom: "atencao", texto: "Gerando" },
  falhou: { tom: "atrasado", texto: "Não concluída" },
};
/** De quanto em quanto tempo a tela confere se a exportação terminou, e por quanto tempo no máximo */
const INTERVALO_MS = 4000;
const LIMITE_MS = 6 * 60_000;
/** Sem registro novo neste tempo, a exportação não começou (sessão vencida, sem permissão, erro do servidor) */
const NAO_COMECOU_MS = 20_000;
export const MSG_NAO_COMECOU = "A exportação não começou. Recarregue a página e tente de novo.";
export const MSG_DEMOROU = "A exportação está demorando. Confira o resultado em Últimas exportações.";

export const hrefExportar = (parte: Parte) => (parte === "tudo" ? URL_BAIXAR : `${URL_BAIXAR}?parte=${parte}`);

/**
 * Os botões de baixar (tudo ou por parte) e as últimas exportações. O download é um link comum: o navegador
 * recebe o .zip em streaming e começa a salvar na hora. Enquanto isso, a tela confere a trilha até a
 * exportação nova aparecer concluída (ou não concluída) e avisa.
 */
export function ExportarDadosClient({ inicial }: { inicial: ExportacaoLinha[] }) {
  const [lista, setLista] = useState(inicial);
  const [gerando, setGerando] = useState<Parte | null>(null);
  const vigia = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (vigia.current) clearInterval(vigia.current); }, []);

  async function carregar(): Promise<ExportacaoLinha[] | null> {
    try {
      const r = await fetch(URL_HISTORICO, { cache: "no-store" });
      if (!r.ok) return null;
      const d = await r.json();
      setLista(d.exportacoes);
      return d.exportacoes;
    } catch {
      return null;
    }
  }

  function acompanhar(parte: Parte) {
    const conhecidos = new Set(lista.map((e) => e.id));
    const inicio = Date.now();
    setGerando(parte);
    if (vigia.current) clearInterval(vigia.current);
    vigia.current = setInterval(async () => {
      const atual = await carregar();
      const nova = atual?.find((e) => !conhecidos.has(e.id));
      const situacao = nova ? situacaoExportacao(nova) : null;
      const passou = Date.now() - inicio;
      const naoComecou = !nova && passou > NAO_COMECOU_MS;
      const esgotou = passou > LIMITE_MS;
      if ((situacao && situacao !== "andamento") || esgotou || naoComecou) {
        clearInterval(vigia.current!);
        vigia.current = null;
        setGerando(null);
        if (situacao === "concluida") toast("Exportação concluída. O arquivo está na pasta de downloads.");
        else if (situacao === "falhou") toast(nova?.erro || "A exportação não terminou. Tente de novo ou baixe por parte.", "erro");
        else if (naoComecou) toast(MSG_NAO_COMECOU, "erro");
        else toast(MSG_DEMOROU, "erro");
      }
    }, INTERVALO_MS);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4" data-exportar-pacote>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-acento-claro text-acento">
            <DatabaseBackup className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Pacote completo</p>
            <p className="text-xs text-ink-muted mt-0.5">Cadastros, OS, orçamentos e financeiro, um CSV por planilha.</p>
          </div>
        </div>
        <a
          href={hrefExportar("tudo")}
          download
          onClick={() => acompanhar("tudo")}
          className="btn-primary inline-flex items-center justify-center gap-1.5 min-h-[44px] w-full sm:w-auto"
          data-exportar="tudo"
        >
          <Download className="w-4 h-4" aria-hidden /> Baixar tudo (.zip)
        </a>
        <div className="border-t border-surface-linha pt-3">
          <p className="text-xs text-ink-muted mb-2">Empresa com muito histórico: baixar por parte.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PARTES.map((p) => (
              <a
                key={p}
                href={hrefExportar(p)}
                download
                onClick={() => acompanhar(p)}
                className="btn-secondary inline-flex items-center justify-center gap-1.5 min-h-[44px]"
                data-exportar={p}
              >
                <Download className="w-4 h-4" aria-hidden /> {ROTULO_PARTE[p]}
              </a>
            ))}
          </div>
        </div>
        <p className={gerando ? "text-xs text-ink-muted" : "sr-only"} aria-live="polite" data-exportar-estado>
          {gerando ? `Gerando ${gerando === "tudo" ? "o pacote" : `a parte ${ROTULO_PARTE[gerando]}`}: o download começa em instantes.` : ""}
        </p>
      </div>

      <div className="card p-0 overflow-hidden" data-exportar-historico>
        <p className="text-sm font-semibold text-ink px-4 pt-4 pb-2">Últimas exportações</p>
        {lista.length === 0 ? (
          <p className="text-sm text-ink-muted px-4 pb-4" data-exportar-vazio>Nenhuma exportação ainda.</p>
        ) : (
          <ul className="divide-y divide-surface-linha">
            {lista.map((e) => {
              const s = SITUACAO[situacaoExportacao(e)];
              return (
                <li key={e.id} className="px-4 py-3 flex items-center gap-3" data-exportacao={e.id}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {formatarDataHora(e.criadoEm)} <span className="text-ink-muted">· {e.usuarioNome}</span>
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {ehParte(e.parte) ? ROTULO_PARTE[e.parte] : e.parte}
                      {e.linhas != null ? ` · ${e.linhas.toLocaleString("pt-BR")} linhas` : ""}
                    </p>
                    {situacaoExportacao(e) === "falhou" && e.erro && <p className="text-xs text-atrasado-texto mt-0.5" data-exportacao-erro>{e.erro}</p>}
                  </div>
                  <StatusPill tom={s.tom} tamanho="sm" data-situacao-exportacao={situacaoExportacao(e)}>{s.texto}</StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
