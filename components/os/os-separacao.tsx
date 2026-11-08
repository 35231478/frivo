"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, PackageMinus, PackageOpen, Undo2, X } from "lucide-react";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn, formatarDataHora } from "@/lib/utils";
import { arred, formatarQtd } from "@/lib/estoque/regras";
import {
  aDevolver as aDevolverDe, LABEL_SITUACAO_MATERIAL, LABEL_SITUACAO_SEPARACAO, resumoSeparacao, situacaoDoMaterial,
  type EstadoSeparacao, type MaterialSeparavel, type ResumoSeparacao, type SituacaoMaterial, type SituacaoSeparacao,
} from "@/lib/estoque/separacao";

/**
 * Estoque E4.1/E4.2 — o material da OS dentro da central (aba Materiais & Compras): o que foi separado (parcial/total)
 * e por quem (E4.1), o consumo informado e a sobra pendente de devolução (E4.2), e a marca "prestação de contas
 * pendente" — o gancho das amarras. Quem separa vai pela tela Estoque › A separar; quem executa/conclui a OS informa o
 * consumo AQUI ("Informar consumo": padrão = o separado; menos = sobra pendente de devolução; mais = baixa a mais) e
 * pode desfazer enquanto a OS não foi finalizada. Com a amarra da empresa ligada, a OS não conclui sem o consumo.
 */

export interface MaterialDaOs extends MaterialSeparavel {
  item: string;
  kitNome: string | null;
  separadoEm: string | null;
  separadoPor: string | null;
  consumidoEm?: string | null;
  consumidoPor?: string | null;
  devolvidoEm?: string | null;
  devolvidoPor?: string | null;
}

const num = (v: unknown) => Number(v ?? 0);

/** Achata os materiais dos itens da OS (como vêm da página) no formato da regra pura. */
export function materiaisDaOs(itens: any[]): MaterialDaOs[] {
  return itens.flatMap((i) => (i.materiais ?? []).map((m: any): MaterialDaOs => ({
    id: m.id, produtoId: m.produtoId ?? null, descricao: m.descricao, unidade: m.unidade || "un",
    quantidade: num(m.quantidade), quantidadeSeparada: num(m.quantidadeSeparada), quantidadeConsumida: num(m.quantidadeConsumida),
    quantidadeDevolvida: num(m.quantidadeDevolvida), consumoInformado: m.consumidoEm != null,
    estadoSeparacao: (m.estadoSeparacao ?? null) as EstadoSeparacao | null,
    item: i.descricao, kitNome: m.kitNome ?? null,
    separadoEm: m.separadoEm ? new Date(m.separadoEm).toISOString() : null, separadoPor: m.separadoPor?.nome ?? null,
    consumidoEm: m.consumidoEm ? new Date(m.consumidoEm).toISOString() : null, consumidoPor: m.consumidoPor?.nome ?? null,
    devolvidoEm: m.devolvidoEm ? new Date(m.devolvidoEm).toISOString() : null, devolvidoPor: m.devolvidoPor?.nome ?? null,
  }))).filter((m) => m.quantidade > 0);
}

export const TOM_SITUACAO_MATERIAL: Record<SituacaoMaterial, TomStatus> = {
  "sem-produto": "previsto", pendente: "atencao", parcial: "atencao", separado: "ok", consumido: "ok-solido", devolvido: "acento",
};
export const TOM_SITUACAO_SEPARACAO: Record<SituacaoSeparacao, TomStatus> = { "sem-material": "previsto", pendente: "atencao", parcial: "atencao", completa: "ok" };

const paraNumero = (v: string) => { const t = v.trim().replace(/\./g, "").replace(",", "."); return t === "" ? NaN : Number(t); };
/** Material que ainda aceita consumo: tem produto e não está consumido/devolvido */
const aceitaConsumo = (m: MaterialDaOs) => !!m.produtoId && m.estadoSeparacao !== "CONSUMIDO" && m.estadoSeparacao !== "DEVOLVIDO";

