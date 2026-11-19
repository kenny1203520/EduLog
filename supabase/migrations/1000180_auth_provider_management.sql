-- Only deployment owners inherit identity-provider management.
INSERT INTO public.permissions (key, name, description, domain, resource, action)
VALUES ('system.auth.providers.manage', '管理登入供應商', '管理 GoTrue 自訂登入供應商及憑證', 'system', 'auth', 'providers_manage')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
SELECT roles.id, permissions.id, 'system', NULL, 'allow'
FROM public.roles
JOIN public.permissions ON permissions.key = 'system.auth.providers.manage'
WHERE roles.is_builtin AND roles.domain = 'system' AND roles.code = 'system_owner'
ON CONFLICT DO NOTHING;
