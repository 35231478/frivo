"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { Dica } from "@/components/ui/dica";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { CATEGORIAS } from "@/lib/colaborador/documentos";
import {
  CAMPOS_AUTOMATICOS, NOME_MAX, TEXTO_MAX, VALIDADE_DIAS_MAX, TIPOS, TIPO_PADRAO,
  camposDesconhecidosDoModelo, camposUsados, erroDoModelo, temItensPadrao, tipoDe,
} from "@/lib/documentos/modelos";
import { cn } from "@/lib/utils";

/**
 * O editor do MODELO DE DOCUMENTO (CadastroPadrao › modelos-documento).
 *
 * O coração é o painel de campos: a empresa escreve o texto e vê, ao lado, tudo o que o sistema
 * sabe preencher — **em verde o que o texto já usa**. Campo que o modelo usa e o sistema não
 * conhece aparece num aviso, porque é erro de quem escreveu e esconder só atrasaria a descoberta.
 */
export function EditorModeloDocumento({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<string>(TIPO_PADRAO);
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [temItens, setTemItens] = useState(false);
  const [validadeDias, setValidadeDias] = useState("");
  const [exigeAssinatura, setExigeAssinatura] = useState(true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    const t = (item?.tipo as string) ?? TIPO_PADRAO;
    setNome(item?.nome ?? "");
    setTipo(t);
    setTexto((item?.texto as string | null) ?? "");
    setCategoria((item?.categoria as string | null) ?? "");
    setTemItens(item ? !!item.temItens : temItensPadrao(t));
    setValidadeDias(item?.validadeDias === null || item?.validadeDias === undefined ? "" : String(item.validadeDias));
    setExigeAssinatura(item ? item.exigeAssinatura !== false : true);
  }, [aberto, item]);

  const def = tipoDe(tipo);
  const usados = useMemo(() => new Set(camposUsados(texto)), [texto]);
  const desconhecidos = useMemo(() => camposDesconhecidosDoModelo(texto, tipo), [texto, tipo]);
  /** Os campos do tipo entram na lista junto dos automáticos: no texto eles se escrevem igual. */
  const doTipo = def.campos;

  /** Trocar de tipo troca o que o tipo manda (itens), sem apagar o que a pessoa escreveu. */
  function trocarTipo(novo: string) {
    setTipo(novo);
    const d = tipoDe(novo);
    if (d.itens === "exige") setTemItens(true);
    if (d.itens === "nao") setTemItens(false);
  }

  function inserir(campo: string) {
    const marca = `{{${campo}}}`;
    const area = areaRef.current;
    if (!area) { setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${marca}`); return; }
    const ini = area.selectionStart ?? texto.length;
    const fim = area.selectionEnd ?? texto.length;
    setTexto(texto.slice(0, ini) + marca + texto.slice(fim));
    requestAnimationFrame(() => { area.focus(); area.selectionStart = area.selectionEnd = ini + marca.length; });
  }

  async function salvar() {
    const dias = validadeDias.trim() ? Number(validadeDias) : null;
    const problema = erroDoModelo({
      nome, tipo, texto, categoria: categoria || null,
      temItens, validadeDias: dias, exigeAssinatura,
    });
    if (problema) { setErro(problema); return; }

    setSalvando(true); setErro("");
    const r = await salvarCadastro("modelos-documento", item?.id ?? null, {
      nome: nome.trim(), tipo, texto,
      categoria: categoria || null,
      temItens, validadeDias: dias, exigeAssinatura,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Novo modelo de documento"}
      largura="w-full sm:w-[64vw] sm:min-w-[560px] sm:max-w-[920px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar} data-salvar-modelo><Check className="w-4 h-4" /> Salvar</Button>
      </>}
    >
      <div className="space-y-4" data-editor-modelo>
        {erro && (
          <div role="alert" data-erro className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">
            {erro}
          </div>
        )}
        {item && item.ativo === false && (
          <p className="text-sm bg-atencao-claro border border-atencao/20 text-atencao-texto rounded-lg px-3 py-2">
            Modelo inativo: não aparece em “Gerar documento”. Os papéis já gerados continuam como estão.
          </p>
        )}

        <FormGrid>
          <FormField label="Nome" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={NOME_MAX}
              placeholder="Ex.: Ficha de entrega de EPI" data-campo-nome />
          </FormField>
          <FormField label="Tipo" required dica={def.dica}>
            <Select value={tipo} onChange={(e) => trocarTipo(e.target.value)} data-campo-tipo>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </Select>
          </FormField>
        </FormGrid>

        {/* O painel de campos: o que o sistema preenche, e em verde o que este texto já usa */}
        <div>
          <p className="text-sm font-semibold text-ink mb-1.5">
            Campos que o sistema preenche <Dica texto="Clique para inserir no texto. Em verde, os que este modelo já usa." />
          </p>
          <div className="flex flex-wrap gap-1.5" data-campos-modelo>
            {[...CAMPOS_AUTOMATICOS, ...doTipo.map((c) => ({ id: c.id, rotulo: `${c.rotulo} (perguntado ao gerar)` }))].map((c) => (
              <button
                key={c.id} type="button" onClick={() => inserir(c.id)} title={c.rotulo}
                data-campo-modelo={c.id} data-usado={usados.has(c.id) ? "sim" : "nao"}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-mono border rounded px-2 py-1 transition-colors",
                  usados.has(c.id)
                    ? "bg-ok-claro text-ok-texto border-ok/30"
                    : "bg-primary-50 text-primary-700 border-primary-100 hover:bg-primary-100",
                )}
              >
                {`{{${c.id}}}`}
              </button>
            ))}
          </div>
        </div>

        {desconhecidos.length > 0 && (
          <div data-campos-desconhecidos role="status"
            className="flex items-start gap-2 bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              O texto usa {desconhecidos.length === 1 ? "um campo que o sistema não conhece" : "campos que o sistema não conhece"}:{" "}
              <strong className="font-mono">{desconhecidos.map((c) => `{{${c}}}`).join(", ")}</strong>. {}
              {desconhecidos.length === 1 ? "Ele sai" : "Eles saem"} no documento exatamente assim, sem ser preenchido.
            </span>
          </div>
        )}

        <FormField label="Texto do documento" required>
          <Textarea ref={areaRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} maxLength={TEXTO_MAX}
            data-campo-texto
            placeholder={"Ex.: {{empresa}} entrega a {{nome}}, CPF {{cpf}}, os equipamentos de proteção listados abaixo, em {{entregaEm}}."} />
        </FormField>

        <FormGrid>
          <FormField label="Gaveta na ficha" dica="Onde o papel gerado fica na seção Documentos. Em branco, vale a do tipo.">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} data-campo-categoria>
              <option value="">{`A do tipo (${CATEGORIAS.find((c) => c.id === def.categoria)?.rotulo ?? def.categoria})`}</option>
              {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
            </Select>
          </FormField>
          <FormField label="Validade (dias)" dica="A partir da entrega. Em branco, o documento não vence — e nenhum aviso nasce.">
            <Input value={validadeDias} onChange={(e) => setValidadeDias(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric" placeholder="Ex.: 180" data-campo-validade
              aria-describedby={undefined} maxLength={String(VALIDADE_DIAS_MAX).length} />
          </FormField>
        </FormGrid>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={temItens} data-campo-itens
              disabled={def.itens !== "permite"}
              onChange={(e) => setTemItens(e.target.checked)} className="mt-0.5" />
            <span>
              Tem lista de itens
              <span className="block text-xs text-ink-subtle">
                {def.itens === "exige" && "A ficha de EPI sempre tem: item, CA, quantidade e data de entrega."}
                {def.itens === "nao" && `${def.rotulo} não tem lista de itens.`}
                {def.itens === "permite" && "Para listar o que foi entregue (item, CA, quantidade e data)."}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={exigeAssinatura} data-campo-assinatura
              onChange={(e) => setExigeAssinatura(e.target.checked)} className="mt-0.5" />
            <span>
              Pede assinatura do colaborador
              <span className="block text-xs text-ink-subtle">
                Sem assinatura, o papel já nasce guardado na ficha. Com ela, só entra depois de assinado.
              </span>
            </span>
          </label>
        </div>
      </div>
    </Drawer>
  );
}
