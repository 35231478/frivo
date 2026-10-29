import { PageHeader } from "@/components/ui/page-header";
import { EmailConfigClient } from "@/components/config/email-config-client";

export function TelaEmail() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="E-mail transacional" description="Remetente dos e-mails automáticos" dica="O envio é feito pelo serviço Resend." backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-6">
        <EmailConfigClient />
      </div>
    </div>
  );
}
