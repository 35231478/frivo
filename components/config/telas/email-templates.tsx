import { PageHeader } from "@/components/ui/page-header";
import { EmailTemplatesClient } from "@/components/config/email-templates-client";

export function TelaEmailTemplates() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Templates de E-mail" description="Personalize o assunto e o corpo dos e-mails automáticos" backHref="/configuracoes/email" />
      <div className="bg-white rounded-card border border-surface-border p-6">
        <EmailTemplatesClient />
      </div>
    </div>
  );
}
