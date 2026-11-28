"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, History, Loader2, Lock, LockOpen, Trophy } from "lucide-react";
import { cn, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_REABERTURA_MIN, MSG_MOTIVO_REABERTURA, TEXTO_CRITERIO, type Folha, type PremioFechado } from "@/lib/desempenho/fechamento";
import type { FechamentoResumo, FolhaDoFechamento, PreviaDoFechamento } from "@/lib/desempenho/fechamento-server";
import { competenciaCurta, formatarEscore, rotuloCompetencia } from "@/lib/desempenho/regras";
import { CabecalhoDesempenho, Erro, JSON_HEADERS, SeletorDeMes, posicaoTexto, type PodeDesempenho } from "./comum";

interface Dados { mes: PreviaDoFechamento; historico: FechamentoResumo[] }
const AJUDA_FOLHA = "Só o valor do bônus é registrado aqui: pagamento, imposto e encargo são lançados no financeiro. Enquanto o mês está aberto, o valor é projeção e muda com atividade, avaliação e revisão novas.";
const AJUDA_FOLHA_COMISSAO = "Bônus do Desempenho e comissões liberadas até o fim do mês. Fechar gera uma conta a pagar por pessoa com o total "
  + "e marca as comissões como pagas. Reabrir cancela essas contas (se nenhuma tiver pagamento) e as comissões voltam a liberadas.";
const AJUDA_PREMIACAO = "O prêmio do mês vai para quem tem o maior escore na disputa. Empate divide o prêmio; ninguém acima da meta mínima deixa o prêmio sem ganhador.";
const AJUDA_HISTORICO = "Cada fechamento do mês fica guardado, inclusive os reabertos: a folha daquele momento, quem fechou, quem reabriu e o motivo.";

const urlDoCsv = (id: string) => `/api/desempenho/fechamentos/${id}/exportar`;

/**
 * Fechamento do mês e folha de bônus. Mês aberto = projeção; fechar congela escore, faixa e valor de
 * cada colaborador. Reabrir pede motivo e fica registrado. Aqui só se registra o valor do bônus:
 * pagamento, imposto e encargo são do financeiro.
 */
