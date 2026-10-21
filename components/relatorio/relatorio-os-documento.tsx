import { CalendarClock, Camera, ClipboardCheck, Lock, MapPin, Mic, Sparkles, Truck, Users } from "lucide-react";
import { cn, formatarCpfCnpj, formatarData, formatarDataHora, formatarTelefone } from "@/lib/utils";
import { enderecoStr } from "@/components/relatorio/cabecalho-relatorio";
import { mostraSecao, type ConfigRelatorioOs, type SecaoRelatorioId, type VersaoRelatorio } from "@/lib/relatorio-os/config";
import type { AdicionalRelatorio, BlocoEquipamento, ChecklistTipoRelatorio, FotoRelatorio, GrupoChecklist, RelatorioOsDados } from "@/lib/relatorio-os/dados";
import { ROTULO_COBRANCA } from "@/lib/execucao/adicional";
import { ROTULO_STATUS, type StatusItem } from "@/lib/execucao/pendencias";

/**
 * Relatório da OS — layout por equipamento. Mesmo componente para as duas versões:
 *  - "cliente": só as seções ligadas e marcadas "cliente vê";
 *  - "interna": todas as seções ligadas (marca "Versão interna" no topo).
 * Seção sem dado na OS não aparece. O cabeçalho sai sempre.
 */
