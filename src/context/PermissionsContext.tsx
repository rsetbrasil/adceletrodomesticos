
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { RolePermissions } from '@/lib/types';
import { initialPermissions } from '@/lib/permissions';
import { getClientFirebase } from '@/lib/firebase-client';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './AuthContext';
import { useAudit } from './AuditContext';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const PERMISSIONS_CACHE_STORAGE_KEY = 'rolePermissionsCache';

interface PermissionsContextType {
    permissions: RolePermissions | null;
    updatePermissions: (newPermissions: RolePermissions) => Promise<void>;
    isLoading: boolean;
    resetPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
    const [permissions, setPermissions] = useState<RolePermissions | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { user } = useAuth();
    const { logAction } = useAudit();
    
    useEffect(() => {
        let unsubscribe: (() => void) | null = null;
        try {
            const cached = localStorage.getItem(PERMISSIONS_CACHE_STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached) as RolePermissions;
                setPermissions(parsed);
                setIsLoading(false);
            }
        } catch {
            setPermissions(initialPermissions);
            setIsLoading(false);
        }

        const timeoutId = window.setTimeout(() => {
            setPermissions((current) => current ?? initialPermissions);
            setIsLoading(false);
        }, 8000);
        try {
            const { db } = getClientFirebase();
            const permissionsRef = doc(db, 'config', 'rolePermissions');
            unsubscribe = onSnapshot(permissionsRef, async (docSnap) => {
                window.clearTimeout(timeoutId);
                if (docSnap.exists()) {
                    const nextPermissions = docSnap.data() as RolePermissions;
                    setPermissions(nextPermissions);
                    try {
                        localStorage.setItem(PERMISSIONS_CACHE_STORAGE_KEY, JSON.stringify(nextPermissions));
                    } catch {
                        return;
                    }
                } else {
                    await setDoc(permissionsRef, initialPermissions);
                    setPermissions(initialPermissions);
                }
                setIsLoading(false);
            }, (error) => {
                window.clearTimeout(timeoutId);
                console.error("Failed to load permissions from Firestore:", error);
                errorEmitter.emit('permission-error', new FirestorePermissionError({
                    path: 'config/rolePermissions',
                    operation: 'get',
                }));
                setPermissions(initialPermissions);
                setIsLoading(false);
            });
        } catch (error) {
            window.clearTimeout(timeoutId);
            setPermissions(initialPermissions);
            setIsLoading(false);
        }

        return () => {
            window.clearTimeout(timeoutId);
            unsubscribe?.();
        };
    }, [toast]);

    const updatePermissions = useCallback(async (newPermissions: RolePermissions) => {
        try {
            const { db } = getClientFirebase();
            if (!db) {
                toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
                return;
            }
            const permissionsRef = doc(db, 'config', 'rolePermissions');
            await setDoc(permissionsRef, newPermissions);
            // Real-time listener will update the state
            logAction('Atualização de Permissões', 'As permissões de acesso dos perfis foram alteradas.', user);
            toast({
                title: "Permissões Salvas!",
                description: "As regras de acesso foram atualizadas com sucesso.",
            });
        } catch (error) {
            console.error("Error updating permissions in Firestore:", error);
            toast({ title: "Erro", description: "Não foi possível salvar as permissões.", variant: "destructive" });
        }
    }, [toast, logAction, user]);

    const resetPermissions = useCallback(async () => {
        await updatePermissions(initialPermissions);
    }, [updatePermissions]);

    return (
        <PermissionsContext.Provider value={{ permissions, updatePermissions, isLoading, resetPermissions }}>
            {children}
        </PermissionsContext.Provider>
    );
};

export const usePermissions = () => {
    const context = useContext(PermissionsContext);
    if (context === undefined) {
        throw new Error('usePermissions must be used within a PermissionsProvider');
    }
    return context;
};
