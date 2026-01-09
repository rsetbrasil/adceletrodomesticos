'use client';

import { AuthProvider } from '@/context/AuthContext';
import { CustomerAuthProvider } from '@/context/CustomerAuthContext';
import { CartProvider } from '@/context/CartContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { PermissionsProvider } from '@/context/PermissionsContext';
import { Toaster } from '@/components/ui/toaster';
import { AuditProvider } from '@/context/AuditContext';
import FirebaseErrorListener from '@/components/FirebaseErrorListener';
import { DataProvider } from '@/context/DataContext';
import { AdminProvider } from '@/context/AdminContext';
import { ThemeProvider } from 'next-themes';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

function ThemeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdminRoute = pathname.startsWith('/admin');
  const storageKey = isAdminRoute ? `theme-admin-${user?.id ?? 'anon'}` : 'theme-public';
  const forcedTheme = isAdminRoute ? undefined : 'light';

  return (
    <ThemeProvider
      key={`${storageKey}:${forcedTheme ?? 'auto'}`}
      attribute="class"
      storageKey={storageKey}
      defaultTheme={isAdminRoute ? 'system' : 'light'}
      enableSystem={isAdminRoute}
      forcedTheme={forcedTheme}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuditProvider>
      <AuthProvider>
        <ThemeGate>
          <SettingsProvider>
            <DataProvider>
              <PermissionsProvider>
                <AdminProvider>
                  <CustomerAuthProvider>
                    <CartProvider>
                      {children}
                      <Toaster />
                      <FirebaseErrorListener />
                    </CartProvider>
                  </CustomerAuthProvider>
                </AdminProvider>
              </PermissionsProvider>
            </DataProvider>
          </SettingsProvider>
        </ThemeGate>
      </AuthProvider>
      <SpeedInsights />
    </AuditProvider>
  );
}

