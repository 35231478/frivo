"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Loader2, Lock, Pencil, Plus, Trash2, Tv, UserPlus } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  AJUDA_TIPO_PERFIL, MAX_FAIXAS, NOME_PERFIL_MAX, REGRA_SUGERIDA, RETORNO_DIAS_MAX, ROTULO_METRICA, ROTULO_TIPO_PERFIL, TIPOS_PERFIL, competenciaCurta,
  regraSchema, rotuloCompetencia, type Regra, type TipoPerfil,
} from "@/lib/desempenho/regras";
import type { RegraDoMes } from "@/lib/desempenho/painel";
import type { ConfiguracaoDoDesempenho, PerfilNaConfiguracao } from "@/lib/desempenho/servidor";
import { CabecalhoDesempenho, Erro, JSON_HEADERS, type PodeDesempenho } from "./comum";

type Cfg = ConfiguracaoDoDesempenho;

async function chamar(url: string, metodo: string, corpo?: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, { method: metodo, ...(corpo !== undefined && { headers: JSON_HEADERS, body: JSON.stringify(corpo) }) });
    if (r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return (d as { erro?: string }).erro ?? "Não foi possível salvar.";
  } catch { return "Erro de conexão."; }
}

/**
 * Configuração do Desempenho: perfis (com a regra de cada um e quem participa), ajustes gerais e o
 * link do modo TV. A regra é travada no mês: a primeira vale já; mudança depois vale no mês seguinte.
 */
export function ConfiguracaoDesempenho({ pode }: { pode: PodeDesempenho }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/desempenho/configuracao");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar a configuração."); return; }
      setCfg(d); setErro("");
    } catch { setErro("Erro de conexão."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="space-y-4" data-configuracao-desempenho>
      <CabecalhoDesempenho ativa="configuracao" pode={pode} />
      <Erro texto={erro} data-erro-configuracao="" />
      {!cfg ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>) : (
        <>
          <Perfis cfg={cfg} aoMudar={carregar} />
          <Ajustes cfg={cfg} aoMudar={carregar} />
          <ModoTv cfg={cfg} aoMudar={carregar} />
        </>
      )}
    </div>
  );
}

/* ───────── perfis, regras e participantes ───────── */

function Perfis({ cfg, aoMudar }: { cfg: Cfg; aoMudar: () => Promise<void> }) {
  const [editando, setEditando] = useState<PerfilNaConfiguracao | "novo" | null>(null);
  const [regraDe, setRegraDe] = useState<PerfilNaConfiguracao | null>(null);
  const [excluindo, setExcluindo] = useState<PerfilNaConfiguracao | null>(null);
  const fechar = () => { setEditando(null); setRegraDe(null); setExcluindo(null); };
  const aposSalvar = async () => { fechar(); await aoMudar(); };

  return (
    <section className="space-y-3" data-secao-perfis>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Perfis e regras</h2>
          <p className="text-sm text-ink-muted">Cada colaborador participa por um perfil. Quem não está em nenhum perfil fica fora do ranking.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditando("novo")} data-novo-perfil><Plus className="w-4 h-4" /> Novo perfil</Button>
      </div>
      {cfg.perfis.length === 0 && <p className="bg-white border border-surface-border rounded-xl px-4 py-8 text-sm text-ink-muted text-center" data-sem-perfis>Nenhum perfil cadastrado.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {cfg.perfis.map((p) => (
          <CartaoPerfil key={p.id} perfil={p} cfg={cfg} aoMudar={aoMudar} aoEditar={() => setEditando(p)} aoRegra={() => setRegraDe(p)} aoExcluir={() => setExcluindo(p)} />
        ))}
      </div>
      {editando && <FormularioPerfil key={editando === "novo" ? "novo" : editando.id} perfil={editando === "novo" ? null : editando} aoFechar={fechar} aoSalvar={aposSalvar} />}
      {regraDe && <FormularioRegra key={regraDe.id} perfil={regraDe} cfg={cfg} aoFechar={fechar} aoSalvar={aposSalvar} />}
      {excluindo && <ExcluirPerfil key={excluindo.id} perfil={excluindo} aoFechar={fechar} aoSalvar={aposSalvar} />}
    </section>
  );
}