export function RelatorioOsDocumento({ dados: d, config, versao }: { dados: RelatorioOsDados; config: ConfigRelatorioOs; versao: VersaoRelatorio }) {
  const ve = (s: SecaoRelatorioId) => mostraSecao(config, s, versao);
  const mostraBlocos = (ve("equipamentos") || ve("fotos")) && d.equipamentos.length > 0;
  const geralChecklist = ve("checklistGeral") ? d.geral.checklist : [];
  const geralFotos = ve("checklistGeral") && ve("fotos") ? d.geral.fotos : [];

  return (
    <article className="bg-white text-ink text-sm" data-relatorio-os data-versao={versao}>
      {/* ── Cabeçalho (sempre) ── */}
      <header className="pb-4 border-b-2 border-primary-500" data-secao="cabecalho">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {d.empresa.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.empresa.logo} alt={d.empresa.nome} className="w-16 h-16 object-contain rounded-lg border border-surface-border shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
                {d.empresa.nome.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-base font-bold text-ink">{d.empresa.nomeFantasia ?? d.empresa.nome}</p>
              <p className="text-xs text-ink-muted">CNPJ {formatarCpfCnpj(d.empresa.cnpj)}</p>
              {enderecoStr(d.empresa) && <p className="text-xs text-ink-muted">{enderecoStr(d.empresa)}</p>}
              <p className="text-xs text-ink-muted">{[d.empresa.telefone && `Tel: ${formatarTelefone(d.empresa.telefone)}`, d.empresa.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="sm:text-right shrink-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">Ordem de serviço</p>
            <p className="font-mono text-xl font-bold text-primary-600" data-numero-os>{d.numeroOs}</p>
            {d.numeroRelatorio && <p className="text-xs text-ink-muted">Relatório {d.numeroRelatorio}</p>}
            {versao === "interna" && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-slate-800 text-white px-2 py-0.5 rounded" data-marca-interna>
                <Lock className="w-3 h-3" /> Versão interna
              </p>
            )}
          </div>
        </div>
        <h1 className="text-center text-base font-bold tracking-wide text-ink mt-4">RELATÓRIO DE ATENDIMENTO</h1>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
          <Dado rotulo="Tipo" valor={d.tipos.join(", ") || "—"} />
          <Dado rotulo="Situação" valor={d.situacao} destaque={d.status === "CONCLUIDA" ? "ok" : d.status === "CANCELADA" ? "erro" : undefined} />
          <Dado rotulo="Abertura" valor={formatarData(d.datas.abertura)} />
          <Dado rotulo="Início" valor={d.datas.inicio ? formatarData(d.datas.inicio) : "—"} />
          <Dado rotulo={d.datas.conclusao ? "Conclusão" : "Previsão"} valor={d.datas.conclusao ? formatarData(d.datas.conclusao) : d.datas.previsao ? formatarData(d.datas.previsao) : "—"} />
        </dl>
      </header>

      {/* ── Resultado (linha curta no topo) ── */}
      {ve("resultado") && d.resultado.texto && (
        <section className="mt-4 rounded-lg border-l-4 border-primary-500 bg-primary-50/60 px-4 py-3" data-secao="resultado">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-primary-700">Resultado</p>
          <p className="text-sm text-ink mt-0.5">{d.resultado.texto}</p>
          {d.solicitacao && <p className="text-xs text-ink-muted mt-1"><span className="font-semibold">Solicitação:</span> {d.solicitacao}</p>}
        </section>
      )}

      {/* ── Cliente e local ── */}
      {ve("clienteLocal") && (
        <section className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 py-3 border-y border-surface-border" data-secao="clienteLocal">
          <div>
            <Titulo>Cliente</Titulo>
            <p className="font-semibold text-ink">{d.cliente.nomeFantasia ?? d.cliente.nome}</p>
            {d.cliente.nomeFantasia && <p className="text-xs text-ink-muted">{d.cliente.nome}</p>}
            <p className="text-xs text-ink-muted">CPF/CNPJ {formatarCpfCnpj(d.cliente.cpfCnpj)}</p>
            {enderecoStr(d.cliente) && <p className="text-xs text-ink-muted">{enderecoStr(d.cliente)}</p>}
            {d.contrato && <p className="text-xs text-ink-muted mt-1">Contrato {d.contrato.numero}{d.contrato.artNumero ? ` · ART ${d.contrato.artNumero}` : ""}</p>}
          </div>
          <div>
            <Titulo>Local atendido</Titulo>
            {d.local ? (
              <>
                <p className="font-semibold text-ink flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-ink-muted" /> {d.local.nome}</p>
                {d.local.endereco && <p className="text-xs text-ink-muted">{d.local.endereco}</p>}
              </>
            ) : <p className="text-xs text-ink-muted">Endereço do cliente</p>}
          </div>
        </section>
      )}

      {/* ── Equipe / técnico / veículo ── */}
      {ve("equipe") && d.equipe.length > 0 && (
        <section className="mt-4" data-secao="equipe">
          <Titulo icone={<Users className="w-3.5 h-3.5" />}>Equipe</Titulo>
          <ul className="space-y-1">
            {d.equipe.map((e, i) => (
              <li key={i} className="flex flex-col sm:flex-row sm:items-center gap-x-3 text-sm">
                <span className="text-ink">{e.tecnicos ?? "—"}</span>
                {e.veiculo && <span className="text-xs text-ink-muted inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> {e.veiculo}</span>}
                {d.equipe.length > 1 && <span className="text-xs text-ink-subtle">({e.atividade})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Um bloco por equipamento ── */}
      {mostraBlocos && (
        <section className="mt-5" data-secao="equipamentos">
          <Titulo icone={<ClipboardCheck className="w-3.5 h-3.5" />}>Equipamentos atendidos ({d.equipamentos.length})</Titulo>
          <div className="space-y-3">
            {d.equipamentos.map((b) => (
              <BlocoEquip key={b.id} b={b} checklist={ve("equipamentos")} fotos={ve("fotos")} interna={versao === "interna"} />
            ))}
          </div>
        </section>
      )}

      {/* ── Serviços adicionais (pedidos na visita), destacados ── */}
      {ve("adicionais") && <SecaoAdicionais adicionais={d.adicionais} fotos={ve("fotos")} interna={versao === "interna"} />}

      {/* ── Formulário geral da atividade (respostas sem equipamento) ── */}
      {(geralChecklist.length > 0 || geralFotos.length > 0) && (
        <section className="mt-5" data-secao="checklistGeral">
          <Titulo>Formulário da atividade</Titulo>
          <Checklist grupos={geralChecklist} />
          <Fotos fotos={geralFotos} />
        </section>
      )}

      {/* ── Não atendidos ── */}
      {ve("naoAtendidos") && d.naoAtendidos.length > 0 && (
        <section className="mt-5" data-secao="naoAtendidos">
          <Titulo>Equipamentos não atendidos ({d.naoAtendidos.length})</Titulo>
          <ul className="text-sm list-disc pl-5 space-y-0.5">
            {d.naoAtendidos.map((e) => <li key={e.id}>{e.titulo}{e.local && <span className="text-ink-muted"> — {e.local}</span>}</li>)}
          </ul>
        </section>
      )}

      {/* ── Horários e duração ── */}
      {ve("tempos") && d.tempos.length > 0 && (
        <section className="mt-5" data-secao="tempos">
          <Titulo icone={<CalendarClock className="w-3.5 h-3.5" />}>Horários e duração</Titulo>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ink-muted border-b border-surface-border"><th className="py-1 pr-2 font-semibold">Atividade</th><th className="py-1 pr-2 font-semibold">Início</th><th className="py-1 font-semibold text-right">Duração</th></tr></thead>
            <tbody>
              {d.tempos.map((t, i) => (
                <tr key={i} className="border-b border-surface-border/60">
                  <td className="py-1 pr-2">{t.atividade}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{t.inicio ? formatarDataHora(t.inicio) : "—"}</td>
                  <td className="py-1 text-right whitespace-nowrap">{duracao(t.duracaoMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Observações ── */}
      {ve("observacoes") && d.observacoes.length > 0 && (
        <section className="mt-5" data-secao="observacoes">
          <Titulo>Observações</Titulo>
          {d.observacoes.map((o, i) => <p key={i} className="text-sm whitespace-pre-wrap">{o}</p>)}
        </section>
      )}

      {/* ── Assinaturas ── */}
      {ve("assinaturas") && (
        <section className="mt-8" style={{ breakInside: "avoid" }} data-secao="assinaturas">
          <Titulo>Assinaturas</Titulo>
          {d.assinaturas.coletadas.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {d.assinaturas.coletadas.map((a) => (
                <figure key={a.url} className="text-center" data-assinatura>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.rotulo} className="h-16 mx-auto object-contain" />
                  <figcaption className="border-t border-ink/40 pt-1 text-xs">
                    <span className="font-semibold">{a.nome ?? a.rotulo}</span>
                    {a.nome && <span className="block text-ink-muted">{a.rotulo}</span>}
                    {a.data && <span className="block text-ink-subtle">{formatarDataHora(a.data)}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 mt-10">
            <div className="border-t border-ink/40 pt-1 text-center text-xs">
              <p className="text-ink">{d.assinaturas.responsavel?.nome ?? "Responsável técnico"}</p>
              {d.assinaturas.responsavel?.crea && <p className="text-ink-subtle">CREA {d.assinaturas.responsavel.crea}</p>}
            </div>
            <div className="border-t border-ink/40 pt-1 text-center text-xs">
              <p className="text-ink">{d.assinaturas.clienteNome}</p>
              <p className="text-ink-subtle">Cliente</p>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t border-surface-border text-[11px] text-ink-subtle flex flex-wrap justify-between gap-2">
        <span>{d.empresa.nomeFantasia ?? d.empresa.nome} · OS {d.numeroOs}</span>
        <span>{versao === "interna" ? "Versão interna — não enviar ao cliente" : "Documento eletrônico"} · Frivo</span>
      </footer>
    </article>
  );
}

function Titulo({ children, icone }: { children: React.ReactNode; icone?: React.ReactNode }) {
  return <h2 className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted mb-1.5 flex items-center gap-1">{icone}{children}</h2>;
}

function Dado({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: "ok" | "erro" }) {
  return (
    <div className="rounded-md bg-surface-alt px-2.5 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-ink-muted">{rotulo}</dt>
      <dd className={cn("font-semibold", destaque === "ok" ? "text-success-700" : destaque === "erro" ? "text-red-600" : "text-ink")}>{valor}</dd>
    </div>
  );
}

/** Seção "Equipamentos atendidos" dos relatórios antigos (atividade e link do relatório): os mesmos blocos. */
export function BlocosEquipamentos({ blocos }: { blocos: BlocoEquipamento[] }) {
  if (!blocos.length) return null;
  return (
    <div className="py-4 border-b border-surface-border" data-equipamentos-relatorio>
      <p className="text-xs uppercase tracking-wider text-ink-muted mb-2">Equipamentos atendidos ({blocos.length})</p>
      <div className="space-y-3">
        {blocos.map((b) => <BlocoEquip key={b.id} b={b} checklist fotos />)}
      </div>
    </div>
  );
}

/**
 * "Serviços adicionais": o que o cliente pediu a mais na visita — mesma OS, mesmo relatório, em
 * destaque. Na versão interna, com a situação da cobrança (o escritório decide).
 */
export function SecaoAdicionais({ adicionais, fotos, interna }: { adicionais: AdicionalRelatorio[]; fotos: boolean; interna: boolean }) {
  if (!adicionais.length) return null;
  return (
    <section className="mt-5" data-secao="adicionais" style={{ breakInside: "avoid" }}>
      <Titulo icone={<Sparkles className="w-3.5 h-3.5" />}>Serviços adicionais ({adicionais.length})</Titulo>
      <div className="space-y-2">
        {adicionais.map((a) => (
          <div key={a.id} className="rounded-lg border-2 border-violet-300 bg-violet-50/60 px-3 py-2 space-y-1" data-adicional-relatorio>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-600 text-white px-1.5 py-0.5 rounded">Adicional</span>
              {interna && <span className="text-[11px] font-semibold border border-violet-300 bg-white text-violet-800 px-1.5 py-0.5 rounded" data-cobranca={a.statusCobranca}>Cobrança: {ROTULO_COBRANCA[a.statusCobranca]}</span>}
              <span className="text-[11px] text-ink-muted">{[a.atividade, a.equipamento].filter(Boolean).join(" · ")}</span>
            </div>
            <p className="text-sm text-ink whitespace-pre-wrap">{a.descricao}</p>
            {interna && a.criadoPor && <p className="text-[11px] text-ink-muted">Registrado por {a.criadoPor}</p>}
            {fotos && <Fotos fotos={a.fotos} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Um equipamento atendido: local, identificação, checklist do tipo, observação e as fotos DELE. */
export function BlocoEquip({ b, checklist, fotos, interna = false }: { b: BlocoEquipamento; checklist: boolean; fotos: boolean; interna?: boolean }) {
  const local = [b.local.principal, b.local.complemento].filter(Boolean).join(" · ");
  const r = b.resumoChecklist;
  const temChecklist = b.checklistTipo.length > 0 || b.checklist.length > 0;
  return (
    <div className="rounded-lg border border-surface-border overflow-hidden" style={{ breakInside: "avoid" }} data-equipamento={b.id}>
      <div className="px-3 py-2 bg-surface-alt/70 border-b border-surface-border">
        <p className="text-xs text-ink-muted flex items-center gap-1" data-local><MapPin className="w-3.5 h-3.5" /> {local || "Ambiente não informado"}{b.local.unidade && ` — ${b.local.unidade}`}</p>
        <p className="font-semibold text-ink flex flex-wrap items-center gap-2">
          {b.titulo}
          {b.tag && <span className="font-mono text-[11px] font-semibold bg-white border border-surface-border px-1.5 py-0.5 rounded" data-tag>TAG {b.tag}</span>}
        </p>
        <p className="text-xs text-ink-muted">{[b.titulo !== b.descricao ? b.descricao : null, b.fabricante, b.numeroSerie && `S/N ${b.numeroSerie}`].filter(Boolean).join(" · ")}</p>
        {checklist && r.ok + r.atencao + r.naoSeAplica + (r.medicoes ?? 0) > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]" data-resumo-checklist>
            <span className="px-1.5 py-0.5 rounded bg-success-50 text-success-700 font-semibold">{r.ok} OK</span>
            {r.atencao > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">{r.atencao} Atenção</span>}
            {r.naoSeAplica > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">{r.naoSeAplica} Não se aplica</span>}
            {(r.medicoes ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 font-semibold">{r.medicoes} {r.medicoes === 1 ? "medição" : "medições"}</span>}
          </p>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        {checklist && (temChecklist ? (
          <>
            <ChecklistTipo grupos={b.checklistTipo} interna={interna} />
            <Checklist grupos={b.checklist} />
          </>
        ) : <p className="text-xs text-ink-subtle">Sem checklist preenchido.</p>)}
        {checklist && b.observacoes.length > 0 && (
          <div data-observacao-equipamento>
            <p className="text-[11px] font-semibold text-ink-muted">Observação do técnico</p>
            {b.observacoes.map((o, i) => <p key={i} className="text-sm whitespace-pre-wrap">{o}</p>)}
          </div>
        )}
        {fotos && <Fotos fotos={b.fotos} />}
      </div>
    </div>
  );
}

const COR_STATUS_REL: Record<StatusItem, string> = {
  OK: "bg-success-50 text-success-700 border-success-200",
  ATENCAO: "bg-amber-50 text-amber-800 border-amber-200",
  NAO_SE_APLICA: "bg-slate-50 text-slate-600 border-slate-200",
};

/** Valor medido para leitura: "118,5 psi" (sem avaliação — o número como o técnico registrou). */
export const textoMedicao = (m: { valor: number; unidade: string | null }) =>
  `${m.valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}${m.unidade ? ` ${m.unidade}` : ""}`;

/**
 * Checklist do tipo de equipamento: item, situação (OK / Atenção / Não se aplica) ou o VALOR medido,
 * e a observação do item. Áudio: só a marca, e só na versão interna (ouve-se na OS).
 */
function ChecklistTipo({ grupos, interna }: { grupos: ChecklistTipoRelatorio[]; interna: boolean }) {
  if (!grupos.length) return null;
  return (
    <div className="space-y-2">
      {grupos.map((g, i) => (
        <div key={i} data-checklist-tipo>
          {grupos.length > 1 && <p className="text-[11px] font-semibold text-ink-muted">Checklist — {g.atividade}</p>}
          <ul className="divide-y divide-dashed divide-surface-border/80">
            {g.itens.map((it, j) => (
              <li key={j} className="py-1" data-item-relatorio data-status={it.status ?? ""}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-ink">{it.texto}</span>
                  {it.status
                    ? <span className={cn("shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded border", COR_STATUS_REL[it.status])}>{ROTULO_STATUS[it.status]}</span>
                    : it.medicao
                      ? <span className="shrink-0 text-xs font-bold text-ink tabular-nums" data-medicao-relatorio>{textoMedicao(it.medicao)}</span>
                      : <span className="shrink-0 text-[11px] text-ink-subtle">—</span>}
                </div>
                {it.observacao && <p className="text-xs text-ink-muted whitespace-pre-wrap mt-0.5">{it.observacao}</p>}
                {interna && it.audio && <p className="text-[11px] text-violet-700 mt-0.5 inline-flex items-center gap-1" data-audio-relatorio><Mic className="w-3 h-3" /> Observação em áudio (ouvir na OS)</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Checklist({ grupos }: { grupos: GrupoChecklist[] }) {
  if (!grupos.length) return null;
  return (
    <div className="space-y-2">
      {grupos.map((g, i) => (
        <div key={i} data-checklist>
          <p className="text-[11px] font-semibold text-ink-muted">{g.formulario}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {g.itens.map((it, j) => (
              <div key={j} className="flex justify-between gap-3 py-0.5 border-b border-dashed border-surface-border/80">
                <dt className="text-ink-muted">{it.label}</dt>
                <dd className={cn("font-medium text-right whitespace-pre-wrap", it.tipo === "SIM_NAO" && (it.valor === "Sim" ? "text-success-700" : "text-red-600"))}>{it.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Fotos({ fotos }: { fotos: FotoRelatorio[] }) {
  if (!fotos.length) return null;
  return (
    <div data-fotos>
      <p className="text-[11px] font-semibold text-ink-muted flex items-center gap-1 mb-1"><Camera className="w-3.5 h-3.5" /> Fotos</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {fotos.map((f, i) => (
          <figure key={i} className="border border-surface-border rounded overflow-hidden" style={{ breakInside: "avoid" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.legenda} className="w-full h-32 object-cover" />
            <figcaption className="text-[10px] text-ink-muted text-center py-0.5 px-1">{f.legenda}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function duracao(min: number | null) {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}
