'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import { ALL_SECTIONS, hasUserAccess } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

export default function AdminRootPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { permissions, isLoading: permissionsLoading } = usePermissions();

  useEffect(() => {
    if (isLoading || permissionsLoading) return;
    if (!isAuthenticated || !user) {
      router.replace('/login');
      return;
    }
    if (!permissions) return;

    const firstAllowed = ALL_SECTIONS.find((s) => hasUserAccess(user, s.id, permissions))?.id;
    if (firstAllowed) {
      router.replace(`/admin/${firstAllowed}`);
      return;
    }

    router.replace('/');
  }, [isLoading, permissionsLoading, isAuthenticated, user, permissions, router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
        {isLoading || permissionsLoading ? (
          <p>Carregando painel...</p>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center px-4">
            <p>Você não tem permissões para acessar o painel.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
              >
                Ir para o login
              </Button>
              <Button variant="default" onClick={() => router.replace('/')}>
                Voltar à loja
              </Button>
            </div>
          </div>
        )}
    </div>
  );
}
