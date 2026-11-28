"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { cepCompleto, consultarCep, formatarCep, type EnderecoCep } from "@/lib/cep";

/** O que o campo diz embaixo, conforme a consulta */
export const DICA_CEP = {
  inicial: "Digite o CEP: o endereço é preenchido sozinho.",
  buscando: "Buscando o endereço…",
  achou: "Endereço preenchido pelo CEP. Confira e complete o número.",
  naoEncontrado: "CEP não encontrado: preencha o endereço à mão.",
  indisponivel: "A consulta de CEP não respondeu: preencha o endereço à mão.",
} as const;

/**
 * O CAMPO DE CEP — um só para todos os formulários com endereço (cliente/unidade, colaborador, admissão, empresa,
 * cadastro rápido). Completou os 8 dígitos, consulta (lib/cep: ViaCEP com reserva, com prazo) e devolve o endereço em
 * `onEndereco`; a tela decide o que preencher. Fora do ar ou CEP inexistente: diz e deixa a pessoa digitar.
 */
export function CampoCep({ valor, onValor, onEndereco, required, label = "CEP", className, dataCampo = "cep", erro, nome }: {
  valor: string;
  onValor: (v: string) => void;
  onEndereco: (e: EnderecoCep) => void;
  required?: boolean;
  label?: string;
  className?: string;
  dataCampo?: string;
  erro?: string;
  /** O nome do campo no formulário (ERRO NO CAMPO): o erro do servidor/do salvar cai aqui */
  nome?: string;
}) {
  const [situacao, setSituacao] = useState<keyof typeof DICA_CEP>("inicial");
  const digitosDe = (v: string) => v.replace(/\D/g, "");
  // O último CEP consultado — o que o registro já tinha ao abrir conta como consultado: abrir a edição, apagar um
  // dígito e voltar ao mesmo CEP não busca de novo (nem sobrescreve o endereço que já estava lá)
  const consultado = useRef<string | null>(cepCompleto(valor) ? digitosDe(valor) : null);
  const digitado = useRef(digitosDe(valor));

  async function consultar(digitos: string) {
    consultado.current = digitos;
    setSituacao("buscando");
    const r = await consultarCep(digitos);
    if (digitado.current !== digitos) return; // a pessoa já trocou o CEP
    if (r.ok) { onEndereco(r.endereco); setSituacao("achou"); }
    else if (r.motivo === "indisponivel") {
      // A consulta não respondeu: o mesmo CEP pode ser consultado de novo (apagar um dígito e redigitar)
      consultado.current = null;
      setSituacao("indisponivel");
    } else setSituacao("naoEncontrado");
  }

  return (
    <FormField label={label} required={required} hint={DICA_CEP[situacao]} error={erro} className={className} name={nome} formato="cep">
      <div className="relative max-w-[220px]">
        <Input
          value={formatarCep(valor)} inputMode="numeric" placeholder="00000-000" autoComplete="postal-code" maxLength={9}
          onChange={(e) => {
            const v = formatarCep(e.target.value);
            const d = digitosDe(v);
            digitado.current = d;
            onValor(v);
            if (!cepCompleto(v)) setSituacao("inicial");
            else if (d !== consultado.current) void consultar(d); // o mesmo CEP não consulta de novo
          }}
          name={dataCampo} data-campo={dataCampo} data-campo-cep data-situacao-cep={situacao}
        />
        {situacao === "buscando" && <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />}
      </div>
    </FormField>
  );
}
