

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/lib/types';
import { initialUsers } from '@/lib/users';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch, query, where, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { useAudit } from './AuditContext';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

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
  const router = useRouter();
  const { toast } = useToast();
  const { logAction } = useAudit();
  
  useEffect(() => {
    setIsLoading(true);
    const { db } = getClientFirebase();
    const disableRealtime = process.env.NEXT_PUBLIC_DISABLE_FIRESTORE_LISTEN === 'true';
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    if (disableRealtime) {
      const fetchUsers = async () => {
        try {
          const snap = await getDocs(collection(db, 'users'));
          const fetched = snap.docs.map(d => ({ ...d.data(), id: d.id } as User));
          setUsers(fetched.length > 0 ? fetched : initialUsers);
        } catch {
          setUsers(initialUsers);
        }
      };
      fetchUsers();
      timer = setInterval(fetchUsers, 30000);
    } else {
      unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
          const fetched = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as User));
          setUsers(fetched.length > 0 ? fetched : initialUsers);
      },
      (error) => {
        console.error("Error fetching users:", error);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: 'users',
          operation: 'list',
        }));
        setUsers(initialUsers);
      });
    }
    
    try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
    } catch (error) {
        console.error("Failed to read user from localStorage", error);
        localStorage.removeItem('user');
    } finally {
        setIsLoading(false);
    }
    
    return () => { if (unsubscribe) unsubscribe(); if (timer) clearInterval(timer); };
  }, []);

  const login = (username: string, pass: string) => {
    const sourceUsers = users && users.length > 0 ? users : initialUsers;
    const foundUser = sourceUsers.find(u => u.username.toLowerCase() === username.toLowerCase());

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
        localStorage.setItem('user', JSON.stringify(userToStore));
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
    setUser(null);
    localStorage.removeItem('user');
    router.push('/login');
  };

  const addUser = async (data: Omit<User, 'id'>): Promise<boolean> => {
    const { db } = getClientFirebase();
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
    
    // Log before updating
    const updatedUser = users.find(u => u.id === userId);
    if (updatedUser) {
        let details = `Dados do usuário "${updatedUser.name}" foram alterados.`;
        if (data.name && data.name !== updatedUser.name) {
            details += ` Nome: de "${updatedUser.name}" para "${data.name}".`
        }
        if (data.username && data.username !== updatedUser.username) {
            details += ` Username: de "${updatedUser.username}" para "${data.username}".`
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
            localStorage.setItem('user', JSON.stringify(updatedCurrentUser));
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
    const batch = writeBatch(db);
    
    users.forEach(existingUser => {
        batch.delete(doc(db, 'users', existingUser.id));
    });

    usersToRestore.forEach(u => {
        const docRef = doc(db, 'users', u.id);
        batch.set(docRef, u);
    });

    batch.commit().then(() => {
        logAction('Restauração de Usuários', 'Todos os usuários foram restaurados a partir de um backup.', user);
        toast({ title: "Usuários Restaurados!", description: "A lista de usuários foi substituída com sucesso." });
    }).catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'users',
            operation: 'write'
        }));
    });
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
