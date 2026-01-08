

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getClientFirebase } from '@/lib/firebase-client';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAudit } from './AuditContext';
import { useAuth } from './AuthContext';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import type { StoreSettings } from '@/lib/types';

const initialSettings: StoreSettings = {
    storeName: '',
    storeCity: '',
    storeAddress: '',
    pixKey: '',
    storePhone: '',
    logoUrl: undefined,
    accessControlEnabled: false,
    commercialHourStart: '08:00',
    commercialHourEnd: '18:00',
    chargeSendTime: '09:00',
    menuiaSendEnabled: true,
};

interface SettingsContextType {
    settings: StoreSettings;
    updateSettings: (newSettings: Partial<StoreSettings>) => Promise<void>;
    isLoading: boolean;
    restoreSettings: (settings: StoreSettings) => Promise<void>;
    resetSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const [settings, setSettings] = useState<StoreSettings>(initialSettings);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { logAction } = useAudit();
    const { user } = useAuth();


    useEffect(() => {
        let unsubscribe: (() => void) | null = null;
        const timeoutId = window.setTimeout(() => {
            setSettings(initialSettings);
            setIsLoading(false);
        }, 8000);
        try {
            const { db } = getClientFirebase();
            const settingsRef = doc(db, 'config', 'storeSettings');
            unsubscribe = onSnapshot(settingsRef, async (docSnap) => {
                window.clearTimeout(timeoutId);
                if (docSnap.exists()) {
                    setSettings({ ...initialSettings, ...(docSnap.data() as StoreSettings) });
                } else {
                    await setDoc(settingsRef, initialSettings);
                    setSettings(initialSettings);
                }
                setIsLoading(false);
            }, (error) => {
                window.clearTimeout(timeoutId);
                console.error("Failed to load settings from Firestore:", error);
                errorEmitter.emit('permission-error', new FirestorePermissionError({
                    path: 'config/storeSettings',
                    operation: 'get',
                }));
                setSettings(initialSettings);
                setIsLoading(false);
            });
        } catch (error) {
            window.clearTimeout(timeoutId);
            setSettings(initialSettings);
            setIsLoading(false);
        }

        return () => {
            window.clearTimeout(timeoutId);
            unsubscribe?.();
        };
    }, [toast]);

    const updateSettings = async (newSettings: Partial<StoreSettings>) => {
        try {
            const { db } = getClientFirebase();
            if (!db) {
                toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
                return;
            }
            const settingsRef = doc(db, 'config', 'storeSettings');
            const entries = Object.entries(newSettings).filter(([, value]) => value !== undefined);
            const safeSettings = Object.fromEntries(entries) as Partial<StoreSettings>;
            await setDoc(settingsRef, safeSettings, { merge: true });

            logAction('Atualização de Configurações', `Configurações da loja foram alteradas.`, user);
            toast({
                title: "Configurações Salvas!",
                description: "As informações da loja foram atualizadas com sucesso.",
            });
        } catch (error) {
            console.error("Error updating settings in Firestore:", error);
            toast({ title: "Erro", description: "Não foi possível salvar as configurações.", variant: "destructive" });
        }
    };
    
    const restoreSettings = async (settingsToRestore: StoreSettings) => {
        await updateSettings(settingsToRestore);
        logAction('Restauração de Configurações', `Configurações da loja foram restauradas de um backup.`, user);
    };

    const resetSettings = async () => {
        await updateSettings(initialSettings);
        logAction('Reset de Configurações', `Configurações da loja foram restauradas para o padrão.`, user);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, isLoading, restoreSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};

    
