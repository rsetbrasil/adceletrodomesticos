
'use client';

import { Button } from '@/components/ui/button';
import { useMemo } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { WhatsAppIcon } from '@/components/WhatsAppIcon';

const toWhatsAppPhone = (value: string): string | null => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
};

export default function ChatWidget() {
    const { settings } = useSettings();

    const whatsappUrl = useMemo(() => {
        const phone = toWhatsAppPhone(settings.storePhone || '');
        if (!phone) return null;
        const text = encodeURIComponent('Olá! Vim pelo site e gostaria de atendimento.');
        return `https://wa.me/${phone}?text=${text}`;
    }, [settings.storePhone]);

    if (!whatsappUrl) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50">
            <Button asChild className="rounded-full h-16 w-16 shadow-lg bg-green-600 hover:bg-green-700" aria-label="Atendimento no WhatsApp">
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon />
                </a>
            </Button>
        </div>
    );
}
