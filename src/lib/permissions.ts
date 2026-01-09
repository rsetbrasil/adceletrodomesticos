


import type { User, UserRole, AppSection, RolePermissions } from './types';

export const ALL_SECTIONS: { id: AppSection, label: string }[] = [
    { id: 'pedidos', label: 'Pedidos' },
    { id: 'criar-pedido', label: 'Criar Pedido' },
    { id: 'clientes', label: 'Clientes' },
    { id: 'atendimento', label: 'Atendimento' },
    { id: 'produtos', label: 'Produtos' },
    { id: 'categorias', label: 'Categorias' },
    { id: 'avarias', label: 'Avarias' },
    { id: 'financeiro', label: 'Financeiro' },
    { id: 'minhas-comissoes', label: 'Minhas Comissões' },
    { id: 'auditoria', label: 'Auditoria' },
    { id: 'configuracao', label: 'Configurações' },
    { id: 'usuarios', label: 'Usuários' },
];

export const initialPermissions: RolePermissions = {
    vendedor: [
        'pedidos',
        'criar-pedido',
        'clientes',
        'produtos',
        'minhas-comissoes',
        'avarias',
        'atendimento',
    ],
    gerente: [
        'pedidos',
        'criar-pedido',
        'clientes',
        'produtos',
        'categorias',
        'avarias',
        'financeiro',
        'minhas-comissoes',
        'auditoria',
        'configuracao',
        'atendimento',
    ],
    admin: [
        'pedidos',
        'criar-pedido',
        'clientes',
        'produtos',
        'categorias',
        'avarias',
        'financeiro',
        'minhas-comissoes',
        'auditoria',
        'configuracao',
        'usuarios',
        'atendimento',
    ],
};


export function hasAccess(role: UserRole, section: AppSection, permissions: RolePermissions): boolean {
    if (role === 'admin') return true; // Admin always has access
    const rolePermissions = permissions[role];
    if (!rolePermissions) {
        return false;
    }
    return rolePermissions.includes(section);
}

export function hasUserAccess(user: User, section: AppSection, permissions: RolePermissions): boolean {
    if (user.role === 'admin') return true;
    const roleAllows = hasAccess(user.role, section, permissions);
    if (!roleAllows) return false;
    if (!user.customPermissionsEnabled) return true;
    if (!user.customPermissions) return roleAllows;
    return user.customPermissions.includes(section);
}
