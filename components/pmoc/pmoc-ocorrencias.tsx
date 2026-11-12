"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, CheckCircle2, FileText, Loader2, Paperclip, Pencil, Plus, RotateCcw, Search, Trash2, Undo2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { reduzirImagem } from "@/lib/imagem-cliente";
import { dataBR, hojeISO } from "@/lib/pmoc";
import {
  DESCRICAO_MAX, FILTRO_VAZIO, GRAVIDADES, LABELS_GRAVIDADE, LABELS_SITUACAO, MSG_ANEXO_GRANDE, MSG_ANEXO_TIPO, ROTULO_GERAL, SITUACOES,
  TAMANHO_MAX_ANEXO_OCORRENCIA, contarOcorrencias, erroDaOcorrencia, filtrarOcorrencias, ordenarOcorrencias, resumoDasOcorrencias, textoDaSituacao,
  type FiltroOcorrencias, type FiltroSituacao, type GravidadeOcorrencia, type OcorrenciaPmoc, type OrdemDaOcorrencia, type SituacaoOcorrencia,
} from "@/lib/pmoc-ocorrencias";

const TOM_GRAVIDADE: Record<GravidadeOcorrencia, TomStatus> = { BAIXA: "previsto", MEDIA: "atencao", ALTA: "atrasado", CRITICA: "atrasado-solido" };
const TOM_SITUACAO: Record<SituacaoOcorrencia, TomStatus> = { ABERTA: "atencao", EM_ANDAMENTO: "acento", RESOLVIDA: "ok" };

function lerArquivo(file: File): Promise<string> {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = erro; r.readAsDataURL(file); });
}
const JSON_HEADERS = { "Content-Type": "application/json" };

interface EquipamentoDoPlano { id: string; rotulo: string }

/**
 * Aba "Ocorrências": o registro das não conformidades achadas na manutenção dos equipamentos do
 * plano. Lista com busca e filtros; quem tem "PMOC › Editar" registra, edita, resolve, reabre,
 * exclui e restaura. As ocorrências que estão valendo entram no documento do plano.
 */
