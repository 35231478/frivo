"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock, Download, Eye, FileText, FolderDown, Link2, Link2Off, Mail, MailX, PackagePlus,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { EVENTOS_DO_CLIENTE, ROTULO_EVENTO, agruparItens, type TipoEvento } from "@/lib/documentacao/pacote";
import { tamanhoEmPalavras } from "@/lib/colaborador/documentos";
import { cn, formatarData, formatarDataHora } from "@/lib/utils";
import type { EnvioDetalhe, EventoDaLinha } from "@/lib/documentacao/pacote-server";
import { SeloLink } from "@/components/documentacao/selo-link";

const ICONE: Record<TipoEvento, React.ComponentType<{ className?: string }>> = {
  CRIADO: PackagePlus, LINK_GERADO: Link2, ZIP_BAIXADO: FolderDown, EMAIL_ENVIADO: Mail, EMAIL_FALHOU: MailX,
  REVOGADO: Link2Off, ACESSO: Eye, DOWNLOAD: Download, DOWNLOAD_ZIP: FolderDown,
};

/** O que o evento diz além do rótulo: para quem foi o e-mail, qual arquivo o cliente baixou, o prazo. */
function complemento(e: EventoDaLinha): string {
  const d = (e.detalhe ?? {}) as Record<string, unknown>;
  switch (e.tipo) {
    case "EMAIL_ENVIADO":
    case "EMAIL_FALHOU": {
      const para = Array.isArray(d.para) ? (d.para as string[]).join(", ") : "";
      const cc = Array.isArray(d.cc) && (d.cc as string[]).length ? ` · cópia: ${(d.cc as string[]).join(", ")}` : "";
      const erro = e.tipo === "EMAIL_FALHOU" && d.erro ? ` — ${String(d.erro)}` : "";
      return `${para}${cc}${erro}`;
    }
    case "LINK_GERADO": return d.dias ? `Válido por ${String(d.dias)} dias` : "";
    case "DOWNLOAD": return d.caminho ? String(d.caminho) : "";
    case "DOWNLOAD_ZIP":
    case "ZIP_BAIXADO": return d.arquivos ? `${String(d.arquivos)} arquivos` : "";
    default: return "";
  }
}

/**
 * O ENVIO POR DENTRO: os arquivos do pacote e a linha do tempo — o que a empresa fez e o que o
 * cliente fez pelo link. É a prova de recebimento: quando abriu, o que baixou, de qual endereço.
 */
export function DetalheEnvio({ envioId, aberto, onFechar }: { envioId: string | null; aberto: boolean; onFechar: () => void }) {
  const [dados, setDados] = useState<EnvioDetalhe | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto || !envioId) return;
    let vivo = true;
    setDados(null); setErro("");
    fetch(`/api/documentacao/envios/${envioId}`)
      .then(async (r) => ({ ok: r.ok, corpo: await r.json().catch(() => ({})) }))
      .then(({ ok, corpo }) => { if (!vivo) return; if (ok) setDados(corpo); else setErro(corpo?.erro ?? "Não foi possível carregar o envio."); })
      .catch(() => { if (vivo) setErro("Erro de conexão. Tente de novo."); });
    return () => { vivo = false; };
  }, [aberto, envioId]);

  const grupos = dados ? agruparItens(dados.itens, dados.organizacao) : [];

  return (
    <Drawer aberto={aberto} onFechar={onFechar} titulo={dados ? `Envio para ${dados.clienteNome}` : "Envio"}>
      <div className="space-y-5" data-detalhe-envio={envioId ?? ""}>
        {erro && <p role="alert" className="text-sm bg-atrasado-claro border border-atrasado/20 text-atrasado-texto rounded-lg px-3 py-2" data-erro-detalhe>{erro}</p>}
        {!dados && !erro && <p className="text-sm text-ink-muted">Carregando…</p>}

        {dados && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              <SeloLink situacao={dados.link} />
              {dados.expiraEm && dados.link === "ATIVO" && (
                <span className="inline-flex items-center gap-1"><CalendarClock className="w-4 h-4" aria-hidden /> até {formatarData(dados.expiraEm)}</span>
              )}
              <span>{dados.arquivos} {dados.arquivos === 1 ? "arquivo" : "arquivos"} de {dados.colaboradores} {dados.colaboradores === 1 ? "colaborador" : "colaboradores"}</span>
            </div>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">Linha do tempo</h3>
              <ol className="space-y-0" data-linha-do-tempo>
                {dados.eventos.map((e) => {
                  const tipo = e.tipo as TipoEvento;
                  const Icone = ICONE[tipo] ?? FileText;
                  const doCliente = EVENTOS_DO_CLIENTE.includes(tipo);
                  const extra = complemento(e);
                  return (
                    <li key={e.id} className="flex gap-3 py-2.5 border-b border-surface-linha last:border-0" data-evento={e.tipo} data-do-cliente={doCliente ? "sim" : "nao"}>
                      <span className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center", doCliente ? "bg-ok-claro text-ok-texto" : e.tipo === "EMAIL_FALHOU" ? "bg-atrasado-claro text-atrasado-texto" : "bg-surface-alt text-ink-muted")}>
                        <Icone className="w-4 h-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{ROTULO_EVENTO[tipo] ?? e.tipo}</p>
                        {extra && <p className="text-xs text-ink-muted break-words">{extra}</p>}
                        <p className="text-xs text-ink-subtle">
                          {formatarDataHora(e.em)}
                          {e.por ? ` · ${e.por}` : ""}
                          {doCliente && e.ip ? ` · IP ${e.ip}` : ""}
                        </p>
                        {doCliente && e.navegador && <p className="text-[11px] text-ink-subtle truncate" title={e.navegador}>{e.navegador}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">O que foi no pacote</h3>
              <div className="space-y-3" data-itens-do-envio>
                {grupos.map((g) => (
                  <div key={g.titulo}>
                    <p className="text-sm font-semibold text-ink">{g.titulo}</p>
                    <ul className="mt-1 space-y-1">
                      {g.itens.map((i) => (
                        <li key={i.id} className="text-sm text-ink-muted flex flex-wrap items-baseline gap-x-2" data-item-do-envio={i.id}>
                          <span className="text-ink">{i.rotulo} · {i.nome}</span>
                          {tamanhoEmPalavras(i.tamanho) && <span className="text-xs">{tamanhoEmPalavras(i.tamanho)}</span>}
                          {i.vencido && <span className="text-xs font-medium text-atrasado">Venceu em {formatarData(i.dataVencimento)}</span>}
                          {!i.disponivel && <span className="text-xs font-medium text-atencao-texto">Excluído da ficha: não sai mais no link</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}
