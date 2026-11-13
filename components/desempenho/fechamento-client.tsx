"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, History, Loader2, Lock, LockOpen, Trophy } from "lucide-react";
import { cn, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_REABERTURA_MIN, MSG_MOTIVO_REABERTURA, TEXTO_CRITERIO, type Folha, type PremioFechado } from "@/lib/desempenho/fechamento";
import type { FechamentoResumo, FolhaDoFechamento, PreviaDoFechamento } from "@/lib/desempenho/fechamento-server";
import { competenciaCurta, formatarEscore, rotuloCompetencia } from "@/lib/desempenho/regras";
import { CabecalhoDesempenho, Erro, JSON_HEADERS, SeletorDeMes, posicaoTexto, type PodeDesempenho } from "./comum";

interface Dados { mes: PreviaDoFechamento; historico: FechamentoResumo[] }
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

          <TabelaDaFolha folha={previa.folha} definitiva={!!fechado} />
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

/** Célula da folha: mais estreita no celular. Perfil e posição só têm coluna própria em tela larga. */
const CEL = "px-3 sm:px-4 py-2";
const SO_TELA_LARGA = "hidden sm:table-cell";

function TabelaDaFolha({ folha, definitiva }: { folha: Folha; definitiva: boolean }) {
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-folha data-folha-definitiva={definitiva ? "sim" : "nao"}>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink">Folha de bônus</h2>
        <p className="text-xs text-ink-muted">Só o valor do bônus é registrado aqui. Pagamento, imposto e encargo são lançados no financeiro.</p>
      </div>
      {folha.linhas.length === 0 ? <p className="text-sm text-ink-muted px-4 py-6" data-folha-vazia>Nenhum colaborador nesta folha.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-surface-border">
                <th className={cn(CEL, "font-medium")}>Colaborador</th><th className={cn(CEL, SO_TELA_LARGA, "font-medium")}>Perfil</th>
                <th className={cn(CEL, SO_TELA_LARGA, "font-medium text-right")}>Posição</th><th className={cn(CEL, "font-medium text-right")}>Escore</th>
                <th className={cn(CEL, "font-medium")}>Faixa</th><th className={cn(CEL, "font-medium text-right")}>{definitiva ? "Bônus" : "Bônus projetado"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {folha.linhas.map((l, i) => (
                <tr key={`${l.tecnicoId ?? l.nome}-${i}`} data-linha-folha={l.nome}>
                  <td className={cn(CEL, "font-medium text-ink")}>
                    <span data-folha-nome>{l.nome}</span>
                    {/* No celular, perfil e posição descem para baixo do nome: o valor do bônus cabe sem rolar */}
                    <span className="block text-xs font-normal text-ink-muted sm:hidden" data-folha-resumo>{l.perfil} · {posicaoTexto(l.posicao)}</span>
                  </td>
                  <td className={cn(CEL, SO_TELA_LARGA, "text-ink-muted")} data-folha-perfil>{l.perfil}</td>
                  <td className={cn(CEL, SO_TELA_LARGA, "text-right tabular-nums")} data-folha-posicao>{posicaoTexto(l.posicao)}</td>
                  <td className={cn(CEL, "text-right tabular-nums")} data-folha-escore>{formatarEscore(l.escore)}</td>
                  <td className={CEL} data-folha-faixa>{l.faixa ?? "—"}</td>
                  <td className={cn(CEL, "text-right tabular-nums font-medium whitespace-nowrap")} data-folha-valor>{formatarMoeda(l.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-surface-border">
              <tr className="font-semibold text-ink">
                <td className={CEL}>Total do mês</td><td className={cn(CEL, SO_TELA_LARGA)} colSpan={2} /><td className={CEL} colSpan={2} />
                <td className={cn(CEL, "text-right tabular-nums whitespace-nowrap")} data-folha-total>{formatarMoeda(folha.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
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
        <h2 className="font-semibold text-ink flex items-center gap-2"><Trophy className="w-4 h-4" aria-hidden /> Premiação do mês</h2>
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
        <h2 className="font-semibold text-ink flex items-center gap-2"><History className="w-4 h-4" aria-hidden /> Histórico de fechamentos</h2>
        <p className="text-xs text-ink-muted">Só leitura. Um mês reaberto continua aqui, com quem reabriu e o motivo.</p>
      </div>
      {historico.length === 0 ? <p className="text-sm text-ink-muted px-4 py-6" data-historico-vazio>Nenhum mês foi fechado ainda.</p> : (
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
        </dl>
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
            <TabelaDaFolha folha={folha.folha} definitiva />
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
