"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, FileCode2, Loader2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { toast } from "@/components/ui/avisos";
import { baixarArquivo } from "@/lib/baixar-cliente";
import { CopiarCodigo } from "@/components/financeiro/copiar-codigo";
import { cn, formatarCpfCnpj, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { chaveEmBlocos, COR_STATUS_NOTA, LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { enderecoEmLinha, type DanfeJson, type Json } from "@/lib/compras/danfe-texto";
import type { VisualizacaoNota } from "@/lib/compras/notas";

type Dados = Json<VisualizacaoNota>;

const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const doc = (d: string) => (d ? formatarCpfCnpj(d) : "—");
const ou = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/**
 * VISUALIZAÇÃO RÁPIDA da nota de compra: a gaveta lateral que a lista abre (clique na linha ou no olho),
 * sem sair da tela. Com o XML importado, mostra a DANFE simplificada (emitente, destinatário, itens,
 * impostos, totais e chave) e oferece Baixar PDF e Baixar XML; sem XML, mostra o que a nota tem no
 * sistema e esconde os dois botões. "Abrir a nota" leva à tela completa (conciliar, lançar).
 */
export function GavetaNota({ notaId, hrefNota, onFechar }: { notaId: string | null; hrefNota: (id: string) => string; onFechar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!notaId) return;
    let vivo = true;
    setDados(null); setErro("");
    fetch(`/api/compras/notas/${notaId}/visualizar`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !j) setErro(j?.erro ?? "Não foi possível abrir a nota.");
        else setDados(j as Dados);
      })
      .catch(() => { if (vivo) setErro("Sem conexão: não foi possível abrir a nota."); });
    return () => { vivo = false; };
  }, [notaId]);

  const n = dados?.nota;
  const titulo = n ? `NF ${n.numero}/${n.serie}` : "Nota de compra";
  const base = notaId ? `/api/compras/notas/${notaId}` : "";
  const [baixando, setBaixando] = useState<"pdf" | "xml" | null>(null);
  async function baixar(url: string, nome: string, qual: "pdf" | "xml") {
    setBaixando(qual);
    const r = await baixarArquivo(url, nome, qual === "pdf" ? "Não foi possível gerar o PDF da nota." : "Não foi possível baixar o XML da nota.");
    setBaixando(null);
    if (!r.ok) toast(r.erro, "erro");
  }
  const rodape = notaId ? (
    <div className="flex flex-wrap items-center justify-end gap-2" data-acoes-nota>
      {dados?.danfe && (
        <>
          <button type="button" onClick={() => baixar(`${base}/danfe`, `nf-${n?.numero ?? "nota"}.pdf`, "pdf")} disabled={baixando === "pdf"} className="btn-secondary inline-flex items-center gap-1.5" data-baixar-pdf>
            {baixando === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />} Baixar PDF
          </button>
          <button type="button" onClick={() => baixar(`${base}/xml`, `nf-${n?.numero ?? "nota"}.xml`, "xml")} disabled={baixando === "xml"} className="btn-secondary inline-flex items-center gap-1.5" data-baixar-xml>
            {baixando === "xml" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <FileCode2 className="w-4 h-4" aria-hidden />} Baixar XML
          </button>
        </>
      )}
      <Link href={hrefNota(notaId)} className="btn-primary inline-flex items-center gap-1.5" data-abrir-nota><ExternalLink className="w-4 h-4" aria-hidden /> Abrir a nota</Link>
    </div>
  ) : undefined;

  return (
    <Drawer aberto={!!notaId} onFechar={onFechar} titulo={titulo} largura="w-full sm:max-w-2xl" rodape={rodape}>
      <div data-gaveta-nota={notaId ?? ""} className="space-y-4">
        {erro ? (
          <p className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5" role="alert">{erro}</p>
        ) : !dados || !n ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted py-8 justify-center" role="status"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando a nota…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("font-semibold px-2.5 py-1 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span>
              {n.pedido && <Link href={`/compras/pedidos/${n.pedido.id}`} className="text-primary-700 hover:underline" data-pedido-nota>Pedido {n.pedido.numero}</Link>}
              {n.entrada && <span className="text-ink-muted">Entrada em {formatarDataHora(n.entrada)}</span>}
            </div>
            {dados.danfe ? <Danfe d={dados.danfe} /> : <SemXml n={n} />}
          </>
        )}
      </div>
    </Drawer>
  );
}