export function PmocOcorrencias({ pmocId, equipamentos, somenteLeitura, aoMudar }: {
  pmocId: string;
  /** Os equipamentos AVAC do próprio plano (a ocorrência é de um deles ou geral da unidade) */
  equipamentos: EquipamentoDoPlano[];
  somenteLeitura: boolean;
  /** Avisa o editor a cada mudança: quantas ainda não foram resolvidas (o número da aba) */
  aoMudar?: (pendentes: number) => void;
}) {
  const [lista, setLista] = useState<OcorrenciaPmoc[] | null>(null);
  const [ordens, setOrdens] = useState<OrdemDaOcorrencia[]>([]);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<FiltroOcorrencias>(FILTRO_VAZIO);
  const [formulario, setFormulario] = useState<OcorrenciaPmoc | "nova" | null>(null);
  const [resolvendo, setResolvendo] = useState<OcorrenciaPmoc | null>(null);
  const [excluindo, setExcluindo] = useState<OcorrenciaPmoc | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const avisar = useRef(aoMudar);
  avisar.current = aoMudar;

  useEffect(() => {
    let vivo = true;
    fetch(`/api/pmocs/${pmocId}/ocorrencias`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar as ocorrências."); return; }
      const ocorrencias: OcorrenciaPmoc[] = Array.isArray(d.ocorrencias) ? d.ocorrencias : [];
      setLista(ocorrencias); setOrdens(Array.isArray(d.ordens) ? d.ordens : []);
      avisar.current?.(contarOcorrencias(ocorrencias).pendentes);
    }).catch(() => { if (vivo) setErro("Erro de conexão."); });
    return () => { vivo = false; };
  }, [pmocId]);

  /** Coloca na lista o que o servidor devolveu (nova ou alterada) e avisa o editor */
  function guardar(o: OcorrenciaPmoc) {
    const nova = [o, ...(lista ?? []).filter((x) => x.id !== o.id)];
    setLista(nova); setErro("");
    avisar.current?.(contarOcorrencias(nova).pendentes);
  }

  /** Ação de um clique na linha (reabrir, restaurar): devolve o erro, se houver */
  async function acaoRapida(o: OcorrenciaPmoc, corpo: Record<string, unknown>) {
    setOcupada(o.id); setErro("");
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/ocorrencias/${o.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível alterar a ocorrência."); return; }
      guardar(d);
    } catch { setErro("Erro de conexão."); } finally { setOcupada(null); }
  }

  const contagem = useMemo(() => contarOcorrencias(lista ?? []), [lista]);
  const visiveis = useMemo(() => ordenarOcorrencias(filtrarOcorrencias(lista ?? [], filtro)), [lista, filtro]);
  const filtrando = filtro.busca.trim() !== "" || filtro.situacao !== "" || filtro.gravidade !== "";

  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden" data-ocorrencias>
      <div className="px-4 py-3 border-b border-surface-border flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">Ocorrências</h2>
          <p className="text-xs text-ink-muted" data-resumo-ocorrencias>
            {lista ? `${resumoDasOcorrencias(contagem)}.` : "Não conformidades achadas na manutenção."} Entram no documento do plano.
          </p>
        </div>
        {!somenteLeitura && (
          <Button type="button" size="sm" onClick={() => setFormulario("nova")} disabled={!lista} data-nova-ocorrencia>
            <Plus className="w-4 h-4" /> Nova ocorrência
          </Button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-surface-border grid gap-2 sm:grid-cols-[1fr_12rem_12rem]" data-filtros-ocorrencias>
        <label className="relative block">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <Input aria-label="Pesquisar ocorrência" placeholder="Pesquisar por descrição, equipamento ou TAG" value={filtro.busca} className="pl-9"
            onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))} data-busca-ocorrencias />
        </label>
        <Select aria-label="Situação" value={filtro.situacao} onChange={(e) => setFiltro((f) => ({ ...f, situacao: e.target.value as FiltroSituacao }))} data-filtro-situacao>
          <option value="">Todas as situações</option>
          {SITUACOES.map((s) => <option key={s} value={s}>{LABELS_SITUACAO[s]}</option>)}
          <option value="EXCLUIDAS">Excluídas{contagem.excluidas ? ` (${contagem.excluidas})` : ""}</option>
        </Select>
        <Select aria-label="Gravidade" value={filtro.gravidade} onChange={(e) => setFiltro((f) => ({ ...f, gravidade: e.target.value as FiltroOcorrencias["gravidade"] }))} data-filtro-gravidade>
          <option value="">Todas as gravidades</option>
          {GRAVIDADES.map((g) => <option key={g} value={g}>{LABELS_GRAVIDADE[g]}</option>)}
        </Select>
      </div>

      {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border-b border-atrasado/20 px-4 py-2" data-erro-ocorrencias>{erro}</p>}

      {!lista ? (!erro && <p className="text-sm text-ink-muted px-4 py-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>)
        : visiveis.length === 0 ? (
          <div className="text-center px-4 py-10 space-y-2" data-sem-ocorrencias>
            <AlertOctagon className="w-6 h-6 text-ink-subtle mx-auto" aria-hidden />
            <p className="text-sm text-ink-muted">{filtrando ? "Nenhuma ocorrência com estes filtros." : "Nenhuma ocorrência registrada neste plano."}</p>
            {filtrando && <button type="button" onClick={() => setFiltro(FILTRO_VAZIO)} className="text-sm font-medium text-primary-600 hover:underline" data-limpar-filtros>Limpar filtros</button>}
          </div>
        ) : (
          <ul className="divide-y divide-surface-border" data-lista-ocorrencias>
            {visiveis.map((o) => (
              <li key={o.id} data-ocorrencia={o.id} data-situacao={o.ativo ? o.situacao : "EXCLUIDA"} className={cn("px-4 py-3 flex flex-col md:flex-row md:items-start gap-2 md:gap-4", !o.ativo && "bg-surface-alt/60")}>
                <p className="text-sm font-medium text-ink md:w-24 shrink-0 tabular-nums" data-data-ocorrencia>{dataBR(o.data)}</p>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-ink break-words" data-equipamento-ocorrencia>{o.equipamento?.rotulo ?? ROTULO_GERAL}</p>
                  <p className="text-sm text-ink whitespace-pre-line break-words" data-descricao-ocorrencia>{o.descricao}</p>
                  {o.situacao === "RESOLVIDA" && o.resolucao && <p className="text-sm text-ink-muted whitespace-pre-line break-words" data-resolucao-ocorrencia>Resolução: {o.resolucao}</p>}
                  {(o.ordemServico || o.anexo) && (
                    <p className="text-xs flex items-center gap-x-4 gap-y-1 flex-wrap">
                      {o.ordemServico && <Link href={`/ordens/${o.ordemServico.id}`} className="text-primary-600 hover:underline" data-os-ocorrencia>Detectada na {o.ordemServico.numero}</Link>}
                      {o.anexo && (
                        <a href={`/api/pmocs/${pmocId}/ocorrencias/${o.id}/anexo?inline=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline" data-anexo-ocorrencia>
                          <Paperclip className="w-3.5 h-3.5" aria-hidden /> {o.anexo.nome}
                        </a>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap md:w-44 md:justify-end shrink-0">
                  <StatusPill tom={TOM_GRAVIDADE[o.gravidade] ?? "previsto"} tamanho="sm" data-gravidade={o.gravidade}>{LABELS_GRAVIDADE[o.gravidade] ?? o.gravidade}</StatusPill>
                  {o.ativo
                    ? <StatusPill tom={TOM_SITUACAO[o.situacao] ?? "previsto"} tamanho="sm" data-pilula-situacao={o.situacao}>{textoDaSituacao(o)}</StatusPill>
                    : <StatusPill tom="previsto" tamanho="sm" data-pilula-situacao="EXCLUIDA">Excluída</StatusPill>}
                </div>
                {!somenteLeitura && (
                  <div className="flex items-center gap-1 md:w-40 md:justify-end shrink-0" data-acoes-ocorrencia>
                    {!o.ativo ? (
                      <Button type="button" variant="secondary" size="sm" loading={ocupada === o.id} onClick={() => acaoRapida(o, { restaurar: true })} data-restaurar><RotateCcw className="w-3.5 h-3.5" /> Restaurar</Button>
                    ) : (
                      <>
                        {o.situacao === "RESOLVIDA"
                          ? <Button type="button" variant="secondary" size="sm" loading={ocupada === o.id} onClick={() => acaoRapida(o, { situacao: "ABERTA" })} data-reabrir><Undo2 className="w-3.5 h-3.5" /> Reabrir</Button>
                          : <Button type="button" variant="outline" size="sm" onClick={() => setResolvendo(o)} data-resolver><CheckCircle2 className="w-3.5 h-3.5" /> Resolver</Button>}
                        <button type="button" title="Editar ocorrência" aria-label="Editar ocorrência" onClick={() => setFormulario(o)} data-editar
                          className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt"><Pencil className="w-4 h-4" /></button>
                        <button type="button" title="Excluir ocorrência" aria-label="Excluir ocorrência" onClick={() => setExcluindo(o)} data-excluir
                          className="p-1.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

      {formulario && (
        <FormularioOcorrencia key={formulario === "nova" ? "nova" : formulario.id} pmocId={pmocId} ocorrencia={formulario === "nova" ? null : formulario}
          equipamentos={equipamentos} ordens={ordens} aoFechar={() => setFormulario(null)} aoSalvar={(o) => { guardar(o); setFormulario(null); }} />
      )}
      {resolvendo && <ResolverOcorrencia key={resolvendo.id} pmocId={pmocId} ocorrencia={resolvendo} aoFechar={() => setResolvendo(null)} aoSalvar={(o) => { guardar(o); setResolvendo(null); }} />}
      {excluindo && <ExcluirOcorrencia key={excluindo.id} pmocId={pmocId} ocorrencia={excluindo} aoFechar={() => setExcluindo(null)} aoSalvar={(o) => { guardar(o); setExcluindo(null); }} />}
    </div>
  );
}

const Erro = ({ texto }: { texto: string }) => (
  texto ? <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-ocorrencia>{texto}</p> : null
);

/** Os campos da resolução: aparecem no formulário (situação Resolvida) e no diálogo "Resolver" */
function CamposDaResolucao({ resolvidaEm, resolucao, mudar }: { resolvidaEm: string; resolucao: string; mudar: (campo: "resolvidaEm" | "resolucao", valor: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[11rem_1fr]" data-campos-resolucao>
      <FormField label="Data da resolução" required>
        <InputData aria-label="Data da resolução" value={resolvidaEm} onChange={(iso) => mudar("resolvidaEm", iso)} />
      </FormField>
      <FormField label="O que foi feito" hint="Opcional. Sai no documento do plano, junto da ocorrência.">
        <Textarea aria-label="O que foi feito" rows={2} maxLength={DESCRICAO_MAX} value={resolucao} onChange={(e) => mudar("resolucao", e.target.value)} placeholder="Ex: troca do filtro e teste de funcionamento" />
      </FormField>
    </div>
  );
}

interface PropsDialogo { pmocId: string; aoFechar: () => void; aoSalvar: (o: OcorrenciaPmoc) => void }

function FormularioOcorrencia({ pmocId, ocorrencia, equipamentos, ordens, aoFechar, aoSalvar }: PropsDialogo & {
  ocorrencia: OcorrenciaPmoc | null; equipamentos: EquipamentoDoPlano[]; ordens: OrdemDaOcorrencia[];
}) {
  const hoje = hojeISO();
  const [form, setForm] = useState(() => ({
    data: ocorrencia?.data ?? hoje,
    equipamentoId: ocorrencia?.equipamento?.id ?? "",
    descricao: ocorrencia?.descricao ?? "",
    gravidade: (ocorrencia?.gravidade ?? "") as GravidadeOcorrencia | "",
    situacao: (ocorrencia?.situacao ?? "ABERTA") as SituacaoOcorrencia,
    resolvidaEm: ocorrencia?.resolvidaEm ?? hoje,
    resolucao: ocorrencia?.resolucao ?? "",
    ordemServicoId: ocorrencia?.ordemServico?.id ?? "",
  }));
  const set = (campo: keyof typeof form, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));
  const [anexoNovo, setAnexoNovo] = useState<{ dataUrl: string; nome: string } | null>(null);
  const [removerAnexo, setRemoverAnexo] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const inputAnexo = useRef<HTMLInputElement>(null);

  // O equipamento e a OS já ligados continuam na lista mesmo que tenham saído do plano ou da lista recente
  const opcoesEquipamento = useMemo(() => {
    const atual = ocorrencia?.equipamento;
    return atual && !equipamentos.some((e) => e.id === atual.id) ? [...equipamentos, { id: atual.id, rotulo: `${atual.rotulo} (fora do plano)` }] : equipamentos;
  }, [equipamentos, ocorrencia]);
  const opcoesOrdem = useMemo(() => {
    const atual = ocorrencia?.ordemServico;
    return atual && !ordens.some((o) => o.id === atual.id) ? [{ id: atual.id, numero: atual.numero, descricao: "" }, ...ordens] : ordens;
  }, [ordens, ocorrencia]);

  async function escolherAnexo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErro("");
    const pdf = f.type === "application/pdf";
    if (!pdf && !f.type.startsWith("image/")) { setErro(MSG_ANEXO_TIPO); return; }
    // Foto do celular (3 a 8 MB) é reduzida antes de enviar: continua legível e cabe no pedido
    if (!pdf) {
      try {
        const { imagem } = await reduzirImagem(f, 1600, 0.82);
        if (imagem.bytes > TAMANHO_MAX_ANEXO_OCORRENCIA) { setErro(MSG_ANEXO_GRANDE); return; }
        setAnexoNovo({ dataUrl: imagem.dataUrl, nome: f.name.replace(/\.[^.]+$/, "") + ".jpg" }); setRemoverAnexo(false);
        return;
      } catch { /* não deu para reduzir: segue com o arquivo como veio, se for JPG ou PNG */ }
      if (f.type !== "image/jpeg" && f.type !== "image/png") { setErro(MSG_ANEXO_TIPO); return; }
    }
    if (f.size > TAMANHO_MAX_ANEXO_OCORRENCIA) { setErro(MSG_ANEXO_GRANDE); return; }
    setAnexoNovo({ dataUrl: await lerArquivo(f), nome: f.name }); setRemoverAnexo(false);
  }

  async function salvar() {
    if (form.descricao.trim().length < 3) { setErro("Descreva o problema (mín. 3 caracteres)."); return; }
    if (!form.gravidade) { setErro("Escolha a gravidade."); return; }
    const resolvida = form.situacao === "RESOLVIDA";
    const conferencia = erroDaOcorrencia({ data: form.data, situacao: form.situacao, resolvidaEm: resolvida ? form.resolvidaEm : null }, hoje);
    if (conferencia) { setErro(conferencia); return; }
    setErro(""); setSalvando(true);
    try {
      const corpo = {
        data: form.data, equipamentoId: form.equipamentoId || null, descricao: form.descricao, gravidade: form.gravidade, situacao: form.situacao,
        resolvidaEm: resolvida ? form.resolvidaEm : null, resolucao: resolvida ? form.resolucao : null, ordemServicoId: form.ordemServicoId || null,
        ...(anexoNovo ? { anexo: anexoNovo.dataUrl, anexoNome: anexoNovo.nome } : {}),
        ...(removerAnexo ? { removerAnexo: true } : {}),
      };
      const res = await fetch(ocorrencia ? `/api/pmocs/${pmocId}/ocorrencias/${ocorrencia.id}` : `/api/pmocs/${pmocId}/ocorrencias`, {
        method: ocorrencia ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar a ocorrência."); return; }
      aoSalvar(d);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  const anexoAtual = !removerAnexo && (anexoNovo?.nome ?? ocorrencia?.anexo?.nome);

  return (
    <Modal aberto onFechar={aoFechar} titulo={ocorrencia ? "Editar ocorrência" : "Nova ocorrência"} tamanho="lg">
      <div className="space-y-4" data-modal-ocorrencia>
        <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
          <FormField label="Data" required>
            <InputData aria-label="Data da ocorrência" value={form.data} onChange={(iso) => set("data", iso)} />
          </FormField>
          <FormField label="Equipamento" hint="Dos equipamentos AVAC deste plano. Sem equipamento, a ocorrência é geral da unidade.">
            <Select aria-label="Equipamento" value={form.equipamentoId} onChange={(e) => set("equipamentoId", e.target.value)} data-campo-equipamento>
              <option value="">{ROTULO_GERAL}</option>
              {opcoesEquipamento.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Descrição do problema" required>
          <Textarea aria-label="Descrição do problema" rows={3} maxLength={DESCRICAO_MAX} value={form.descricao} onChange={(e) => set("descricao", e.target.value)}
            placeholder="Ex: vazamento de água na bandeja da evaporadora" />
        </FormField>
        <FormField label="Gravidade" required>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Gravidade">
            {GRAVIDADES.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={form.gravidade === g} onClick={() => set("gravidade", g)} data-gravidade-opcao={g}
                className={cn("rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  form.gravidade === g ? "border-acento bg-acento-claro text-acento" : "border-surface-border bg-white text-ink hover:bg-surface-alt")}>
                {LABELS_GRAVIDADE[g]}
              </button>
            ))}
          </div>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Situação" required>
            <Select aria-label="Situação da ocorrência" value={form.situacao} onChange={(e) => set("situacao", e.target.value)} data-campo-situacao>
              {SITUACOES.map((s) => <option key={s} value={s}>{LABELS_SITUACAO[s]}</option>)}
            </Select>
          </FormField>
          <FormField label="OS onde foi detectada" hint="Opcional. As OS deste cliente.">
            <Select aria-label="OS onde foi detectada" value={form.ordemServicoId} onChange={(e) => set("ordemServicoId", e.target.value)} data-campo-os>
              <option value="">Nenhuma</option>
              {opcoesOrdem.map((o) => <option key={o.id} value={o.id}>{o.descricao ? `${o.numero} · ${o.descricao}` : o.numero}</option>)}
            </Select>
          </FormField>
        </div>
        {form.situacao === "RESOLVIDA" && <CamposDaResolucao resolvidaEm={form.resolvidaEm} resolucao={form.resolucao} mudar={set} />}
        <FormField label="Foto ou anexo" hint="Foto (reduzida ao enviar) ou PDF até 3 MB.">
          <input ref={inputAnexo} type="file" accept="image/*,application/pdf" className="hidden" onChange={escolherAnexo} aria-label="Foto ou anexo da ocorrência" />
          {anexoAtual ? (
            <div className="flex items-center gap-2 border border-surface-border rounded-lg px-3 py-2 text-sm" data-anexo-formulario>
              <FileText className="w-4 h-4 text-primary-600 shrink-0" aria-hidden />
              <span className="truncate flex-1">{anexoAtual}</span>
              {anexoNovo && <span className="text-[10px] text-atencao-texto bg-atencao-claro px-1.5 py-0.5 rounded">a salvar</span>}
              <button type="button" title="Excluir anexo" aria-label="Excluir anexo" onClick={() => { setAnexoNovo(null); setRemoverAnexo(!!ocorrencia?.anexo); }}
                className="p-1 text-ink-muted hover:text-atrasado" data-remover-anexo><Trash2 className="w-4 h-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => inputAnexo.current?.click()} data-enviar-anexo
              className="w-full inline-flex items-center justify-center gap-2 border border-dashed border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-alt">
              <Upload className="w-4 h-4" /> Enviar foto ou PDF
            </button>
          )}
        </FormField>
        <Erro texto={erro} />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-ocorrencia>{ocorrencia ? "Salvar" : "Registrar ocorrência"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ResolverOcorrencia({ pmocId, ocorrencia, aoFechar, aoSalvar }: PropsDialogo & { ocorrencia: OcorrenciaPmoc }) {
  const hoje = hojeISO();
  const [form, setForm] = useState({ resolvidaEm: hoje, resolucao: "" });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function resolver() {
    const conferencia = erroDaOcorrencia({ data: ocorrencia.data, situacao: "RESOLVIDA", resolvidaEm: form.resolvidaEm }, hoje);
    if (conferencia) { setErro(conferencia); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/ocorrencias/${ocorrencia.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ situacao: "RESOLVIDA", ...form }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível resolver a ocorrência."); return; }
      aoSalvar(d);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo="Resolver ocorrência" tamanho="md">
      <div className="space-y-4" data-modal-resolver>
        <p className="text-sm text-ink-muted break-words">
          <strong className="text-ink">{ocorrencia.equipamento?.rotulo ?? ROTULO_GERAL}</strong> · {dataBR(ocorrencia.data)} · {ocorrencia.descricao}
        </p>
        <CamposDaResolucao resolvidaEm={form.resolvidaEm} resolucao={form.resolucao} mudar={(campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))} />
        <Erro texto={erro} />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="success" loading={salvando} onClick={resolver} data-confirmar-resolver><CheckCircle2 className="w-4 h-4" /> Marcar como resolvida</Button>
        </div>
      </div>
    </Modal>
  );
}

function ExcluirOcorrencia({ pmocId, ocorrencia, aoFechar, aoSalvar }: PropsDialogo & { ocorrencia: OcorrenciaPmoc }) {
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function excluir() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/ocorrencias/${ocorrencia.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível excluir a ocorrência."); return; }
      aoSalvar(d);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo="Excluir ocorrência" tamanho="sm">
      <div className="space-y-4" data-modal-excluir>
        <p className="text-sm text-ink break-words">
          <strong>{ocorrencia.equipamento?.rotulo ?? ROTULO_GERAL}</strong> · {dataBR(ocorrencia.data)} · {ocorrencia.descricao}
        </p>
        <p className="text-sm text-ink-muted">
          <span>Ela sai da lista e do documento do plano. </span>
          <span>Fica guardada: o filtro “Excluídas” mostra e permite restaurar.</span>
        </p>
        <Erro texto={erro} />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="danger" loading={salvando} onClick={excluir} data-confirmar-excluir><Trash2 className="w-4 h-4" /> Excluir</Button>
        </div>
      </div>
    </Modal>
  );
}
