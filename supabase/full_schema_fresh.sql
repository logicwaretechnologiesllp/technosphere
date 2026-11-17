-- ====================================================================
-- TECHNOSPHERE B2B PROCUREMENT & RFQ MANAGEMENT SYSTEM
-- COMPLETE PRODUCTION DATABASE SCHEMA (FRESH START)
-- ====================================================================

-- 1. EXTENSIONS & UTILITIES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------
-- 2. PROFILES TABLE (Linked to auth.users)
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff', 'vendor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by authenticated users"
ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 3. CATEGORIES TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Categories viewable by authenticated users and anon"
ON public.categories FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "Categories editable by authenticated users"
ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 4. VENDORS TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    contact_person TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    secondary_contact_person TEXT,
    secondary_phone TEXT,
    secondary_email TEXT,
    address TEXT,
    gst_number TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    registration_status TEXT NOT NULL DEFAULT 'approved' CHECK (registration_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_status ON public.vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_company_name ON public.vendors(company_name);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors viewable by authenticated users"
ON public.vendors FOR SELECT TO authenticated USING (true);

CREATE POLICY "Vendors editable by authenticated users"
ON public.vendors FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 5. VENDOR_CATEGORIES (Junction Table)
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vendor_category_unique UNIQUE(vendor_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor_id ON public.vendor_categories(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category_id ON public.vendor_categories(category_id);

ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor categories viewable by authenticated users"
ON public.vendor_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Vendor categories editable by authenticated users"
ON public.vendor_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ----------------------------------------------------
-- 6. VENDOR_REGISTRATIONS (Public Self-Onboarding)
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    contact_person TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    category_ids UUID[] DEFAULT '{}',
    address TEXT,
    gst_number TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_registrations_status ON public.vendor_registrations(status);

ALTER TABLE public.vendor_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendor registrations readable by authenticated users"
ON public.vendor_registrations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anyone can submit vendor registration"
ON public.vendor_registrations FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Vendor registrations updateable by authenticated users"
ON public.vendor_registrations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_vendor_registrations_updated_at BEFORE UPDATE ON public.vendor_registrations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 7. LEADS / RFQ REQUISITIONS TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    lead_name TEXT NOT NULL,
    product_item TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    specifications TEXT,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_to_send', 'sent', 'quoted', 'completed', 'cancelled')),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    delivery_terms TEXT,
    warranty TEXT,
    unit_price_estimate NUMERIC(12, 2),
    gst_rate NUMERIC(5, 2) DEFAULT 18.00,
    expected_credit_terms TEXT,
    remarks TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Closure & Winner Extensions
    closure_outcome TEXT CHECK (closure_outcome IN ('win', 'lost')),
    winning_vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
    winning_amount NUMERIC(14, 2),
    closure_notes TEXT,
    closed_at TIMESTAMPTZ,
    loss_reason TEXT,
    closure_items JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_category_id ON public.leads(category_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_winning_vendor_id ON public.leads(winning_vendor_id);
CREATE INDEX IF NOT EXISTS idx_leads_closure_outcome ON public.leads(closure_outcome);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leads readable by authenticated users"
ON public.leads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Leads manageable by authenticated users"
ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 8. LEAD_ATTACHMENTS TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead_id ON public.lead_attachments(lead_id);

ALTER TABLE public.lead_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lead attachments viewable by authenticated users"
ON public.lead_attachments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Lead attachments manageable by authenticated users"
ON public.lead_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ----------------------------------------------------
-- 9. LEAD_VENDORS (RFQ-to-Vendor Dispatches)
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    email_sent_at TIMESTAMPTZ,
    whatsapp_prepared BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_prepared_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT lead_vendor_unique UNIQUE(lead_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_vendors_lead_id ON public.lead_vendors(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_vendors_vendor_id ON public.lead_vendors(vendor_id);

ALTER TABLE public.lead_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lead vendors viewable by authenticated users"
ON public.lead_vendors FOR SELECT TO authenticated USING (true);

CREATE POLICY "Lead vendors manageable by authenticated users"
ON public.lead_vendors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ----------------------------------------------------
-- 10. MESSAGE_LOGS (Audit Trail)
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    recipient TEXT NOT NULL,
    subject TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('prepared', 'sent', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_logs_created_at ON public.message_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_logs_lead_id ON public.message_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_vendor_id ON public.message_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_channel ON public.message_logs(channel);
CREATE INDEX IF NOT EXISTS idx_message_logs_status ON public.message_logs(status);

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Message logs viewable by authenticated users"
ON public.message_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Message logs insertable by authenticated users"
ON public.message_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ----------------------------------------------------
-- 11. SYSTEM_SETTINGS TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System settings readable by authenticated users"
ON public.system_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "System settings manageable by authenticated users"
ON public.system_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------
-- 12. MFA SECURITY TABLES
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mfa_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON public.mfa_backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_used ON public.mfa_backup_codes(used);

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Backup codes viewable by owner"
ON public.mfa_backup_codes FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

CREATE POLICY "Backup codes manageable by owner"
ON public.mfa_backup_codes FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

-- EMAIL OTP CHALLENGES
CREATE TABLE IF NOT EXISTS public.email_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_email TEXT,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otp_user ON public.email_otp_challenges(user_id);

ALTER TABLE public.email_otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Email OTP challenges viewable by owner"
ON public.email_otp_challenges FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

CREATE POLICY "Email OTP challenges manageable by owner"
ON public.email_otp_challenges FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

-- USER MFA SETTINGS
CREATE TABLE IF NOT EXISTS public.user_mfa_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_otp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    otp_email TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    preferred_method TEXT NOT NULL DEFAULT 'totp' CHECK (preferred_method IN ('totp', 'email', 'backup')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_mfa_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User MFA settings viewable by owner"
ON public.user_mfa_settings FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

CREATE POLICY "User MFA settings editable by owner"
ON public.user_mfa_settings FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

-- ----------------------------------------------------
-- 13. PASSWORD RESET CHALLENGES TABLE
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_email ON public.password_reset_challenges(email);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_user ON public.password_reset_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_code_hash ON public.password_reset_challenges(code_hash);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_used ON public.password_reset_challenges(used);

ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Password reset challenges viewable by owner"
ON public.password_reset_challenges FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------
-- 14. STORAGE BUCKETS SETUP & POLICIES
-- ----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('lead-attachments', 'lead-attachments', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv']),
  ('vendor-documents', 'vendor-documents', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS Policies for lead-attachments
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload lead attachments' AND tablename = 'objects') THEN
        CREATE POLICY "Authenticated users can upload lead attachments"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'lead-attachments');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can select lead attachments' AND tablename = 'objects') THEN
        CREATE POLICY "Authenticated users can select lead attachments"
        ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'lead-attachments');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete lead attachments' AND tablename = 'objects') THEN
        CREATE POLICY "Authenticated users can delete lead attachments"
        ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'lead-attachments');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anon can view public lead attachments' AND tablename = 'objects') THEN
        CREATE POLICY "Anon can view public lead attachments"
        ON storage.objects FOR SELECT TO anon
        USING (bucket_id = 'lead-attachments');
    END IF;
END $$;

