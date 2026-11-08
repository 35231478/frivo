"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, PackageOpen, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn, formatarData, formatarDataHora } from "@/lib/utils";
import { arred, formatarQtd } from "@/lib/estoque/regras";
import { avisoSaldoSeparacao, LABEL_SITUACAO_MATERIAL, LABEL_SITUACAO_SEPARACAO, type ResumoSeparacao } from "@/lib/estoque/separacao";
import type { MaterialSeparacaoTela, SeparacaoDaOs } from "@/lib/estoque/separacao-server";
import { TOM_SITUACAO_MATERIAL, TOM_SITUACAO_SEPARACAO } from "@/components/os/os-separacao";

/**
 * Estoque E4.1 — a tela de separação de UMA OS: os materiais (inclusos e peças: tudo que é físico), a quantidade
 * necessária, o saldo disponível do produto e o campo "separar agora" (padrão = o que falta; dá para separar menos
 * se faltou). Saldo que não cobre fica vermelho mas NÃO trava. Confirmar gera a RESERVA no razão (vinculada à OS);
 * "Desfazer" estorna. Funciona no celular (cartões) e no desktop (tabela).
 */

const paraNumero = (v: string) => { const t = v.trim().replace(/\./g, "").replace(",", "."); return t === "" ? NaN : Number(t); };
const texto = (n: number) => formatarQtd(n);

