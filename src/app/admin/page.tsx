'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import { ALL_SECTIONS, hasUserAccess, initialPermissions } from '@/lib/permissions';
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
    const effectivePermissions = permissions ?? initialPermissions;

    const firstAllowed = ALL_SECTIONS.find((s) => hasUserAccess(user, s.id, effectivePermissions))?.id;
    if (firstAllowed) {
      router.replace(`/admin/${firstAllowed}`);
      return;
    }

    router.replace('/');
  }, [isLoading, permissionsLoading, isAuthenticated, user, permissions, router]);

  const hasAnyAccess = useMemo(() => {
    if (isLoading || permissionsLoading) return true;
    if (!isAuthenticated || !user) return true;
    const effectivePermissions = permissions ?? initialPermissions;
    return ALL_SECTIONS.some((s) => hasUserAccess(user, s.id, effectivePermissions));
  }, [isLoading, permissionsLoading, isAuthenticated, user, permissions]);

  if (isLoading || permissionsLoading) return null;
  if (!isAuthenticated || !user) return null;
  if (hasAnyAccess) return null;

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
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
    </div>
  );
}
