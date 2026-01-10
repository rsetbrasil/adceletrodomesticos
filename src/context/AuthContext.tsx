
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { User, UserRole } from '@/lib/types';
import { initialUsers } from '@/lib/users';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch, query, where, getDoc, deleteDoc, documentId, orderBy, startAfter, limit, type DocumentData, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { useAudit } from './AuditContext';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_SESSION_STORAGE_KEY = 'authSession';
const LEGACY_USER_STORAGE_KEY = 'user';
const USERS_CACHE_STORAGE_KEY = 'usersCache';

type StoredAuthSession = {
  user: User;
  expiresAt: number;
};

interface AuthContextType {
  user: User | null;
  users: User[];
  initialUsers: User[];
  login: (user: string, pass: string) => void;
  logout: () => void;
  addUser: (data: Omit<User, 'id'>) => Promise<boolean>;
  updateUser: (userId: string, data: Partial<Omit<User, 'id'>>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  changeMyPassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  isLoading: boolean;
  isAuthenticated: boolean;
  restoreUsers: (users: User[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [isLoading, setIsLoading] = useState(true);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [canValidateSession, setCanValidateSession] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { logAction } = useAudit();
  const logoutTimeoutRef = useRef<number | null>(null);
  const userRef = useRef<User | null>(null);

  const clearLogoutTimeout = () => {
    if (logoutTimeoutRef.current) {
      window.clearTimeout(logoutTimeoutRef.current);
      logoutTimeoutRef.current = null;
    }
  };

  const clearStoredSession = () => {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_USER_STORAGE_KEY);
  };

  const scheduleLogoutAt = (expiresAt: number) => {
    clearLogoutTimeout();
    const delay = Math.max(0, expiresAt - Date.now());
    logoutTimeoutRef.current = window.setTimeout(() => {
      const currentUser = userRef.current;
      if (currentUser) {
        logAction('Logout', `Sessão expirada para "${currentUser.name}".`, currentUser);
      }
      setUser(null);
      clearStoredSession();
      toast({ title: 'Sessão expirada', description: 'Faça login novamente.' });
      router.replace('/login');
    }, delay);
  };

  const readStoredSession = (): StoredAuthSession | null => {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredAuthSession;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.user || typeof parsed.expiresAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const readCachedUsers = (): User[] | null => {
    try {
      const raw = localStorage.getItem(USERS_CACHE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      return parsed as User[];
    } catch {
      return null;
    }
  };

  const writeCachedUsers = (nextUsers: User[]) => {
    try {
      localStorage.setItem(USERS_CACHE_STORAGE_KEY, JSON.stringify(nextUsers));
    } catch {
      return;
    }
  };

  const writeStoredSession = (userToStore: User, expiresAt?: number) => {
    const session: StoredAuthSession = {
      user: userToStore,
      expiresAt: expiresAt ?? Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_USER_STORAGE_KEY);
    scheduleLogoutAt(session.expiresAt);
    return session;
  };
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const cachedUsers = readCachedUsers();
    if (cachedUsers?.length) {
      setUsers(cachedUsers);
    }
    const usersTimeoutId = window.setTimeout(() => {
      setUsers(initialUsers);
      setUsersLoaded(true);
      setCanValidateSession(false);
    }, 8000);
    try {
      const { db } = getClientFirebase();
      getDocs(collection(db, 'users'))
        .then((snapshot) => {
          window.clearTimeout(usersTimeoutId);
          const nextUsers = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as User));
          setUsers(nextUsers);
          writeCachedUsers(nextUsers);
          setUsersLoaded(true);
          setCanValidateSession(true);
        })
        .catch(() => {
          window.clearTimeout(usersTimeoutId);
          errorEmitter.emit(
            'permission-error',
            new FirestorePermissionError({
              path: 'users',
              operation: 'list',
            }),
          );
          setUsers(initialUsers);
          setUsersLoaded(true);
          setCanValidateSession(false);
        });
    } catch (error) {
      window.clearTimeout(usersTimeoutId);
      setUsers(initialUsers);
      setUsersLoaded(true);
      setCanValidateSession(false);
    }
    
    return () => {
      window.clearTimeout(usersTimeoutId);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_SESSION_STORAGE_KEY && e.key !== LEGACY_USER_STORAGE_KEY) return;
      const session = readStoredSession();
      if (!session) {
        clearLogoutTimeout();
        setUser(null);
        return;
      }
      if (Date.now() >= session.expiresAt) {
        clearLogoutTimeout();
        setUser(null);
        clearStoredSession();
        return;
      }
      setUser(session.user);
      scheduleLogoutAt(session.expiresAt);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    try {
      const session = readStoredSession();
      if (session) {
        if (Date.now() >= session.expiresAt) {
          setUser(null);
          clearStoredSession();
          clearLogoutTimeout();
          setIsLoading(false);
          return;
        }
        setUser(session.user);
        scheduleLogoutAt(session.expiresAt);
        setIsLoading(false);
        return;
      }

      const legacy = localStorage.getItem(LEGACY_USER_STORAGE_KEY);
      if (!legacy) {
        setIsLoading(false);
        return;
      }
      const legacyUser = JSON.parse(legacy) as User;
      setUser(legacyUser);
      writeStoredSession(legacyUser);
      setIsLoading(false);
    } catch {
      setUser(null);
      clearStoredSession();
      clearLogoutTimeout();
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !usersLoaded || !canValidateSession) return;

    const latest = users.find(u => u.id === user.id);
    if (!latest) {
      clearLogoutTimeout();
      setUser(null);
      clearStoredSession();
      toast({ title: 'Sessão encerrada', description: 'Seu usuário foi removido ou desativado.' });
      router.replace('/login');
      return;
    }

    const merged: User = { ...user, ...latest };
    delete merged.password;

    const prevCustomEnabled = !!user.customPermissionsEnabled;
    const nextCustomEnabled = !!merged.customPermissionsEnabled;
    const prevCustom = ((user.customPermissions || []) as string[]).slice().sort();
    const nextCustom = ((merged.customPermissions || []) as string[]).slice().sort();
    const sameCustom =
      prevCustom.length === nextCustom.length &&
      prevCustom.every((v, i) => v === nextCustom[i]);

    const isSame =
      user.name === merged.name &&
      user.username === merged.username &&
      user.role === merged.role &&
      prevCustomEnabled === nextCustomEnabled &&
      sameCustom;

    if (isSame) return;

    setUser(merged);
    const currentSession = readStoredSession();
    if (currentSession) {
      writeStoredSession(merged, currentSession.expiresAt);
    } else {
      writeStoredSession(merged);
    }
  }, [router, toast, users, user, usersLoaded, canValidateSession]);

