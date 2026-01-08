
'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { WhatsAppIcon } from '@/components/WhatsAppIcon';
import { buildWhatsAppLink, toBrazilE164 } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function ChatWidget() {
    const { settings } = useSettings();
    const { toast } = useToast();
    const [isSending, setIsSending] = useState(false);

    const to = toBrazilE164(settings.storePhone);

    if (!to) return null;

    const handleSend = async () => {
        if (isSending) return;
        setIsSending(true);
        const message = 'Olá! Vim pelo site e gostaria de atendimento.';
        const menuiaSendEnabled = settings.menuiaSendEnabled ?? true;
        try {
            if (!menuiaSendEnabled) {
                const link = buildWhatsAppLink(to, message);
                if (link) {
                    window.open(link, '_blank', 'noopener,noreferrer');
                    toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
                    return;
                }
            }
            const res = await fetch('/api/menuia/send-text', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    to,
                    message,
                }),
            });
            if (res.ok) {
                toast({ title: 'Enviado!', description: 'Mensagem enviada no WhatsApp da loja.' });
            } else {
                const link = buildWhatsAppLink(to, message);
                if (link) {
                    window.open(link, '_blank', 'noopener,noreferrer');
                    toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
                    return;
                }
                toast({ title: 'Erro', description: `Falha ao enviar (status ${res.status}).`, variant: 'destructive' });
            }
        } catch {
            const link = buildWhatsAppLink(to, message);
            if (link) {
                window.open(link, '_blank', 'noopener,noreferrer');
                toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
                return;
            }
            toast({ title: 'Erro', description: 'Falha ao enviar mensagem.', variant: 'destructive' });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50">
            <Button
                className="rounded-full h-16 w-16 shadow-lg bg-green-600 hover:bg-green-700"
                aria-label="Atendimento no WhatsApp"
                onClick={handleSend}
                disabled={isSending}
            >
                <WhatsAppIcon />
            </Button>
        </div>
    );
}
