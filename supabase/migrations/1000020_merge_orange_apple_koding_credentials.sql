-- ==========================================
-- Merge Orange Apple credentials into Koding.school platform naming
-- ==========================================

UPDATE public.student_credentials
SET platform = 'Koding School (Orange Apple)'
WHERE platform IN ('Orange Apple', 'Koding School');

UPDATE public.teacher_credentials
SET platform = 'Koding School (Orange Apple)'
WHERE platform IN ('Orange Apple', 'Koding School');