  const login = (username: string, pass: string) => {
    const foundUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!foundUser) {
        toast({ title: 'Falha no Login', description: 'Usuário não encontrado.', variant: 'destructive' });
        return;
    }
    
    // In a real app, this would be a hashed password comparison
    if (foundUser.password === pass) {
        const userToStore = { ...foundUser };
        // Ensure password is not stored in state or localStorage for security
        delete userToStore.password;
        
        setUser(userToStore); 
        writeStoredSession(userToStore);
        logAction('Login', `Usuário "${foundUser.name}" realizou login.`, userToStore);
        router.push('/admin');
        toast({
            title: 'Login bem-sucedido!',
            description: `Bem-vindo(a), ${foundUser.name}.`,
        });
    } else {
        toast({
            title: 'Falha no Login',
            description: 'Senha inválida.',
            variant: 'destructive',
        });
    }
  };

  const logout = () => {
    if (user) {
        logAction('Logout', `Usuário "${user.name}" realizou logout.`, user);
    }
    clearLogoutTimeout();
    setUser(null);
    clearStoredSession();
    router.push('/login');
  };

  const addUser = async (data: Omit<User, 'id'>): Promise<boolean> => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return false;
    }
    const isUsernameTaken = users.some(u => u.username.toLowerCase() === data.username.toLowerCase());
    if (isUsernameTaken) {
        toast({
            title: 'Erro ao Criar Usuário',
            description: 'Este nome de usuário já está em uso.',
            variant: 'destructive',
        });
        return false;
    }

    const newUserId = `user-${Date.now()}`;
    const newUser: User = { ...data, id: newUserId };
    
    const userRef = doc(db, 'users', newUserId);
    setDoc(userRef, newUser).then(() => {
        logAction('Criação de Usuário', `Novo usuário "${data.name}" (Perfil: ${data.role}) foi criado.`, user);
        toast({
            title: 'Usuário Criado!',
            description: `O usuário ${data.name} foi criado com sucesso.`,
        });
    }).catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'create',
            requestResourceData: newUser
        }));
    });
    return true; // Assume success for optimistic UI
  };

  const updateUser = async (userId: string, data: Partial<Omit<User, 'id'>>) => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return;
    }
    if (data.username) {
        const isUsernameTaken = users.some(u => u.id !== userId && u.username.toLowerCase() === data.username?.toLowerCase());
        if (isUsernameTaken) {
            toast({
                title: 'Erro ao Atualizar',
                description: 'Este nome de usuário já está em uso por outra conta.',
                variant: 'destructive',
            });
            return;
        }
    }
    
    const userRef = doc(db, 'users', userId);
    
    const updatedUser = users.find(u => u.id === userId);
    if (updatedUser) {
        let details = `Dados do usuário "${updatedUser.name}" foram alterados.`;
        if (data.name && data.name !== updatedUser.name) {
            details += ` Nome: de "${updatedUser.name}" para "${data.name}".`
        }
        if (data.username && data.username !== updatedUser.username) {
            details += ` Username: de "${updatedUser.username}" para "${data.username}".`
        }
         if (data.role && data.role !== updatedUser.role) {
            details += ` Perfil: de "${updatedUser.role}" para "${data.role}".`
        }
        if (data.password) {
            details += ' Senha foi alterada.';
        }
        logAction('Atualização de Usuário', details, user);
    }
    
    updateDoc(userRef, data).then(() => {
        if (user?.id === userId) {
            const updatedCurrentUser = { ...user, ...data };
            delete updatedCurrentUser.password;
            setUser(updatedCurrentUser);
            const currentSession = readStoredSession();
            if (currentSession) {
              writeStoredSession(updatedCurrentUser, currentSession.expiresAt);
            } else {
              writeStoredSession(updatedCurrentUser);
            }
        }

        toast({
            title: 'Usuário Atualizado!',
            description: 'As informações do usuário foram salvas com sucesso.',
        });
    }).catch(async (error) => {
         errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'update',
            requestResourceData: data
        }));
    });
  };

  const deleteUser = async (userId: string) => {
    if (user?.id === userId) {
      toast({
        title: 'Ação não permitida',
        description: 'Você não pode excluir seu próprio usuário.',
        variant: 'destructive',
      });
      return;
    }
    const { db } = getClientFirebase();
    if (!db) {
      toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
      return;
    }
    const userRef = doc(db, 'users', userId);
    const userToDelete = users.find(u => u.id === userId);

    deleteDoc(userRef).then(() => {
      if (userToDelete) {
        logAction('Exclusão de Usuário', `Usuário "${userToDelete.name}" foi excluído.`, user);
      }
      toast({
        title: 'Usuário Excluído!',
        description: 'O usuário foi removido do sistema.',
        variant: 'destructive',
        duration: 5000,
      });
    }).catch(async (error) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: userRef.path,
        operation: 'delete',
      }));
    });
  };

  const changeMyPassword = async (currentPassword: string, newPassword: string): Promise<boolean> => {
      const { db } = getClientFirebase();
      if (!db) {
          toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
          return false;
      }
      if (!user) {
          toast({ title: "Erro", description: "Você não está logado.", variant: "destructive" });
          return false;
      }
      
      const currentUserInDB = users.find(u => u.id === user.id);
      
      if (!currentUserInDB || currentUserInDB.password !== currentPassword) {
          toast({ title: "Erro", description: "A senha atual está incorreta.", variant: "destructive" });
          return false;
      }

      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, { password: newPassword });
      logAction('Alteração de Senha', `O usuário "${user.name}" alterou a própria senha.`, user);
      toast({ title: "Senha Alterada!", description: "Sua senha foi atualizada com sucesso." });
      return true;
  };
  
  const restoreUsers = async (usersToRestore: User[]) => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return;
    }
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const commitWithRetry = async (batch: ReturnType<typeof writeBatch>, op: 'delete' | 'write') => {
      let delayMs = 600;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await batch.commit();
          await sleep(250);
          return;
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code;
          const shouldRetry = code === 'resource-exhausted' || code === 'unavailable' || code === 'deadline-exceeded';
          if (!shouldRetry || attempt === 5) {
            throw error instanceof Error ? error : new Error(`Firestore ${op} failed`);
          }
          await sleep(delayMs);
          delayMs = Math.min(10_000, Math.floor(delayMs * 1.7));
        }
      }
    };

    const deleteAllDocs = async (collectionName: string) => {
      let last: QueryDocumentSnapshot<DocumentData> | null = null;
      while (true) {
        const q: Query<DocumentData> = last
          ? query(collection(db, collectionName), orderBy(documentId()), startAfter(last), limit(450))
          : query(collection(db, collectionName), orderBy(documentId()), limit(450));
        const snap: QuerySnapshot<DocumentData> = await getDocs(q);
        if (snap.empty) break;

        const batch = writeBatch(db);
        snap.docs.forEach((d: QueryDocumentSnapshot<DocumentData>) => batch.delete(d.ref));
        await commitWithRetry(batch, 'delete');
        last = snap.docs[snap.docs.length - 1] ?? null;
      }
    };

    try {
      await deleteAllDocs('users');

      let batch = writeBatch(db);
      let ops = 0;

      const commitIfNeeded = async (force = false) => {
        if (!force && ops < 400) return;
        if (ops === 0) return;
        await commitWithRetry(batch, 'write');
        batch = writeBatch(db);
        ops = 0;
      };

      for (let i = 0; i < usersToRestore.length; i += 1) {
        const u = usersToRestore[i];
        const id = typeof u?.id === 'string' && u.id.trim() ? u.id.trim() : `restored-user-${Date.now()}-${i}`;
        batch.set(doc(db, 'users', id), { ...u, id });
        ops += 1;
        await commitIfNeeded(false);
      }

      await commitIfNeeded(true);

      setUsers(usersToRestore);
      writeCachedUsers(usersToRestore);

      logAction('Restauração de Usuários', 'Todos os usuários foram restaurados a partir de um backup.', user);
      toast({ title: "Usuários Restaurados!", description: "A lista de usuários foi substituída com sucesso." });
    } catch {
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'users', operation: 'write' }));
    }
  };

  return (
    <AuthContext.Provider value={{ user, users, initialUsers, login, logout, addUser, updateUser, deleteUser, changeMyPassword, isLoading, isAuthenticated: !!user, restoreUsers }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
