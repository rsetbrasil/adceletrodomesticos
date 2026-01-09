

'use client';

import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { CustomerAuthProvider } from '@/context/CustomerAuthContext';
import { CartProvider } from '@/context/CartContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { PermissionsProvider } from '@/context/PermissionsContext';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { AuditProvider } from '@/context/AuditContext';
import FirebaseErrorListener from '@/components/FirebaseErrorListener';
import { DataProvider } from '@/context/DataContext';
import { AdminProvider } from '@/context/AdminContext';
import { ThemeProvider } from "next-themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Inter } from 'next/font/google';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  
  return (
    <html lang="pt-BR" suppressHydrationWarning className={cn(inter.variable)}>
      <head>
        <title>ADC MÓVEIS E ELETROS</title>
        <meta name="description" content="ADC MÓVEIS E ELETROS - Sua loja de móveis e eletrodomésticos." />
        <link rel="dns-prefetch" href="https://firestore.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        <link rel="dns-prefetch" href="https://firebaseinstallations.googleapis.com" />
        <link rel="dns-prefetch" href="https://identitytoolkit.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://firebaseinstallations.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body className="font-body antialiased">
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
        </AuditProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