export function OsSeparacao({ osId, materiais: iniciais, resumo: resumoInicial, podeSeparar, podeConsumir = false, finalizada = false, cancelada = false, exigirPrestacao = false, onMudou }: {
  osId: string; materiais: MaterialDaOs[]; resumo: ResumoSeparacao; podeSeparar: boolean;
  podeConsumir?: boolean; finalizada?: boolean; cancelada?: boolean; exigirPrestacao?: boolean; onMudou?: () => void;
}) {
  const [materiais, setMateriais] = useState<MaterialDaOs[]>(iniciais);
  const [resumo, setResumo] = useState<ResumoSeparacao>(resumoInicial);
  useEffect(() => { setMateriais(iniciais); setResumo(resumoInicial); }, [iniciais, resumoInicial]);
  const [informando, setInformando] = useState(false);
  const [agora, setAgora] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const consumiveis = materiais.filter(aceitaConsumo);
  const mostrarInformar = podeConsumir && !cancelada && consumiveis.length > 0;

  function abrirConsumo() {
    setAgora(Object.fromEntries(consumiveis.map((m) => [m.id, formatarQtd(m.quantidadeSeparada)])));
    setErro(""); setInformando(true);
  }

  async function chamar(metodo: "POST" | "DELETE", corpo: unknown, rotulo: string) {
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/ordens/${osId}/consumo`, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível registrar."); return false; }
      setMateriais(d.separacao.materiais); setResumo(d.separacao.resumo);
      toast(d.avisos?.length ? `${rotulo}. ${d.avisos.join(" ")}` : rotulo, d.avisos?.length ? "info" : "sucesso");
      onMudou?.();
      return true;
    } catch { setErro("Erro de conexão."); return false; } finally { setSalvando(false); }
  }

  async function confirmarConsumo() {
    const alvos: { id: string; quantidade: number }[] = [];
    const aMais: string[] = [];
    for (const m of consumiveis) {
      const n = paraNumero(agora[m.id] ?? "");
      if (!Number.isFinite(n) || n < 0) { setErro(`${m.descricao}: informe quanto foi consumido (0 se nada).`); return; }
      const q = arred(n);
      if (q === 0 && m.quantidadeSeparada <= 0) continue; // nem separado nem consumido: fica de fora
      if (q > m.quantidadeSeparada) aMais.push(`${m.descricao} (+${formatarQtd(arred(q - m.quantidadeSeparada))} ${m.unidade})`);
      alvos.push({ id: m.id, quantidade: q });
    }
    if (!alvos.length) { setErro("Informe o consumo de ao menos um material."); return; }
    if (aMais.length && !(await confirmar({ titulo: "Consumo acima do separado", mensagem: `${aMais.join(", ")}: a diferença sai do estoque agora (baixa a mais). Confirmar?`, confirmarTexto: "Baixar mesmo assim" }))) return;
    if (await chamar("POST", { materiais: alvos }, alvos.length === 1 ? "Consumo de 1 material informado" : `Consumo de ${alvos.length} materiais informado`)) setInformando(false);
  }

  async function desfazer(m: MaterialDaOs) {
    if (!(await confirmar({ titulo: "Desfazer consumo", mensagem: `Estornar a baixa de ${formatarQtd(m.quantidadeConsumida ?? 0)} ${m.unidade} de ${m.descricao}? O material volta a "separado".`, confirmarTexto: "Desfazer", perigo: true }))) return;
    await chamar("DELETE", { id: m.id }, `Consumo de ${m.descricao} desfeito`);
  }

  const semConsumo = resumo.consumoPendente;

  return (
    <section data-os-separacao data-situacao-separacao={resumo.situacao} data-prestacao-pendente={resumo.prestacaoPendente ? "true" : undefined} data-consumo-pendente={semConsumo || undefined} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title flex items-center gap-2">
          <PackageOpen className="w-4 h-4 text-primary-600" /> Material da OS
          <Dica rotulo="Material da OS" texto="Antes de sair, o almoxarifado separa o material da OS (fica reservado no estoque). Na execução, quem conclui informa o que foi consumido de verdade: só isso sai do estoque; a sobra fica reservada até ser devolvida." />
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tom={TOM_SITUACAO_SEPARACAO[resumo.situacao]} data-resumo-separacao={resumo.situacao}>
            {LABEL_SITUACAO_SEPARACAO[resumo.situacao]}{resumo.total > 0 && resumo.situacao !== "completa" ? ` · ${resumo.aSeparar} de ${resumo.total} a separar` : ""}
          </StatusPill>
          {semConsumo > 0 && (
            <StatusPill tom={exigirPrestacao ? "atrasado" : "atencao"} data-consumo-pendente-pill={semConsumo}>
              {semConsumo === 1 ? "1 consumo a informar" : `${semConsumo} consumos a informar`}{exigirPrestacao ? " · trava a conclusão" : ""}
            </StatusPill>
          )}
          {resumo.aDevolver > 0 && <StatusPill tom={cancelada ? "atrasado" : "atencao"} data-pendentes-devolucao={resumo.aDevolver}>{cancelada ? "OS cancelada · liberar reserva" : resumo.aDevolver === 1 ? "1 sobra a devolver" : `${resumo.aDevolver} sobras a devolver`}</StatusPill>}
          {resumo.prestado && (
            <span className="inline-flex items-center gap-1">
              <StatusPill tom="ok" data-prestado>Material prestado contas</StatusPill>
              <Dica rotulo="Material prestado contas" texto="Todo material separado teve o consumo informado e a sobra devolvida ao estoque: nada pendente para faturar." />
            </span>
          )}
          {resumo.prestacaoPendente && (
            <span className="inline-flex items-center gap-1">
              <StatusPill tom="acento" data-flag-prestacao>Prestação de contas pendente</StatusPill>
              <Dica rotulo="Prestação de contas pendente" texto={exigirPrestacao
                ? "Há material separado sem consumo informado, ou sobra sem devolução. Com “Exigir prestação de contas de material” ligada em Configurações, a OS não conclui sem o consumo e não fatura sem a devolução."
                : "Há material separado sem consumo informado, ou sobra sem devolução. Só avisa: para travar a conclusão e o faturamento, ligue “Exigir prestação de contas de material” em Configurações."} />
            </span>
          )}
          {podeSeparar && resumo.total > 0 && !informando && resumo.aDevolver > 0 && (
            <Link href={`/estoque/devolucao/${osId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline" data-acao="ir-devolver">
              <PackageMinus className="w-3.5 h-3.5" /> Devolver material
            </Link>
          )}
          {podeSeparar && resumo.total > 0 && !informando && !cancelada && (
            <Link href={`/estoque/separacao/${osId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline" data-acao="ir-separar">
              <PackageOpen className="w-3.5 h-3.5" /> {resumo.aSeparar > 0 ? "Separar material" : "Ver separação"}
            </Link>
          )}
          {mostrarInformar && !informando && (
            <Button size="sm" variant={semConsumo > 0 ? "primary" : "outline"} onClick={abrirConsumo} data-acao="informar-consumo"><Check className="w-4 h-4" /> Informar consumo</Button>
          )}
        </div>
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {erro}
        </div>
      )}

      {materiais.length === 0 ? (
        <p className="text-sm text-ink-muted" data-sem-materiais>Esta OS não tem material nos itens: nada a separar.</p>
      ) : (
        <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg overflow-hidden" data-lista-separacao>
          {materiais.map((m) => {
            const sit = situacaoDoMaterial(m);
            const sobra = aDevolverDe(m, cancelada);
            const editando = informando && aceitaConsumo(m);
            const q = editando ? paraNumero(agora[m.id] ?? "") : NaN;
            const aMais = editando && Number.isFinite(q) && q > m.quantidadeSeparada;
            return (
              <li key={m.id} data-material-estado={m.id} data-situacao-material={sit} data-pendente-devolucao={sobra > 0 ? sobra : undefined} className={cn("px-3 py-2 text-sm sm:flex sm:items-center sm:gap-3", aMais && "bg-atencao-claro/40")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink truncate">{m.descricao}</p>
                  <p className="text-xs text-ink-subtle truncate">{m.item}{m.kitNome ? ` · Kit ${m.kitNome}` : ""}</p>
                </div>
                <div className="mt-1 sm:mt-0 flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
                  <span className="tabular-nums text-ink-muted" data-separado-de>
                    <span className="text-[10px] uppercase text-ink-subtle mr-1">Separado</span>{" "}
                    {formatarQtd(m.quantidadeSeparada)} de {formatarQtd(m.quantidade)} {m.unidade}
                  </span>
                  {editando ? (
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-[10px] uppercase text-ink-subtle">Consumir</span>
                      <input type="text" inputMode="decimal" value={agora[m.id] ?? ""} onChange={(e) => setAgora((a) => ({ ...a, [m.id]: e.target.value }))}
                        className={cn("input-base w-20 py-1 text-right tabular-nums", aMais && "border-atencao text-atencao-texto")} aria-label={`Consumir: ${m.descricao}`} data-consumir />
                      <span className="text-xs text-ink-subtle">{m.unidade}</span>
                      {aMais && <span className="text-[11px] text-atencao-texto" data-baixa-a-mais>+{formatarQtd(arred(q - m.quantidadeSeparada))} a mais</span>}
                    </label>
                  ) : (
                    <>
                      {sit === "consumido" && (
                        <span className="tabular-nums text-ink" data-consumido>
                          <span className="text-[10px] uppercase text-ink-subtle mr-1">Consumido</span>{" "}
                          {formatarQtd(m.quantidadeConsumida ?? 0)} {m.unidade}
                        </span>
                      )}
                      {sit === "devolvido" && (
                        <span className="tabular-nums text-ink" data-devolvido>
                          <span className="text-[10px] uppercase text-ink-subtle mr-1">Devolvido</span>{" "}
                          {formatarQtd(m.quantidadeDevolvida ?? 0)} {m.unidade}
                        </span>
                      )}
                      {sobra > 0 && <StatusPill tom="atencao" tamanho="sm" data-sobra>{cancelada && sit !== "consumido" ? "Reservado · devolver" : "Pend. devolução"} {formatarQtd(sobra)} {m.unidade}</StatusPill>}
                      <StatusPill tom={TOM_SITUACAO_MATERIAL[sit]} tamanho="sm">{LABEL_SITUACAO_MATERIAL[sit]}</StatusPill>
                      {sit === "devolvido" && m.devolvidoPor && m.devolvidoEm
                        ? <span className="text-xs text-ink-subtle" data-devolvido-por>por {m.devolvidoPor} · {formatarDataHora(m.devolvidoEm)}</span>
                        : sit === "consumido" && m.consumidoPor && m.consumidoEm
                        ? <span className="text-xs text-ink-subtle" data-consumido-por>por {m.consumidoPor} · {formatarDataHora(m.consumidoEm)}</span>
                        : m.separadoPor && m.separadoEm && <span className="text-xs text-ink-subtle" data-separado-por>por {m.separadoPor} · {formatarDataHora(m.separadoEm)}</span>}
                      {sit === "consumido" && podeConsumir && !finalizada && (
                        <button type="button" onClick={() => desfazer(m)} disabled={salvando} className="inline-flex items-center gap-1 text-xs font-semibold text-atrasado hover:underline" data-acao="desfazer-consumo"><Undo2 className="w-3.5 h-3.5" /> Desfazer</button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {informando && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-barra-consumo>
          <p className="text-xs text-ink-muted">Padrão = o separado. Menos: a sobra fica reservada, pendente de devolução. Mais: a diferença sai do estoque agora.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setInformando(false); setErro(""); }} disabled={salvando} data-acao="cancelar-consumo"><X className="w-4 h-4" /> Cancelar</Button>
            <Button size="sm" onClick={confirmarConsumo} loading={salvando} data-acao="confirmar-consumo"><Check className="w-4 h-4" /> Confirmar consumo</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Resumo recalculado na tela (quando a lista muda localmente) */
export const resumoDaLista = (materiais: MaterialDaOs[], cancelada = false) => resumoSeparacao(materiais, cancelada);