/** Bloco com o rótulo pequeno em cima (o "quadro" da DANFE) */
function Quadro({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border border-surface-border rounded-lg px-3 py-2.5", className)} aria-label={titulo}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">{titulo}</h3>
      {children}
    </section>
  );
}

function Campo({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-subtle">{rotulo}</p>
      <p className={cn("text-sm tabular-nums", destaque ? "font-display font-semibold text-ink" : "text-ink")}>{valor}</p>
    </div>
  );
}

function Danfe({ d }: { d: DanfeJson }) {
  const t = d.totais;
  return (
    <div className="space-y-3" data-danfe>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <Quadro titulo="Emitente">
          <p className="text-sm font-semibold text-ink" data-danfe-emitente>{ou(d.emitente.nome)}</p>
          <p className="text-xs text-ink-muted">{ou(enderecoEmLinha(d.emitente.endereco))}</p>
          <p className="text-xs text-ink-muted tabular-nums">CNPJ {doc(d.emitente.documento)} · IE {ou(d.emitente.ie)}</p>
        </Quadro>
        <Quadro titulo="DANFE simplificada" className="sm:min-w-[11rem]">
          <p className="text-sm font-semibold text-ink tabular-nums">NF-e {d.numero} · Série {d.serie}</p>
          <p className="text-xs text-ink-muted">{d.tipo === "ENTRADA" ? "Entrada" : d.tipo === "SAIDA" ? "Saída" : ""}{d.emissao ? ` · Emissão ${formatarData(d.emissao)}` : ""}</p>
        </Quadro>
      </div>

      <Quadro titulo="Chave de acesso">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs sm:text-sm text-ink break-all" data-danfe-chave>{d.chave ? chaveEmBlocos(d.chave) : "—"}</p>
          {d.chave && <CopiarCodigo texto={d.chave} rotulo="Copiar chave" />}
        </div>
        <p className="text-xs text-ink-muted mt-1">
          {d.protocolo ? `Protocolo ${d.protocolo.numero}${d.protocolo.data ? ` · ${formatarDataHora(d.protocolo.data)}` : ""}` : "Sem protocolo de autorização no XML"}
          {d.naturezaOperacao ? ` · ${d.naturezaOperacao}` : ""}
        </p>
      </Quadro>

      <Quadro titulo="Destinatário">
        <p className="text-sm font-semibold text-ink">{ou(d.destinatario.nome)}</p>
        <p className="text-xs text-ink-muted">{ou(enderecoEmLinha(d.destinatario.endereco))}</p>
        <p className="text-xs text-ink-muted tabular-nums">CNPJ/CPF {doc(d.destinatario.documento)} · IE {ou(d.destinatario.ie)}</p>
      </Quadro>

      <Quadro titulo={`Itens (${d.itens.length})`}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[30rem]" data-danfe-itens>
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-subtle text-left">
                <th className="px-1 py-1 font-semibold">Produto</th>
                <th className="px-1 py-1 font-semibold text-right">Qtd</th>
                <th className="px-1 py-1 font-semibold text-right">Unit. (R$)</th>
                <th className="px-1 py-1 font-semibold text-right">Total (R$)</th>
                <th className="px-1 py-1 font-semibold text-right">ICMS (R$)</th>
                <th className="px-1 py-1 font-semibold text-right">IPI (R$)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {d.itens.map((i) => (
                <tr key={i.numero} data-danfe-item={i.numero}>
                  <td className="px-1 py-1.5">
                    <p className="text-ink">{i.descricao}</p>
                    <p className="text-[10px] text-ink-subtle tabular-nums">{[i.codigo, i.ncm && `NCM ${i.ncm}`, i.cfop && `CFOP ${i.cfop}`, i.cst && `CST ${i.cst}`].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums whitespace-nowrap">{qtd(i.quantidade)} {i.unidade}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{formatarMoeda(i.valorUnitario).replace("R$", "").trim()}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-semibold">{formatarMoeda(i.valorTotal).replace("R$", "").trim()}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{i.valorIcms ? formatarMoeda(i.valorIcms).replace("R$", "").trim() : "—"}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{i.valorIpi ? formatarMoeda(i.valorIpi).replace("R$", "").trim() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Quadro>

      <Quadro titulo="Impostos e totais">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2" data-danfe-totais>
          <Campo rotulo="Base do ICMS" valor={formatarMoeda(t.baseIcms)} />
          <Campo rotulo="ICMS" valor={formatarMoeda(t.icms)} />
          <Campo rotulo="Base do ICMS-ST" valor={formatarMoeda(t.baseIcmsSt)} />
          <Campo rotulo="ICMS-ST" valor={formatarMoeda(t.icmsSt)} />
          <Campo rotulo="Produtos" valor={formatarMoeda(t.produtos)} />
          <Campo rotulo="Frete" valor={formatarMoeda(t.frete)} />
          <Campo rotulo="Seguro" valor={formatarMoeda(t.seguro)} />
          <Campo rotulo="Desconto" valor={formatarMoeda(t.desconto)} />
          <Campo rotulo="Outras despesas" valor={formatarMoeda(t.outros)} />
          <Campo rotulo="IPI" valor={formatarMoeda(t.ipi)} />
          <Campo rotulo="Tributos aprox." valor={formatarMoeda(t.tributos)} />
          <Campo rotulo="Total da nota" valor={formatarMoeda(t.nota)} destaque />
        </div>
      </Quadro>

      {(d.transporte.modalidade || d.transporte.transportadora || d.duplicatas.length > 0) && (
        <Quadro titulo="Transporte e cobrança">
          <p className="text-xs text-ink-muted">{[d.transporte.modalidade && `Frete: ${d.transporte.modalidade}`, d.transporte.transportadora].filter(Boolean).join(" · ") || "—"}</p>
          {d.duplicatas.length > 0 && (
            <ul className="mt-1.5 text-xs tabular-nums space-y-0.5" data-danfe-duplicatas>
              {d.duplicatas.map((x) => (
                <li key={x.numero} className="flex justify-between gap-3"><span className="text-ink-muted">{x.numero} · vence {x.vencimento ? formatarData(`${x.vencimento}T12:00:00Z`) : "—"}</span><span className="text-ink">{formatarMoeda(x.valor)}</span></li>
              ))}
            </ul>
          )}
        </Quadro>
      )}

      {d.informacoes && (
        <Quadro titulo="Informações complementares">
          <p className="text-xs text-ink-muted whitespace-pre-line">{d.informacoes}</p>
        </Quadro>
      )}
      <p className="text-[11px] text-ink-subtle">Espelho para consulta, gerado do XML importado. Não substitui a DANFE do emitente.</p>
    </div>
  );
}

/** Nota sem XML: o que existe no sistema (sem DANFE nem downloads) */
function SemXml({ n }: { n: Dados["nota"] }) {
  return (
    <div className="space-y-3" data-sem-xml>
      <p className="text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2.5" role="status">Esta nota não tem o XML da NF-e: a DANFE e os downloads não estão disponíveis.</p>
      <Quadro titulo="Nota">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Campo rotulo="Número / série" valor={`${n.numero} / ${n.serie}`} />
          <Campo rotulo="Emissão" valor={formatarData(n.emissao)} />
          <Campo rotulo="Fornecedor" valor={ou(n.fornecedor)} />
          <Campo rotulo="CNPJ" valor={doc(n.cnpj)} />
          <Campo rotulo="Total da nota" valor={formatarMoeda(n.valorTotal)} destaque />
        </div>
        {n.chave && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-mono text-xs text-ink break-all">{chaveEmBlocos(n.chave)}</p>
            <CopiarCodigo texto={n.chave} rotulo="Copiar chave" />
          </div>
        )}
      </Quadro>
      {n.itens.length > 0 && (
        <Quadro titulo={`Itens (${n.itens.length})`}>
          <ul className="divide-y divide-surface-border text-xs">
            {n.itens.map((i) => (
              <li key={i.numero} className="py-1.5 flex justify-between gap-3">
                <span className="text-ink">{i.descricao} <span className="text-ink-subtle">· {qtd(i.quantidade)} {i.unidade}</span></span>
                <span className="tabular-nums font-semibold">{formatarMoeda(i.valorTotal)}</span>
              </li>
            ))}
          </ul>
        </Quadro>
      )}
    </div>
  );
}
