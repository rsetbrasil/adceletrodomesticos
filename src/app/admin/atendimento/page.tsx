
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { ChatMessage, ChatSession, ChatAttachment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, UserCircle, CheckCircle, Circle, Paperclip, FileText, Download, Trash2, Pencil, Save, X, Search, ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAdmin, useAdminData } from '@/context/AdminContext';
import { useAudit } from '@/context/AuditContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const notificationSound = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export default function AtendimentoPage() {
    const { user } = useAuth();
    const { deleteChatSession, updateChatSession } = useAdmin();
    const { logAction } = useAudit();
    const { chatSessions: sessions } = useAdminData();
    const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [filter, setFilter] = useState<'open' | 'active' | 'closed'>('open');
    const [nameFilter, setNameFilter] = useState('');
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [db, setDb] = useState<Firestore | null>(null);
    const { toast } = useToast();
    const prevSessionsRef = useRef<ChatSession[]>([]);

    const [isEditingName, setIsEditingName] = useState(false);
    const [editingNameValue, setEditingNameValue] = useState('');

    const originalTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');
    const titleIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [imageToView, setImageToView] = useState<string | null>(null);

    useEffect(() => {
        try {
            setDb(getClientFirebase().db);
        } catch {
            setDb(null);
        }
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined' && !audioRef.current) {
            audioRef.current = new Audio(notificationSound);
        }
    }, []);

    useEffect(() => {
        const hasUnread = sessions.some(session => session.unreadBySeller);
        
        if (hasUnread) {
            const lastUnreadSession = sessions.find(session => session.unreadBySeller);
            const prevSession = prevSessionsRef.current.find(p => p.id === lastUnreadSession?.id);
            
            if (hasInteracted && lastUnreadSession && (!prevSession || !prevSession.unreadBySeller)) {
                audioRef.current?.play().catch(e => console.error("Error playing sound:", e));
            }

            if (document.hidden && !titleIntervalRef.current) {
                let isOriginalTitle = true;
                titleIntervalRef.current = setInterval(() => {
                    document.title = isOriginalTitle ? `(NOVO) Atendimento` : originalTitleRef.current;
                    isOriginalTitle = !isOriginalTitle;
                }, 1000);
            }
        }
        
        prevSessionsRef.current = sessions;

    }, [sessions, hasInteracted]);


    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                if (titleIntervalRef.current) {
                    clearInterval(titleIntervalRef.current);
                    titleIntervalRef.current = null;
                    document.title = originalTitleRef.current;
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (titleIntervalRef.current) {
                clearInterval(titleIntervalRef.current);
                document.title = originalTitleRef.current;
            }
        };
    }, []);


    useEffect(() => {
        if (!selectedSession || !db) {
            setMessages([]);
            return;
        }

        const messagesRef = collection(db, 'chatSessions', selectedSession.id, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedMessages: ChatMessage[] = [];
            snapshot.forEach(doc => {
                fetchedMessages.push({ sessionId: selectedSession.id, ...doc.data() } as ChatMessage);
            });
            setMessages(fetchedMessages);
        });

        return () => unsubscribe();
    }, [selectedSession, db]);
    
    useEffect(() => {
        if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTo({
                top: scrollAreaRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages]);

    const handleSelectSession = async (session: ChatSession) => {
        if (!db) return;
        if (!hasInteracted && audioRef.current) {
          audioRef.current.play().catch(() => {});
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          setHasInteracted(true);
        }

        setSelectedSession(session);
        setIsEditingName(false);
        const sessionRef = doc(db, 'chatSessions', session.id);

        const updates: Partial<ChatSession> = { unreadBySeller: false };
        if (session.status === 'open') {
            updates.status = 'active';
            updates.sellerId = user?.id;
            updates.sellerName = user?.name;
        }
        await updateDoc(sessionRef, updates);
    };

    const handleSendMessage = async (text: string, attachmentFile: File | null) => {
        if (!db) return;
        if (!selectedSession || !user) return;

        let attachment: ChatAttachment | null = null;
        if (attachmentFile) {
            let fileType: 'image' | 'pdf' | null = null;
            if (attachmentFile.type.startsWith('image/')) {
                fileType = 'image';
            } else if (attachmentFile.type === 'application/pdf') {
                fileType = 'pdf';
            } else {
                toast({ title: "Tipo de arquivo não suportado", description: "Por favor, envie apenas imagens ou arquivos PDF.", variant: "destructive" });
                return;
            }

            try {
                const url = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.onerror = (error) => reject(error);
                    reader.readAsDataURL(attachmentFile);
                });
                attachment = {
                    name: attachmentFile.name,
                    type: fileType,
                    url: url,
                };
            } catch (error) {
                console.error("Error processing file:", error);
                toast({ title: "Erro ao processar anexo", variant: 'destructive' });
                return;
            }
        }
        
        const messageText = text || (attachment ? attachment.name : '');
        if (messageText.trim() === '' && !attachment) return;
    
        const messageData: Partial<ChatMessage> = {
            text: messageText,
            sender: 'seller',
            senderName: user.name,
            timestamp: new Date().toISOString(),
        };

        if (attachment) {
            messageData.attachment = attachment;
        }

        const messagesRef = collection(db, 'chatSessions', selectedSession.id, 'messages');
        await addDoc(messagesRef, messageData);
    
        const sessionRef = doc(db, 'chatSessions', selectedSession.id);
        await updateDoc(sessionRef, {
            lastMessageAt: new Date().toISOString(),
            lastMessageText: attachment ? `Anexo: ${attachment.name}` : messageText,
            unreadByVisitor: true,
        });

        setNewMessage('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await handleSendMessage(newMessage, null);
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            toast({ title: "Arquivo muito grande", description: "O tamanho máximo do arquivo é 5MB.", variant: "destructive" });
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }
        
        await handleSendMessage('', file);
    };
    
    const handleCloseSession = async () => {
        if (!db) return;
        if (!selectedSession || !user) return;
        const sessionRef = doc(db, 'chatSessions', selectedSession.id);
        
        const surveyMessage: ChatMessage = {
            id: `survey-${Date.now()}`,
            text: 'Como você avalia nosso atendimento?',
            sender: 'seller',
            senderName: 'Sistema',
            timestamp: new Date().toISOString(),
            type: 'survey',
            sessionId: selectedSession.id,
        };

        const messagesRef = collection(db, 'chatSessions', selectedSession.id, 'messages');
        await addDoc(messagesRef, surveyMessage);
        
        await updateDoc(sessionRef, { 
            status: 'awaiting-feedback',
            unreadByVisitor: true,
            lastMessageAt: new Date().toISOString(),
            lastMessageText: surveyMessage.text,
            satisfaction: null,
        });
        
        toast({
            title: "Atendimento Encerrado",
            description: "Uma pesquisa de satisfação foi enviada ao cliente.",
        });
    };
    
    const handleDeleteSession = async () => {
        if (!selectedSession || user?.role !== 'admin') return;
        
        await deleteChatSession(selectedSession.id, logAction, user);
        setSelectedSession(null);
    }

    const handleSaveName = async () => {
        if (!selectedSession || !editingNameValue.trim()) return;

        await updateChatSession(selectedSession.id, { visitorName: editingNameValue.trim() }, logAction, user);
        setIsEditingName(false);
    };

    const filteredSessions = useMemo(() => {
        return sessions.filter(session => {
            let statusMatch = false;
            switch(filter) {
                case 'open':
                    statusMatch = session.status === 'open' || session.unreadBySeller;
                    break;
                case 'active':
                    statusMatch = session.status === 'active';
                    break;
                case 'closed':
                    statusMatch = session.status === 'closed' || session.status === 'awaiting-feedback';
                    break;
            }

            const nameMatch = !nameFilter || session.visitorName?.toLowerCase().includes(nameFilter.toLowerCase());

            return statusMatch && nameMatch;
        });
    }, [sessions, filter, nameFilter]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 h-[calc(100vh-10rem)] border rounded-lg overflow-hidden">
            <aside className={cn("border-r flex-col", selectedSession && "hidden md:flex", !selectedSession && "flex col-span-1 md:col-span-1")}>
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <MessageSquare /> Atendimento
                    </h2>
                    <div className="relative mt-4">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Buscar por nome..."
                            className="pl-8 w-full"
                            value={nameFilter}
                            onChange={(e) => setNameFilter(e.target.value)}
                        />
                    </div>
                     <div className="flex gap-2 mt-4">
                        <Button variant={filter === 'open' ? 'default' : 'outline'} onClick={() => setFilter('open')} size="sm">Não lidos</Button>
                        <Button variant={filter === 'active' ? 'default' : 'outline'} onClick={() => setFilter('active')} size="sm">Ativos</Button>
                        <Button variant={filter === 'closed' ? 'default' : 'outline'} onClick={() => setFilter('closed')} size="sm">Fechados</Button>
                    </div>
                </div>
                <ScrollArea className="flex-grow">
                    {filteredSessions.map(session => (
                        <button
                            key={session.id}
                            onClick={() => handleSelectSession(session)}
                            className={cn(
                                "w-full text-left p-4 border-b hover:bg-muted/50",
                                selectedSession?.id === session.id && "bg-muted"
                            )}
                        >
                            <div className="flex justify-between items-start">
                                <p className="font-semibold truncate">{session.visitorName || 'Visitante'}</p>
                                {session.unreadBySeller && <Badge variant="destructive" className="animate-pulse">Novo</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">{session.lastMessageText}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true, locale: ptBR })}
                            </p>
                            {session.sellerName && <Badge variant="secondary" className="mt-2">Atendido por: {session.sellerName}</Badge>}
                        </button>
                    ))}
                </ScrollArea>
            </aside>
            <main className={cn("flex-col", selectedSession ? "flex md:col-span-2" : "hidden md:flex md:col-span-2")}>
                {selectedSession ? (
                    <>
                        <CardHeader className="flex-col md:flex-row justify-between items-start md:items-center border-b">
                             <div className="flex items-center gap-2">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <Input 
                                            value={editingNameValue}
                                            onChange={(e) => setEditingNameValue(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                                            className="h-9"
                                        />
                                        <Button size="icon" className="h-9 w-9" onClick={handleSaveName}><Save className="h-4 w-4" /></Button>
                                        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setIsEditingName(false)}><X className="h-4 w-4" /></Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center">
                                            <Button variant="ghost" size="icon" className="md:hidden mr-2" onClick={() => setSelectedSession(null)}><ArrowLeft className="h-4 w-4"/></Button>
                                            <CardTitle>Chat com {selectedSession.visitorName || 'Visitante'}</CardTitle>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-8 w-8"
                                            onClick={() => {
                                                setEditingNameValue(selectedSession.visitorName || '');
                                                setIsEditingName(true);
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    </>
                                )}
                                
                             </div>
                             <div className="flex gap-2 w-full md:w-auto justify-end mt-4 md:mt-0">
                                <Button variant="outline" onClick={handleCloseSession}>Encerrar Atendimento</Button>
                                {user?.role === 'admin' && (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive">
                                                <Trash2 className="mr-2 h-4 w-4"/>
                                                <span className="hidden sm:inline">Excluir Conversa</span>
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Esta ação não pode ser desfeita. Isso excluirá permanentemente a conversa e todas as suas mensagens.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleDeleteSession}>Sim, Excluir</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                )}
                             </div>
                        </CardHeader>
                        <CardContent className="flex-grow p-0">
                            <ScrollArea className="h-[calc(100vh-20rem)]" ref={scrollAreaRef}>
                                <div className="p-6 space-y-4">
                                     {messages.map((msg, index) => (
                                        <div key={`${msg.id}-${index}`} className={cn("flex flex-col", msg.sender === 'seller' ? 'items-end' : 'items-start')}>
                                            <div className={cn("max-w-lg rounded-lg px-3 py-2", msg.sender === 'seller' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                                                {msg.attachment ? (
                                                    <div className="space-y-2">
                                                        {msg.attachment.type === 'image' ? (
                                                            <div 
                                                                className="relative w-48 h-48 cursor-pointer"
                                                                onClick={() => setImageToView(msg.attachment?.url || null)}
                                                            >
                                                                <Image src={msg.attachment.url} alt={msg.attachment.name} layout="fill" className="object-cover rounded-md" />
                                                            </div>
                                                        ) : (
                                                            <a href={msg.attachment.url} download={msg.attachment.name} className="flex items-center gap-2 p-2 rounded-md bg-background/20 hover:bg-background/40">
                                                                <FileText className="h-6 w-6" />
                                                                <span>{msg.attachment.name}</span>
                                                                <Download className="h-4 w-4 ml-auto" />
                                                            </a>
                                                        )}
                                                        {msg.text !== msg.attachment.name && <p className="text-sm">{msg.text}</p>}
                                                    </div>
                                                ) : (
                                                    <p className="text-sm">{msg.text}</p>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground mt-1">
                                                {msg.senderName} - {format(new Date(msg.timestamp), 'HH:mm')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="p-4 border-t">
                            <form onSubmit={handleFormSubmit} className="w-full flex items-center gap-2">
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handleFileChange}
                                    accept="image/png, image/jpeg, image/gif, image/webp, application/pdf"
                                    className="hidden" 
                                />
                                <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
                                    <Paperclip className="h-5 w-5" />
                                </Button>
                                <Input
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Digite sua resposta..."
                                    autoComplete="off"
                                />
                                <Button type="submit" size="icon" disabled={!newMessage.trim()}>
                                    <Send className="h-4 w-4" />
                                </Button>
                            </form>
                        </CardFooter>
                    </>
                ) : (
                    <div className="flex-grow flex flex-col items-center justify-center text-center text-muted-foreground">
                        <MessageSquare className="w-24 h-24 mb-4" />
                        <p className="text-lg font-semibold">Selecione um chat para começar.</p>
                        <p className="text-sm">Os chats não lidos aparecerão na lista ao lado.</p>
                    </div>
                )}
            </main>
             <Dialog open={!!imageToView} onOpenChange={() => setImageToView(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-2 sm:p-4">
                    <DialogHeader>
                        <DialogTitle>Visualizador de Imagem</DialogTitle>
                    </DialogHeader>
                    <div className="relative flex-1 w-full my-4">
                        {imageToView && (
                            <Image src={imageToView} alt="Visualização do anexo" fill className="object-contain" />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

    
    