export function FechamentoDesempenho({ mesInicial, mesAtual, pode }: { mesInicial: string; mesAtual: string; pode: PodeDesempenho }) {
  const [mes, setMes] = useState(mesInicial);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [fechando, setFechando] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);
  const [vendo, setVendo] = useState<FechamentoResumo | null>(null);

  const carregar = useCallback(async (competencia: string) => {
    setErro("");
    try {
      const r = await fetch(`/api/desempenho/fechamentos?mes=${competencia}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar o fechamento."); return; }
      setDados(d);
    } catch { setErro("Erro de conexão."); }
  }, []);
  useEffect(() => { setDados(null); void carregar(mes); }, [carregar, mes]);
  const aposMudar = () => { setFechando(false); setReabrindo(false); void carregar(mes); };

  const previa = dados?.mes;
  const fechado = previa?.situacao === "FECHADO" ? previa.fechamento : null;
  return (
    <div className="space-y-4" data-fechamento-desempenho data-mes={mes} data-situacao={previa?.situacao ?? ""}>
      <CabecalhoDesempenho ativa="fechamento" pode={pode} acoes={<SeletorDeMes mes={mes} aoMudar={setMes} max={mesAtual} />} />
      <Erro texto={erro} data-erro-fechamento="" />
      {!dados || !previa ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>) : (
        <>
          <section className="bg-white border border-surface-border rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-situacao-do-mes>
            {fechado ? (
              <>
                <div className="min-w-0">
                  <p className="font-semibold text-ink flex items-center gap-2"><Lock className="w-4 h-4" aria-hidden /> <span className="first-letter:uppercase">{rotuloCompetencia(mes)}</span> fechado</p>
                  <p className="text-sm text-ink-muted" data-fechado-por>
                    Fechado em {formatarDataHora(fechado.fechadoEm)} por {fechado.fechadoPor}{fechado.versao > 1 ? ` · ${fechado.versao}º fechamento do mês` : ""}. Os valores são definitivos.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={urlDoCsv(fechado.id)} download data-exportar
                    className="inline-flex items-center gap-2 rounded-lg bg-acento text-white text-sm font-medium px-4 py-2.5 hover:bg-acento-hover"><Download className="w-4 h-4" /> Exportar planilha</a>
                  <Button type="button" variant="secondary" onClick={() => setReabrindo(true)} data-reabrir><LockOpen className="w-4 h-4" /> Reabrir mês</Button>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="font-semibold text-ink flex items-center gap-2"><LockOpen className="w-4 h-4" aria-hidden /> <span className="first-letter:uppercase">{rotuloCompetencia(mes)}</span> aberto</p>
                  <p className="text-sm text-ink-muted" data-mes-aberto>
                    {previa.bloqueio ?? "Os valores abaixo são projeção: mudam com atividade, avaliação e revisão novas até o mês ser fechado."}
                  </p>
                </div>
                <Button type="button" disabled={!!previa.bloqueio} onClick={() => setFechando(true)} data-fechar><Lock className="w-4 h-4" /> Fechar mês</Button>
              </>
            )}
          </section>

          <TabelaDaFolha folha={previa.folha} definitiva={!!fechado} comissoes={previa.comissoes} />
          <Premiados premios={previa.premios} definitivo={!!fechado} />
          <Historico historico={dados.historico} aoVer={setVendo} />
        </>
      )}

      {fechando && previa && <Fechar key={mes} previa={previa} aoFechar={() => setFechando(false)} aoSalvar={aposMudar} />}
      {reabrindo && fechado && <Reabrir key={fechado.id} fechamento={fechado} aoFechar={() => setReabrindo(false)} aoSalvar={aposMudar} />}
      {vendo && <FolhaAntiga key={vendo.id} resumo={vendo} aoFechar={() => setVendo(null)} />}
    </div>
  );
}

function TabelaDaFolha({ folha, definitiva, comissoes = false }: { folha: Folha; definitiva: boolean; comissoes?: boolean }) {
  const rotuloValor = definitiva ? "Bônus" : "Bônus projetado";
  // COM-1: com comissão na empresa, a folha mostra Comissão e Total (bônus + comissão = a conta a pagar da pessoa)
  const totalComissao = folha.totalComissao ?? 0;
  const totalGeral = Math.round((folha.total + totalComissao) * 100) / 100;
  const totalDa = (l: Folha["linhas"][number]) => Math.round((l.valor + (l.comissao ?? 0)) * 100) / 100;
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-folha data-folha-definitiva={definitiva ? "sim" : "nao"}>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink flex items-center gap-1.5">
          {comissoes ? "Folha de bônus e comissões" : "Folha de bônus"} <Dica texto={comissoes ? AJUDA_FOLHA_COMISSAO : AJUDA_FOLHA} rotulo="Folha do mês" />
        </h2>
      </div>
      {folha.linhas.length === 0 ? <ListaVazia mensagem="Nenhum colaborador nesta folha." /> : (
        <TabelaPro
          tela="desempenho-folha"
          atributos={{ "data-tabela-folha": true }}
          barra={
            <p data-folha-resumo-barra>
              {folha.linhas.length === 1 ? "1 colaborador" : `${folha.linhas.length} colaboradores`}
              {" · "}Total do mês <strong className="text-ink" data-folha-total>{formatarMoeda(comissoes ? totalGeral : folha.total)}</strong>
              {comissoes && <span data-folha-total-comissao>{" · "}Comissões {formatarMoeda(totalComissao)}</span>}
            </p>
          }
          cartoes={
            <ul className="divide-y divide-surface-border" data-folha-cartoes>
              {folha.linhas.map((l, i) => (
                <li key={`${l.tecnicoId ?? l.nome}-${i}`} className="px-4 py-3 flex items-start justify-between gap-3" data-linha-folha={l.nome}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink break-words" data-folha-nome>{l.nome}</p>
                    <p className="text-xs text-ink-muted" data-folha-resumo>{l.perfil} · {posicaoTexto(l.posicao)} · {formatarEscore(l.escore)}{l.faixa ? ` · ${l.faixa}` : ""}</p>
                  </div>
                  {comissoes ? (
                    <span className="text-right shrink-0">
                      <span className={cn(PLANILHA.numero, "block text-sm font-semibold text-ink")} data-folha-total-linha>{formatarMoeda(totalDa(l))}</span>
                      <span className="block text-xs text-ink-muted tabular-nums">Bônus {formatarMoeda(l.valor)} · Comissão {formatarMoeda(l.comissao ?? 0)}</span>
                    </span>
                  ) : (
                    <span className={cn(PLANILHA.numero, "text-sm font-semibold text-ink")} data-folha-valor>{formatarMoeda(l.valor)}</span>
                  )}
                </li>
              ))}
              <li className="px-4 py-3 flex items-center justify-between gap-3 bg-surface-alt/60">
                <span className="text-sm font-semibold text-ink">Total do mês</span>
                <span className={cn(PLANILHA.numero, "text-sm font-semibold text-ink")}>{formatarMoeda(comissoes ? totalGeral : folha.total)}</span>
              </li>
            </ul>
          }
          colunas={[
            { id: "nome", titulo: "Colaborador", minimo: 180, obrigatoria: true, classe: "break-words" },
            { id: "perfil", titulo: "Perfil", largura: 150 },
            { id: "posicao", titulo: "Posição", alinhar: "direita", largura: 90 },
            { id: "escore", titulo: "Escore", alinhar: "direita", largura: 90 },
            { id: "faixa", titulo: "Faixa", largura: 120 },
            { id: "valor", titulo: rotuloValor, alinhar: "direita", largura: 130, obrigatoria: true },
            ...(comissoes ? [
              { id: "comissao", titulo: "Comissão", alinhar: "direita" as const, largura: 130, obrigatoria: true },
              { id: "total", titulo: "Total", alinhar: "direita" as const, largura: 130, obrigatoria: true },
            ] : []),
          ]}
          linhas={folha.linhas.map((l, i) => ({
            id: `${l.tecnicoId ?? l.nome}-${i}`,
            atributos: { "data-linha-folha": l.nome },
            titulos: { nome: l.nome },
            celulas: {
              nome: <span className="font-medium text-ink" data-folha-nome>{l.nome}</span>,
              perfil: <span className={PLANILHA.apagado} data-folha-perfil>{l.perfil}</span>,
              posicao: <span className={PLANILHA.numero} data-folha-posicao>{posicaoTexto(l.posicao)}</span>,
              escore: <span className={PLANILHA.numero} data-folha-escore>{formatarEscore(l.escore)}</span>,
              faixa: <span data-folha-faixa>{l.faixa ?? "—"}</span>,
              valor: <span className={cn(PLANILHA.numero, "font-medium")} data-folha-valor>{formatarMoeda(l.valor)}</span>,
              comissao: <span className={cn(PLANILHA.numero, "font-medium")} data-folha-comissao>{formatarMoeda(l.comissao ?? 0)}</span>,
              total: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-folha-total-linha>{formatarMoeda(totalDa(l))}</span>,
            },
          }))}
        />
      )}
    </section>
  );
}

const nomes = (p: PremioFechado) => p.ganhadores.map((g) => g.nome).join(" e ");

function Premiados({ premios, definitivo }: { premios: PremioFechado[]; definitivo: boolean }) {
  if (!premios.length) return null;
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-premiados>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink flex items-center gap-2">
          <Trophy className="w-4 h-4" aria-hidden /> Premiação do mês <Dica texto={AJUDA_PREMIACAO} rotulo="Premiação do mês" />
        </h2>
        <p className="text-xs text-ink-muted">{definitivo ? "Quem ganhou cada prêmio." : "Quem ganharia cada prêmio se o mês fechasse agora."}</p>
      </div>
      <ul className="divide-y divide-surface-border">
        {premios.map((p) => (
          <li key={p.premiacaoId} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1" data-premiado={p.titulo} data-criterio={p.criterio ?? ""}>
            <span className="flex-1 min-w-[12rem]">
              <span className="font-medium text-ink">{p.titulo}</span>
              <span className="block text-xs text-ink-muted">{p.perfil ? `Disputa do perfil ${p.perfil}` : "Disputa de todos os perfis"}</span>
            </span>
            <span className="flex-1 min-w-[12rem] text-sm">
              {p.ganhadores.length === 0 ? <span className="text-ink-muted" data-sem-ganhador>Ninguém acima da meta mínima: sem ganhador.</span> : (
                <>
                  <span className="font-semibold text-ink" data-ganhadores>{nomes(p)}</span> <span className="text-ink-muted tabular-nums">· {formatarEscore(p.ganhadores[0].escore)}</span>
                  {p.criterio === "DIVIDIDO" && <StatusPill tom="atencao" tamanho="sm" className="ml-2 align-middle" data-premio-dividido="">Prêmio dividido</StatusPill>}
                  {p.criterio && <span className="block text-xs text-ink-muted" data-texto-criterio>{TEXTO_CRITERIO[p.criterio]}.</span>}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Historico({ historico, aoVer }: { historico: FechamentoResumo[]; aoVer: (f: FechamentoResumo) => void }) {
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-historico>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink flex items-center gap-2">
          <History className="w-4 h-4" aria-hidden /> Histórico de fechamentos <Dica texto={AJUDA_HISTORICO} rotulo="Histórico de fechamentos" />
        </h2>
      </div>
      {historico.length === 0 ? <ListaVazia mensagem="Nenhum mês foi fechado ainda." /> : (
        <ul className="divide-y divide-surface-border">
          {historico.map((f) => (
            <li key={f.id} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1" data-fechamento={f.competencia} data-versao={f.versao} data-situacao-fechamento={f.situacao}>
              <span className="w-24 shrink-0">
                <span className="font-semibold text-ink tabular-nums">{competenciaCurta(f.competencia)}</span>
                {f.versao > 1 && <span className="block text-xs text-ink-muted">{f.versao}º fechamento</span>}
              </span>
              <span className="flex-1 min-w-[14rem] text-sm">
                <span className="text-ink">Fechado em {formatarData(f.fechadoEm)} por {f.fechadoPor}</span>
                {f.premios.some((p) => p.ganhadores.length > 0) && (
                  <span className="block text-xs text-ink-muted" data-historico-premiados>
                    Premiação: {f.premios.filter((p) => p.ganhadores.length > 0).map((p) => `${p.titulo} — ${nomes(p)}`).join("; ")}
                  </span>
                )}
                {f.situacao === "REABERTO" && (
                  <span className="block text-xs text-atencao-texto break-words" data-reabertura>
                    Reaberto em {f.reabertoEm ? formatarData(f.reabertoEm) : "—"} por {f.reabertoPor ?? "—"}: {f.reaberturaMotivo}
                  </span>
                )}
              </span>
              <StatusPill tom={f.situacao === "FECHADO" ? "ok" : "previsto"} tamanho="sm">{f.situacao === "FECHADO" ? "Fechado" : "Reaberto"}</StatusPill>
              <span className="w-28 text-right text-sm font-semibold text-ink tabular-nums" data-historico-total>{formatarMoeda(f.total)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => aoVer(f)} data-ver-folha>Ver folha</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface PropsDialogo { aoFechar: () => void; aoSalvar: () => void }

function Fechar({ previa, aoFechar, aoSalvar }: PropsDialogo & { previa: PreviaDoFechamento }) {
  const [ciente, setCiente] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const precisaConfirmar = previa.avisos.length > 0;

  async function fechar() {
    if (precisaConfirmar && !ciente) { setErro("Confirme os avisos para fechar o mês."); return; }
    setErro(""); setSalvando(true);
    try {
      const r = await fetch("/api/desempenho/fechamentos", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ competencia: previa.competencia, ...(precisaConfirmar && { ciente: true }) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível fechar o mês."); return; }
      // Sucesso é toast (padrão da casa); o erro fica no diálogo
      const total = formatarMoeda(d?.folha?.total ?? previa.folha.total);
      const comissao = d?.folha?.totalComissao ?? previa.folha.totalComissao ?? 0;
      toast(`${rotuloCompetencia(previa.competencia)} fechado. Bônus: ${total}.${previa.comissoes ? ` Comissões: ${formatarMoeda(comissao)}.` : ""}`);
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={`Fechar ${rotuloCompetencia(previa.competencia)}`}>
      <div className="space-y-4" data-modal-fechar>
        <p className="text-sm text-ink">
          O escore, a faixa e o bônus de cada colaborador ficam definitivos. Dado novo não muda mais este mês.
        </p>
        <dl className="text-sm grid grid-cols-2 gap-2 rounded-lg bg-surface-alt px-3 py-2">
          <dt className="text-ink-muted">Colaboradores na folha</dt><dd className="text-right font-medium text-ink tabular-nums" data-fechar-colaboradores>{previa.folha.linhas.length}</dd>
          <dt className="text-ink-muted">Total de bônus</dt><dd className="text-right font-semibold text-ink tabular-nums" data-fechar-total>{formatarMoeda(previa.folha.total)}</dd>
          {previa.comissoes && (<>
            <dt className="text-ink-muted">Total de comissões</dt>
            <dd className="text-right font-semibold text-ink tabular-nums" data-fechar-total-comissao>{formatarMoeda(previa.folha.totalComissao ?? 0)}</dd>
          </>)}
        </dl>
        {previa.comissoes && <p className="text-sm text-ink-muted" data-fechar-contas>Cada pessoa vira uma conta a pagar com o bônus e a comissão.</p>}
        {precisaConfirmar && (
          <div className="rounded-lg border border-atencao/30 bg-atencao-claro px-3 py-2 space-y-2" data-avisos-fechar>
            <ul className="text-sm text-atencao-texto list-disc pl-4 space-y-1">{previa.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" className="mt-0.5 rounded border-surface-border" checked={ciente} onChange={(e) => { setCiente(e.target.checked); setErro(""); }} data-ciente />
              Li os avisos e quero fechar o mês assim.
            </label>
          </div>
        )}
        <Erro texto={erro} data-erro-fechar="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={fechar} data-confirmar-fechar>Fechar mês</Button>
        </div>
      </div>
    </Modal>
  );
}

function Reabrir({ fechamento, aoFechar, aoSalvar }: PropsDialogo & { fechamento: FechamentoResumo }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function reabrir() {
    if (motivo.trim().length < MOTIVO_REABERTURA_MIN) { setErro(MSG_MOTIVO_REABERTURA); return; }
    setErro(""); setSalvando(true);
    try {
      const r = await fetch(`/api/desempenho/fechamentos/${fechamento.id}/reabrir`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ motivo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível reabrir o mês."); return; }
      toast(`${rotuloCompetencia(fechamento.competencia)} reaberto: os valores voltam a ser projeção.`);
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={`Reabrir ${rotuloCompetencia(fechamento.competencia)}`}>
      <div className="space-y-4" data-modal-reabrir>
        <p className="text-sm text-ink">
          Os valores deixam de ser definitivos e o mês volta a ser calculado. O fechamento atual continua no histórico.
        </p>
        <FormField label="Motivo da reabertura" required hint="Fica gravado com o nome de quem reabriu e a data.">
          <Textarea aria-label="Motivo da reabertura" rows={3} maxLength={500} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(""); }}
            placeholder="Ex: avaliação de cliente lançada na OS errada" data-campo-motivo-reabertura />
        </FormField>
        <Erro texto={erro} data-erro-reabrir="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="danger" loading={salvando} onClick={reabrir} data-confirmar-reabrir>Reabrir mês</Button>
        </div>
      </div>
    </Modal>
  );
}

/** A folha de um fechamento do histórico (só leitura), com a exportação daquele fechamento */
function FolhaAntiga({ resumo, aoFechar }: { resumo: FechamentoResumo; aoFechar: () => void }) {
  const [folha, setFolha] = useState<FolhaDoFechamento | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    fetch(`/api/desempenho/fechamentos/${resumo.id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar a folha."); return; }
      setFolha(d);
    }).catch(() => { if (vivo) setErro("Erro de conexão."); });
    return () => { vivo = false; };
  }, [resumo.id]);

  return (
    <Modal aberto onFechar={aoFechar} titulo={`Folha de ${rotuloCompetencia(resumo.competencia)}`} tamanho="lg">
      <div className="space-y-3" data-modal-folha-antiga>
        <p className="text-sm text-ink-muted">
          Fechado em {formatarData(resumo.fechadoEm)} por {resumo.fechadoPor}{resumo.situacao === "REABERTO" ? ". Este fechamento foi reaberto e não vale mais." : "."}
        </p>
        <Erro texto={erro} />
        {!folha ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>) : (
          <>
            <TabelaDaFolha folha={folha.folha} definitiva comissoes={(folha.folha.totalComissao ?? 0) !== 0} />
            <Premiados premios={folha.premios} definitivo />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <a href={urlDoCsv(resumo.id)} download data-exportar-antiga
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-white text-sm font-medium text-acento px-4 py-2.5 hover:bg-acento-claro"><Download className="w-4 h-4" /> Exportar planilha</a>
          <Button type="button" variant="secondary" onClick={aoFechar}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