function ResumoRegra({ regra, tipo }: { regra: RegraDoMes; tipo: TipoPerfil }) {
  const rotulos = ROTULO_METRICA[tipo];
  const linha = "flex flex-wrap gap-x-2";
  return (
    <dl className="text-sm text-ink space-y-1" data-resumo-regra>
      <div className={linha}><dt className="text-ink-muted">Pesos:</dt>
        <dd data-regra-pesos>{rotulos.prazo} {regra.pesoPrazo}% · {rotulos.relatorio} {regra.pesoRelatorio}% · {rotulos.avaliacao} {regra.pesoAvaliacao}%</dd>
      </div>
      <div className={linha}><dt className="text-ink-muted">Meta mínima:</dt><dd data-regra-meta>{regra.metaMinima}%</dd></div>
      <div className={linha}><dt className="text-ink-muted">Faixas:</dt>
        <dd data-regra-faixas>{regra.faixas.map((f) => `${f.nome} a partir de ${f.minimo}% (${formatarMoeda(f.valor)})`).join(" · ")}</dd>
      </div>
      <div className={linha}><dt className="text-ink-muted">Penalidades:</dt>
        <dd data-regra-penalidades>{regra.penalidadeRetorno} pontos por retorno · {regra.penalidadeReclamacao} por reclamação</dd>
      </div>
      <div className={linha}><dt className="text-ink-muted">Relatório completo:</dt>
        <dd>{regra.exigirFotoAntesDepois ? "checklist do app e foto antes e depois" : "checklist do app"}</dd>
      </div>
    </dl>
  );
}