export function SeparacaoOs({ inicial }: { inicial: SeparacaoDaOs }) {
  const [dados, setDados] = useState<SeparacaoDaOs>(inicial);
  const { os, materiais, resumo } = dados;
  // O que separar agora, por material (texto do campo); padrão = o que falta
  const [agora, setAgora] = useState<Record<string, string>>(() => Object.fromEntries(materiais.filter((m) => m.falta > 0).map((m) => [m.id, texto(m.falta)])));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const pendentes = useMemo(() => materiais.filter((m) => m.falta > 0), [materiais]);

  function valorAgora(m: MaterialSeparacaoTela) {
    const n = paraNumero(agora[m.id] ?? "");
    return Number.isFinite(n) ? arred(n) : NaN;
  }

  async function enviar(alvos: { id: string; quantidade: number }[], rotulo: string) {
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/ordens/${os.id}/separacao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materiais: alvos }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível registrar a separação."); return false; }
      setDados(d.separacao);
      setAgora(Object.fromEntries((d.separacao.materiais as MaterialSeparacaoTela[]).filter((m) => m.falta > 0).map((m) => [m.id, texto(m.falta)])));
      if (d.avisos?.length) toast(`${rotulo}. ${d.avisos.join(" ")}`, "info");
      else toast(rotulo);
      return true;
    } catch { setErro("Erro de conexão."); return false; } finally { setSalvando(false); }
  }

  async function confirmarSeparacao() {
    const alvos: { id: string; quantidade: number }[] = [];
    for (const m of pendentes) {
      const q = valorAgora(m);
      if (!Number.isFinite(q) || q < 0) { setErro(`${m.descricao}: informe quanto foi separado (0 para pular).`); return; }
      if (q > m.falta) { setErro(`${m.descricao}: dá para separar no máximo o que falta (${texto(m.falta)} ${m.unidade}).`); return; }
      if (q > 0) alvos.push({ id: m.id, quantidade: arred(m.quantidadeSeparada + q) });
    }
    if (!alvos.length) { setErro("Informe a quantidade separada de ao menos um material."); return; }
    const semSaldo = pendentes.filter((m) => m.saldo != null && valorAgora(m) > 0 && m.saldo < valorAgora(m));
    if (semSaldo.length && !(await confirmar({ titulo: "Saldo não cobre", mensagem: `${semSaldo.length === 1 ? "1 material fica" : `${semSaldo.length} materiais ficam`} com saldo negativo no estoque (${semSaldo.map((m) => m.descricao).join(", ")}). Registrar a separação mesmo assim?`, confirmarTexto: "Separar mesmo assim" }))) return;
    await enviar(alvos, alvos.length === 1 ? "1 material separado" : `${alvos.length} materiais separados`);
  }

  async function desfazer(m: MaterialSeparacaoTela) {
    if (!(await confirmar({ titulo: "Desfazer separação", mensagem: `Devolver ao disponível ${texto(m.quantidadeSeparada)} ${m.unidade} de ${m.descricao}? A reserva é estornada.`, confirmarTexto: "Desfazer", perigo: true }))) return;
    await enviar([{ id: m.id, quantidade: 0 }], `Separação de ${m.descricao} desfeita`);
  }

  const linhaMaterial = (m: MaterialSeparacaoTela) => {
    const q = m.falta > 0 ? valorAgora(m) : 0;
    const aviso = m.saldo == null ? null : avisoSaldoSeparacao(m.saldo, Number.isFinite(q) ? q : 0, m.unidade);
    const saldoVermelho = m.saldo != null && m.falta > 0 && Number.isFinite(q) && q > 0 && m.saldo < q;
    return { q, aviso, saldoVermelho };
  };

  return (
    <div className="space-y-5" data-separacao-os data-situacao-separacao={resumo.situacao}>
      <Link href="/estoque/separacao" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> A separar</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-primary-50 rounded-lg"><PackageOpen className="w-5 h-5 text-primary-600" /></div>
          <div className="min-w-0">
            <h1 className="page-title flex flex-wrap items-center gap-2">
              Separar material · <Link href={`/ordens/${os.id}?aba=materiais`} className="text-primary-600 hover:underline" data-link-os>{os.chamadoNumero ?? os.numero}</Link>
            </h1>
            <p className="text-sm text-ink-muted truncate">{os.cliente}{os.unidade ? ` · ${os.unidade}` : ""} — {os.descricao}</p>
            {os.previsaoConclusao && <p className="text-xs text-ink-subtle">Previsão da OS: {formatarData(os.previsaoConclusao)}</p>}
          </div>
        </div>
        <StatusPill tom={TOM_SITUACAO_SEPARACAO[resumo.situacao]} data-resumo-separacao={resumo.situacao}>
          {LABEL_SITUACAO_SEPARACAO[resumo.situacao]}{resumo.total > 0 && resumo.situacao !== "completa" ? ` · ${resumo.aSeparar} de ${resumo.total} a separar` : ""}
        </StatusPill>
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {erro}
        </div>
      )}

      {materiais.length === 0 ? (
        <div className="card py-12 text-center" data-lista-vazia>
          <p className="text-sm font-medium text-ink">Esta OS não tem material nos itens</p>
          <p className="text-xs text-ink-muted">Nada a separar.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Celular: um cartão por material */}
          <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
            {materiais.map((m) => {
              const { aviso, saldoVermelho } = linhaMaterial(m);
              return (
                <li key={m.id} data-material-sep={m.id} data-situacao-material={m.situacao} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{m.descricao}</p>
                      <p className="text-xs text-ink-subtle truncate">{m.item}{m.kitNome ? ` · Kit ${m.kitNome}` : ""}</p>
                    </div>
                    <StatusPill tom={TOM_SITUACAO_MATERIAL[m.situacao]} tamanho="sm">{LABEL_SITUACAO_MATERIAL[m.situacao]}</StatusPill>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-ink-subtle uppercase text-[10px]">Necessário</p><p className="font-semibold tabular-nums" data-necessario>{texto(m.quantidade)} {m.unidade}</p></div>
                    <div><p className="text-ink-subtle uppercase text-[10px]">Separado</p><p className="font-semibold tabular-nums" data-separado>{texto(m.quantidadeSeparada)}</p></div>
                    <div><p className="text-ink-subtle uppercase text-[10px]">Disponível</p><p className={cn("font-semibold tabular-nums", saldoVermelho && "text-atrasado")} data-saldo>{m.saldo == null ? "—" : texto(m.saldo)}</p></div>
                  </div>
                  {m.falta > 0 && m.produtoId && (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-ink-muted shrink-0">Separar agora</span>
                      <input type="text" inputMode="decimal" value={agora[m.id] ?? ""} onChange={(e) => setAgora((a) => ({ ...a, [m.id]: e.target.value }))}
                        className={cn("input-base w-24 py-1 text-right tabular-nums", saldoVermelho && "border-atrasado text-atrasado")} aria-label={`Separar agora: ${m.descricao}`} data-alvo />
                      <span className="text-xs text-ink-subtle">{m.unidade}</span>
                    </label>
                  )}
                  {aviso && <p className="text-xs text-atrasado-texto flex items-center gap-1" data-falta-saldo><AlertTriangle className="w-3.5 h-3.5" /> {aviso}</p>}
                  {m.quantidadeSeparada > 0 && m.estadoSeparacao === "SEPARADO" && (
                    <div className="flex items-center justify-between gap-2 text-xs text-ink-subtle">
                      <span data-separado-por>por {m.separadoPor ?? "—"}{m.separadoEm ? ` · ${formatarDataHora(m.separadoEm)}` : ""}</span>
                      <button type="button" onClick={() => desfazer(m)} disabled={salvando} className="inline-flex items-center gap-1 font-semibold text-atrasado hover:underline" data-acao="desfazer-separacao"><Undo2 className="w-3.5 h-3.5" /> Desfazer</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Desktop: a planilha */}
          <table className="hidden md:table w-full text-sm" data-tabela-separacao>
            <thead className="bg-surface-page text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Necessário</th>
                <th className="text-right px-3 py-2">Separado</th>
                <th className="text-right px-3 py-2">
                  <span className="inline-flex items-center gap-1 justify-end">Disponível <Dica rotulo="Disponível" texto="Saldo atual do produto no estoque (já descontadas as reservas de outras OS). Se não cobrir, fica vermelho: a separação é registrada mesmo assim e o saldo fica negativo até a entrada." /></span>
                </th>
                <th className="text-right px-3 py-2">Separar agora</th>
                <th className="text-left px-3 py-2">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-linha">
              {materiais.map((m) => {
                const { aviso, saldoVermelho } = linhaMaterial(m);
                return (
                  <tr key={m.id} data-material-sep={m.id} data-situacao-material={m.situacao} className={cn(saldoVermelho && "bg-atrasado-claro/40")}>
                    <td className="px-3 py-2 min-w-0">
                      <p className="font-medium text-ink">{m.descricao}</p>
                      <p className="text-xs text-ink-subtle">{m.item}{m.kitNome ? ` · Kit ${m.kitNome}` : ""}</p>
                      {aviso && <p className="text-xs text-atrasado-texto flex items-center gap-1 mt-0.5" data-falta-saldo><AlertTriangle className="w-3.5 h-3.5" /> {aviso}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" data-necessario>{texto(m.quantidade)} <span className="text-xs text-ink-muted">{m.unidade}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted" data-separado>{texto(m.quantidadeSeparada)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", saldoVermelho ? "text-atrasado" : "text-ink")} data-saldo>{m.saldo == null ? "—" : texto(m.saldo)}</td>
                    <td className="px-3 py-2 text-right">
                      {m.falta > 0 && m.produtoId ? (
                        <input type="text" inputMode="decimal" value={agora[m.id] ?? ""} onChange={(e) => setAgora((a) => ({ ...a, [m.id]: e.target.value }))}
                          className={cn("input-base w-24 py-1 text-right tabular-nums", saldoVermelho && "border-atrasado text-atrasado")} aria-label={`Separar agora: ${m.descricao}`} data-alvo />
                      ) : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tom={TOM_SITUACAO_MATERIAL[m.situacao]} tamanho="sm">{LABEL_SITUACAO_MATERIAL[m.situacao]}</StatusPill>
                      {m.quantidadeSeparada > 0 && m.separadoPor && <p className="text-[11px] text-ink-subtle mt-0.5" data-separado-por>por {m.separadoPor}{m.separadoEm ? ` · ${formatarDataHora(m.separadoEm)}` : ""}</p>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.quantidadeSeparada > 0 && m.estadoSeparacao === "SEPARADO" && (
                        <button type="button" onClick={() => desfazer(m)} disabled={salvando} className="inline-flex items-center gap-1 text-xs font-semibold text-atrasado hover:underline" data-acao="desfazer-separacao"><Undo2 className="w-3.5 h-3.5" /> Desfazer</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-surface-border bg-surface-page">
            <p className="text-xs text-ink-muted">
              {pendentes.length === 0 ? "Tudo separado para esta OS." : `${pendentes.length} ${pendentes.length === 1 ? "material falta" : "materiais faltam"} separar. Confirmar reserva o material no estoque.`}
            </p>
            {pendentes.length > 0 && (
              <Button onClick={confirmarSeparacao} loading={salvando} data-acao="confirmar-separacao"><Check className="w-4 h-4" /> Confirmar separação</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
