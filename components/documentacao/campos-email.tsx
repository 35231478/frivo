"use client";

import { EmailsInput } from "@/components/ui/emails-input";
import { FormField } from "@/components/ui/form-field";
import { VALIDADES_DIAS } from "@/lib/documentacao/pacote";
import { Select } from "@/components/ui/select";

export interface DestinoEmail { para: string[]; cc: string[]; copiaParaMim: boolean }

/**
 * Os destinatários do e-mail da documentação. Vêm preenchidos com os contatos do cadastro do
 * cliente e são editáveis: mais de um em "Para", cópia, e a cópia para quem está enviando.
 * O e-mail leva o LINK — por isso não existe campo de anexo aqui.
 */
export function CamposEmail({ valor, onValor, desabilitado, semCopiaParaMim }: {
  valor: DestinoEmail; onValor: (v: DestinoEmail) => void; desabilitado?: boolean;
  /** No lote, a cópia para quem envia é uma escolha só, para todos os clientes — não por cliente. */
  semCopiaParaMim?: boolean;
}) {
  return (
    <div className="space-y-3" data-campos-email>
      <FormField label="Para" required hint="Vem do cadastro do cliente. Pode trocar ou acrescentar.">
        <div data-email-para>
          <EmailsInput value={valor.para} onChange={(para) => onValor({ ...valor, para })} placeholder="email@cliente.com" disabled={desabilitado} />
        </div>
      </FormField>
      <FormField label="Cópia">
        <div data-email-cc>
          <EmailsInput value={valor.cc} onChange={(cc) => onValor({ ...valor, cc })} placeholder="Opcional" disabled={desabilitado} />
        </div>
      </FormField>
      {!semCopiaParaMim && <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
        <input
          type="checkbox" checked={valor.copiaParaMim} disabled={desabilitado} data-email-copia-para-mim
          onChange={(e) => onValor({ ...valor, copiaParaMim: e.target.checked })}
          className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento"
        />
        Enviar uma cópia para mim
      </label>}
    </div>
  );
}

/** O prazo do link: os quatro que a casa permite. Curto de propósito — é dado de pessoa fora da empresa. */
export function SeletorValidade({ valor, onValor, desabilitado }: { valor: number; onValor: (dias: number) => void; desabilitado?: boolean }) {
  return (
    <FormField label="O link vale por" dica="Depois do prazo o link para de abrir. Dá para gerar outro pelo histórico, e revogar antes do prazo.">
      <Select value={String(valor)} onChange={(e) => onValor(Number(e.target.value))} disabled={desabilitado} data-validade-link>
        {VALIDADES_DIAS.map((d) => <option key={d} value={d}>{d} dias</option>)}
      </Select>
    </FormField>
  );
}