function CartaoPerfil({ perfil, cfg, aoMudar, aoEditar, aoRegra, aoExcluir }: {
  perfil: PerfilNaConfiguracao; cfg: Cfg; aoMudar: () => Promise<void>; aoEditar: () => void; aoRegra: () => void; aoExcluir: () => void;
}) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const fazer = async (url: string, metodo: string, corpo?: unknown) => {
    setOcupado(true); setErro("");
    const falha = await chamar(url, metodo, corpo);
    if (falha) setErro(falha); else { setNovo(""); await aoMudar(); }
    setOcupado(false);
  };
  const botaoIcone = "p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt";

  return (
    <article className="bg-white border border-surface-border rounded-xl overflow-hidden flex flex-col" data-perfil={perfil.nome} data-perfil-tipo={perfil.tipo}>
      <div className="px-4 py-3 border-b border-surface-border flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink break-words">{perfil.nome}</h3>
          <p className="text-xs text-ink-muted">{ROTULO_TIPO_PERFIL[perfil.tipo]} · {AJUDA_TIPO_PERFIL[perfil.tipo]}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" className={botaoIcone} title="Editar perfil" aria-label={`Editar perfil ${perfil.nome}`} onClick={aoEditar} data-editar-perfil><Pencil className="w-4 h-4" /></button>
          <button type="button" className={cn(botaoIcone, "hover:text-atrasado hover:bg-atrasado-claro")} title="Excluir perfil" aria-label={`Excluir perfil ${perfil.nome}`} onClick={aoExcluir} data-excluir-perfil>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-surface-border space-y-2" data-regra-do-perfil>
        {perfil.vigente ? (
          <>
            <p className="text-xs font-medium text-ink-muted flex items-center gap-1.5" data-regra-vigente={perfil.vigente.vigenteDesde}>
              <Lock className="w-3.5 h-3.5" aria-hidden /> Regra em vigor desde {competenciaCurta(perfil.vigente.vigenteDesde)} (travada neste mês)
            </p>
            <ResumoRegra regra={perfil.vigente} tipo={perfil.tipo} />
          </>
        ) : <p className="text-sm text-atencao-texto" data-perfil-sem-regra>Sem regra: ninguém é medido por este perfil ainda.</p>}
        {perfil.agendada && (
          <div className="rounded-lg border border-atencao/30 bg-atencao-claro/50 px-3 py-2 space-y-1" data-regra-agendada={perfil.agendada.vigenteDesde}>
            <p className="text-xs font-medium text-atencao-texto flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" aria-hidden /> Mudança que vale a partir de {competenciaCurta(perfil.agendada.vigenteDesde)}</p>
            <ResumoRegra regra={perfil.agendada} tipo={perfil.tipo} />
            <button type="button" className="text-xs font-medium text-ink underline disabled:opacity-50" disabled={ocupado} data-descartar-agendada
              onClick={() => fazer(`/api/desempenho/perfis/${perfil.id}/regra`, "DELETE")}>Descartar esta mudança</button>
          </div>
        )}
        <Button type="button" size="sm" variant={perfil.vigente ? "secondary" : "primary"} onClick={aoRegra} data-definir-regra>{perfil.vigente ? "Alterar regra" : "Definir regra"}</Button>
      </div>

      <div className="px-4 py-3 space-y-2 flex-1" data-participantes>
        <p className="text-xs font-medium text-ink-muted">Colaboradores ({perfil.participantes.length})</p>
        {perfil.participantes.length === 0 && <p className="text-sm text-ink-muted" data-sem-participantes>Ninguém neste perfil.</p>}
        <ul className="space-y-1">
          {perfil.participantes.map((x) => (
            <li key={x.tecnicoId} className="flex items-center gap-2" data-participante={x.nome}>
              <span className="flex-1 min-w-0 text-sm text-ink truncate">{x.nome}</span>
              <Select aria-label={`Perfil de ${x.nome}`} value={perfil.id} disabled={ocupado} className="w-40 text-xs py-1.5" data-mudar-perfil
                onChange={(e) => fazer("/api/desempenho/participantes", "POST", { tecnicoId: x.tecnicoId, perfilId: e.target.value })}>
                {cfg.perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </Select>
              <button type="button" className={cn(botaoIcone, "hover:text-atrasado hover:bg-atrasado-claro")} disabled={ocupado} title="Tirar do Desempenho" aria-label={`Tirar ${x.nome} do Desempenho`}
                onClick={() => fazer(`/api/desempenho/participantes/${x.tecnicoId}`, "DELETE")} data-tirar-participante><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 pt-1">
          <Select aria-label={`Adicionar colaborador ao perfil ${perfil.nome}`} value={novo} onChange={(e) => setNovo(e.target.value)} className="flex-1 text-sm" disabled={ocupado} data-novo-participante>
            <option value="">{cfg.disponiveis.length ? "Adicionar colaborador…" : "Todos os colaboradores ativos já têm perfil"}</option>
            {cfg.disponiveis.map((t) => <option key={t.id} value={t.id}>{t.cargo ? `${t.nome} (${t.cargo})` : t.nome}</option>)}
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={!novo} loading={ocupado && !!novo} data-adicionar-participante
            onClick={() => fazer("/api/desempenho/participantes", "POST", { tecnicoId: novo, perfilId: perfil.id })}><UserPlus className="w-3.5 h-3.5" /> Adicionar</Button>
        </div>
        <Erro texto={erro} data-erro-perfil="" />
      </div>
    </article>
  );
}

interface PropsDialogo { aoFechar: () => void; aoSalvar: () => Promise<void> }

function FormularioPerfil({ perfil, aoFechar, aoSalvar }: PropsDialogo & { perfil: PerfilNaConfiguracao | null }) {
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [tipo, setTipo] = useState<TipoPerfil>(perfil?.tipo ?? "TECNICO");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const tipoTravado = !!perfil && (!!perfil.vigente || !!perfil.agendada);

  async function salvar() {
    if (nome.trim().length < 2) { setErro("Dê um nome ao perfil (mínimo 2 caracteres)."); return; }
    setSalvando(true);
    const falha = await chamar(perfil ? `/api/desempenho/perfis/${perfil.id}` : "/api/desempenho/perfis", perfil ? "PUT" : "POST", { nome, tipo });
    setSalvando(false);
    if (falha) setErro(falha); else await aoSalvar();
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={perfil ? "Editar perfil" : "Novo perfil"}>
      <div className="space-y-4" data-modal-perfil>
        <FormField label="Nome" required>
          <Input aria-label="Nome do perfil" value={nome} maxLength={NOME_PERFIL_MAX} onChange={(e) => { setNome(e.target.value); setErro(""); }} placeholder="Ex: Preventiva" data-campo-nome />
        </FormField>
        <FormField label="O que o perfil mede" hint={tipoTravado ? "O tipo não muda depois que o perfil tem regra." : undefined}>
          <div className="grid gap-2" role="radiogroup" aria-label="O que o perfil mede">
            {TIPOS_PERFIL.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} disabled={tipoTravado} onClick={() => setTipo(t)} data-tipo-opcao={t}
                className={cn("rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60",
                  tipo === t ? "border-acento bg-acento-claro" : "border-surface-border bg-white hover:bg-surface-alt")}>
                <span className={cn("block text-sm font-medium", tipo === t ? "text-acento" : "text-ink")}>{ROTULO_TIPO_PERFIL[t]}</span>
                <span className="block text-xs text-ink-muted">{AJUDA_TIPO_PERFIL[t]}</span>
              </button>
            ))}
          </div>
        </FormField>
        <Erro texto={erro} data-erro-modal-perfil="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-perfil>{perfil ? "Salvar" : "Criar perfil"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ExcluirPerfil({ perfil, aoFechar, aoSalvar }: PropsDialogo & { perfil: PerfilNaConfiguracao }) {
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function excluir() {
    setSalvando(true);
    const falha = await chamar(`/api/desempenho/perfis/${perfil.id}`, "DELETE");
    setSalvando(false);
    if (falha) setErro(falha); else await aoSalvar();
  }
  return (
    <Modal aberto onFechar={aoFechar} titulo="Excluir perfil" tamanho="sm">
      <div className="space-y-4" data-modal-excluir-perfil>
        <p className="text-sm text-ink">O perfil <span className="font-medium">{perfil.nome}</span> e as regras dele são excluídos. Só é possível excluir um perfil sem colaboradores.</p>
        <Erro texto={erro} data-erro-excluir-perfil="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="danger" loading={salvando} onClick={excluir} data-confirmar-exclusao>Excluir</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── a regra do perfil ───────── */

const numeroDe = (texto: string) => (texto.trim() === "" ? NaN : Number(texto.trim().replace(/\./g, "").replace(",", ".")));
const textoDe = (n: number) => String(n).replace(".", ",");

function FormularioRegra({ perfil, cfg, aoFechar, aoSalvar }: PropsDialogo & { perfil: PerfilNaConfiguracao; cfg: Cfg }) {
  // Parte da mudança já agendada, se houver; senão da regra em vigor; senão da sugestão (valores em branco)
  const base: Regra = perfil.agendada ?? perfil.vigente ?? REGRA_SUGERIDA;
  const [f, setF] = useState({
    pesoPrazo: String(base.pesoPrazo), pesoRelatorio: String(base.pesoRelatorio), pesoAvaliacao: String(base.pesoAvaliacao),
    penalidadeRetorno: String(base.penalidadeRetorno), penalidadeReclamacao: String(base.penalidadeReclamacao), metaMinima: String(base.metaMinima),
  });
  const [exigirFoto, setExigirFoto] = useState(base.exigirFotoAntesDepois);
  const [faixas, setFaixas] = useState(base.faixas.map((x) => ({ nome: x.nome, minimo: String(x.minimo), valor: textoDe(x.valor) })));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = (campo: keyof typeof f, valor: string) => { setF((x) => ({ ...x, [campo]: valor.replace(/\D/g, "").slice(0, 3) })); setErro(""); };
  const setFaixa = (i: number, campo: "nome" | "minimo" | "valor", valor: string) => { setFaixas((l) => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x))); setErro(""); };

  const soma = Number(f.pesoPrazo || 0) + Number(f.pesoRelatorio || 0) + Number(f.pesoAvaliacao || 0);
  const primeira = !perfil.vigente;
  const vale = primeira ? cfg.competencia : cfg.competenciaSeguinte;
  const rotulos = ROTULO_METRICA[perfil.tipo];

  async function salvar() {
    const parsed = regraSchema.safeParse({
      pesoPrazo: Number(f.pesoPrazo), pesoRelatorio: Number(f.pesoRelatorio), pesoAvaliacao: Number(f.pesoAvaliacao), exigirFotoAntesDepois: exigirFoto,
      penalidadeRetorno: Number(f.penalidadeRetorno), penalidadeReclamacao: Number(f.penalidadeReclamacao), metaMinima: Number(f.metaMinima),
      faixas: faixas.map((x) => ({ nome: x.nome, minimo: Number(x.minimo === "" ? NaN : x.minimo), valor: numeroDe(x.valor) })),
    });
    if (!parsed.success) { setErro(parsed.error.issues[0]?.message ?? "Confira os campos."); return; }
    setSalvando(true);
    const falha = await chamar(`/api/desempenho/perfis/${perfil.id}/regra`, "PUT", parsed.data);
    setSalvando(false);
    if (falha) setErro(falha); else await aoSalvar();
  }

  const campoNumero = (campo: keyof typeof f, rotulo: string, sufixo: string) => (
    <FormField label={rotulo}>
      <div className="relative">
        <Input aria-label={rotulo} inputMode="numeric" value={f[campo]} onChange={(e) => set(campo, e.target.value)} className="pr-14 tabular-nums" data-campo={campo} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted pointer-events-none">{sufixo}</span>
      </div>
    </FormField>
  );

  return (
    <Modal aberto onFechar={aoFechar} titulo={`Regra do perfil ${perfil.nome}`} tamanho="lg">
      <div className="space-y-5" data-modal-regra>
        <p className={cn("text-sm rounded-lg border px-3 py-2", primeira ? "border-surface-border bg-surface-alt text-ink" : "border-atencao/30 bg-atencao-claro text-atencao-texto")} data-vigencia-da-regra={vale}>
          {primeira
            ? <>Vale já em <strong>{rotuloCompetencia(vale)}</strong> e fica travada até o fim do mês. Mudança depois só vale no mês seguinte.</>
            : <>A regra em vigor não muda. Esta mudança vale a partir de <strong>{rotuloCompetencia(vale)}</strong>.</>}
        </p>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Pesos das métricas</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {campoNumero("pesoPrazo", rotulos.prazo, "%")}
            {campoNumero("pesoRelatorio", rotulos.relatorio, "%")}
            {campoNumero("pesoAvaliacao", rotulos.avaliacao, "%")}
          </div>
          <p className={cn("text-xs", soma === 100 ? "text-ink-muted" : "text-atrasado-texto")} data-soma-pesos={soma}>Soma dos pesos: {soma} de 100. Peso zero tira a métrica da conta.</p>
          <ToggleSwitch checked={exigirFoto} onChange={setExigirFoto} label="Relatório completo exige foto antes e depois"
            description="Além do checklist, das medições e das fotos que o app já pede em cada equipamento atendido." />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Meta mínima e penalidades</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {campoNumero("metaMinima", "Meta mínima", "%")}
            {campoNumero("penalidadeRetorno", "Desconto por retorno", "pontos")}
            {campoNumero("penalidadeReclamacao", "Desconto por reclamação", "pontos")}
          </div>
          <p className="text-xs text-ink-muted">Abaixo da meta mínima não há faixa nem bônus. O desconto só vale para o que a revisão marcou “Conta”.</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Faixas e valor do bônus</legend>
          <ul className="space-y-2" data-faixas>
            {faixas.map((x, i) => (
              <li key={i} className="grid grid-cols-[1fr_6rem_8rem_auto] gap-2 items-end" data-faixa-linha={i}>
                <FormField label={i === 0 ? "Faixa" : ""}><Input aria-label={`Nome da faixa ${i + 1}`} value={x.nome} maxLength={30} onChange={(e) => setFaixa(i, "nome", e.target.value)} data-faixa-nome /></FormField>
                <FormField label={i === 0 ? "A partir de" : ""}>
                  <Input aria-label={`Escore mínimo da faixa ${i + 1}`} inputMode="numeric" value={x.minimo} className="tabular-nums" data-faixa-minimo
                    onChange={(e) => setFaixa(i, "minimo", e.target.value.replace(/\D/g, "").slice(0, 3))} />
                </FormField>
                <FormField label={i === 0 ? "Bônus (R$)" : ""}>
                  <Input aria-label={`Valor do bônus da faixa ${i + 1}`} inputMode="decimal" value={x.valor} className="tabular-nums" data-faixa-valor
                    onChange={(e) => setFaixa(i, "valor", e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))} />
                </FormField>
                <button type="button" title="Excluir faixa" aria-label={`Excluir faixa ${i + 1}`} disabled={faixas.length <= 1} data-excluir-faixa
                  onClick={() => setFaixas((l) => l.filter((_, j) => j !== i))} className="p-2 mb-0.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          {faixas.length < MAX_FAIXAS && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFaixas((l) => [...l, { nome: "", minimo: "", valor: "0" }])} data-nova-faixa><Plus className="w-3.5 h-3.5" /> Nova faixa</Button>
          )}
          <p className="text-xs text-ink-muted">O valor é o bônus de quem fecha o mês na faixa. Só a gestão vê os valores.</p>
        </fieldset>

        <Erro texto={erro} data-erro-regra="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-regra>{primeira ? "Salvar regra" : "Agendar mudança"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── ajustes gerais ───────── */

function Ajustes({ cfg, aoMudar }: { cfg: Cfg; aoMudar: () => Promise<void> }) {
  const [dias, setDias] = useState(String(cfg.ajustes.retornoDias));
  const [nota, setNota] = useState(String(cfg.ajustes.notaBaixaAte));
  const [tipos, setTipos] = useState<string[]>(cfg.ajustes.tiposRetorno);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const mexeu = () => { setErro(""); setSalvo(false); };

  async function salvar() {
    const retornoDias = Number(dias);
    if (!Number.isInteger(retornoDias) || retornoDias < 1 || retornoDias > RETORNO_DIAS_MAX) { setErro(`Prazo do retorno: de 1 a ${RETORNO_DIAS_MAX} dias.`); return; }
    setSalvando(true);
    const falha = await chamar("/api/desempenho/configuracao", "PUT", { retornoDias, notaBaixaAte: Number(nota), tiposRetorno: tipos });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    setSalvo(true); await aoMudar();
  }

  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-secao-ajustes>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink">O que entra na lista “A revisar”</h2>
        <p className="text-sm text-ink-muted">Estes ajustes só dizem o que é levado à revisão. Nada pesa no escore sem alguém marcar “Conta”.</p>
      </div>
      <div className="px-4 py-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Prazo do retorno (dias)" hint="OS corretiva no mesmo equipamento dentro deste prazo, depois de um serviço do colaborador.">
            <Input aria-label="Prazo do retorno em dias" inputMode="numeric" value={dias} className="tabular-nums" data-campo-retorno-dias
              onChange={(e) => { setDias(e.target.value.replace(/\D/g, "").slice(0, 3)); mexeu(); }} />
          </FormField>
          <FormField label="Nota baixa do cliente" hint="Avaliações até esta nota vão para a revisão.">
            <Select aria-label="Nota baixa do cliente" value={nota} onChange={(e) => { setNota(e.target.value); mexeu(); }} data-campo-nota-baixa>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? "1 estrela" : `Até ${n} estrelas`}</option>)}
            </Select>
          </FormField>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Tipos de OS que contam como corretiva</legend>
          <p className="text-xs text-ink-muted mb-2">Sem nenhum tipo marcado, nenhum retorno é detectado.</p>
          {cfg.tiposOs.length === 0 ? <p className="text-sm text-ink-muted">Nenhum tipo de OS cadastrado.</p> : (
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3" data-tipos-corretiva>
              {cfg.tiposOs.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 text-sm text-ink py-1 cursor-pointer">
                    <input type="checkbox" className="rounded border-surface-border" checked={tipos.includes(t.id)} data-tipo-corretiva={t.nome}
                      onChange={(e) => { setTipos((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id))); mexeu(); }} />
                    {t.nome}{!t.ativo && <span className="text-xs text-ink-muted">(inativo)</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <Erro texto={erro} data-erro-ajustes="" />
        <div className="flex items-center justify-end gap-3">
          {salvo && <span className="text-sm text-ok-texto" role="status" data-ajustes-salvos>Ajustes salvos.</span>}
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-ajustes>Salvar ajustes</Button>
        </div>
      </div>
    </section>
  );
}

/* ───────── modo TV ───────── */

function ModoTv({ cfg, aoMudar }: { cfg: Cfg; aoMudar: () => Promise<void> }) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [origem, setOrigem] = useState("");
  useEffect(() => { setOrigem(window.location.origin); }, []);
  const link = cfg.tvToken ? `${origem}/relatorio/desempenho/${cfg.tvToken}` : "";

  const fazer = async (metodo: "POST" | "DELETE") => {
    setOcupado(true); setErro(""); setCopiado(false);
    const falha = await chamar("/api/desempenho/tv", metodo);
    if (falha) setErro(falha); else await aoMudar();
    setOcupado(false);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(link); setCopiado(true); } catch { setErro("Não foi possível copiar. Selecione o link e copie."); } };

  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-secao-tv data-tv={cfg.tvToken ? "ligado" : "desligado"}>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink flex items-center gap-2"><Tv className="w-4 h-4" aria-hidden /> Modo TV</h2>
        <p className="text-sm text-ink-muted">Ranking e prêmio em disputa numa tela da empresa, sem login e só para leitura. Nunca mostra valor em reais.</p>
      </div>
      <div className="px-4 py-4 space-y-3">
        {cfg.tvToken ? (
          <>
            <FormField label="Link da TV" hint="Quem tem este link vê o ranking. Trocar o link desliga o anterior.">
              <Input aria-label="Link da TV" readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-link-tv />
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copiar} data-copiar-link><Copy className="w-3.5 h-3.5" /> {copiado ? "Link copiado" : "Copiar link"}</Button>
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-acento px-3 py-1.5 rounded-lg border border-surface-border hover:bg-acento-claro" data-abrir-tv>
                <ExternalLink className="w-3.5 h-3.5" /> Abrir a tela
              </a>
              <Button type="button" size="sm" variant="secondary" loading={ocupado} onClick={() => fazer("POST")} data-trocar-link>Trocar link</Button>
              <Button type="button" size="sm" variant="ghost" disabled={ocupado} onClick={() => fazer("DELETE")} data-desligar-tv>Desligar</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" data-tv-desligado>O modo TV está desligado.</p>
            <Button type="button" size="sm" loading={ocupado} onClick={() => fazer("POST")} data-gerar-link>Gerar link da TV</Button>
          </div>
        )}
        <Erro texto={erro} data-erro-tv="" />
      </div>
    </section>
  );
}
